import { describe, expect, it } from 'vitest';
import { NO_UPGRADES, playerStats, SHOT_COST } from './config';
import { MENU_ENEMY_X, TOWER_TOP, TOWER_X } from './layout';
import {
  AIM_MAX,
  AIM_MIN,
  Apple,
  BattleModel,
  COOP_TOWERS,
  enemyFor,
  ROUND_PAUSE,
  ROUNDS_TO_WIN,
  VERSUS_TOWER_X,
  type BattleEvent,
  type Who,
} from './model';
import { WORLD_W } from './types';

const DT = 1 / 60;
type Ev<T extends BattleEvent['type']> = Extract<BattleEvent, { type: T }>;

function run(m: BattleModel, seconds: number): BattleEvent[] {
  const out: BattleEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...m.step(DT));
  return out;
}

function until(m: BattleModel, seconds: number, done: (events: BattleEvent[]) => boolean): BattleEvent[] {
  const out: BattleEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT) && !done(out); i++) out.push(...m.step(DT));
  return out;
}

function of<T extends BattleEvent['type']>(events: BattleEvent[], type: T): Ev<T>[] {
  return events.filter((e): e is Ev<T> => e.type === type);
}

/** Human `who` draws fully aiming at (x, y) and lets go; returns the events of the draw. */
function shootAs(m: BattleModel, who: Who, x: number, y: number, draw = 1): BattleEvent[] {
  const angle = m.aimAt(x, y, draw, who);
  expect(angle).not.toBeNull();
  const h = m.human(who);
  const out: BattleEvent[] = [];
  if (!m.beginDraw(who)) return m.step(DT);
  m.aim(angle!, draw, who);
  for (let i = 0; i < 200 && h.fighter.draw < draw - 1e-9 && h.drawing; i++) out.push(...m.step(DT));
  m.release(who);
  return out;
}

const chest = (m: BattleModel, who: Who) => m.human(who).fighter.body.chest();
const other = (who: Who): Who => (who === 0 ? 1 : 0);

/** One versus round: `winner` shoots the other archer (left at 1 hp) dead. */
function winRound(m: BattleModel, winner: Who): BattleEvent[] {
  const loser = other(winner);
  m.human(loser).fighter.hp = 1;
  const c = chest(m, loser);
  const ev = shootAs(m, winner, c.x, c.y);
  ev.push(...until(m, 2, (e) => of(e, 'roundOver').length > 0));
  return ev;
}

describe('solo mode keeps the one-human API', () => {
  it('human 0 is the player; the solo accessors read and write its controller', () => {
    const m = new BattleModel({ seed: 1 });
    expect(m.mode).toBe('solo');
    expect(m.humans).toHaveLength(1);
    expect(m.human(0).fighter).toBe(m.player);
    expect(m.human(0).tower).toBe(m.tower);
    expect(() => m.human(1)).toThrow();
    expect(m.beginDraw(1)).toBe(false);
    m.stamina = 42;
    expect(m.human(0).stamina).toBe(42);
    m.human(0).selected = 'normal';
    expect(m.selected).toBe('normal');
    expect(m.state).toBe('menu');
    m.stamina = 100;
    expect(m.beginDraw()).toBe(true);
    expect(m.step(DT)).toEqual([{ type: 'start' }, { type: 'draw', side: 'player', who: 0 }]);
    m.aim(0, 1);
    run(m, 1);
    expect(m.release()).toBe(true);
    expect(of(m.step(DT), 'shoot')[0]).toMatchObject({ side: 'player', who: 0 });
    expect(m.shots).toBe(1);
    expect(m.human(0).shots).toBe(1);
    m.enemy!.cooldown = 0;
    const draws = of(run(m, 3), 'draw');
    expect(draws.some((d) => d.side === 'enemy' && d.who === null)).toBe(true);
  });
});

