import { afterEach, describe, expect, it } from 'vitest';
import { formatLint, lintUI, openModalsOf, type Label, type Rect, type Vec2 } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import { JUMP_COST, SHOT_COST, START_SKULLS } from './config';
import { screenLayout } from './layout';
import app from './main';
import { ROUND_PAUSE, ROUNDS_TO_WIN, type BattleModel, type Who } from './model';
import { archerSave, trials } from './save';
import type { DuoParams, DuoScene } from './scenes/duo';
import { menuGeometry } from './scenes/menu';
import type { PlayScene } from './scenes/play';
import { J } from './types';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
  trials.clear();
});

const shots = !!process.env.GAME_SHOTS;
const DEVICES = ['iphone-se-land', 'iphone-14-land', 'ipad-land'];

async function duo(device: string, params: DuoParams): Promise<{ t: TestGame; scene: DuoScene }> {
  t = await createTestGame({ app, device, scene: 'duo', params });
  return { t, scene: t.scene as DuoScene };
}

/** Where player `who` puts a finger down: mid-sky of its own half (stage coordinates). */
function anchor(scene: DuoScene, who: Who): Vec2 {
  return scene.toWorld(scene.width * (who === 0 ? 0.25 : 0.75), scene.height * 0.42);
}

/** One slingshot stroke for `who`: pull back opposite to `angle`. */
function stroke(scene: DuoScene, who: Who, angle: number, pull = 240): [Vec2, Vec2] {
  const from = anchor(scene, who);
  return [from, { x: from.x - Math.cos(angle) * pull, y: from.y - Math.sin(angle) * pull }];
}

/** Both players (or whoever has an angle) draw fully and let go in the same frames. */
async function volley(tg: TestGame, scene: DuoScene, angles: readonly (number | null)[]): Promise<void> {
  const strokes = angles.flatMap((a, who) => (a === null ? [] : [stroke(scene, who as Who, a)]));
  if (strokes.length > 0) await tg.multiDrag(strokes, 66);
}

function head(m: BattleModel, who: Who): Vec2 {
  const h = m.human(who).fighter.body.pos[J.head]!;
  return { x: h.x, y: h.y };
}

/** Launch angle for `who` at the other archer's head / chest (versus). */
function aimAtRival(m: BattleModel, who: Who, headshot: boolean): number {
  const f = m.human(who === 0 ? 1 : 0).fighter;
  const c = f.body.chest();
  const h = head(m, who === 0 ? 1 : 0);
  const target = headshot ? h : { x: c.x, y: (c.y + h.y) / 2 };
  const a = m.aimAt(target.x, target.y, 1, who);
  expect(a, `P${who + 1} can reach the rival`).not.toBeNull();
  return a!;
}

/** `shooter` keeps shooting the idle rival until the round is decided; returns right after it is. */
async function winRound(tg: TestGame, scene: DuoScene, shooter: Who): Promise<void> {
  const m = scene.model;
  const round = m.round;
  const before = m.roundScore[shooter];
  const decided = () => m.roundScore[shooter] !== before;
  for (let i = 0; i < 40 && !decided(); i++) {
    if (!m.canActFor(shooter) || m.human(shooter).stamina < SHOT_COST) {
      await tg.advance(0.25);
      continue;
    }
    const angles: (number | null)[] = [null, null];
    angles[shooter] = aimAtRival(m, shooter, i % 2 === 0);
    await volley(tg, scene, angles);
    for (let k = 0; k < 8 && !decided(); k++) await tg.advance(0.1);
  }
  expect(m.roundScore[shooter], `round ${round}`).toBe(before + 1);
}

function expectClean(tg: TestGame, label: string): void {
  const issues = lintUI(tg.game.stage, tg.game);
  expect(issues.filter((i) => i.severity === 'error'), `${label}\n${formatLint(issues)}`).toHaveLength(0);
}

