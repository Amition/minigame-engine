import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box, CacheContainer, Emitter, MaskContainer, Node, type Ctx2D, type Rect, type Vec2 } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
  vi.restoreAllMocks();
});

/** 1 stage unit = 1 canvas pixel. */
const pixelGame = () => createTestGame({ device: '750x1334@1' });

function pixel(tg: TestGame, x: number, y: number): [number, number, number, number] {
  const d = tg.platform.canvas.getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]!];
}

/** A node that paints its box with `paint(ctx)` after running `before(ctx)`. */
class Painted extends Node {
  constructor(
    private readonly before: (ctx: Ctx2D) => void,
    private readonly color: string,
    opts: ConstructorParameters<typeof Node>[0],
  ) {
    super(opts);
  }

  override draw(ctx: Ctx2D): void {
    this.before(ctx);
    ctx.fillStyle = this.color;
    ctx.fillRect(0, 0, this.width, this.height);
  }
}

describe('Node.tick', () => {
  it('skips children removed during the tick and runs added ones from the next frame', () => {
    const root = new Node();
    const log: string[] = [];
    const named = (name: string) => {
      const n = new Node();
      n.onUpdate(() => log.push(name));
      return n;
    };
    const a = root.add(named('a'));
    const b = root.add(named('b'));
    root.add(named('c'));
    let once = true;
    a.onUpdate(() => {
      if (!once) return;
      once = false;
      root.remove(b);
      root.add(named('d'));
      root.addAt(named('e'), 0);
    });
    root.tick(0.016);
    expect(log).toEqual(['a', 'c']);
    log.length = 0;
    root.tick(0.016);
    expect(log).toEqual(['e', 'a', 'c', 'd']);
  });

  it('keeps the children array when nothing changes (no per-frame copy)', () => {
    const root = new Node();
    root.add(new Node());
    const last = root.add(new Node());
    const before = root.children;
    root.tick(0.016);
    root.walk(() => {});
    expect(root.children).toBe(before);
    root.remove(last);
    expect(root.children).toBe(before);
    expect(before).toHaveLength(1);
  });

  it('runs updaters removed during the tick once more and added ones from the next frame', () => {
    const n = new Node();
    const log: string[] = [];
    let offB: () => void = () => {};
    let added = false;
    n.onUpdate(() => {
      log.push('a');
      offB();
      if (!added) {
        added = true;
        n.onUpdate(() => log.push('c'));
      }
    });
    offB = n.onUpdate(() => log.push('b'));
    n.tick(0.016);
    expect(log).toEqual(['a', 'b']);
    log.length = 0;
    n.tick(0.016);
    expect(log).toEqual(['a', 'c']);
  });

  it('lets a single updater remove itself', () => {
    const n = new Node();
    let calls = 0;
    const off = n.onUpdate(() => {
      calls++;
      off();
    });
    n.tick(0.016);
    n.tick(0.016);
    expect(calls).toBe(1);
  });

  it('walks every node even when the callback removes one', () => {
    const root = new Node();
    const a = root.add(new Node({ id: 'a' }));
    root.add(new Node({ id: 'b' }));
    const seen: string[] = [];
    root.walk((n) => {
      seen.push(n.id);
      if (n === a) root.remove(a);
    });
    expect(seen).toEqual(['', 'a', 'b']);
    expect(root.children.map((c) => c.id)).toEqual(['b']);
  });
});

describe('Emitter', () => {
  it('still delivers the current event to listeners removed during emit', () => {
    const e = new Emitter<{ ping: number }>();
    const log: string[] = [];
    const b = () => log.push('b');
    e.on('ping', () => {
      log.push('a');
      e.off('ping', b);
      e.on('ping', () => log.push('late'));
    });
    e.on('ping', b);
    e.once('ping', () => log.push('once'));
    e.emit('ping', 1);
    expect(log).toEqual(['a', 'b', 'once']);
    log.length = 0;
    e.emit('ping', 2);
    expect(log).toEqual(['a', 'late']);
  });

  it('handles a once listener that re-emits', () => {
    const e = new Emitter<{ ping: number }>();
    const got: number[] = [];
    e.once('ping', (v) => {
      got.push(v);
      e.emit('ping', v + 1);
    });
    e.emit('ping', 1);
    expect(got).toEqual([1]);
    expect(e.hasListeners('ping')).toBe(false);
  });
});

describe('Game systems', () => {
  it('runs systems added or removed during an update from the next frame', async () => {
    t = await createTestGame();
    const log: string[] = [];
    let offB: () => void = () => {};
    let added = false;
    t.game.addSystem({
      update: () => {
        log.push('a');
        offB();
        if (!added) {
          added = true;
          t!.game.addSystem({ update: () => log.push('c') }, 5);
        }
      },
    });
    offB = t.game.addSystem({ update: () => log.push('b') }, 1);
    await t.step(1);
    expect(log).toEqual(['a', 'b']);
    log.length = 0;
    await t.step(1);
    expect(log).toEqual(['a', 'c']);
  });
});

