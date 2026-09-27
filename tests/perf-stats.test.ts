import { createCanvas } from '@napi-rs/canvas';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  autoTextureResolution,
  bakeTexture,
  Box,
  formatGameStats,
  GameStatSeries,
  loadAssets,
  ParticleEmitter,
  particlePresets,
  releaseTexture,
  resolveTextureResolution,
  ScaledTexture,
  Texture,
  textureMemory,
  textureStats,
  textures,
  trackTexture,
  untrackTexture,
  type AppDef,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const paint = () => {};
const find = (key: string) => textureStats({ top: 1e6 }).top.find((e) => e.key === key);

describe('GameStatSeries', () => {
  it('keeps a rolling window with avg / max / min / percentile / at', () => {
    const s = new GameStatSeries(4);
    expect([s.count, s.avg, s.max, s.percentile(0.95)]).toEqual([0, 0, 0, 0]);
    for (const v of [1, 2, 3]) s.push(v);
    expect(s.count).toBe(3);
    expect(s.avg).toBeCloseTo(2);
    expect(s.max).toBe(3);
    expect(s.min).toBe(1);
    expect(s.last).toBe(3);
    expect([s.at(0), s.at(1), s.at(2), s.at(3)]).toEqual([3, 2, 1, 0]);
    for (const v of [10, 20]) s.push(v); // window is now 2, 3, 10, 20
    expect(s.count).toBe(4);
    expect(s.avg).toBeCloseTo(8.75);
    expect(s.min).toBe(2);
    expect(s.percentile(0.5)).toBe(3);
    expect(s.percentile(0.95)).toBe(20);
    expect(s.at(0)).toBe(20);
    expect(s.at(3)).toBe(2);
    s.reset();
    expect([s.count, s.avg, s.last]).toEqual([0, 0, 0]);
  });
});

describe('game.stats', () => {
  it('reports fps, per-phase ms and node counts under the headless harness', async () => {
    t = await createTestGame({ render: 'every' });
    const g = t.game;
    for (let i = 0; i < 10; i++) g.sceneLayer.add(new Box(40, 40, { fill: '#f00' }, { x: i * 50, y: 100 }));
    g.sceneLayer.add(new Box(40, 40, { fill: '#0f0' }, { visible: false }));
    await t.step(30);
    const s = g.stats;
    expect(s.fps).toBeCloseTo(60, 1);
    expect(s.frames).toBeGreaterThanOrEqual(31);
    expect(s.updateMs.count).toBe(31);
    expect(s.renderMs.count).toBe(31);
    expect(s.updateMs.avg).toBeGreaterThanOrEqual(0);
    expect(s.renderMs.avg).toBeGreaterThan(0);
    expect(s.renderMs.max).toBeGreaterThanOrEqual(s.renderMs.avg);
    expect(s.frameMs.avg).toBeCloseTo(s.updateMs.avg + s.renderMs.avg, 6);
    expect(s.intervalMs.max).toBeCloseTo(1000 / 60, 6);
    // stage + scenes + overlay + 11 boxes; the hidden box is not drawn
    expect(s.nodes).toBe(14);
    expect(s.drawnNodes).toBe(13);
    expect(s.particles).toBe(0);
    expect(formatGameStats(s)).toMatch(/^fps 60\.0 \| frame [\d.]+ ms .*nodes 14 \(drawn 13\)/);
    const snap = s.snapshot();
    expect(snap).toMatchObject({ nodes: 14, drawnNodes: 13, textures: textureMemory.count });
    expect(JSON.parse(JSON.stringify(snap)).fps).toBeCloseTo(60, 1);
  });

  it('times update() and render() separately and follows the frame interval', async () => {
    t = await createTestGame();
    const g = t.game;
    const s = g.stats;
    s.reset();
    for (let i = 0; i < 90; i++) g.update(1 / 30);
    expect(s.updateMs.count).toBe(90);
    expect(s.renderMs.count).toBe(0);
    expect(s.fps).toBeCloseTo(30, 0);
    g.render();
    g.render();
    expect(s.renderMs.count).toBe(2);
    expect(s.frameMs.count).toBe(2);
    expect(s.frames).toBe(2);
    // step() uses the loop interval before clamping to maxDt
    for (let i = 0; i < 120; i++) g.step(1 / 10);
    expect(s.fps).toBeCloseTo(10, 0);
    expect(s.intervalMs.max).toBeCloseTo(100, 6);
  });

  it('counts live particles and skips clock reads when disabled', async () => {
    t = await createTestGame();
    const g = t.game;
    const fx = g.sceneLayer.add(new ParticleEmitter(particlePresets.fire({ seed: 2 }), { x: 300, y: 600 }));
    await t.step(20);
    expect(fx.particleCount).toBeGreaterThan(0);
    expect(g.stats.particles).toBe(fx.particleCount);
    const s = g.stats;
    let reads = 0;
    const clock = s.clock;
    s.clock = () => (reads++, clock());
    s.enabled = false;
    const before = s.updateMs.count;
    await t.step(5);
    expect(reads).toBe(0);
    expect(s.updateMs.count).toBe(before);
    expect(s.drawnNodes).toBeGreaterThan(0);
    s.enabled = true;
    await t.step(1);
    expect(reads).toBe(4);
  });
});

