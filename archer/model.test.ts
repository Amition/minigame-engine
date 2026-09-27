import { Rng } from '@engine';
import { describe, expect, it } from 'vitest';
import { JUMP_COST, NO_UPGRADES, playerStats, SHOT_COST, type ArrowId } from './config';
import { MENU_ENEMY_TOP, MENU_ENEMY_X, TOWER_TOP } from './layout';
import {
  Apple,
  ARROW_GRAVITY,
  BattleModel,
  EXPLOSION_RADIUS,
  enemyFor,
  HEADSHOT_MUL,
  launchSpeed,
  MAX_STUCK_BODY,
  POISON_TIME,
  solveLaunchAngle,
  STUN_TIME,
  type BattleEvent,
} from './model';
import { J, WORLD_H } from './types';

const DT = 1 / 60;
type Ev<T extends BattleEvent['type']> = Extract<BattleEvent, { type: T }>;

function run(m: BattleModel, seconds: number): BattleEvent[] {
  const out: BattleEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...m.step(DT));
  return out;
}

function of<T extends BattleEvent['type']>(events: BattleEvent[], type: T): Ev<T>[] {
  return events.filter((e): e is Ev<T> => e.type === type);
}

/** Draws fully (or to `draw`) aiming at (x, y) plus an angle error, releases, returns the events of the draw. */
function shootAt(m: BattleModel, x: number, y: number, draw = 1, error = 0): BattleEvent[] {
  const angle = m.aimAt(x, y, draw);
  expect(angle).not.toBeNull();
  const out: BattleEvent[] = [];
  if (!m.beginDraw()) return m.step(DT);
  m.aim(angle! + error, draw);
  for (let i = 0; i < 200 && m.draw < draw - 1e-9 && m.drawing; i++) out.push(...m.step(DT));
  m.release();
  return out;
}

function chestOf(m: BattleModel): { x: number; y: number } {
  return m.enemy!.body.chest();
}

/** A model in 'playing' with the enemy holding fire. */
function quiet(seed = 1, loadout: ArrowId[] = ['normal'], stats = playerStats(NO_UPGRADES)): BattleModel {
  const m = new BattleModel({ seed, loadout, stats });
  m.beginDraw();
  m.cancelDraw();
  m.enemy!.cooldown = 1e9;
  run(m, 0.2);
  return m;
}

function hold(m: BattleModel): void {
  if (m.enemy) m.enemy.cooldown = 1e9;
}