describe('transforms', () => {
  it('writes into the given out objects', () => {
    const p = new Node({ x: 100, y: 50, scale: 2 });
    const c = p.add(new Node({ x: 10, y: 5, width: 20, height: 10 }));
    const r: Rect = { x: 0, y: 0, w: 0, h: 0 };
    expect(c.worldBounds(r)).toBe(r);
    expect(r).toEqual({ x: 120, y: 60, w: 40, h: 20 });
    const v: Vec2 = { x: 0, y: 0 };
    expect(c.toWorld(1, 1, v)).toBe(v);
    expect(v).toEqual({ x: 122, y: 62 });
    expect(c.toLocal(122, 62, v)).toEqual({ x: 1, y: 1 });
    expect(c.worldMatrix().apply(1, 1)).toEqual({ x: 122, y: 62 });
  });
});

describe('hit testing', () => {
  it('maps points through rotated and scaled parents', async () => {
    t = await createTestGame();
    const p = t.game.sceneLayer.add(new Node({ x: 300, y: 300, rotation: Math.PI / 2, scale: 2 }));
    const child = p.add(new Box(50, 20, {}, { x: 10, y: 0, interactive: true }));
    const c = child.worldCenter();
    expect(c.x).toBeCloseTo(280);
    expect(c.y).toBeCloseTo(370);
    expect(t.game.hitTest(c.x, c.y)).toBe(child);
    expect(t.game.hitTest(300 + 10, 370)).toBeNull();
  });

  it('respects clipping parents, hitPadding, zIndex order and custom hitTest', async () => {
    t = await createTestGame();
    const clip = t.game.sceneLayer.add(new Node({ x: 100, y: 100, width: 100, height: 100, clip: true }));
    const big = clip.add(new Box(300, 300, {}, { interactive: true }));
    expect(t.game.hitTest(150, 150)).toBe(big);
    expect(t.game.hitTest(250, 150)).toBeNull();

    const low = t.game.sceneLayer.add(new Box(50, 50, {}, { x: 400, y: 400, zIndex: 2, interactive: true, hitPadding: 10 }));
    const high = t.game.sceneLayer.add(new Box(50, 50, {}, { x: 420, y: 400, zIndex: 1, interactive: true }));
    expect(t.game.hitTest(430, 420)).toBe(low);
    expect(t.game.hitTest(395, 420)).toBe(low);
    expect(t.game.hitTest(465, 420)).toBe(high);

    class Disc extends Node {
      override hitTest(lx: number, ly: number): boolean {
        return (lx - 50) ** 2 + (ly - 50) ** 2 <= 50 * 50;
      }
    }
    const disc = t.game.sceneLayer.add(new Disc({ x: 500, y: 600, width: 100, height: 100, interactive: true }));
    expect(t.game.hitTest(550, 650)).toBe(disc);
    expect(t.game.hitTest(503, 603)).toBeNull();

    const mask = t.game.sceneLayer.add(new MaskContainer({ type: 'circle' }, { x: 100, y: 800, width: 100, height: 100 }));
    const inMask = mask.add(new Box(100, 100, {}, { interactive: true }));
    expect(t.game.hitTest(150, 850)).toBe(inMask);
    expect(t.game.hitTest(103, 803)).toBeNull();
  });

  it('counts interactive descendants and skips subtrees without any', async () => {
    t = await createTestGame();
    let clipCalls = 0;
    class Probe extends Node {
      override hitClip(lx: number, ly: number): boolean {
        clipCalls++;
        return super.hitClip(lx, ly);
      }
    }
    const probe = new Probe({ width: 800, height: 800 });
    const inner = probe.add(new Node());
    const leaf = inner.add(new Box(100, 100, {}, { x: 10, y: 10 }));
    t.game.sceneLayer.add(probe);
    expect(t.game.hitTest(50, 50)).toBeNull();
    expect(clipCalls).toBe(0);

    leaf.interactive = true;
    expect(probe.interactiveDescendants).toBe(1);
    expect(t.game.sceneLayer.interactiveDescendants).toBeGreaterThanOrEqual(1);
    expect(t.game.hitTest(50, 50)).toBe(leaf);
    expect(clipCalls).toBe(1);

    inner.removeFromParent();
    expect(probe.interactiveDescendants).toBe(0);
    probe.add(inner);
    expect(probe.interactiveDescendants).toBe(1);
    leaf.interactive = false;
    expect(probe.interactiveDescendants).toBe(0);
    leaf.interactive = true;
    probe.interactiveChildren = false;
    expect(t.game.hitTest(50, 50)).toBeNull();
    probe.interactiveChildren = true;
    leaf.destroy();
    expect(probe.interactiveDescendants).toBe(0);
  });
});

