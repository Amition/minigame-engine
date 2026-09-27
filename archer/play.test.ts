import { afterEach, describe, expect, it } from 'vitest';
import { formatLint, lintUI, openModalsOf, type Label, type UILintOptions } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import { JUMP_COST, SHOT_COST, START_SKULLS } from './config';
import app from './main';
import { archerSave, trials } from './save';
import type { PlayScene } from './scenes/play';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
  trials.clear();
});

const shots = !!process.env.GAME_SHOTS;
const DEVICES = ['iphone-se-land', 'iphone-14-land', 'ipad-land'];

async function play(device: string, seed: number): Promise<{ t: TestGame; scene: PlayScene }> {
  t = await createTestGame({ app, device, scene: 'play', params: { seed }, render: 'none' });
  return { t, scene: t.scene as PlayScene };
}

/** Where the bot puts its finger down: right part of the operation zone, mid height (stage coordinates). */
function anchor(scene: PlayScene): { x: number; y: number } {
  const zone = scene.find('#aim-zone')!;
  return scene.toWorld(zone.x + zone.width - 50, scene.height * 0.42);
}

/** Slingshot drag: pull back opposite to `angle`, long enough for a full draw, then let go. */
async function shoot(t: TestGame, scene: PlayScene, angle: number, pull = 240): Promise<void> {
  const from = anchor(scene);
  await t.drag(from, { x: from.x - Math.cos(angle) * pull, y: from.y - Math.sin(angle) * pull }, 66);
}

function touch(t: TestGame, phase: 'start' | 'move' | 'end', p: { x: number; y: number }): void {
  const s = t.game.stageToScreen(p.x, p.y);
  t.platform.touch(phase, [{ id: 1, x: s.x, y: s.y }]);
}

function expectClean(t: TestGame, label: string, opts: UILintOptions = {}): void {
  const issues = lintUI(t.game.stage, t.game, opts);
  expect(issues.filter((i) => i.severity === 'error'), `${label}\n${formatLint(issues)}`).toHaveLength(0);
}

