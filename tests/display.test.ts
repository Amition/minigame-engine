import { afterEach, describe, expect, it } from 'vitest';
import {
  AnimatedSprite,
  ArcProgress,
  bakeTexture,
  Box,
  CacheContainer,
  DashedLine,
  Graphics,
  gradientColorTable,
  Line,
  MaskContainer,
  NineSlice,
  nineSliceRects,
  platform,
  resolvePaintStyle,
  sampleGradientStops,
  ScaledTexture,
  ShadowBlob,
  Sprite,
  textures,
  TilingSprite,
  Trail,
  type Ctx2D,
  type LinearGradientStyle,
  type SpriteFrameEvent,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

/** 1 stage unit = 1 canvas pixel. */
const pixelGame = () => createTestGame({ device: '750x1334@1' });

function pixel(tg: TestGame, x: number, y: number): [number, number, number, number] {
  const d = tg.platform.canvas.getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]!];
}

/** Minimal ctx that records drawImage calls (source rect + dest rect). */
function recordingCtx() {
  const calls: number[][] = [];
  const ctx = {
    drawImage: (_src: unknown, ...args: number[]) => calls.push(args),
  } as unknown as Ctx2D;
  return { ctx, calls };
}

const solid = (color: string, w = 10, h = 10) =>
  bakeTexture(w, h, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  });

describe('Graphics', () => {
  it('computes bounds from painted paths, including stroke width', async () => {
    t = await createTestGame();
    const g = new Graphics().rect(10, 20, 100, 50).fill('#f00');
    expect(g.bounds).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect([g.width, g.height]).toEqual([100, 50]);
    g.circle(0, 0, 30).stroke('#fff', 4);
    expect(g.bounds).toEqual({ x: -32, y: -32, w: 142, h: 102 });
    g.moveTo(1000, 1000).lineTo(2000, 2000);
    expect(g.bounds.w).toBe(142);
    expect(g.describe()).toMatchObject({ cmds: 8, draws: 2, paint: '#f00' });
  });

  it('uses exact bounds for arcs and curves', async () => {
    t = await createTestGame();
    const arc = new Graphics().moveTo(0, 0).arc(0, 0, 10, 0, Math.PI / 2).fill('#fff');
    expect(arc.bounds).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    const cubic = new Graphics().moveTo(0, 0).bezierTo(0, 100, 100, 100, 100, 0).fill('#fff');
    expect(cubic.bounds.x).toBeCloseTo(0);
    expect(cubic.bounds.w).toBeCloseTo(100);
    expect(cubic.bounds.h).toBeCloseTo(75);
    const quad = new Graphics().moveTo(0, 0).quadTo(50, -100, 100, 0).stroke('#fff', 2);
    expect(quad.bounds.y).toBeCloseTo(-51);
    const star = new Graphics().star(0, 0, 5, 50).fill('#fff');
    expect(star.bounds.y).toBeCloseTo(-50);
    const reset = star.clear();
    expect([reset.width, reset.height, reset.commandCount]).toEqual([0, 0, 0]);
  });

  it('keeps width/height when autoSize is off', async () => {
    t = await createTestGame();
    const g = new Graphics({ width: 50, height: 40 }).rect(0, 0, 300, 300).fill('#fff');
    expect(g.autoSize).toBe(false);
    expect([g.width, g.height]).toEqual([50, 40]);
    expect(g.bounds.w).toBe(300);
  });

  it('hit tests and dumps with the bounds rect (negative local coords)', async () => {
    t = await createTestGame();
    const g = t.game.sceneLayer.add(new Graphics({ id: 'dot', x: 100, y: 100 }).circle(0, 0, 20).fill('#f00'));
    let taps = 0;
    g.onTap(() => taps++);
    expect(t.game.hitTest(92, 92)).toBe(g);
    expect(t.game.hitTest(125, 125)).toBeNull();
    await t.tap('#dot');
    expect(taps).toBe(1);
    expect(t.dump()).toContain('Graphics#dot [80,80 40x40] interactive cmds=2 draws=1 paint=#f00');
  });

  it('renders fills, gradients and strokes, and bakes to a texture', async () => {
    t = await pixelGame();
    const grad: LinearGradientStyle = { type: 'linear', x0: 0, y0: 0, x1: 100, y1: 0, stops: [[0, '#ff0000'], [1, '#0000ff']] };
    const g = t.game.sceneLayer.add(new Graphics({ x: 100, y: 100 }).rect(0, 0, 100, 40).fill(grad).circle(50, 100, 20).stroke('#00ff00', 6));
    t.game.render();
    const left = pixel(t, 102, 120);
    const right = pixel(t, 197, 120);
    expect(left[0]).toBeGreaterThan(200);
    expect(left[2]).toBeLessThan(50);
    expect(right[2]).toBeGreaterThan(200);
    expect(pixel(t, 170, 200)).toEqual([0, 255, 0, 255]);
    const tex = g.bake(2, { padding: 0 });
    expect(tex).toBeInstanceOf(ScaledTexture);
    expect([tex.width, tex.height]).toEqual([100, 123]);
    expect(tex.frame.w).toBe(200);
  });
});

