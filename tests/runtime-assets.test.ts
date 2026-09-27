import { createCanvas } from '@napi-rs/canvas';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  assets,
  createSave,
  createSettings,
  events,
  fixedUpdate,
  loadAssets,
  LoadingScene,
  Node,
  NodePool,
  onEvent,
  Pool,
  Scene,
  StateMachine,
  textures,
  tween,
  type AssetManifest,
  type Ctx2D,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

let dir = '';

async function png(path: string, w: number, h: number, paint: (ctx: Ctx2D) => void): Promise<void> {
  const c = createCanvas(w, h);
  paint(c.getContext('2d') as unknown as Ctx2D);
  await mkdir(join(dir, path, '..'), { recursive: true });
  await writeFile(join(dir, path), c.toBuffer('image/png'));
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runtime-assets-'));
  await png('img/hero.png', 40, 30, (ctx) => {
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 40, 30);
  });
  await png('img/coins.png', 64, 32, (ctx) => {
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(32, 0, 32, 32);
  });
  // Atlas: 'btn' at (0,0) 32x16; 'rot' is a 16x32 sprite (top green, bottom blue) packed rotated 90° clockwise
  // into (32,0) 32x16, so its left half is blue and its right half green.
  await png('atlas/ui.png', 64, 32, (ctx) => {
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(0, 0, 32, 16);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(32, 0, 16, 16);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(48, 0, 16, 16);
  });
  await writeFile(
    join(dir, 'atlas/ui.json'),
    JSON.stringify({
      frames: {
        'btn.png': { frame: { x: 0, y: 0, w: 32, h: 16 }, rotated: false, trimmed: false },
        'rot.png': { frame: { x: 32, y: 0, w: 16, h: 32 }, rotated: true, trimmed: false },
      },
      meta: { image: 'ui.png' },
    }),
  );
  await writeFile(
    join(dir, 'atlas/arr.json'),
    JSON.stringify({ frames: [{ filename: 'a.png', frame: { x: 0, y: 0, w: 8, h: 8 } }], meta: { image: 'ui.png' } }),
  );
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'data/level.json'), JSON.stringify({ name: 'one', size: [3, 4] }));
  await writeFile(join(dir, 'data/readme.txt'), 'hello 世界');
  await writeFile(join(dir, 'data/bad.json'), '{ nope');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const pixel = (tex: { source: unknown; frame: { x: number; y: number } }, x: number, y: number) => {
  const ctx = (tex.source as { getContext(t: '2d'): Ctx2D }).getContext('2d');
  return [...ctx.getImageData(tex.frame.x + x, tex.frame.y + y, 1, 1).data.slice(0, 3)];
};