describe('versus mode', () => {
  it('puts P2 on the mirrored tower facing left, on side enemy, with no AI and no menu', () => {
    const stats = { ...playerStats(NO_UPGRADES), armor: 2 };
    const m = new BattleModel({ seed: 2, mode: 'versus', stats, loadout: ['normal', 'axe'] });
    expect(m.state).toBe('playing');
    expect(m.enemy).toBeNull();
    expect(m.fighters).toHaveLength(2);
    const [p1, p2] = [m.human(0), m.human(1)];
    expect(p1.fighter.side).toBe('player');
    expect(p2.fighter.side).toBe('enemy');
    expect(p2.fighter.facing).toBe(-1);
    expect(p1.tower.x).toBe(TOWER_X);
    expect(p2.tower.x).toBe(VERSUS_TOWER_X);
    expect(p1.tower.x + p2.tower.x).toBe(WORLD_W);
    expect(p2.tower.y - p2.tower.h / 2).toBe(TOWER_TOP);
    expect(p2.fighter.armor).toBe(2);
    expect(p2.loadout).toEqual(['normal', 'axe']);
    expect(p2.fighter.hp).toBe(stats.maxHp);
    expect(m.step(DT)).toEqual([{ type: 'start' }, { type: 'roundStart', round: 1 }]);
    const idle = run(m, 8);
    expect(of(idle, 'shoot')).toHaveLength(0);
    expect(of(idle, 'draw')).toHaveLength(0);
  });

  it('mirrors the aim clamp for P2 and lets both archers draw and shoot at the same time', () => {
    const m = new BattleModel({ seed: 3, mode: 'versus' });
    m.step(DT);
    m.aim(0, 1, 1);
    expect(m.human(1).fighter.aimAngle).toBeCloseTo(Math.PI - AIM_MAX);
    m.aim(-Math.PI / 2 + 0.3, 1, 1);
    expect(m.human(1).fighter.aimAngle).toBeCloseTo(Math.PI - AIM_MIN);
    m.aim(-Math.PI / 2 - 0.3, 1, 1);
    expect(m.human(1).fighter.aimAngle).toBeCloseTo(Math.PI * 1.5 - 0.3);
    m.aim(Math.PI + 0.2, 1, 1);
    expect(m.human(1).fighter.aimAngle).toBeCloseTo(Math.PI + 0.2);

    const a1 = m.aimAt(chest(m, 1).x, chest(m, 1).y, 1, 0)!;
    const a2 = m.aimAt(chest(m, 0).x, chest(m, 0).y, 1, 1)!;
    expect(Math.cos(a1)).toBeGreaterThan(0);
    expect(Math.cos(a2)).toBeLessThan(0);
    expect(m.beginDraw(0)).toBe(true);
    expect(m.beginDraw(1)).toBe(true);
    m.aim(a1, 1, 0);
    m.aim(a2, 1, 1);
    const drawEv = run(m, 1);
    expect(of(drawEv, 'draw').map((d) => [d.side, d.who])).toEqual([
      ['player', 0],
      ['enemy', 1],
    ]);
    expect(m.human(0).fighter.draw).toBe(1);
    expect(m.human(1).fighter.draw).toBe(1);
    expect(m.release(0)).toBe(true);
    expect(m.release(1)).toBe(true);
    expect(m.human(1).stamina).toBeLessThanOrEqual(m.human(1).maxStamina - SHOT_COST + 1);
    const ev = run(m, 1.5);
    expect(of(ev, 'shoot').map((s) => s.who)).toEqual([0, 1]);
    const hits = of(ev, 'hit');
    expect(hits.find((h) => h.by === 0)).toMatchObject({ side: 'enemy', who: 1 });
    expect(hits.find((h) => h.by === 1)).toMatchObject({ side: 'player', who: 0 });
    expect(m.human(0).hits).toBe(1);
    expect(m.human(1).hits).toBe(1);
    expect(m.human(0).fighter.hp).toBeLessThan(m.human(0).fighter.maxHp);
    expect(m.human(1).fighter.hp).toBeLessThan(m.human(1).fighter.maxHp);
  });

  it('a death ends the round; late arrows do no harm; the next round resets both archers', () => {
    const m = new BattleModel({ seed: 4, mode: 'versus' });
    m.step(DT);
    m.human(0).fighter.hp = 1;
    m.human(1).fighter.hp = 1;
    const a1 = m.aimAt(chest(m, 1).x, chest(m, 1).y, 1, 0)!;
    const a2 = m.aimAt(chest(m, 0).x, chest(m, 0).y, 0.6, 1)!;
    m.beginDraw(0);
    m.beginDraw(1);
    m.aim(a1, 1, 0);
    m.aim(a2, 0.6, 1);
    run(m, 1);
    m.release(0);
    m.release(1);
    const ev = run(m, 1.5);
    const over = of(ev, 'roundOver');
    expect(over).toHaveLength(1);
    const winner = over[0]!.winner;
    expect(over[0]).toMatchObject({ round: 1, score: winner === 0 ? [1, 0] : [0, 1] });
    expect(m.human(winner).fighter.alive).toBe(true);
    expect(m.human(other(winner)).fighter.alive).toBe(false);
    expect(m.betweenRounds).toBe(true);
    expect(m.state).toBe('playing');
    expect(m.canActFor(winner)).toBe(false);
    expect(m.beginDraw(winner)).toBe(false);
    expect(m.jump(winner)).toBe(false);
    expect(m.human(0).fighter.stuck.length + m.human(1).fighter.stuck.length).toBeGreaterThan(0);

    const next = until(m, ROUND_PAUSE + 0.5, (e) => of(e, 'roundStart').length > 0);
    expect(of(next, 'roundStart')).toEqual([{ type: 'roundStart', round: 2 }]);
    expect(m.round).toBe(2);
    expect(m.betweenRounds).toBe(false);
    for (const h of m.humans) {
      expect(h.fighter.alive).toBe(true);
      expect(h.fighter.hp).toBe(h.fighter.maxHp);
      expect(h.stamina).toBe(h.maxStamina);
      expect(h.fighter.stuck).toHaveLength(0);
      expect(h.tower.stuck).toHaveLength(0);
      expect(h.fighter.body.grounded).toBe(true);
    }
    expect(m.arrows).toHaveLength(0);
    expect(m.apples).toHaveLength(0);
    run(m, 1);
    expect(m.human(0).fighter.body.bottom()).toBeLessThan(TOWER_TOP + 1);
    expect(m.beginDraw(0)).toBe(true);
  });

  it('first to three round wins takes the match; no skulls, no enemies', () => {
    const m = new BattleModel({ seed: 5, mode: 'versus' });
    m.step(DT);
    const log: BattleEvent[] = [];
    const order: Who[] = [0, 1, 0, 0];
    for (const w of order) {
      log.push(...winRound(m, w));
      if (m.state === 'over') break;
      log.push(...until(m, ROUND_PAUSE + 0.5, (e) => of(e, 'roundStart').length > 0));
    }
    expect(of(log, 'roundOver').map((r) => r.score)).toEqual([
      [1, 0],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(of(log, 'roundStart').map((r) => r.round)).toEqual([2, 3, 4]);
    expect(of(log, 'matchOver')).toEqual([{ type: 'matchOver', winner: 0, score: [3, 1] }]);
    expect(ROUNDS_TO_WIN).toBe(3);
    expect(m.state).toBe('over');
    expect(m.winner).toBe(0);
    expect(m.roundScore).toEqual([3, 1]);
    expect(m.beginDraw(0)).toBe(false);
    expect(of(run(m, ROUND_PAUSE + 1), 'roundStart')).toHaveLength(0);
    expect(m.score).toBe(0);
    expect(m.skullsEarned).toBe(0);
    expect(of(log, 'kill')).toHaveLength(0);
    expect(m.enemy).toBeNull();
    expect(m.revive()).toBe(false);
  });

  it('apples fly between the towers and heal whoever shoots them', () => {
    const m = new BattleModel({ seed: 6, mode: 'versus' });
    const xs: number[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      m.step(DT);
      for (const a of m.apples) if (!xs.includes(a.id)) xs.push(a.id) && expect(a.x).toBeGreaterThan(TOWER_X + 200);
    }
    expect(xs.length).toBeGreaterThanOrEqual(3);

    m.apples.length = 0;
    const p2 = m.human(1);
    const angle = m.aimAt(800, 400, 1, 1)!;
    m.beginDraw(1);
    m.aim(angle, 1, 1);
    run(m, 1);
    p2.fighter.hp = 20;
    p2.stamina = 20;
    m.apples.push(new Apple(999, 'gold', 800, 400, 0, 0, 0));
    m.release(1);
    const ev = run(m, 0.4);
    expect(of(ev, 'apple')[0]).toMatchObject({ kind: 'gold', who: 1, hp: 30 });
    expect(of(ev, 'heal')[0]).toMatchObject({ who: 1, amount: 30 });
    expect(p2.fighter.hp).toBe(50);
    expect(m.human(0).fighter.hp).toBe(m.human(0).fighter.maxHp);
  });

  it('balloons can float an archer away, which loses the round', () => {
    const m = new BattleModel({ seed: 7, mode: 'versus', loadout: ['balloon'] });
    m.step(DT);
    m.human(1).fighter.hp = m.human(1).fighter.maxHp = 1e4;
    for (let i = 0; i < 2; i++) {
      shootAs(m, 0, chest(m, 1).x, chest(m, 1).y);
      run(m, 1);
    }
    expect(m.human(1).fighter.lifted).toBe(true);
    const ev = until(m, 8, (e) => of(e, 'roundOver').length > 0);
    expect(of(ev, 'roundOver')[0]).toMatchObject({ winner: 0 });
    expect(m.fighters).toHaveLength(2);
    until(m, ROUND_PAUSE + 0.5, (e) => of(e, 'roundStart').length > 0);
    expect(m.human(1).fighter.balloons).toBe(0);
    expect(m.human(1).fighter.body.bottom()).toBeCloseTo(TOWER_TOP, -1);
  });
});

/** A co-op model after the first enemy glided in, holding its fire. */
function coop(seed = 1, stats = playerStats(NO_UPGRADES)): BattleModel {
  const m = new BattleModel({ seed, mode: 'coop', stats });
  run(m, 1.3);
  m.enemy!.cooldown = 1e9;
  return m;
}

/** Fast, dead-accurate first enemy: every shot lands. */
function sharpen(m: BattleModel): void {
  const e = m.enemy!;
  (e as { spec: unknown }).spec = { ...enemyFor(0), cooldown: 0.3, drawTime: 0.4, aimError: 0, arrow: 'normal' };
  e.cooldown = 0;
}

describe('co-op mode', () => {
  it('two archers on side player on separate towers; the first enemy glides in', () => {
    const m = new BattleModel({ seed: 1, mode: 'coop' });
    const first = m.step(DT);
    expect(first.map((e) => e.type)).toEqual(['start', 'arrive']);
    expect(m.state).toBe('playing');
    const [p1, p2] = [m.human(0), m.human(1)];
    expect(p1.fighter.side).toBe('player');
    expect(p2.fighter.side).toBe('player');
    expect(p1.tower).not.toBe(p2.tower);
    expect(p1.tower.x + p1.tower.w / 2).toBeLessThan(p2.tower.x - p2.tower.w / 2);
    expect(p1.tower.x).toBe(COOP_TOWERS[0]!.x);
    expect(p2.fighter.body.stand.y).toBe(COOP_TOWERS[1]!.top);
    expect(p1.fighter.body.stand.y).toBeLessThan(p2.fighter.body.stand.y);
    expect(m.enemy!.arrived).toBe(false);
    run(m, 1.2);
    expect(m.enemy!.arrived).toBe(true);
    expect(m.enemy!.platform.standX).toBeCloseTo(MENU_ENEMY_X);
    for (const who of [0, 1] as const) {
      for (const [x, y] of [
        [1050, 200],
        [1400, 200],
        [1050, 560],
        [1400, 560],
      ] as const) {
        expect(m.aimAt(x, y, 1, who), `P${who + 1} -> ${x},${y}`).not.toBeNull();
      }
    }
  });

  it('both archers can hit the enemy; the back archer shoots over the front one', () => {
    for (const who of [0, 1] as const) {
      const m = coop(2);
      const e = m.enemy!;
      e.hp = e.maxHp = 1e4;
      const c = e.body.chest();
      const ev = [...shootAs(m, who, c.x, c.y), ...run(m, 1.2)];
      expect(of(ev, 'hit')[0], `P${who + 1}`).toMatchObject({ side: 'enemy', by: who, who: null });
      expect(of(ev, 'thunk').filter((t) => t.platform === 'tower')).toHaveLength(0);
      expect(m.human(who).hits).toBe(1);
    }
    const m = coop(3);
    for (const [x, y] of [
      [1050, 560],
      [1400, 560],
      [1100, 250],
    ] as const) {
      const ev = [...shootAs(m, 0, x, y), ...run(m, 1.5)];
      expect(of(ev, 'thunk').filter((t) => t.platform === 'tower'), `P1 -> ${x},${y}`).toHaveLength(0);
      expect(of(ev, 'hit').filter((h) => h.side === 'player')).toHaveLength(0);
      run(m, 1);
    }
  });

  it('the enemy AI picks its target among the humans it can shoot', () => {
    const m = coop(4);
    for (const h of m.humans) h.fighter.hp = h.fighter.maxHp = 1e9;
    sharpen(m);
    const targets = new Set<Who>();
    const hitOn = [0, 0];
    for (let i = 0; i < 60 * 40; i++) {
      for (const e of m.step(DT)) {
        if (e.type === 'draw' && e.side === 'enemy') targets.add(m.enemy!.target!.who);
        if (e.type === 'hit' && e.who !== null) hitOn[e.who]!++;
      }
    }
    expect([...targets].sort()).toEqual([0, 1]);
    expect(hitOn[0]).toBeGreaterThan(3);
    expect(hitOn[1]).toBeGreaterThan(3);

    m.human(0).fighter.knocked = 1e9;
    let draws = 0;
    for (let i = 0; i < 60 * 15; i++) {
      for (const e of m.step(DT)) {
        if (e.type === 'draw' && e.side === 'enemy') {
          draws++;
          expect(m.enemy!.target).toBe(m.human(1));
        }
      }
    }
    expect(draws).toBeGreaterThan(5);
  });

  it('each human has its own lives; game over only when both are out', () => {
    const stats = { ...playerStats(NO_UPGRADES), lives: 2 };
    const m = coop(5, stats);
    expect(m.human(0).livesLeft).toBe(2);
    expect(m.human(1).livesLeft).toBe(2);
    m.human(1).fighter.hp = m.human(1).fighter.maxHp = 1e9;
    m.human(0).fighter.hp = 1;
    sharpen(m);
    let ev = until(m, 30, (e) => of(e, 'lifeLost').length > 0);
    expect(of(ev, 'lifeLost')).toEqual([{ type: 'lifeLost', livesLeft: 1, who: 0 }]);
    ev = until(m, 3, (e) => of(e, 'respawn').length > 0);
    expect(of(ev, 'respawn')).toEqual([{ type: 'respawn', who: 0 }]);
    expect(m.human(0).fighter.hp).toBe(m.human(0).fighter.maxHp);

    m.human(0).fighter.hp = 1;
    ev = until(m, 30, (e) => of(e, 'out').length > 0);
    expect(of(ev, 'out')).toEqual([{ type: 'out', who: 0 }]);
    expect(of(ev, 'gameover')).toHaveLength(0);
    expect(m.state).toBe('playing');
    expect(m.human(0).fighter.alive).toBe(false);
    expect(m.canActFor(0)).toBe(false);
    expect(m.canActFor(1)).toBe(true);

    let draws = 0;
    for (let i = 0; i < 60 * 5; i++) for (const e of m.step(DT)) if (e.type === 'draw' && e.side === 'enemy') draws++;
    expect(draws).toBeGreaterThan(2);
    expect(m.enemy!.target).toBe(m.human(1));

    m.human(1).fighter.hp = m.human(1).fighter.maxHp = 1;
    m.human(1).livesLeft = 1;
    ev = until(m, 30, (e) => of(e, 'gameover').length > 0);
    expect(of(ev, 'gameover')).toHaveLength(1);
    expect(m.state).toBe('over');
    expect(m.humans.every((h) => !h.fighter.alive)).toBe(true);
    expect(m.revive()).toBe(false);
  });

  it('kills by either archer add to the shared score and skulls; the next enemy glides in', () => {
    const m = coop(6);
    m.enemy!.hp = 1;
    const c = m.enemy!.body.chest();
    const ev = [...shootAs(m, 1, c.x, c.y), ...run(m, 0.5)];
    expect(of(ev, 'kill')[0]!.reward).toBe(enemyFor(0).reward);
    expect(m.score).toBe(1);
    expect(m.skullsEarned).toBe(enemyFor(0).reward);
    const arrive = of(run(m, 1.2), 'arrive');
    expect(arrive[0]!.index).toBe(1);
    run(m, 1.2);
    hold(m);
    m.enemy!.hp = 1;
    const c2 = m.enemy!.body.chest();
    shootAs(m, 0, c2.x, c2.y);
    run(m, 1);
    expect(m.score).toBe(2);
    expect(m.skullsEarned).toBe(enemyFor(0).reward + enemyFor(1).reward);
  });

  it('forfeit ends a co-op run with a game over and stops a versus match undecided', () => {
    const m = coop(7);
    m.forfeit();
    expect(m.state).toBe('over');
    expect(of(m.step(DT), 'gameover')).toHaveLength(1);
    const v = new BattleModel({ seed: 7, mode: 'versus' });
    v.forfeit();
    expect(v.state).toBe('over');
    expect(v.winner).toBeNull();
  });

  it('is deterministic for a seed', () => {
    const play = (seed: number) => {
      const m = new BattleModel({ seed, mode: 'coop' });
      const log: string[] = [];
      for (let i = 0; i < 12; i++) {
        const who = (i % 2) as Who;
        const e = m.enemy;
        const c = e?.alive ? e.body.chest() : { x: 1100, y: 450 };
        const ev = m.canActFor(who) ? shootAs(m, who, c.x, c.y) : [];
        ev.push(...run(m, 1.5));
        log.push(ev.map((x) => x.type).join(','));
      }
      return JSON.stringify({ log, hp: m.humans.map((h) => h.fighter.hp), score: m.score, arrows: m.arrows.length });
    };
    expect(play(9)).toBe(play(9));
    expect(play(9)).not.toBe(play(10));
  });
});

function hold(m: BattleModel): void {
  if (m.enemy) m.enemy.cooldown = 1e9;
}