describe('render', () => {
  it('draws children through parent transforms and drawOver in the node space', async () => {
    t = await pixelGame();
    class Over extends Node {
      override drawOver(ctx: Ctx2D): void {
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(0, 0, 10, 10);
      }
    }
    const p = t.game.sceneLayer.add(new Over({ x: 100, y: 100, scale: 2 }));
    p.add(new Box(20, 20, { fill: '#ff0000' }, { x: 20, y: 20, rotation: Math.PI / 4, anchor: 0.5 }));
    t.game.render();
    expect(pixel(t, 140, 140)).toEqual([255, 0, 0, 255]);
    expect(pixel(t, 105, 105)).toEqual([0, 0, 255, 255]);
    expect(pixel(t, 125, 105)).toEqual([0, 0, 0, 255]);
  });

  it('does not leak alpha, blend or draw() state into siblings', async () => {
    t = await pixelGame();
    const layer = t.game.sceneLayer;
    const faded = layer.add(new Node({ alpha: 0.5 }));
    faded.add(new Box(50, 50, { fill: '#ff0000' }, { x: 0, y: 0 }));
    layer.add(new Box(50, 50, { fill: '#ff0000' }, { x: 60, y: 0 }));
    layer.add(new Box(50, 50, { fill: '#00ff00' }, { x: 120, y: 0, blend: 'lighter' }));
    layer.add(new Box(50, 50, { fill: '#ff0000' }, { x: 180, y: 0 }));
    layer.add(new Painted((ctx) => (ctx.globalAlpha = 0.2), '#ff0000', { x: 240, y: 0, width: 50, height: 50 }));
    layer.add(new Box(50, 50, { fill: '#ff0000' }, { x: 300, y: 0 }));
    const shadowy = (ctx: Ctx2D) => {
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 20;
    };
    layer.add(new Painted(shadowy, '#ff0000', { x: 0, y: 100, width: 50, height: 50, isolate: true }));
    layer.add(new Box(50, 50, { fill: '#ff0000' }, { x: 100, y: 100 }));
    t.game.render();
    expect(pixel(t, 25, 25)[0]).toBeGreaterThan(120);
    expect(pixel(t, 25, 25)[0]).toBeLessThan(135);
    expect(pixel(t, 85, 25)).toEqual([255, 0, 0, 255]);
    expect(pixel(t, 145, 25)).toEqual([0, 255, 0, 255]);
    expect(pixel(t, 205, 25)).toEqual([255, 0, 0, 255]);
    expect(pixel(t, 265, 25)[0]).toBeLessThan(60);
    expect(pixel(t, 325, 25)).toEqual([255, 0, 0, 255]);
    expect(pixel(t, 60, 125)).toEqual([255, 255, 255, 255]);
    expect(pixel(t, 160, 125)).toEqual([0, 0, 0, 255]);
  });

  it('warns once when draw() leaves canvas state behind', async () => {
    t = await pixelGame();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class Leaky extends Painted {
      override get kind(): string {
        return 'LeakyTestNode';
      }
    }
    t.game.sceneLayer.add(new Leaky((ctx) => (ctx.lineJoin = 'round'), '#ff0000', { id: 'l', width: 10, height: 10 }));
    t.game.render();
    t.game.render();
    const msgs = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('LeakyTestNode'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('LeakyTestNode#l');
    expect(msgs[0]).toContain('lineJoin');
  });

  it('keeps Node.renderCount at one per drawn node', async () => {
    t = await createTestGame();
    const p = t.game.sceneLayer.add(new Node());
    p.add(new Node());
    p.add(new Node({ visible: false })).add(new Node());
    p.add(new Node({ alpha: 0 }));
    const ctx = t.platform.canvas.getContext('2d');
    const n0 = Node.renderCount;
    p.render(ctx);
    expect(Node.renderCount - n0).toBe(2);
  });
});

describe('CacheContainer release', () => {
  it('shrinks the offscreen canvas to 1x1 on releaseCache() and destroy()', async () => {
    t = await pixelGame();
    const c = t.game.sceneLayer.add(new CacheContainer(100, 80, { resolution: 1 }));
    c.add(new Box(100, 80, { fill: '#00ff00' }));
    const first = c.cacheTexture()!.source as { width: number; height: number };
    expect([first.width, first.height]).toEqual([100, 80]);
    c.releaseCache();
    expect([first.width, first.height]).toEqual([1, 1]);
    t.game.render();
    expect(pixel(t, 50, 40)).toEqual([0, 255, 0, 255]);
    const second = c.cacheTexture()!.source as { width: number; height: number };
    expect(second).not.toBe(first);
    c.destroy();
    expect([second.width, second.height]).toEqual([1, 1]);
  });
});