describe('paint styles', () => {
  it('creates and caches gradients per descriptor', async () => {
    t = await pixelGame();
    const ctx = platform().createCanvas(100, 10).getContext('2d');
    const lin: LinearGradientStyle = { type: 'linear', x0: 0, y0: 0, x1: 100, y1: 0, stops: [[0, '#ff0000'], [1, '#0000ff']] };
    const a = resolvePaintStyle(ctx, lin);
    expect(typeof a).toBe('object');
    expect(resolvePaintStyle(ctx, lin)).toBe(a);
    expect(resolvePaintStyle(ctx, '#123456')).toBe('#123456');
    const radial = resolvePaintStyle(ctx, { type: 'radial', x: 50, y: 5, r: 50, stops: [[0, '#fff'], [1, '#000']] });
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, 100, 10);
    const center = ctx.getImageData(50, 5, 1, 1).data;
    const edge = ctx.getImageData(1, 5, 1, 1).data;
    expect(center[0]!).toBeGreaterThan(edge[0]!);
    expect(sampleGradientStops(lin.stops, 0.5)).toEqual({ r: 127.5, g: 0, b: 127.5, a: 1 });
    const table = gradientColorTable(lin.stops, 3);
    expect(table).toEqual(['#ff0000', '#800080', '#0000ff']);
  });
});

describe('AnimatedSprite', () => {
  const frames = () => [0, 1, 2, 3].map((i) => solid(['#f00', '#0f0', '#00f', '#ff0'][i]!));

  it('advances frames at fps, emits frame/complete and stops on the last frame', async () => {
    t = await createTestGame();
    const s = new AnimatedSprite({ walk: { frames: frames(), fps: 10, loop: false } });
    const log: number[] = [];
    const done: string[] = [];
    s.on('frame', (e: SpriteFrameEvent) => log.push(e.frame));
    s.on('complete', (clip: string) => done.push(clip));
    expect([s.currentClip, s.currentFrame, s.playing, s.width]).toEqual(['walk', 0, true, 10]);
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) s.update(1 / 60);
    };
    tick(5);
    expect(s.currentFrame).toBe(0);
    tick(1);
    expect(s.currentFrame).toBe(1);
    tick(12);
    expect(s.currentFrame).toBe(3);
    expect(done).toEqual([]);
    tick(6);
    expect(done).toEqual(['walk']);
    expect([s.currentFrame, s.playing]).toEqual([3, false]);
    tick(30);
    expect(log).toEqual([1, 2, 3]);
    expect(done).toEqual(['walk']);
    expect(s.describe()).toMatchObject({ clip: 'walk', frame: 3, frames: 4, playing: false });
    s.play();
    expect([s.currentFrame, s.playing]).toEqual([0, true]);
  });

  it('loops, honours speed, goto and chained clips', async () => {
    t = await createTestGame();
    const f = frames();
    textures.set('anim-k0', f[0]!);
    textures.set('anim-k1', f[1]!);
    const s = new AnimatedSprite(
      {
        idle: { frames: ['anim-k0', 'anim-k1'], fps: 4 },
        hop: { frames: f, fps: 20, loop: false, next: 'idle' },
      },
      { autoPlay: false },
    );
    expect(s.playing).toBe(false);
    expect(s.texture).toBe(f[0]);
    s.play('idle');
    s.update(0.25);
    s.update(0.25);
    expect(s.currentFrame).toBe(0);
    s.speed = 2;
    s.update(0.125);
    expect(s.currentFrame).toBe(1);
    s.gotoAndStop(2, 'hop');
    s.update(1);
    expect([s.currentClip, s.currentFrame, s.playing]).toEqual(['hop', 2, false]);
    s.speed = 1;
    s.gotoAndPlay(3);
    s.update(0.05);
    expect([s.currentClip, s.currentFrame, s.playing]).toEqual(['idle', 0, true]);
    s.speed = -1;
    s.update(0.25);
    expect(s.currentFrame).toBe(1);
    expect(() => s.play('nope')).toThrow(/no clip "nope"/);
  });

  it('accepts a plain frame array and runs through the game loop', async () => {
    t = await createTestGame();
    const s = t.game.sceneLayer.add(new AnimatedSprite(frames(), { id: 'a', fps: 60 }));
    await t.step(2);
    expect(s.currentClip).toBe('default');
    expect(s.currentFrame).toBe(2);
    expect(t.find('AnimatedSprite[clip=default][frame=2]')).toBe(s);
  });
});