const text = (tg: TestGame, sel: string) => tg.get<Label>(sel).text;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('archer two-player modes', () => {
  it('menu → 双人 → 对战: concurrent drags shoot both archers; rounds and the match end; 返回 goes back to the menu', async () => {
    t = await createTestGame({ app, device: 'iphone-se-land', scene: 'play', params: { seed: 1 } });
    await t.advance(0.5);
    await t.tap('#menu-duo');
    await t.advance(0.4);
    expect(openModalsOf()).toHaveLength(1);
    expect(t.find('#duo-dialog')).not.toBeNull();
    if (shots) await t.screenshot('.shots/archer-duo-menu-dialog.png');
    await t.tap('#duo-versus');
    await t.advance(1.2);
    const scene = t.scene as DuoScene;
    expect(scene.kind).toBe('DuoScene');
    expect(scene.mode).toBe('versus');
    expect(openModalsOf()).toHaveLength(0);
    const m = scene.model;
    expect(m.mode).toBe('versus');
    expect(m.round).toBe(1);
    expect(text(t, '#round-score')).toBe('0 : 0');
    expect(t.findAll('Fighter')).toHaveLength(2);

    const [p1, p2] = [m.human(0), m.human(1)];
    await volley(t, scene, [aimAtRival(m, 0, false), aimAtRival(m, 1, false)]);
    expect(p1.shots).toBe(1);
    expect(p2.shots).toBe(1);
    expect(p1.stamina).toBeLessThanOrEqual(p1.maxStamina - SHOT_COST + 1);
    expect(p2.stamina).toBeLessThanOrEqual(p2.maxStamina - SHOT_COST + 1);
    expect(new Set(m.arrows.map((a) => a.who))).toEqual(new Set([0, 1]));
    await t.advance(1);
    expect(p1.hits + p2.hits).toBeGreaterThanOrEqual(1);
    expect(t.played()).toEqual(expect.arrayContaining(['draw', 'shoot']));
    if (shots) await t.screenshot('.shots/archer-duo-versus-volley.png');

    await winRound(t, scene, 0);
    expect(text(t, '#round-score')).toBe('1 : 0');
    expect(m.betweenRounds).toBe(true);
    expect(String(t.get('#winner-banner').describe().text)).toBe('P1 胜利');
    await t.advance(ROUND_PAUSE + 0.3);
    expect(m.round).toBe(2);
    expect(m.betweenRounds).toBe(false);
    expect(p1.fighter.hp).toBe(p1.fighter.maxHp);
    expect(p2.fighter.alive).toBe(true);
    expect(p2.fighter.hp).toBe(p2.fighter.maxHp);
    expect(String(t.get('#round-banner').describe().text)).toBe('第2回合');

    for (const winner of [1, 0, 0] as const) {
      await winRound(t, scene, winner);
      if (m.state !== 'over') await t.advance(ROUND_PAUSE + 0.3);
    }
    expect(m.state).toBe('over');
    expect(m.winner).toBe(0);
    expect(m.roundScore).toEqual([ROUNDS_TO_WIN, 1]);
    expect(text(t, '#round-score')).toBe('3 : 1');
    await t.advance(2);
    expect(openModalsOf()).toHaveLength(1);
    expect(text(t, '#duo-winner')).toBe('P1 获胜!');
    expect(text(t, '#duo-final')).toBe('比分 3 : 1');
    expect(archerSave().data.skulls).toBe(START_SKULLS);
    if (shots) await t.screenshot('.shots/archer-duo-versus-over.png');

    await t.tap('#back');
    await t.advance(1.2);
    const menu = t.scene as PlayScene;
    expect(menu.kind).toBe('PlayScene');
    expect(menu.model.state).toBe('menu');
    expect(t.find('#menu')).not.toBeNull();
    expect(openModalsOf()).toHaveLength(0);
  }, 120_000);

  it('co-op: both archers shoot the enemy series together, skulls are banked, game over when both are out', async () => {
    const { t, scene } = await duo('iphone-14-land', { mode: 'coop', seed: 3 });
    await t.advance(0.3);
    const m = scene.model;
    expect(m.mode).toBe('coop');
    expect(m.humans.every((h) => h.fighter.side === 'player')).toBe(true);
    for (let i = 0; i < 60 && m.score < 1 && m.state !== 'over'; i++) {
      const e = m.enemy;
      if (!e || !e.alive || !e.arrived) {
        await t.advance(0.25);
        continue;
      }
      const c = e.body.chest();
      const h = m.enemyHead()!;
      const angles = m.humans.map((p) => (m.canActFor(p.who) && p.stamina >= SHOT_COST ? m.aimAt(i % 2 ? h.x : c.x, i % 2 ? h.y : c.y, 1, p.who) : null));
      if (angles.every((a) => a === null)) {
        await t.advance(0.25);
        continue;
      }
      await volley(t, scene, angles);
      await t.advance(0.35);
      if (shots && i === 2) await t.screenshot('.shots/archer-duo-coop-battle.png');
    }
    await t.advance(2);
    expect(m.score).toBeGreaterThanOrEqual(1);
    expect(m.human(0).shots).toBeGreaterThan(0);
    expect(m.human(1).shots).toBeGreaterThan(0);
    expect(m.human(0).hits + m.human(1).hits).toBeGreaterThanOrEqual(2);
    expect(m.skullsEarned).toBeGreaterThan(0);
    expect(archerSave().data.skulls).toBe(START_SKULLS + m.skullsEarned);
    expect(text(t, '#skull-count')).toBe(String(START_SKULLS + m.skullsEarned));
    expect(text(t, '#score')).toBe(`得分 ${m.score}`);
    expect(t.played()).toEqual(expect.arrayContaining(['hit', 'kill', 'coin']));

    for (let i = 0; i < 100 && m.state !== 'over'; i++) await t.advance(5);
    expect(m.state).toBe('over');
    expect(m.humans.every((h) => !h.fighter.alive)).toBe(true);
    await t.advance(1.5);
    expect(openModalsOf()).toHaveLength(1);
    expect(text(t, '#final-score')).toBe(`合作得分 ${m.score}`);
    expect(archerSave().data.runs).toHaveLength(0);
    expect(archerSave().data.best).toBe(0);
    expect(archerSave().data.games).toBe(0);
    if (shots) await t.screenshot('.shots/archer-duo-coop-over.png');

    await t.tap('#again');
    await t.advance(1);
    const next = t.scene as DuoScene;
    expect(next).not.toBe(scene);
    expect(next.mode).toBe('coop');
    expect(next.model.state).toBe('playing');
    expect(openModalsOf()).toHaveLength(0);
  }, 180_000);

  it('each player has an arrow switch and a jump button (and keys); pause freezes, 返回菜单 leaves', async () => {
    const { t } = await duo('iphone-se-land', { mode: 'versus', seed: 4 });
    archerSave().set({ owned: ['normal', 'explosive'], equipped: ['normal', 'explosive'] });
    const scene = (await t.go('duo', { mode: 'versus', seed: 4 })) as DuoScene;
    await t.advance(0.3);
    const m = scene.model;
    expect(m.human(1).loadout).toEqual(['normal', 'explosive']);
    await t.tap('#swap-p2');
    expect(m.human(1).selected).toBe('explosive');
    expect(m.human(0).selected).toBe('normal');
    await t.tap('#swap-p1');
    await t.tap('#swap-p1');
    expect(m.human(0).selected).toBe('normal');

    const stamina = m.human(1).stamina;
    await t.tap('#jump-p2');
    await t.step(2);
    expect(m.human(1).fighter.body.grounded).toBe(false);
    expect(m.human(0).fighter.body.grounded).toBe(true);
    expect(m.human(1).stamina).toBeLessThan(stamina - JUMP_COST + 1);
    await t.advance(1.5);
    t.platform.key('KeyW');
    await t.step(2);
    t.platform.key('KeyW', 'up');
    expect(m.human(0).fighter.body.grounded).toBe(false);
    t.platform.key('Enter');
    await t.step(2);
    t.platform.key('Enter', 'up');
    expect(m.human(1).fighter.body.grounded).toBe(false);
    expect(t.played()).toEqual(expect.arrayContaining(['equip', 'jump']));
    await t.advance(1.5);

    await t.tap('#pause');
    await t.advance(0.4);
    expect(openModalsOf()).toHaveLength(1);
    const time = m.time;
    await t.advance(1);
    expect(m.time).toBe(time);
    await t.tap('#resume');
    await t.advance(0.4);
    expect(m.time).toBeGreaterThan(time);
    await t.tap('#pause');
    await t.advance(0.4);
    await t.tap('#quit');
    await t.advance(1.2);
    expect((t.scene as PlayScene).kind).toBe('PlayScene');
    expect(t.find('#menu')).not.toBeNull();
    expect(openModalsOf()).toHaveLength(0);
  }, 30_000);

  it('the 双人 button sits in the bottom cluster, clear of the zone and the idle enemy; its dialog lints clean', async () => {
    for (const device of DEVICES) {
      t = await createTestGame({ app, device, scene: 'menu-preview', pixelRatio: 1 });
      await t.advance(0.3);
      const g = t.game;
      const lay = screenLayout(g.view, g.safe);
      const geo = menuGeometry(g.view, g.safe, lay.zone, lay.hudBottom);
      const b = t.get('#menu-duo').worldBounds();
      const gear = t.get('#menu-settings').worldBounds();
      expect(overlaps(b, geo.enemy), `${device} covers the enemy`).toBe(false);
      expect(overlaps(b, gear), `${device} covers the gear`).toBe(false);
      expect(overlaps(b, t.get('#menu-leaderboard').worldBounds()), `${device} covers 排行榜`).toBe(false);
      expect(b.x).toBeGreaterThanOrEqual(lay.zone.x + lay.zone.w);
      expect(b.y + b.h).toBeLessThanOrEqual(gear.y);
      expect(b.x + b.w).toBeLessThanOrEqual(g.safe.x + g.safe.w);
      await t.tap('#menu-duo');
      await t.advance(0.5);
      expect(openModalsOf()).toHaveLength(1);
      expect(t.find('#duo-versus')).not.toBeNull();
      expect(t.find('#duo-coop')).not.toBeNull();
      const issues = lintUI(g.stage, g);
      const bad = issues.filter((i) => i.severity === 'error' || i.rule === 'small-tap-target' || i.rule === 'small-font');
      expect(bad, `${device} duo dialog\n${formatLint(issues)}`).toHaveLength(0);
      if (shots) await t.screenshot(`.shots/archer-duo-dialog-${device}.png`);
      t.destroy();
      t = null;
    }
  }, 30_000);

  it('lints clean on three landscape devices: versus / co-op HUD, pause modal, end dialogs', async () => {
    for (const device of DEVICES) {
      const { t } = await duo(device, { mode: 'versus', seed: 1 });
      archerSave().set({ owned: ['normal', 'explosive'], equipped: ['normal', 'explosive'] });
      const scene = (await t.go('duo', { mode: 'versus', seed: 1 })) as DuoScene;
      await t.advance(0.3);
      const m = scene.model;
      await volley(t, scene, [aimAtRival(m, 0, false), aimAtRival(m, 1, false)]);
      await t.advance(0.3);
      expect(t.findAll('[id^=swap-p]').length).toBe(2);
      expectClean(t, `${device} versus`);
      if (shots) await t.screenshot(`.shots/archer-duo-versus-${device}.png`);

      await t.tap('#pause');
      await t.advance(0.5);
      expect(openModalsOf()).toHaveLength(1);
      expectClean(t, `${device} pause`);
      if (shots) await t.screenshot(`.shots/archer-duo-pause-${device}.png`);
      await t.tap('#resume');
      await t.advance(0.5);

      await t.advance(1.5);
      m.roundScore[0] = ROUNDS_TO_WIN - 1;
      m.human(1).fighter.hp = 1;
      await winRound(t, scene, 0);
      expect(m.state).toBe('over');
      await t.advance(2);
      expect(openModalsOf()).toHaveLength(1);
      expectClean(t, `${device} match over`);
      if (shots) await t.screenshot(`.shots/archer-duo-match-over-${device}.png`);
      await t.tap('#back');
      await t.advance(1.2);
      expect(openModalsOf()).toHaveLength(0);

      const coop = (await t.go('duo', { mode: 'coop', seed: 1 })) as DuoScene;
      await t.advance(1.5);
      expect(t.find('#controls-p2')).not.toBeNull();
      expectClean(t, `${device} co-op`);
      if (shots) await t.screenshot(`.shots/archer-duo-coop-${device}.png`);
      coop.model.forfeit();
      await t.advance(1.6);
      expect(openModalsOf()).toHaveLength(1);
      expectClean(t, `${device} co-op over`);
      if (shots) await t.screenshot(`.shots/archer-duo-coop-over-${device}.png`);
      t.destroy();
    }
    t = null;
  }, 90_000);
});