describe('textureStats', () => {
  it('tracks bakes by key, replaces re-bakes and lists the largest first', async () => {
    t = await createTestGame();
    const base = textureStats();
    const a = bakeTexture(100, 50, paint, { key: 'perf:a' });
    expect(a).not.toBeInstanceOf(ScaledTexture);
    let s = textureStats({ top: 1e6 });
    expect(s.count).toBe(base.count + 1);
    expect(s.pixels).toBe(base.pixels + 5000);
    expect(s.bytes).toBe(base.bytes + 20000);
    expect(s.mb).toBeCloseTo(s.bytes / 1048576, 9);
    expect(find('perf:a')).toEqual({ key: 'perf:a', kind: 'baked', width: 100, height: 50, bytes: 20000 });

    const a2 = bakeTexture(100, 50, paint, { key: 'perf:a', resolution: 2 });
    expect(a2).toBeInstanceOf(ScaledTexture);
    s = textureStats();
    expect(s.count).toBe(base.count + 1);
    expect(s.pixels).toBe(base.pixels + 200 * 100);
    expect(find('perf:a')?.width).toBe(200);

    const anon = bakeTexture(10, 10, paint);
    expect(textureStats().count).toBe(base.count + 2);
    const big = bakeTexture(700, 600, paint, { key: 'perf:big' });
    expect(textureStats({ top: 1 }).top).toEqual([{ key: 'perf:big', kind: 'baked', width: 700, height: 600, bytes: 700 * 600 * 4 }]);
    expect(textureStats({ top: 0 }).top).toEqual([]);
    expect(textureMemory.bytes).toBe(textureStats().bytes);

    untrackTexture(anon.source);
    untrackTexture(anon.source);
    expect(textureStats().count).toBe(base.count + 2);
    releaseTexture(big);
    expect(big.source.width).toBe(1);
    expect(find('perf:big')).toBeUndefined();
    expect(textureStats().count).toBe(base.count + 1);
    untrackTexture(a2.source);
    expect(textureStats().pixels).toBe(base.pixels);
  });

  it('counts registry textures once per source and releases them on delete / clear', async () => {
    t = await createTestGame();
    const base = textureStats().count;
    const sheet = new Texture(t.platform.createCanvas(64, 32));
    textures.set('perf:sheet', sheet);
    textures.set('perf:sheet#0', sheet.sub(0, 0, 32, 32));
    textures.set('perf:sheet#1', sheet.sub(32, 0, 32, 32));
    expect(textureStats().count).toBe(base + 1);
    expect(find('perf:sheet')).toMatchObject({ kind: 'canvas', width: 64, height: 32 });
    textures.delete('perf:sheet');
    textures.delete('perf:sheet#0');
    expect(textureStats().count).toBe(base + 1);
    textures.delete('perf:sheet#1');
    expect(textureStats().count).toBe(base);

    const page = t.platform.createCanvas(128, 128);
    textures.set('perf:frame', new Texture(page, { x: 0, y: 0, w: 16, h: 16 }));
    expect(find('page(perf:frame)')?.width).toBe(128);
    textures.set('perf:frame', new Texture(t.platform.createCanvas(8, 8)));
    expect(find('page(perf:frame)')).toBeUndefined();
    expect(find('perf:frame')?.width).toBe(8);
    textures.clear();
    expect(find('perf:frame')).toBeUndefined();

    const own = t.platform.createCanvas(20, 20);
    trackTexture(own);
    trackTexture(own, 'perf:own');
    expect(find('perf:own')).toMatchObject({ kind: 'canvas', width: 20 });
    untrackTexture(own);
  });

  describe('loaded images', () => {
    let dir = '';
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'perf-stats-'));
      const c = createCanvas(40, 30);
      await mkdir(join(dir, 'img'), { recursive: true });
      await writeFile(join(dir, 'img/hero.png'), c.toBuffer('image/png'));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('tracks images once by path, also when registered under a key', async () => {
      t = await createTestGame({ assetsDir: dir });
      await loadAssets({ images: { 'perf-hero': 'img/hero.png' }, sheets: { 'perf-heroes': { image: 'img/hero.png', frameW: 20, frameH: 30 } } });
      const all = textureStats({ top: 1e6 }).top.filter((e) => e.key === 'img/hero.png');
      expect(all).toEqual([{ key: 'img/hero.png', kind: 'image', width: 40, height: 30, bytes: 4800 }]);
      expect(textures.get('perf-heroes#1').width).toBe(20);
      textures.clear();
    });
  });
});