describe('NineSlice', () => {
  it('computes the nine source/destination rects', () => {
    const r = nineSliceRects(30, 30, { top: 10, right: 10, bottom: 10, left: 10 }, 100, 60);
    expect(r).toHaveLength(9);
    expect(r[0]).toEqual({ sx: 0, sy: 0, sw: 10, sh: 10, dx: 0, dy: 0, dw: 10, dh: 10 });
    expect(r[1]).toEqual({ sx: 10, sy: 0, sw: 10, sh: 10, dx: 10, dy: 0, dw: 80, dh: 10 });
    expect(r[4]).toEqual({ sx: 10, sy: 10, sw: 10, sh: 10, dx: 10, dy: 10, dw: 80, dh: 40 });
    expect(r[8]).toEqual({ sx: 20, sy: 20, sw: 10, sh: 10, dx: 90, dy: 50, dw: 10, dh: 10 });
  });

  it('shrinks corners when the box is too small and scales borders', () => {
    const small = nineSliceRects(30, 30, { top: 10, right: 20, bottom: 10, left: 10 }, 15, 60);
    expect(small[0]!.dw).toBeCloseTo(5);
    expect(small[2]!.dw).toBeCloseTo(10);
    expect(small[1]!.dw).toBe(0);
    const scaled = nineSliceRects(30, 30, { top: 10, right: 10, bottom: 10, left: 10 }, 100, 100, 2);
    expect(scaled[0]!.dw).toBe(20);
    expect(scaled[0]!.sw).toBe(10);
    expect(scaled[4]).toMatchObject({ dx: 20, dw: 60 });
  });

  it('draws nine pieces from the texture frame (resolution aware)', async () => {
    t = await createTestGame();
    const tex = bakeTexture(30, 30, () => {}, { resolution: 2 });
    const ns = new NineSlice(tex, [10, 10, 10, 10], 100, 60);
    ns.seamOverlap = 0;
    const { ctx, calls } = recordingCtx();
    ns.draw(ctx);
    expect(calls).toHaveLength(9);
    expect(calls[4]).toEqual([20, 20, 20, 20, 10, 10, 80, 40]);
    ns.fillCenter = false;
    calls.length = 0;
    ns.draw(ctx);
    expect(calls).toHaveLength(8);
    expect(ns.describe()).toMatchObject({ insets: '10/10/10/10' });
  });
});