describe('loadAssets', () => {
  it('loads images, sheets, atlases, json and text with progress', async () => {
    t = await createTestGame({ assetsDir: dir });
    textures.clear();
    assets.clear();
    const progress: number[] = [];
    const manifest: AssetManifest = {
      images: { hero: 'img/hero.png' },
      sheets: { coins: { image: 'img/coins.png', frameW: 32, frameH: 32 } },
      atlases: { ui: { json: 'atlas/ui.json' }, arr: { json: 'atlas/arr.json', image: 'atlas/ui.png', prefix: '' } },
      json: { level: 'data/level.json' },
      text: { readme: 'data/readme.txt' },
    };
    await loadAssets(manifest, (p) => progress.push(p));
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.length).toBe(7);
    expect(textures.get('hero').width).toBe(40);
    expect(textures.get('coins').width).toBe(64);
    expect(textures.get('coins#1').frame).toEqual({ x: 32, y: 0, w: 32, h: 32 });
    expect(textures.has('coins#2')).toBe(false);
    expect(textures.get('ui/btn').frame).toEqual({ x: 0, y: 0, w: 32, h: 16 });
    expect(textures.has('a')).toBe(true);
    const rot = textures.get('ui/rot');
    expect([rot.width, rot.height]).toEqual([16, 32]);
    expect(pixel(rot, 8, 4)).toEqual([0, 255, 0]);
    expect(pixel(rot, 8, 28)).toEqual([0, 0, 255]);
    expect(assets.getJson<{ name: string }>('level').name).toBe('one');
    expect(assets.getText('readme')).toBe('hello 世界');
    expect(() => assets.getJson('nope')).toThrow(/not loaded/);

    const again: number[] = [];
    await loadAssets(manifest, (p) => again.push(p));
    expect(again).toEqual([1]);
  });

  it('reports missing files and bad JSON with the key and path', async () => {
    t = await createTestGame({ assetsDir: dir });
    await expect(loadAssets({ images: { ghost: 'img/ghost.png' } })).rejects.toThrow(/image "ghost" \(img\/ghost\.png\)/);
    await expect(loadAssets({ json: { bad: 'data/bad.json' } })).rejects.toThrow(/json "bad".*invalid JSON/);
  });

  it('LoadingScene shows progress and then goes to the next scene', async () => {
    textures.delete('hero');
    class Menu extends Scene {}
    t = await createTestGame({
      assetsDir: dir,
      app: {
        design: { width: 750, height: 1334 },
        scenes: {
          boot: () => new LoadingScene({ manifest: { images: { hero: 'img/hero.png' } }, next: 'menu', title: 'Loading' }),
          menu: () => new Menu(),
        },
        start: 'boot',
      },
    });
    expect(t.find('#loading-bar')).not.toBeNull();
    for (let i = 0; i < 200 && t.scene?.sceneName !== 'menu'; i++) {
      await t.step(1);
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(t.scene?.sceneName).toBe('menu');
    await t.advance(0.5);
    expect(t.game.sceneLayer.children.length).toBe(1);
    expect(textures.has('hero')).toBe(true);
  });
});

describe('save', () => {
  it('migrates old versions and merges new defaults', async () => {
    t = await createTestGame();
    t.platform.storage.set('game', JSON.stringify({ v: 1, data: { gold: 7, best: 3 } }));
    const save = createSave(
      'game',
      { coins: 0, best: 0, opts: { music: true, lang: 'zh' } },
      { version: 2, migrate: (old, from) => (from < 2 ? { coins: old.gold, best: old.best } : old) },
    );
    expect(save.data.coins).toBe(7);
    expect(save.data.best).toBe(3);
    expect(save.data.opts).toEqual({ music: true, lang: 'zh' });
    expect(save.loadError).toBeNull();
  });

  it('recovers from corrupted JSON and wrong types', async () => {
    t = await createTestGame();
    t.platform.storage.set('broken', '{"v":1,"data":{"coins":');
    const save = createSave('broken', { coins: 0, items: [] as string[] });
    expect(save.data).toEqual({ coins: 0, items: [] });
    expect(save.loadError).toBe('corrupt');
    expect(t.platform.storage.get('broken:corrupt')).toContain('coins');

    t.platform.storage.set('typed', JSON.stringify({ v: 1, data: { coins: 'lots', items: 'x', extra: { a: 1 } } }));
    const typed = createSave('typed', { coins: 5, items: ['sword'] });
    expect(typed.data).toEqual({ coins: 5, items: ['sword'], extra: { a: 1 } });
  });

  it('debounces writes in realtime, flushes on hide, and resets', async () => {
    t = await createTestGame();
    const save = createSave('prog', { level: 1, stars: {} as Record<string, number> });
    save.set({ level: 2 });
    save.update((d) => (d.stars['1'] = 3));
    expect(t.platform.storage.get('prog')).toBeNull();
    expect(save.pending).toBe(true);
    t.game.paused = true;
    await t.advance(0.6);
    expect(JSON.parse(t.platform.storage.get('prog')!)).toEqual({ v: 1, data: { level: 2, stars: { '1': 3 } } });
    save.set({ level: 3 });
    t.platform.hide();
    expect(JSON.parse(t.platform.storage.get('prog')!).data.level).toBe(3);
    save.reset();
    expect(JSON.parse(t.platform.storage.get('prog')!).data).toEqual({ level: 1, stars: {} });
    save.reload();
    expect(save.data.level).toBe(1);

    const settings = createSettings({ lang: 'zh' });
    settings.set({ music: false });
    expect(JSON.parse(t.platform.storage.get('settings')!).data).toEqual({
      sound: true,
      music: false,
      vibration: true,
      volume: 1,
      lang: 'zh',
    });
  });
});