describe("resolution 'auto'", () => {
  it('follows the device: 1 on iphone-se, 1.5 on ipad, capped by maxResolution', async () => {
    t = await createTestGame({ device: 'iphone-se' });
    expect(t.game.pixelRatio * t.game.scale).toBeCloseTo(1, 6);
    expect(autoTextureResolution()).toBe(1);
    const se = bakeTexture(100, 80, paint, { resolution: 'auto', key: 'perf:auto' });
    expect(se).not.toBeInstanceOf(ScaledTexture);
    expect([se.source.width, se.source.height, se.width]).toEqual([100, 80, 100]);
    t.destroy();

    t = await createTestGame({ device: 'ipad' });
    expect(t.game.pixelRatio * t.game.scale).toBeCloseTo(1.535, 2);
    expect(autoTextureResolution()).toBe(1.5);
    expect(autoTextureResolution(1.25)).toBe(1.25);
    expect(resolveTextureResolution('auto', 1)).toBe(1);
    expect(resolveTextureResolution(3)).toBe(3);
    expect(resolveTextureResolution(undefined)).toBe(1);
    const pad = bakeTexture(100, 80, paint, { resolution: 'auto', key: 'perf:auto' });
    expect(pad).toBeInstanceOf(ScaledTexture);
    expect([pad.source.width, pad.source.height, pad.width, pad.height]).toEqual([150, 120, 100, 80]);
    expect(find('perf:auto')?.width).toBe(150);
    t.destroy();

    t = await createTestGame({ device: '1080x2400@3' });
    expect(autoTextureResolution()).toBe(2);
    expect(autoTextureResolution(3)).toBe(3);
    t.destroy();

    t = await createTestGame({ device: '360x800@2' });
    expect(autoTextureResolution()).toBe(1);
    untrackTexture(pad.source);
  });

  it("is known inside an app's boot()", async () => {
    let res = 0;
    let tex = null as Texture | null;
    const app: AppDef = {
      design: { width: 750, height: 1334 },
      boot() {
        res = autoTextureResolution();
        tex = bakeTexture(50, 50, paint, { resolution: 'auto' });
      },
      scenes: {},
    };
    t = await createTestGame({ app, device: 'ipad' });
    expect(res).toBe(1.5);
    expect(tex!.source.width).toBe(75);
    untrackTexture(tex!.source);
  });

  it('stats expose the texture totals', async () => {
    t = await createTestGame();
    const tex = bakeTexture(64, 64, paint, { key: 'perf:stats' });
    expect(t.game.stats.textureCount).toBe(textureMemory.count);
    expect(t.game.stats.textureBytes).toBe(textureMemory.bytes);
    expect(t.game.stats.textureMB).toBeCloseTo(textureMemory.bytes / 1048576, 9);
    expect(find('perf:stats')?.bytes).toBe(64 * 64 * 4);
    untrackTexture(tex.source);
  });
});
