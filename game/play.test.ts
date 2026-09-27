import { afterEach, describe, expect, it } from 'vitest';
import { formatLint, lintUI, openModalsOf, Rng } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import app from './main';
import type { PlayScene } from './scenes/play';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const shots = !!process.env.GAME_SHOTS;

async function play(device: string, seed: number): Promise<{ t: TestGame; scene: PlayScene }> {
  t = await createTestGame({ app, device, scene: 'play', params: { seed }, render: 'none' });
  return { t, scene: t.scene as PlayScene };
}

describe('play scene', () => {
  it('drops where the player taps and merges fruits', async () => {
    const { t, scene } = await play('iphone-14', 3);
    const jar = t.find('#jar')!;
    const rng = new Rng(11);
    let drops = 0;
    for (let i = 0; i < 40 && scene.model.state === 'playing'; i++) {
      const x = jar.toWorld(rng.float(40, 670), 0).x;
      await t.tap({ x, y: jar.toWorld(0, 400).y });
      drops++;
      await t.advance(0.9);
      if (shots && i === 12) await t.screenshot('.shots/game-play-early.png');
    }
    await t.advance(1.5);
    if (shots) await t.screenshot('.shots/game-play-iphone-14.png');
    expect(scene.model.drops).toBe(drops);
    expect(scene.model.merges).toBeGreaterThan(5);
    expect(scene.model.score).toBeGreaterThan(0);
    const fruits = t.game.stage.findAll('Fruit');
    expect(fruits.length).toBeGreaterThan(scene.model.physics.bodies.length - 1);
  });

  it('HUD lints clean on three devices', async () => {
    for (const device of ['iphone-se', 'iphone-14', 'ipad']) {
      const { t } = await play(device, 1);
      await t.advance(0.5);
      const issues = lintUI(t.game.stage, t.game);
      expect(issues.filter((i) => i.severity === 'error'), `${device}\n${formatLint(issues)}`).toHaveLength(0);
      if (shots) await t.screenshot(`.shots/game-start-${device}.png`);
      t.destroy();
    }
    t = null;
  });

  it('pause menu opens and resumes', async () => {
    const { t, scene } = await play('iphone-14', 1);
    await t.advance(0.3);
    await t.tap('#pause');
    await t.advance(0.5);
    expect(openModalsOf().length).toBe(1);
    const issues = lintUI(t.game.stage, t.game);
    expect(issues.filter((i) => i.severity === 'error'), formatLint(issues)).toHaveLength(0);
    if (shots) await t.screenshot('.shots/game-pause.png');
    const score = scene.model.physics.time;
    await t.tap('#resume');
    await t.advance(0.6);
    expect(openModalsOf().length).toBe(0);
    expect(scene.model.physics.time).toBeGreaterThan(score);
  });

  it('shows the game over dialog when the jar overflows', async () => {
    const { t, scene } = await play('iphone-14', 1);
    const m = scene.model;
    for (let i = 0; i < 10; i++) m.physics.add(300 + i, 170, i % 2 ? 180 : 530, m.physics.height - 170 - i * 170);
    await t.advance(5);
    expect(m.state).toBe('over');
    expect(openModalsOf().length).toBe(1);
    const issues = lintUI(t.game.stage, t.game);
    expect(issues.filter((i) => i.severity === 'error'), formatLint(issues)).toHaveLength(0);
    if (shots) await t.screenshot('.shots/game-over.png');
    await t.tap('#again');
    await t.advance(1);
    expect((t.scene as PlayScene).model.state).toBe('playing');
    expect(t.scene).not.toBe(scene);
  });
});