describe('archer play scene', () => {
  it('shows the menu over the idle duel; a drag in the zone aims, shoots and starts the run', async () => {
    const { t, scene } = await play('iphone-14-land', 1);
    await t.advance(0.5);
    const m = scene.model;
    expect(m.state).toBe('menu');
    expect(t.find('#menu')).not.toBeNull();
    expect(t.get('#pause').visible).toBe(false);
    expect(t.get<Label>('#skull-count').text).toBe(String(START_SKULLS));
    expect(t.get<Label>('#score').text).toBe('得分 0/0');
    expect(t.get('#skulls').worldBounds().y + t.get('#skulls').worldBounds().h).toBeLessThanOrEqual(t.game.safe.y + 70);
    expect(t.findAll('Fighter')).toHaveLength(2);
    if (shots) await t.screenshot('.shots/archer-play-menu.png');

    const from = anchor(scene);
    touch(t, 'start', from);
    await t.step(1);
    for (let i = 1; i <= 20; i++) {
      touch(t, 'move', { x: from.x - 11 * i, y: from.y + 5 * i });
      await t.step(1);
    }
    await t.advance(0.5);
    expect(m.state).toBe('playing');
    expect(m.drawing).toBe(true);
    expect(m.draw).toBeGreaterThan(0.5);
    expect(m.player.aimAngle).toBeCloseTo(Math.atan2(-5, 11), 2);
    expect(t.get('#trajectory').visible).toBe(true);
    if (shots) await t.screenshot('.shots/archer-play-aim.png');
    touch(t, 'end', { x: from.x - 220, y: from.y + 100 });
    await t.step(1);
    expect(m.shots).toBe(1);
    expect(m.stamina).toBeLessThanOrEqual(m.maxStamina - SHOT_COST + 1);
    expect(t.get('#trajectory').visible).toBe(false);
    await t.advance(0.6);
    expect(t.find('#menu')).toBeNull();
    expect(t.get('#pause').visible).toBe(true);
    expect(t.played()).toEqual(expect.arrayContaining(['draw', 'shoot']));
  });

  it('a bot aiming with the model helper kills enemies; skulls land in the save and the counter', async () => {
    const { t, scene } = await play('iphone-14-land', 3);
    await t.advance(0.3);
    const m = scene.model;
    let volleys = 0;
    for (let i = 0; i < 80 && m.score < 2 && m.state !== 'over'; i++) {
      const e = m.enemy;
      if (!e || !e.alive || !e.arrived || !m.canAct || m.stamina < SHOT_COST) {
        await t.advance(0.25);
        continue;
      }
      const c = e.body.chest();
      const head = m.enemyHead()!;
      const target = i % 3 === 0 ? head : { x: c.x, y: (c.y + head.y) / 2 };
      const angle = m.aimAt(target.x, target.y, 1);
      expect(angle).not.toBeNull();
      await shoot(t, scene, angle!);
      volleys++;
      await t.advance(0.35);
      if (shots && volleys === 3) await t.screenshot('.shots/archer-play-battle.png');
    }
    await t.advance(2);
    expect(m.score).toBeGreaterThanOrEqual(2);
    expect(m.shots).toBe(volleys);
    expect(m.hits).toBeGreaterThanOrEqual(3);
    expect(m.skullsEarned).toBeGreaterThan(0);
    expect(archerSave().data.skulls).toBe(START_SKULLS + m.skullsEarned);
    expect(t.get<Label>('#skull-count').text).toBe(String(START_SKULLS + m.skullsEarned));
    expect(t.get<Label>('#score').text).toBe(`得分 ${m.score}/${m.score}`);
    expect(t.played()).toEqual(expect.arrayContaining(['hit', 'kill', 'coin']));
    if (shots) await t.screenshot('.shots/archer-play-kills.png');
  });

  it('an idle player dies: game over dialog, then 返回 goes back to the menu', async () => {
    const { t, scene } = await play('iphone-14-land', 5);
    await t.advance(0.3);
    await t.tap(anchor(scene));
    const m = scene.model;
    expect(m.state).toBe('playing');
    expect(m.shots).toBe(0);
    for (let i = 0; i < 60 && m.state !== 'over'; i++) await t.advance(5);
    expect(m.state).toBe('over');
    expect(m.time).toBeGreaterThan(20);
    await t.advance(1.5);
    expect(openModalsOf()).toHaveLength(1);
    expect(t.get<Label>('#final-score').text).toBe('本局得分 0');
    expect(t.find('#revive')).not.toBeNull();
    expect(t.get('#pause').visible).toBe(false);
    if (shots) await t.screenshot('.shots/archer-play-over.png');
    await t.tap('#back');
    await t.advance(1);
    const next = t.scene as PlayScene;
    expect(next).not.toBe(scene);
    expect(next.model.state).toBe('menu');
    expect(openModalsOf()).toHaveLength(0);
    expect(t.find('#menu')).not.toBeNull();
    expect(archerSave().data.games).toBe(1);
    expect(archerSave().data.runs).toHaveLength(1);
  });

  it('the rewarded ad revives once; 放弃本局 in the pause modal ends the run without another offer', async () => {
    const { t, scene } = await play('iphone-14-land', 2);
    await t.advance(0.3);
    await t.tap(anchor(scene));
    const m = scene.model;
    m.forfeit();
    await t.advance(1.6);
    expect(m.state).toBe('over');
    expect(archerSave().data.games).toBe(0);
    await t.tap('#revive');
    await t.advance(0.5);
    expect(t.platform.ads.calls.filter((c) => c.startsWith('rewarded'))).toHaveLength(1);
    expect(m.state).toBe('playing');
    expect(m.hp).toBe(m.maxHp);
    expect(openModalsOf()).toHaveLength(0);
    expect(t.get('#pause').visible).toBe(true);

    await t.tap('#pause');
    await t.advance(0.4);
    expect(openModalsOf()).toHaveLength(1);
    const time = m.time;
    await t.advance(1);
    expect(m.time).toBe(time);
    await t.tap('#resume');
    await t.advance(0.5);
    expect(openModalsOf()).toHaveLength(0);
    expect(m.time).toBeGreaterThan(time);

    await t.tap('#pause');
    await t.advance(0.4);
    await t.tap('#quit');
    await t.advance(1.6);
    expect(m.state).toBe('over');
    expect(openModalsOf()).toHaveLength(1);
    expect(t.find('#revive')).toBeNull();
    expect(archerSave().data.games).toBe(1);
    await t.tap('#back');
    await t.advance(1);
    expect((t.scene as PlayScene).model.state).toBe('menu');
    expect(archerSave().data.games).toBe(1);
  });

  it('switches arrows by button and keys; Space jumps', async () => {
    const { t } = await play('iphone-14-land', 4);
    archerSave().set({ owned: ['normal', 'explosive'], equipped: ['normal', 'explosive'] });
    trials.add('split');
    const scene = (await t.go('play', { seed: 4 })) as PlayScene;
    await t.advance(0.3);
    const m = scene.model;
    expect(m.loadout).toEqual(['normal', 'explosive', 'split']);
    expect(t.find('#switch-normal')).toBeNull();
    await shoot(t, scene, -0.3);
    await t.advance(0.3);
    expect(t.find('#switch-split')).not.toBeNull();
    await t.tap('#switch-split');
    expect(m.selected).toBe('split');
    t.platform.key('Digit2');
    await t.step(1);
    t.platform.key('Digit2', 'up');
    expect(m.selected).toBe('explosive');
    const stamina = m.stamina;
    t.platform.key('Space');
    await t.step(2);
    t.platform.key('Space', 'up');
    expect(m.player.body.grounded).toBe(false);
    expect(m.stamina).toBeLessThan(stamina - JUMP_COST + 1);
    await t.advance(1.5);
    expect(m.player.body.grounded).toBe(true);
    expect(t.played()).toEqual(expect.arrayContaining(['equip', 'jump']));
  });

  it('the tower HUD rides the tower face, also after a resize', async () => {
    const { t } = await play('iphone-se-land', 1);
    await t.advance(0.3);
    const expectOnTower = (label: string) => {
      const tower = t.get('#tower').worldBounds();
      const safe = t.game.safe;
      for (const sel of ['#hp-bar', '#stamina-bar', '#jump']) {
        const b = t.get(sel).worldBounds();
        expect(b.x, `${label} ${sel}`).toBeGreaterThanOrEqual(tower.x);
        expect(b.x + b.w, `${label} ${sel}`).toBeLessThanOrEqual(tower.x + tower.w);
        expect(b.y, `${label} ${sel}`).toBeGreaterThan(tower.y + 10);
        expect(b.y + b.h, `${label} ${sel}`).toBeLessThanOrEqual(safe.y + safe.h);
      }
    };
    expectOnTower('phone');
    const before = t.get('#tower').worldBounds();
    t.platform.resize(1024, 768);
    await t.step(1);
    expect(t.get('#tower').worldBounds().y).toBeGreaterThan(before.y + 50);
    expectOnTower('tablet');
  });

  it('lints clean on three landscape devices: menu, battle HUD, pause modal, game over dialog', async () => {
    for (const device of DEVICES) {
      const { t } = await play(device, 1);
      await t.advance(0.5);
      expectClean(t, `${device} menu`);
      if (shots) await t.screenshot(`.shots/archer-menu-${device}.png`);

      archerSave().set({ owned: ['normal', 'explosive'], equipped: ['normal', 'explosive'] });
      trials.add('missile');
      const scene = (await t.go('play', { seed: 1 })) as PlayScene;
      await t.advance(0.3);
      await shoot(t, scene, -0.25);
      await t.advance(0.8);
      expect(scene.model.state).toBe('playing');
      expect(t.findAll('[id^=switch-]').length).toBe(3);
      expectClean(t, `${device} battle`);
      if (shots) await t.screenshot(`.shots/archer-hud-${device}.png`);

      await t.tap('#pause');
      await t.advance(0.5);
      expect(openModalsOf()).toHaveLength(1);
      expectClean(t, `${device} pause`);
      if (shots) await t.screenshot(`.shots/archer-pause-${device}.png`);
      await t.tap('#resume');
      await t.advance(0.5);

      scene.model.forfeit();
      await t.advance(1.8);
      expect(t.find('#revive')).not.toBeNull();
      expectClean(t, `${device} game over with revive`);
      if (shots) await t.screenshot(`.shots/archer-revive-${device}.png`);
      await t.tap('#revive');
      await t.advance(0.5);
      expect(scene.model.state).toBe('playing');

      await t.tap('#pause');
      await t.advance(0.5);
      await t.tap('#quit');
      await t.advance(1.8);
      expect(openModalsOf()).toHaveLength(1);
      expect(t.find('#revive')).toBeNull();
      expect(trials.size).toBe(0);
      expectClean(t, `${device} game over`);
      if (shots) await t.screenshot(`.shots/archer-over-${device}.png`);
      t.destroy();
    }
    t = null;
  });
});
