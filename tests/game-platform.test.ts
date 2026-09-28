import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bakeTexture,
  bootApp,
  clearTextBitmaps,
  clearTintCache,
  defineApp,
  Game,
  Scene,
  Text,
  textBitmapStats,
  tintTexture,
  type MemoryWarningInfo,
} from '@engine';
import { createTestGame, HeadlessPlatform, type TestGame } from '@engine/testing';
import archer from '../archer/main';
import game from '../game/main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
  clearTintCache();
  clearTextBitmaps();
  vi.unstubAllEnvs();
});

/** Runs the real start() loop for `frames` host frames of `hostMs`; returns the unscaled dt of each game frame. */
function runLoop(t: TestGame, frames: number, hostMs = 1000 / 60): number[] {
  const dts: number[] = [];
  const off = t.game.on('frame', (dt) => dts.push(dt));
  t.game.start();
  for (let i = 0; i < frames; i++) {
    t.platform.clock += hostMs;
    t.platform.flushFrames();
  }
  t.game.stop();
  off();
  return dts;
}

describe('memory warning', () => {
  it('drops the tint cache and text bitmaps, emits memorywarning and asks for a GC', async () => {
    t = await createTestGame({ render: 'every' });
    const src = bakeTexture(8, 8, (ctx) => ctx.fillRect(0, 0, 8, 8));
    const red = tintTexture(src, '#ff0000');
    const label = t.game.sceneLayer.add(new Text('Cached', { fontSize: 30, cache: 'bitmap' }, { x: 20, y: 20 }));
    await t.step(1);
    expect(textBitmapStats().count).toBe(1);
    const seen: MemoryWarningInfo[] = [];
    t.game.on('memorywarning', (info) => {
      seen.push(info);
      expect(tintTexture(src, '#ff0000')).not.toBe(red);
      expect(textBitmapStats().count).toBe(0);
    });
    t.platform.memoryWarning(10);
    await t.step(1);
    expect(textBitmapStats().count, 'visible labels bake again').toBe(1);
    label.destroy();
    expect(seen).toEqual([{ level: 10 }]);
    expect(t.platform.gcCount).toBe(1);
    t.game.memoryWarning();
    expect(seen).toEqual([{ level: 10 }, {}]);
    expect(t.platform.gcCount).toBe(2);
  });
});

describe('frame rate', () => {
  it('skips host frames on the web loop and keeps dt in real time', async () => {
    t = await createTestGame();
    expect(t.game.frameRate).toBe(60);
    expect(runLoop(t, 60)).toHaveLength(60);

    t.game.setFrameRate(30);
    expect(t.game.frameRate).toBe(30);
    const dts = runLoop(t, 60);
    expect(dts.length).toBeGreaterThanOrEqual(29);
    expect(dts.length).toBeLessThanOrEqual(31);
    for (const dt of dts.slice(1)) expect(dt).toBeCloseTo(1 / 30, 4);

    t.game.setFrameRate(60);
    expect(runLoop(t, 30)).toHaveLength(30);
  });

  it('raises maxDt below 15 fps so updates keep real time', async () => {
    t = await createTestGame();
    const updates: number[] = [];
    t.game.on('update', (dt) => updates.push(dt));
    t.game.setFrameRate(10);
    expect(t.game.config.maxDt).toBeCloseTo(0.125);
    const dts = runLoop(t, 60);
    expect(dts.length).toBeGreaterThanOrEqual(9);
    expect(dts.length).toBeLessThanOrEqual(11);
    expect(updates[updates.length - 1]).toBeCloseTo(0.1, 4);
    t.game.setFrameRate(60);
    expect(t.game.config.maxDt).toBeCloseTo(1 / 15);
  });

  it('uses the host cap when the platform has one and reads frameRate from the config', async () => {
    const platform = new HeadlessPlatform();
    const native = vi.fn(() => true);
    Object.assign(platform, { setPreferredFramesPerSecond: native });
    const g = new Game(platform, { design: { width: 750, height: 1334 }, frameRate: 20 });
    expect(g.frameRate).toBe(20);
    expect(native).toHaveBeenCalledWith(20);
    const frames: number[] = [];
    g.on('frame', (dt) => frames.push(dt));
    g.start();
    for (let i = 0; i < 6; i++) {
      platform.clock += 50;
      platform.flushFrames();
    }
    g.stop();
    expect(frames).toHaveLength(6);
    expect(frames[frames.length - 1]).toBeCloseTo(0.05);
  });
});

class Empty extends Scene {}

describe('devScenes', () => {
  const app = defineApp({
    design: { width: 750, height: 1334 },
    scenes: { main: () => new Empty() },
    devScenes: { gallery: () => new Empty() },
  });

  it('are registered outside release builds', async () => {
    t = await createTestGame();
    await bootApp(t.game, app);
    expect(t.game.scenes.has('main')).toBe(true);
    await expect(t.game.scenes.go('gallery')).resolves.toBeInstanceOf(Empty);
  });

  it('are skipped when NODE_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    t = await createTestGame();
    await bootApp(t.game, app);
    expect(t.game.scenes.has('main')).toBe(true);
    expect(t.game.scenes.has('gallery')).toBe(false);
  });

  it('hold the review scenes of the games', () => {
    expect(Object.keys(game.devScenes ?? {})).toEqual(['gallery']);
    expect(Object.keys(game.scenes ?? {})).not.toContain('gallery');
    expect(Object.keys(archer.devScenes ?? {}).sort()).toEqual(['gallery', 'menu-preview']);
    expect(Object.keys(archer.scenes ?? {})).not.toContain('menu-preview');
  });
});