describe('TilingSprite', () => {
  it('tiles with offset and crops edge tiles through source rects', async () => {
    t = await createTestGame();
    const ts = new TilingSprite(solid('#fff', 32, 32), 100, 40, { tileX: 10 });
    ts.seamOverlap = 0;
    const { ctx, calls } = recordingCtx();
    ts.draw(ctx);
    expect(calls).toHaveLength(8);
    expect(calls[0]).toEqual([22, 0, 10, 32, 0, 0, 10, 32]);
    expect(calls[3]).toEqual([0, 0, 26, 32, 74, 0, 26, 32]);
    expect(calls[4]).toEqual([22, 0, 10, 8, 0, 32, 10, 8]);
    const row = calls.slice(0, 4).reduce((s, c) => s + c[6]!, 0);
    expect(row).toBe(100);
  });

  it('scrolls and applies tile scale', async () => {
    t = await createTestGame();
    const ts = new TilingSprite(solid('#fff', 32, 32), 64, 32, { tileScale: 2, scrollX: 32 });
    ts.update(0.5);
    expect(ts.tileX).toBe(16);
    ts.update(2);
    expect(ts.tileX).toBe(16);
    const { ctx, calls } = recordingCtx();
    ts.seamOverlap = 0;
    ts.draw(ctx);
    expect(calls[0]).toEqual([24, 0, 8, 16, 0, 0, 16, 32]);
    expect(ts.describe()).toMatchObject({ tile: '16,0', tileScale: '2x2' });
  });
});

describe('Sprite.fit', () => {
  it('maps the texture for contain / cover / none', async () => {
    t = await createTestGame();
    const tex = solid('#fff', 200, 100);
    const draw = (fit: 'contain' | 'cover' | 'none') => {
      const s = new Sprite(tex, { width: 100, height: 100, fit });
      const { ctx, calls } = recordingCtx();
      s.draw(ctx);
      return calls[0];
    };
    expect(draw('contain')).toEqual([0, 0, 200, 100, 0, 25, 100, 50]);
    expect(draw('cover')).toEqual([50, 0, 100, 100, 0, 0, 100, 100]);
    expect(draw('none')).toEqual([0, 0, 200, 100, -50, 0, 200, 100]);
    expect(new Sprite(tex, { fit: 'cover' }).describe()).toMatchObject({ fit: 'cover' });
  });
});

describe('MaskContainer', () => {
  it('only lets children inside the mask shape receive hits', async () => {
    t = await createTestGame();
    const m = t.game.sceneLayer.add(new MaskContainer({ type: 'circle' }, { x: 100, y: 100, width: 200, height: 200 }));
    const child = m.add(new Box(200, 200));
    child.interactive = true;
    expect(t.game.hitTest(200, 200)).toBe(child);
    expect(t.game.hitTest(110, 110)).toBeNull();
    expect(t.game.hitTest(290, 200)).toBe(child);
    expect(t.game.hitTest(295, 295)).toBeNull();
    m.maskHits = false;
    m.interactiveChildren = true;
    expect(t.game.hitTest(110, 110)).toBe(child);
  });

  it('tests points for every shape', async () => {
    t = await createTestGame();
    const rr = new MaskContainer({ type: 'roundRect', radius: 20 }, { width: 100, height: 60 });
    expect(rr.containsPoint(2, 2)).toBe(false);
    expect(rr.containsPoint(20, 2)).toBe(true);
    expect(rr.containsPoint(50, 30)).toBe(true);
    const poly = new MaskContainer({ type: 'polygon', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }] });
    expect(poly.containsPoint(10, 10)).toBe(true);
    expect(poly.containsPoint(80, 80)).toBe(false);
    const el = new MaskContainer({ type: 'ellipse' }, { width: 200, height: 100 });
    expect(el.containsPoint(190, 50)).toBe(true);
    expect(el.containsPoint(190, 10)).toBe(false);
    expect(el.describe()).toMatchObject({ mask: 'ellipse' });
  });

  it('clips rendering to the shape', async () => {
    t = await pixelGame();
    const m = t.game.sceneLayer.add(new MaskContainer({ type: 'circle' }, { x: 100, y: 100, width: 200, height: 200 }));
    m.add(new Box(200, 200, { fill: '#ff0000' }));
    t.game.render();
    expect(pixel(t, 200, 200)).toEqual([255, 0, 0, 255]);
    expect(pixel(t, 105, 105)).toEqual([0, 0, 0, 255]);
  });
});

