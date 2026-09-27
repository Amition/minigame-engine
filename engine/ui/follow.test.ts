import { afterEach, describe, expect, it } from 'vitest';
import { createTestGame, type TestGame } from '@engine/testing';
import type { Rect } from '../core/math';
import { Node } from '../scene/node';
import { mountScreen, ui } from './builder';
import { convertPoint, followNode, nodeRect, pinToNode } from './follow';
import { flushUILayout } from './layout';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const round = (r: Rect) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

/** stage > root > field (moved, scaled) > target; hud (moved) is a sibling of field. */
function tree() {
  const root = new Node();
  const field = root.add(new Node({ x: 100, y: 50, scale: 0.5 }));
  const target = field.add(new Node({ x: 400, y: 600, width: 200, height: 100 }));
  const hud = root.add(new Node({ x: 10, y: 20 }));
  return { root, field, target, hud };
}

describe('convertPoint / nodeRect', () => {
  it('converts between nested scaled and moved nodes; null is the stage', () => {
    const { field, target, hud } = tree();
    expect(convertPoint(target, null, 0, 0)).toEqual({ x: 300, y: 350 });
    expect(convertPoint(field, hud, 400, 600)).toEqual({ x: 290, y: 330 });
    expect(convertPoint(null, target, 300, 350)).toEqual({ x: 0, y: 0 });
    const out = { x: 0, y: 0 };
    expect(convertPoint(hud, field, 290, 330, out)).toBe(out);
    expect(out).toEqual({ x: 400, y: 600 });
  });

  it('nodeRect: content box by default (= worldBounds), local rects, other spaces, rotation gives the AABB', () => {
    const { field, target, hud } = tree();
    expect(nodeRect(target)).toEqual(target.worldBounds());
    expect(nodeRect(target)).toEqual({ x: 300, y: 350, w: 100, h: 50 });
    expect(nodeRect(target, { x: 20, y: 10, w: 40, h: 20 }, hud)).toEqual({ x: 300, y: 335, w: 20, h: 10 });
    expect(nodeRect(field, { x: 400, y: 600, w: 200, h: 100 }, target)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    target.rotation = Math.PI / 2;
    expect(round(nodeRect(target))).toEqual({ x: 250, y: 350, w: 50, h: 100 });
  });
});

describe('followNode', () => {
  it('returns the target rect, then offset, clamp, pad and min size in that order', async () => {
    t = await createTestGame({ device: '750x1334@1' });
    const { root, target } = tree();
    t.game.sceneLayer.add(root);
    expect(followNode(target)()).toEqual({ x: 300, y: 350, w: 100, h: 50 });
    expect(followNode(target, { offset: { x: 5, y: -10 }, pad: [1, 2, 3, 4] })()).toEqual({ x: 309, y: 341, w: 94, h: 46 });
    expect(followNode(target, { rect: (n) => ({ x: 0, y: -40, w: n.width, h: 40 }) })()).toEqual({ x: 300, y: 330, w: 100, h: 20 });
    expect(followNode(target, { pad: 10, minWidth: 120, minHeight: 60, anchor: { x: 0.5, y: 0 } })()).toEqual({ x: 290, y: 360, w: 120, h: 60 });
    target.y = 2600;
    expect(followNode(target, { clamp: 'view' })()).toEqual({ x: 300, y: 1334, w: 100, h: 0 });
    target.height = 200;
    target.y = 2400;
    expect(followNode(target, { clamp: 'view', pad: [10, 0, 8, 0] })()).toEqual({ x: 300, y: 1260, w: 100, h: 66 });
    expect(followNode(target, { clamp: { x: 0, y: 0, w: 320, h: 2000 } })()).toEqual({ x: 300, y: 1250, w: 20, h: 100 });
  });

  it('as a mountScreen area it uses the mount parent space and tracks a node in a scaled, moved parent', async () => {
    t = await createTestGame({ device: 'iphone-se' });
    const { root, field, target, hud } = tree();
    t.game.sceneLayer.add(root);
    const bar = ui.view({ id: 'bar', height: 20, fill: '#f00' });
    mountScreen(hud, ui.column({}, [bar]), { area: followNode(target, { pad: 4 }) });
    flushUILayout(root);
    const expected = () => {
      const r = target.worldBounds();
      return round({ x: r.x + 4, y: r.y + 4, w: r.w - 8, h: 20 });
    };
    expect(round(bar.worldBounds())).toEqual(expected());
    expect(round(bar.worldBounds())).toEqual({ x: 304, y: 354, w: 92, h: 20 });

    field.x = 40;
    field.scaleX = field.scaleY = 1.5;
    target.x = 100;
    await t.step(1);
    expect(round(bar.worldBounds())).toEqual(expected());
    expect(round(bar.worldBounds())).toEqual({ x: 194, y: 954, w: 292, h: 20 });

    // the app refits its field on resize, like a landscape game scaling the world to the view
    t.game.on('resize', () => {
      field.scaleX = field.scaleY = t!.game.view.width / 1000;
    });
    t.platform.resize(400, 600);
    await t.step(1);
    expect(field.scaleX).toBeCloseTo(t.game.view.width / 1000);
    expect(round(bar.worldBounds())).toEqual(expected());
  });

  it('space null means stage; an explicit space wins over the mount parent; a destroyed target keeps the last rect', async () => {
    t = await createTestGame({ device: '750x1334@1' });
    const { root, target, hud } = tree();
    t.game.sceneLayer.add(root);
    const inHud = followNode(target, { space: hud });
    const onStage = followNode(target, { space: null });
    const byMount = followNode(target);
    expect(inHud()).toEqual({ x: 290, y: 330, w: 100, h: 50 });
    expect(onStage(hud)).toEqual({ x: 300, y: 350, w: 100, h: 50 });
    expect(byMount(hud)).toEqual({ x: 290, y: 330, w: 100, h: 50 });
    expect(byMount()).toEqual({ x: 300, y: 350, w: 100, h: 50 });
    target.destroy();
    expect(byMount()).toEqual({ x: 300, y: 350, w: 100, h: 50 });
  });

  it("clamp 'safe' keeps a mounted HUD inside the safe area", async () => {
    t = await createTestGame({ device: 'iphone-14' });
    const { root, target, hud } = tree();
    t.game.sceneLayer.add(root);
    target.y = 2000;
    target.height = 2000;
    const area = followNode(target, { clamp: 'safe', pad: [0, 0, 8, 0] });
    const safe = t.game.safe;
    const r = area(hud);
    expect(r.y + hud.y + r.h).toBeCloseTo(safe.y + safe.h - 8);
  });
});

describe('pinToNode', () => {
  it('places the node on the target point every frame, after the stage moved it', async () => {
    t = await createTestGame({ device: '750x1334@1' });
    const { root, field, target, hud } = tree();
    t.game.sceneLayer.add(root);
    const label = hud.add(new Node({ width: 40, height: 20, anchor: 0.5 }));
    pinToNode(label, target, { at: (n) => ({ x: n.width / 2, y: 0 }), offset: { x: 0, y: -12 } });
    expect(label.worldCenter()).toEqual({ x: 350, y: 338 });
    target.onUpdate(() => (target.x += 10));
    await t.step(3);
    expect(target.x).toBe(430);
    expect(label.worldCenter()).toEqual({ x: 365, y: 338 });
    field.scaleX = field.scaleY = 1;
    await t.step(1);
    expect(label.worldCenter()).toEqual({ x: 100 + 440 + 100, y: 50 + 600 - 12 });
  });

  it('hideWithTarget copies the effective visibility', async () => {
    t = await createTestGame({ device: '750x1334@1' });
    const { root, field, target, hud } = tree();
    t.game.sceneLayer.add(root);
    const label = hud.add(new Node({ width: 40, height: 20 }));
    pinToNode(label, target, { hideWithTarget: true });
    expect(label.visible).toBe(true);
    field.visible = false;
    await t.step(1);
    expect(label.visible).toBe(false);
    field.visible = true;
    await t.step(1);
    expect(label.visible).toBe(true);
  });

  it('stops when the target or the node is destroyed, or when the remover is called', async () => {
    t = await createTestGame({ device: '750x1334@1' });
    const { root, target, hud } = tree();
    t.game.sceneLayer.add(root);
    const a = hud.add(new Node());
    const b = hud.add(new Node());
    const c = hud.add(new Node());
    pinToNode(a, target);
    pinToNode(b, target);
    const stop = pinToNode(c, target);
    expect(a.x).toBe(290 + 50);

    stop();
    c.x = 0;
    await t.step(1);
    expect(c.x).toBe(0);
    expect(a.x).toBe(290 + 50);

    b.destroy();
    target.destroy();
    a.x = 0;
    await t.step(1);
    expect(a.x).toBe(0);
  });
});
