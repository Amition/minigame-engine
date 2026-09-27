import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Box, flushUILayout, Label, mountScreen, Node, setUILayout, Sprite, bakeTexture, ui, UIView, type Rect } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const box = (w: number, h: number, id = '') => new Box(w, h, { fill: '#888' }, { id });
const view = (w: number, h: number, props: ConstructorParameters<typeof UIView>[0] = {}) =>
  new UIView({ width: w, height: h, ...props });

function rect(n: Node): Rect {
  const b = n.worldBounds();
  return { x: Math.round(b.x * 100) / 100, y: Math.round(b.y * 100) / 100, w: Math.round(b.w * 100) / 100, h: Math.round(b.h * 100) / 100 };
}

async function mount(root: UIView): Promise<UIView> {
  t ??= await createTestGame();
  t.game.sceneLayer.add(root);
  flushUILayout(root);
  return root;
}

describe('ui layout: column / row', () => {
  it('stacks a column with padding and gap; leaves keep their size', async () => {
    const a = box(100, 50);
    const b = box(200, 80);
    const root = await mount(ui.column({ padding: 20, gap: 10 }, [a, b]));
    expect(rect(root)).toEqual({ x: 0, y: 0, w: 240, h: 20 + 50 + 10 + 80 + 20 });
    expect(rect(a)).toEqual({ x: 20, y: 20, w: 100, h: 50 });
    expect(rect(b)).toEqual({ x: 20, y: 80, w: 200, h: 80 });
  });

  it('supports [v, h] and [t, r, b, l] padding and margins', async () => {
    const a = box(100, 100);
    setUILayout(a, { margin: [5, 10] });
    const root = await mount(ui.column({ padding: [1, 2, 3, 4] }, [a]));
    expect(rect(root)).toEqual({ x: 0, y: 0, w: 4 + 10 + 100 + 10 + 2, h: 1 + 5 + 100 + 5 + 3 });
    expect(rect(a)).toEqual({ x: 14, y: 6, w: 100, h: 100 });
  });

  it('aligns items in a row (start/center/end/stretch) and via alignSelf', async () => {
    const a = box(50, 20);
    const b = box(50, 40);
    const c = view(50, 'auto' as never);
    setUILayout(b, { alignSelf: 'end' });
    const root = await mount(ui.row({ align: 'center', height: 100, width: 300 }, [a, b, c]));
    expect(rect(a).y).toBe(40);
    expect(rect(b).y).toBe(60);
    expect(rect(c)).toEqual({ x: 100, y: 50, w: 50, h: 0 });
    root.layout.align = 'stretch';
    flushUILayout(root);
    expect(rect(c)).toEqual({ x: 100, y: 0, w: 50, h: 100 });
    expect(rect(a).y).toBe(0);
  });

  it.each([
    ['start', [0, 100, 200]],
    ['center', [150, 250, 350]],
    ['end', [300, 400, 500]],
    ['between', [0, 250, 500]],
    ['around', [50, 250, 450]],
    ['evenly', [75, 250, 425]],
  ] as const)('justify %s', async (justify, xs) => {
    const items = [box(100, 10), box(100, 10), box(100, 10)];
    await mount(ui.row({ width: 600, justify }, items));
    expect(items.map((n) => rect(n).x)).toEqual(xs);
  });

  it('distributes free space with grow and overflow with shrink (weighted by basis)', async () => {
    const a = view(0, 10, { width: undefined, basis: 100, grow: 1 });
    const b = view(0, 10, { width: undefined, basis: 100, grow: 3 });
    await mount(ui.row({ width: 600, gap: 0 }, [a, b]));
    expect(rect(a).w).toBe(100 + 100);
    expect(rect(b).w).toBe(100 + 300);

    t?.destroy();
    t = null;
    const c = view(0, 10, { width: undefined, basis: 300, shrink: 1, minWidth: 0 });
    const d = view(0, 10, { width: undefined, basis: 100, shrink: 1, minWidth: 0 });
    await mount(ui.row({ width: 200 }, [c, d]));
    expect(rect(c).w).toBe(150);
    expect(rect(d).w).toBe(50);
  });

  it('respects min/max while flexing', async () => {
    const a = view(0, 10, { width: undefined, grow: 1, maxWidth: 120 });
    const b = view(0, 10, { width: undefined, grow: 1 });
    await mount(ui.row({ width: 500 }, [a, b]));
    expect(rect(a).w).toBe(120);
    expect(rect(b).w).toBe(380);
  });

  it('resolves percentages and aspectRatio', async () => {
    const a = new UIView({ width: '50%', height: '25%' });
    const b = new UIView({ width: '40%', aspectRatio: 2 });
    await mount(ui.column({ width: 400, height: 800, padding: 0, align: 'start' }, [a, b]));
    expect(rect(a)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    expect(rect(b)).toEqual({ x: 0, y: 200, w: 160, h: 80 });
  });

  it('wraps rows onto new lines', async () => {
    const items = [0, 1, 2, 3, 4].map(() => box(200, 50));
    const root = await mount(ui.row({ width: 500, wrap: true, gap: 20, crossGap: 10, align: 'start' }, items));
    expect(items.map((n) => [rect(n).x, rect(n).y])).toEqual([
      [0, 0],
      [220, 0],
      [0, 60],
      [220, 60],
      [0, 120],
    ]);
    expect(rect(root).h).toBe(170);
  });

  it('places absolute children by offsets, percentages and centering', async () => {
    const tl = setUILayout(box(40, 40), { position: 'absolute', left: 10, top: 20 });
    const br = setUILayout(box(40, 40), { position: 'absolute', right: 10, bottom: 20 });
    const ctr = setUILayout(box(100, 50), { position: 'absolute', center: true });
    const fill = new UIView({ position: 'absolute', inset: 0 });
    const pct = setUILayout(box(10, 10), { position: 'absolute', left: '50%', top: '10%' });
    await mount(ui.view({ width: 400, height: 300, padding: 30 }, [tl, br, ctr, fill, pct]));
    expect(rect(tl)).toEqual({ x: 10, y: 20, w: 40, h: 40 });
    expect(rect(br)).toEqual({ x: 350, y: 240, w: 40, h: 40 });
    expect(rect(ctr)).toEqual({ x: 150, y: 125, w: 100, h: 50 });
    expect(rect(fill)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(rect(pct)).toEqual({ x: 200, y: 30, w: 10, h: 10 });
  });

  it('stack direction overlays children, centered by default', async () => {
    const a = box(100, 100);
    const b = box(40, 20);
    const root = await mount(ui.stack({}, [a, b]));
    expect(rect(root)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(rect(b)).toEqual({ x: 30, y: 40, w: 40, h: 20 });
  });

  it('skips invisible children and honours anchors of placed nodes', async () => {
    const a = box(100, 40);
    const hidden = box(100, 40);
    hidden.visible = false;
    const anchored = box(60, 60);
    anchored.anchorX = anchored.anchorY = 0.5;
    const root = await mount(ui.column({ gap: 10 }, [a, hidden, anchored]));
    expect(rect(root).h).toBe(110);
    expect(rect(anchored)).toEqual({ x: 0, y: 50, w: 60, h: 60 });
    expect(anchored.x).toBe(30);
  });

  it('scales sprites proportionally when one side is set', async () => {
    t = await createTestGame();
    const tex = bakeTexture(40, 20, () => undefined);
    const s = setUILayout(new Sprite(tex), { width: 200 });
    const root = t.game.sceneLayer.add(ui.column({ align: 'start' }, [s]));
    flushUILayout(root);
    expect(rect(s)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });
});

describe('ui layout: text + relayout', () => {
  beforeEach(async () => {
    t = await createTestGame();
  });

  it('wraps text to the available width and grows the container', async () => {
    const long = new Label('The quick brown fox jumps over the lazy dog again and again', { size: 30 });
    const root = await mount(ui.column({ width: 300, padding: 10 }, [long]));
    expect(long.width).toBe(280);
    expect(long.lines.length).toBeGreaterThan(1);
    expect(rect(root).h).toBe(Math.ceil(long.lines.length * 30 * 1.4) + 20);
  });

  it('keeps short text at its natural width in a row and shrinks long text', async () => {
    const short = new Label('Hi', { size: 30 });
    const long = new Label('A fairly long label that must wrap inside the row', { size: 30, shrink: 1 });
    await mount(ui.row({ width: 400, align: 'start', gap: 20 }, [short, long]));
    expect(short.lines.length).toBe(1);
    expect(short.width).toBeLessThan(60);
    expect(rect(long).x + rect(long).w).toBeLessThanOrEqual(400.5);
    expect(long.lines.length).toBeGreaterThan(1);
  });

  it('autoFit shrinks the font instead of wrapping', async () => {
    const l = new Label('Collect all the stars', { size: 40, autoFit: 20 });
    await mount(ui.column({ width: 200 }, [l]));
    expect(l.lines.length).toBe(1);
    expect(l.fontSize).toBeLessThan(40);
    expect(l.fontSize).toBeGreaterThanOrEqual(20);
  });

  it('re-lays out automatically when layout props, text or visibility change', async () => {
    const a = box(100, 50);
    const label = new Label('short', { size: 30 });
    const root = await mount(ui.column({ gap: 0, align: 'start' }, [a, label]));
    const y0 = rect(label).y;
    expect(y0).toBe(50);
    a.height = 80;
    await t!.step(1);
    expect(rect(label).y).toBe(80);
    a.visible = false;
    await t!.step(1);
    expect(rect(label).y).toBe(0);
    root.layout.padding = 12;
    await t!.step(1);
    expect(rect(label).y).toBe(12);
    const w0 = label.width;
    label.text = 'a much longer piece of text';
    await t!.step(1);
    expect(rect(root).w).toBeGreaterThan(w0 + 24);
  });

  it('mountScreen fills the safe area and follows resizes', async () => {
    t?.destroy();
    t = await createTestGame({ device: 'iphone-14' });
    const scene = t.game.sceneLayer.add(new Node());
    scene.setSize(t.game.view.width, t.game.view.height);
    const root = mountScreen(scene, ui.column({ justify: 'end', padding: 0 }, [box(100, 100, 'foot')]));
    await t.step(1);
    const safe = t.game.safe;
    expect(rect(root)).toEqual({ x: 0, y: Math.round(safe.y * 100) / 100, w: Math.round(safe.w * 100) / 100, h: Math.round(safe.h * 100) / 100 });
    expect(rect(t.get('#foot')).y + 100).toBeCloseTo(safe.y + safe.h, 1);
    t.platform.resize(390, 600, { top: 0, right: 0, bottom: 0, left: 0 });
    await t.step(1);
    expect(rect(root).h).toBeCloseTo(t.game.view.height, 1);
    expect(rect(t.get('#foot')).y + 100).toBeCloseTo(t.game.view.height, 1);
  });
});