describe('battle model', () => {
  it('starts in the menu with an idle enemy that never shoots; the first draw starts the run', () => {
    const m = new BattleModel({ seed: 3 });
    expect(m.state).toBe('menu');
    expect(m.enemy!.platform.standX).toBeCloseTo(MENU_ENEMY_X);
    expect(m.enemy!.platform.standY).toBeCloseTo(MENU_ENEMY_TOP);
    expect(m.tower.kind).toBe('tower');
    expect(m.tower.y - m.tower.h / 2).toBe(TOWER_TOP);
    const idle = run(m, 12);
    expect(of(idle, 'shoot')).toHaveLength(0);
    expect(m.apples).toHaveLength(0);
    expect(m.state).toBe('menu');
    expect(m.beginDraw()).toBe(true);
    const ev = m.step(DT);
    expect(ev.map((e) => e.type)).toEqual(['start', 'draw']);
    expect(m.state).toBe('playing');
  });

  it('is deterministic for a seed', () => {
    const play = (seed: number) => {
      const m = new BattleModel({ seed });
      const r = new Rng(5);
      const log: string[] = [];
      for (let i = 0; i < 12; i++) {
        const c = m.enemy?.alive ? chestOf(m) : { x: 1100, y: 450 };
        const ev = shootAt(m, c.x, c.y, 1, r.gauss(0, 0.04));
        ev.push(...run(m, 1.5));
        log.push(ev.map((e) => e.type).join(','));
      }
      const joints = m.fighters.map((f) => f.joints.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(';'));
      return JSON.stringify({ log, joints, hp: m.hp, score: m.score, arrows: m.arrows.length, stamina: m.stamina });
    };
    expect(play(9)).toBe(play(9));
    expect(play(9)).not.toBe(play(10));
  });

  it('solves the ballistic launch angle (lower arc) that hits a static target', () => {
    for (const [dx, dy, v] of [
      [700, 0, 1400],
      [900, -250, 1500],
      [-800, 120, 1350],
    ] as const) {
      const a = solveLaunchAngle(dx, dy, v)!;
      expect(a).not.toBeNull();
      let x = 0;
      let y = 0;
      let vx = Math.cos(a) * v;
      let vy = Math.sin(a) * v;
      while (Math.abs(x) < Math.abs(dx)) {
        vy += ARROW_GRAVITY * DT;
        x += vx * DT;
        y += vy * DT;
      }
      expect(Math.abs(y - dy)).toBeLessThan(20);
      const high = solveLaunchAngle(dx, dy, v, ARROW_GRAVITY, true)!;
      expect(Math.abs(Math.sin(high))).toBeGreaterThan(Math.abs(Math.sin(a)));
    }
    expect(solveLaunchAngle(5000, 0, 700)).toBeNull();
  });

  it('aimAt lets the player hit the enemy; damage scales with draw and headshots', () => {
    const m = quiet(2);
    const e = m.enemy!;
    const c = chestOf(m);
    const ev = [...shootAt(m, c.x, c.y), ...run(m, 1.2)];
    const hit = of(ev, 'hit')[0]!;
    expect(hit.side).toBe('enemy');
    expect(hit.head).toBe(false);
    expect(hit.damage).toBeCloseTo(m.stats.damage, 5);
    expect(e.stuck).toHaveLength(1);
    expect(m.shots).toBe(1);
    expect(m.hits).toBe(1);

    const m2 = quiet(2);
    const h = m2.enemyHead()!;
    const hev = [...shootAt(m2, h.x, h.y), ...run(m2, 1.2)];
    const hh = of(hev, 'hit')[0]!;
    expect(hh.head).toBe(true);
    expect(hh.kill).toBe(true);
    expect(m2.stats.damage * HEADSHOT_MUL).toBeGreaterThan(enemyFor(0).hp);
    expect(hh.damage).toBe(enemyFor(0).hp);

    const m3 = quiet(2);
    const c3 = chestOf(m3);
    const weak = of([...shootAt(m3, c3.x, c3.y, 0.4), ...run(m3, 2)], 'hit')[0];
    expect(weak?.damage).toBeCloseTo(m3.stats.damage * (0.5 + 0.5 * 0.4), 5);
  });

  it('stuck arrows follow the bone they hit and are capped', () => {
    const m = quiet(4);
    const e = m.enemy!;
    e.hp = e.maxHp = 1e6;
    for (let i = 0; i < MAX_STUCK_BODY + 3; i++) {
      const c = chestOf(m);
      shootAt(m, c.x, c.y);
      run(m, 0.9);
    }
    expect(e.stuck.length).toBe(MAX_STUCK_BODY);
    const st = e.stuck[0]!;
    const before = { x: st.x, y: st.y };
    const pin = e.pins[0]!;
    const joint = (bone: number) => e.body.pos[bone === 7 ? J.head : J.neck]!;
    const d0 = Math.hypot(st.x - joint(pin.bone).x, st.y - joint(pin.bone).y);
    e.body.kill();
    run(m, 0.6);
    expect(Math.hypot(st.x - before.x, st.y - before.y)).toBeGreaterThan(20);
    const d1 = Math.hypot(st.x - joint(pin.bone).x, st.y - joint(pin.bone).y);
    expect(Math.abs(d1 - d0)).toBeLessThan(25);
  });

  it('arrows stick into platforms and follow a falling block', () => {
    const m = quiet(5);
    const pl = m.enemy!.platform;
    const ev = [...shootAt(m, pl.x, pl.y + 20), ...run(m, 1.2)];
    const thunk = of(ev, 'thunk')[0];
    expect(thunk?.platform).toBe('block');
    expect(pl.stuck).toHaveLength(1);
    const y0 = pl.stuck[0]!.y;
    pl.falling = true;
    run(m, 1.5);
    expect(pl.stuck[0]!.y).toBeGreaterThan(y0 + 50);
  });

  it('costs stamina for shots and jumps and refuses when empty', () => {
    const m = quiet(6);
    const full = m.stamina;
    const c = chestOf(m);
    shootAt(m, c.x, c.y);
    expect(m.stamina).toBeLessThan(full - SHOT_COST + 3);
    run(m, 3);
    const s0 = m.stamina;
    expect(m.jump()).toBe(true);
    expect(m.stamina).toBeCloseTo(s0 - JUMP_COST, 5);
    expect(of(m.step(DT), 'jump')).toHaveLength(1);
    const land = of(run(m, 1.5), 'land');
    expect(land).toHaveLength(1);
    m.stamina = SHOT_COST - 1;
    expect(m.beginDraw()).toBe(false);
    expect(of(m.step(DT), 'noStamina')).toHaveLength(1);
    m.stamina = 1;
    expect(m.jump()).toBe(false);
    m.stamina = 0;
    run(m, 1);
    expect(m.stamina).toBeCloseTo(m.stats.regen, 0);
    const d = new BattleModel({ seed: 1 });
    expect(d.beginDraw()).toBe(true);
    d.aim(0, 0.1);
    run(d, 0.5);
    expect(d.release()).toBe(false);
    expect(d.stamina).toBeCloseTo(d.maxStamina, 5);
  });

  it('electric stuns, poison ticks over time, vampire heals the shooter', () => {
    const m = quiet(7, ['normal', 'electric', 'poison', 'vampire']);
    const e = m.enemy!;
    e.hp = e.maxHp = 1e4;
    m.selectArrow('electric');
    let c = chestOf(m);
    let ev = [...shootAt(m, c.x, c.y), ...run(m, 1.1)];
    expect(of(ev, 'zap')).toHaveLength(1);
    expect(e.stun).toBeGreaterThan(STUN_TIME - 1.1);
    e.cooldown = 0;
    run(m, 0.2);
    expect(e.drawing).toBe(false);
    hold(m);

    m.selectArrow('poison');
    c = chestOf(m);
    ev = [...shootAt(m, c.x, c.y), ...run(m, 1.1)];
    expect(of(ev, 'poison')).toHaveLength(1);
    const hp0 = e.hp;
    const dots = of(run(m, POISON_TIME), 'dot');
    expect(dots.length).toBeGreaterThanOrEqual(3);
    expect(hp0 - e.hp).toBeGreaterThan(20);
    expect(e.poison).toBe(0);

    m.selectArrow('vampire');
    m.player.hp = 40;
    c = chestOf(m);
    ev = [...shootAt(m, c.x, c.y), ...run(m, 1.1)];
    const heal = of(ev, 'heal')[0]!;
    expect(heal.amount).toBeCloseTo(m.stats.damage * 0.5, 5);
    expect(m.hp).toBeCloseTo(40 + m.stats.damage * 0.5, 5);
  });

  it('balloons lift an enemy away; floating off the top counts as a kill', () => {
    const m = quiet(8, ['balloon']);
    const e = m.enemy!;
    e.hp = e.maxHp = 1e4;
    for (let i = 0; i < 2; i++) {
      const c = chestOf(m);
      shootAt(m, c.x, c.y);
      run(m, 1);
    }
    expect(e.balloons).toBe(2);
    expect(e.lifted).toBe(true);
    const ev = run(m, 6);
    const kill = of(ev, 'kill')[0];
    expect(kill?.balloon).toBe(true);
    expect(m.score).toBe(1);
    expect(m.fighters.includes(e)).toBe(false);
  });

  it('explosive arrows blast on any impact with falloff and knockback', () => {
    const m = quiet(9, ['explosive']);
    const e = m.enemy!;
    e.hp = e.maxHp = 1e4;
    const c = chestOf(m);
    const ev = [...shootAt(m, c.x, c.y), ...run(m, 1.1)];
    const ex = of(ev, 'explode')[0]!;
    expect(ex.radius).toBe(EXPLOSION_RADIUS);
    const hit = of(ev, 'hit')[0]!;
    expect(hit.blast).toBe(true);
    expect(hit.damage).toBeCloseTo(m.stats.damage * 1.4, 5);
    expect(e.stuck).toHaveLength(0);
    const pl = e.platform;
    const hp1 = e.hp;
    const ev2 = [...shootAt(m, pl.x, pl.y + 45), ...run(m, 1.1)];
    expect(of(ev2, 'explode')).toHaveLength(1);
    expect(of(ev2, 'thunk')).toHaveLength(0);
    const splash = of(ev2, 'hit')[0];
    expect(splash).toBeDefined();
    expect(splash!.damage).toBeLessThan(m.stats.damage * 1.4);
    expect(e.hp).toBeLessThan(hp1);
  });

  it('axe arrows fall faster and knock bodies back harder', () => {
    const push = (type: ArrowId) => {
      const m = quiet(10, [type]);
      m.enemy!.hp = m.enemy!.maxHp = 1e4;
      const c = chestOf(m);
      const head0 = { ...m.enemy!.body.pos[J.head]! };
      const angle = m.aimAt(c.x, c.y)!;
      shootAt(m, c.x, c.y);
      const y0 = m.arrows[0]!.y;
      const vy0 = m.arrows[0]!.vy;
      m.step(DT);
      const dvy = m.arrows[0] ? m.arrows[0].vy - vy0 : 0;
      let dev = 0;
      for (let i = 0; i < 90; i++) {
        m.step(DT);
        const h = m.enemy!.body.pos[J.head]!;
        dev = Math.max(dev, Math.hypot(h.x - head0.x, h.y - head0.y));
      }
      return { dev, dvy, angle, y0 };
    };
    const n = push('normal');
    const a = push('axe');
    expect(a.dvy).toBeCloseTo(n.dvy * 1.3, 3);
    expect(a.dev).toBeGreaterThan(n.dev * 1.5);
  });

  it('split arrows become three; chainsaw pierces once per body; missiles home in', () => {
    const m = quiet(11, ['split', 'chainsaw', 'missile']);
    const e = m.enemy!;
    e.hp = e.maxHp = 1e4;
    let c = chestOf(m);
    shootAt(m, c.x, c.y);
    const ev = run(m, 0.3);
    expect(of(ev, 'split')).toHaveLength(1);
    expect(m.arrows.length).toBe(3);
    run(m, 1.5);

    m.selectArrow('chainsaw');
    c = chestOf(m);
    const hp0 = e.hp;
    const cev = [...shootAt(m, c.x, c.y), ...run(m, 1.5)];
    expect(of(cev, 'saw')).toHaveLength(1);
    expect(of(cev, 'hit').filter((h) => h.side === 'enemy')).toHaveLength(1);
    expect(hp0 - e.hp).toBeCloseTo(m.stats.damage * 1.2, 5);

    m.selectArrow('missile');
    c = chestOf(m);
    const mev = [...shootAt(m, c.x, c.y - 250), ...run(m, 2)];
    expect(of(mev, 'explode')).toHaveLength(1);
    expect(of(mev, 'hit').some((h) => h.side === 'enemy')).toBe(true);
  });

  it('apples fly across between the fighters every few seconds', () => {
    const m = quiet(12);
    const seen = new Map<number, { minY: number; x0: number; x1: number }>();
    for (let i = 0; i < 60 * 30; i++) {
      m.step(DT);
      for (const a of m.apples) {
        const s = seen.get(a.id) ?? { minY: Infinity, x0: a.x, x1: a.x };
        s.minY = Math.min(s.minY, a.y);
        s.x1 = a.x;
        seen.set(a.id, s);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(seen.size).toBeLessThanOrEqual(6);
    for (const s of seen.values()) {
      expect(s.minY).toBeGreaterThan(100);
      expect(s.minY).toBeLessThan(400);
      expect(s.x0).toBeGreaterThan(600);
      expect(s.x0).toBeLessThan(1200);
    }
    expect(m.apples.every((a) => a.y < WORLD_H + 130)).toBe(true);
  });

  it('shooting an apple restores hp / stamina, capped at the maximum', () => {
    const burst = (kind: 'red' | 'green' | 'gold', hp: number, stamina: number) => {
      const m = quiet(12);
      m.apples.length = 0;
      const angle = m.aimAt(700, 400, 1)!;
      m.beginDraw();
      m.aim(angle, 1);
      run(m, 1);
      m.player.hp = hp;
      m.stamina = stamina;
      m.apples.push(new Apple(999, kind, 700, 400, 0, 0, 0));
      m.release();
      return { m, ev: of(run(m, 0.4), 'apple') };
    };
    const gold = burst('gold', 10, 20);
    expect(gold.ev).toHaveLength(1);
    expect(gold.ev[0]).toMatchObject({ kind: 'gold', hp: 30, stamina: 50 });
    expect(gold.m.hp).toBe(40);
    expect(gold.m.apples).toHaveLength(0);
    const red = burst('red', 95, 50);
    expect(red.ev[0]).toMatchObject({ kind: 'red', hp: 5, stamina: 0 });
    expect(red.m.hp).toBe(red.m.maxHp);
    const green = burst('green', 50, 90);
    expect(green.ev[0]!.stamina).toBeGreaterThan(10);
    expect(green.ev[0]!.stamina).toBeLessThan(25);
    expect(green.m.stamina).toBeCloseTo(green.m.maxStamina, 0);
  });

  it('kills pay skulls and the next enemy glides in; every 5th is a boss', () => {
    const m = quiet(13);
    const first = m.enemy!;
    first.hp = 1;
    const c = chestOf(m);
    const ev = [...shootAt(m, c.x, c.y), ...run(m, 0.5)];
    const kill = of(ev, 'kill')[0]!;
    expect(kill.reward).toBe(enemyFor(0).reward);
    expect(m.score).toBe(1);
    expect(m.skullsEarned).toBe(enemyFor(0).reward);
    const arrive = of(run(m, 1), 'arrive')[0]!;
    expect(arrive.index).toBe(1);
    const next = m.enemy!;
    expect(next).not.toBe(first);
    expect(next.arrived).toBe(false);
    run(m, 1.1);
    expect(next.arrived).toBe(true);
    expect(next.platform.x).toBeGreaterThanOrEqual(1050);
    expect(next.platform.x).toBeLessThanOrEqual(1400);
    const falls = of(run(m, 6), 'kill');
    expect(falls).toHaveLength(0);
    expect(m.fighters.includes(first)).toBe(false);
    for (const i of [4, 9, 14]) expect(enemyFor(i).boss).toBe(true);
    for (const i of [0, 3, 5, 8]) expect(enemyFor(i).boss).toBe(false);
    expect(enemyFor(4).scale).toBeGreaterThan(1.4);
    expect(enemyFor(4).reward).toBeGreaterThan(enemyFor(5).reward * 2);
  });

  it('difficulty ramps with the enemy index', () => {
    for (let i = 0; i < 20; i++) {
      const a = enemyFor(i);
      const b = enemyFor(i + 1);
      if (a.boss || b.boss) continue;
      expect(b.hp).toBeGreaterThan(a.hp);
      expect(b.damage).toBeGreaterThan(a.damage);
      expect(b.aimError).toBeLessThanOrEqual(a.aimError);
      expect(b.drawTime).toBeLessThanOrEqual(a.drawTime);
      expect(b.cooldown).toBeLessThanOrEqual(a.cooldown);
      expect(b.reward).toBeGreaterThan(a.reward);
    }
    expect(enemyFor(2).arrow).toBe('normal');
    const specials = new Set(Array.from({ length: 20 }, (_, i) => enemyFor(i + 6).arrow));
    expect(specials).toEqual(new Set(['normal', 'poison', 'electric', 'explosive']));

    const hitRate = (index: number) => {
      const m = new BattleModel({ seed: 21 });
      m.beginDraw();
      m.cancelDraw();
      m.player.hp = m.player.maxHp = 1e9;
      const e = m.enemy!;
      (e as { spec: unknown }).spec = { ...enemyFor(index), cooldown: 0.4, drawTime: 0.5, arrow: 'normal', scale: 1 };
      const ev = run(m, 90);
      return of(ev, 'hit').filter((h) => h.side === 'player').length / Math.max(1, of(ev, 'shoot').filter((s) => s.side === 'enemy').length);
    };
    const early = hitRate(0);
    const late = hitRate(16);
    expect(late).toBeGreaterThan(early + 0.15);
  });

  it('lives: a spare life respawns with full hp, the last one ends the run; revive restores it', () => {
    const stats = { ...playerStats(NO_UPGRADES), lives: 2 };
    const m = quiet(14, ['normal'], stats);
    expect(m.livesLeft).toBe(2);
    m.player.hp = 1;
    m.enemy!.cooldown = 0;
    let ev: BattleEvent[] = [];
    for (let i = 0; i < 60 * 30 && of(ev, 'lifeLost').length === 0; i++) ev.push(...m.step(DT));
    expect(of(ev, 'lifeLost')[0]!.livesLeft).toBe(1);
    expect(m.state).toBe('playing');
    ev = run(m, 1.5);
    expect(of(ev, 'respawn')).toHaveLength(1);
    expect(m.hp).toBe(m.maxHp);
    m.player.hp = 1;
    ev = [];
    for (let i = 0; i < 60 * 30 && m.state === 'playing'; i++) ev.push(...m.step(DT));
    expect(m.state).toBe('over');
    expect(of(ev, 'gameover')).toHaveLength(1);
    expect(m.player.alive).toBe(false);
    expect(m.beginDraw()).toBe(false);
    run(m, 2);
    expect(m.player.body.bottom()).toBeLessThan(TOWER_TOP + 1);
    expect(m.revive()).toBe(true);
    expect(m.state).toBe('playing');
    expect(m.hp).toBe(m.maxHp);
    expect(m.player.alive).toBe(true);
  });

  it('an idle player is eventually shot dead by the first enemies', () => {
    const m = new BattleModel({ seed: 15 });
    m.beginDraw();
    m.cancelDraw();
    let t = 0;
    while (m.state === 'playing' && t < 300) {
      m.step(DT);
      t += DT;
    }
    expect(m.state).toBe('over');
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(150);
  });

  it('un-upgraded bots typically kill a handful of enemies in a 1-3 minute run', () => {
    const bot = (sd: number, wait: number) => {
      const results: { kills: number; time: number }[] = [];
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const m = new BattleModel({ seed });
        const r = new Rng(seed * 31);
        m.beginDraw();
        m.cancelDraw();
        while (m.state === 'playing' && m.time < 400) {
          const head = m.enemyHead();
          if (head && m.enemy!.arrived && m.stamina >= SHOT_COST && m.canAct) {
            const c = chestOf(m);
            shootAt(m, c.x, r.chance(0.3) ? head.y : c.y, 1, r.gauss(0, sd));
          }
          for (let i = 0; i < wait; i++) m.step(DT);
        }
        results.push({ kills: m.score, time: Math.round(m.time) });
      }
      const median = (a: number[]) => {
        const s = [...a].sort((x, y) => x - y);
        return (s[2]! + s[3]!) / 2;
      };
      return { kills: median(results.map((r) => r.kills)), time: median(results.map((r) => r.time)), all: JSON.stringify(results) };
    };
    const good = bot(0.045, 24);
    expect(good.kills, good.all).toBeGreaterThanOrEqual(6);
    expect(good.kills, good.all).toBeLessThanOrEqual(12);
    expect(good.time, good.all).toBeGreaterThanOrEqual(55);
    expect(good.time, good.all).toBeLessThanOrEqual(180);
    const casual = bot(0.08, 100);
    expect(casual.kills, casual.all).toBeGreaterThanOrEqual(4);
    expect(casual.kills, casual.all).toBeLessThanOrEqual(good.kills);
    expect(casual.time, casual.all).toBeGreaterThanOrEqual(55);
  }, 60_000);

  it('only loadout arrows can be selected; setLoadout works in the menu only', () => {
    const m = new BattleModel({ seed: 16 });
    expect(m.selectArrow('axe')).toBe(false);
    const stats = { ...playerStats(NO_UPGRADES), maxHp: 150, maxStamina: 125 };
    m.setLoadout(stats, ['normal', 'axe']);
    expect(m.maxHp).toBe(150);
    expect(m.hp).toBe(150);
    expect(m.maxStamina).toBe(125);
    expect(m.selectArrow('axe')).toBe(true);
    expect(of(m.step(DT), 'equip')[0]!.arrow).toBe('axe');
    expect(m.player.nocked).toBe('axe');
    m.beginDraw();
    m.setLoadout(playerStats(NO_UPGRADES), ['normal']);
    expect(m.maxHp).toBe(150);
  });

  it('dead enemies fall out of the world and are removed', () => {
    const m = quiet(17);
    const e = m.enemy!;
    e.hp = 1;
    const c = chestOf(m);
    shootAt(m, c.x, c.y);
    run(m, 1);
    expect(e.alive).toBe(false);
    let t = 0;
    while (m.fighters.includes(e) && t < 8) {
      m.step(DT);
      t += DT;
    }
    expect(m.fighters.includes(e)).toBe(false);
    expect(e.body.top()).toBeGreaterThan(WORLD_H);
    expect(launchSpeed(1)).toBe(1650);
    expect(launchSpeed(0)).toBe(700);
  });
});