describe('utilities', () => {
  it('Pool reuses items and reports stats', () => {
    let resets = 0;
    const pool = new Pool({ create: () => ({ x: 0 }), reset: (o) => ((o.x = 0), resets++), prewarm: 2 });
    const a = pool.get();
    const b = pool.get();
    const c = pool.get();
    expect(pool.stats).toEqual({ created: 3, active: 3, free: 0 });
    a.x = 5;
    pool.release(a);
    pool.release(a);
    expect(resets).toBe(1);
    expect(pool.get()).toBe(a);
    expect(a.x).toBe(0);
    pool.releaseAll();
    expect(pool.stats).toEqual({ created: 3, active: 0, free: 3 });
    expect([b, c].length).toBe(2);
  });

  it('NodePool detaches, restores and skips destroyed nodes', async () => {
    t = await createTestGame();
    const layer = t.game.sceneLayer;
    const pool = new NodePool(() => new Node({ scale: 0.5 }), { parent: layer });
    const n = pool.get();
    expect(n.parent).toBe(layer);
    n.alpha = 0.2;
    n.scaleX = 3;
    tween(n, { x: 100 }, 1);
    pool.release(n);
    expect(n.parent).toBeNull();
    expect([n.alpha, n.scaleX]).toEqual([1, 0.5]);
    await t.step(10);
    expect(n.x).toBe(0);
    const again = pool.get();
    expect(again).toBe(n);
    again.destroy();
    pool.release(again);
    expect(pool.get()).not.toBe(n);
    expect(pool.stats.created).toBe(2);
  });

  it('StateMachine switches on update results and tracks time', async () => {
    t = await createTestGame();
    const log: string[] = [];
    const fsm = new StateMachine(
      {
        idle: { enter: (prev) => log.push(`enter idle from ${prev}`), update: (_dt, time) => (time >= 0.5 ? 'run' : undefined) },
        run: { enter: () => log.push('enter run'), exit: (next) => log.push(`exit run to ${next}`) },
        dead: {},
      },
      'idle',
    );
    const node = t.game.sceneLayer.add(new Node());
    fsm.attach(node);
    await t.step(29);
    expect(fsm.state).toBe('idle');
    await t.step(1);
    expect(fsm.is('run')).toBe(true);
    expect(fsm.previous).toBe('idle');
    expect(fsm.go('run')).toBe(false);
    fsm.go('dead');
    expect(log).toEqual(['enter idle from null', 'enter run', 'exit run to dead']);
    expect(() => fsm.go('nope' as 'dead')).toThrow(/unknown state/);
  });

  it('fixedUpdate runs a fixed number of steps per second', async () => {
    t = await createTestGame();
    let steps = 0;
    const stop = fixedUpdate(t.game, 120, (dt) => {
      expect(dt).toBeCloseTo(1 / 120);
      steps++;
    });
    await t.advance(1);
    expect(steps).toBe(120);
    stop();
    await t.advance(0.5);
    expect(steps).toBe(120);
  });

  it('events bus with owner-bound listeners', async () => {
    t = await createTestGame();
    const owner = t.game.sceneLayer.add(new Node());
    const got: number[] = [];
    onEvent('coin', (n: number) => got.push(n), owner);
    events.emit('coin', 1);
    owner.destroy();
    events.emit('coin', 2);
    expect(got).toEqual([1]);
    expect(events.hasListeners('coin')).toBe(false);
  });
});