describe('CacheContainer', () => {
  class CountingBox extends Box {
    draws = 0;
    override draw(ctx: Ctx2D): void {
      this.draws++;
      super.draw(ctx);
    }
  }

  it('renders children once and redraws only when marked dirty', async () => {
    t = await pixelGame();
    t.renderMode = 'every';
    const c = t.game.sceneLayer.add(new CacheContainer(100, 100, { x: 50, y: 50, resolution: 1 }));
    const box = c.add(new CountingBox(100, 100, { fill: '#00ff00' }));
    await t.step(3);
    expect(box.draws).toBe(1);
    expect(c.redraws).toBe(1);
    expect(pixel(t, 100, 100)).toEqual([0, 255, 0, 255]);
    box.fill = '#0000ff';
    await t.step(1);
    expect(pixel(t, 100, 100)).toEqual([0, 255, 0, 255]);
    c.markDirty();
    await t.step(2);
    expect(box.draws).toBe(2);
    expect(c.redraws).toBe(2);
    expect(pixel(t, 100, 100)).toEqual([0, 0, 255, 255]);
    c.cacheEnabled = false;
    await t.step(2);
    expect(box.draws).toBe(4);
    expect(c.describe()).toMatchObject({ cached: false, redraws: 2 });
    c.cacheEnabled = true;
    expect(c.cacheTexture()).not.toBeNull();
  });
});

describe('effects', () => {
  it('Trail records target positions and ages them out', async () => {
    t = await createTestGame();
    const target = t.game.sceneLayer.add(new Box(10, 10, {}, { x: 0, y: 0, anchor: 0.5 }));
    const trail = t.game.sceneLayer.add(new Trail({ target, lifetime: 0.2, minDistance: 5 }));
    for (let i = 0; i < 10; i++) {
      target.x += 10;
      await t.step(1);
    }
    expect(trail.pointCount).toBeGreaterThan(5);
    await t.step(30);
    expect(trail.pointCount).toBe(1);
    trail.target = null;
    await t.step(30);
    expect(trail.pointCount).toBe(0);
    trail.addPoint(0, 0).addPoint(1, 0).addPoint(20, 0);
    expect(trail.pointCount).toBe(2);
  });

  it('ArcProgress, ShadowBlob, Line and DashedLine render and describe themselves', async () => {
    t = await pixelGame();
    const arc = t.game.sceneLayer.add(
      new ArcProgress({ radius: 50, thickness: 10, value: 0.25, x: 0, y: 0, color: '#ff0000', trackColor: null }),
    );
    const blob = t.game.sceneLayer.add(new ShadowBlob(100, 30, { x: 400, y: 400, color: '#ff00ff', opacity: 1, softness: 0 }));
    const line = t.game.sceneLayer.add(new Line([0, 0, 100, 0], { color: '#00ff00', thickness: 6, arrow: 20 }, { x: 100, y: 300 }));
    const dashed = t.game.sceneLayer.add(new DashedLine([0, 0, 300, 0], { dashSpeed: 100 }, { y: 500 }));
    t.game.render();
    expect(pixel(t, 81, 18)).toEqual([255, 0, 0, 255]);
    expect(pixel(t, 5, 50)).toEqual([0, 0, 0, 255]);
    expect(pixel(t, 400, 400)).toEqual([255, 0, 255, 255]);
    expect(blob.worldBounds()).toEqual({ x: 350, y: 385, w: 100, h: 30 });
    expect(pixel(t, 150, 300)).toEqual([0, 255, 0, 255]);
    expect(line.length).toBe(100);
    line.setEnds(0, 0, 30, 40);
    expect(line.length).toBe(50);
    expect(arc.describe()).toMatchObject({ value: 0.25, mode: 'ring' });
    dashed.update(0.1);
    expect(dashed.dashOffset).toBeCloseTo(-10);
    expect(dashed.describe()).toMatchObject({ dash: '16,10', len: 300 });
  });
});