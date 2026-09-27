import { afterEach, describe, expect, it } from 'vitest';
import {
  Box,
  Camera2D,
  DepthSortLayer,
  GroundObject,
  Node,
  ParallaxLayer,
  visibleRectIn,
  World,
  type Ctx2D,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

/** Counts how often it was drawn. */
class Probe extends Node {
  draws = 0;
  override draw(_ctx: Ctx2D): void {
    this.draws++;
  }
}

describe('Camera2D', () => {
  it('round-trips screen <-> world with zoom and rotation', () => {
    const cam = new Camera2D({ x: 300, y: -120, zoom: 1.7, rotation: 0.6 }).setViewport(750, 1334);
    const c = cam.worldToScreen(300, -120);
    expect(c.x).toBeCloseTo(375);
    expect(c.y).toBeCloseTo(667);
    for (const [x, y] of [
      [0, 0],
      [512, -333],
      [-1000, 2500],
    ] as const) {
      const s = cam.worldToScreen(x, y);
      const w = cam.screenToWorld(s.x, s.y);
      expect(w.x).toBeCloseTo(x, 6);
      expect(w.y).toBeCloseTo(y, 6);
    }
    const s = cam.screenToWorld(375 + 170, 667);
    expect(Math.hypot(s.x - 300, s.y + 120)).toBeCloseTo(100);
  });

  it('visibleRect covers every viewport corner (rotated)', () => {
    const cam = new Camera2D({ x: 50, y: 60, zoom: 0.5, rotation: 1.1 }).setViewport(400, 300);
    const r = cam.visibleRect();
    for (const [sx, sy] of [
      [0, 0],
      [400, 0],
      [400, 300],
      [0, 300],
    ] as const) {
      const p = cam.screenToWorld(sx, sy);
      expect(p.x).toBeGreaterThanOrEqual(r.x - 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(r.y - 1e-6);
      expect(p.x).toBeLessThanOrEqual(r.x + r.w + 1e-6);
      expect(p.y).toBeLessThanOrEqual(r.y + r.h + 1e-6);
    }
  });

  it('clamps to bounds and centers when the bounds are smaller than the view', () => {
    const cam = new Camera2D({ bounds: { x: 0, y: 0, w: 2000, h: 1000 } }).setViewport(750, 1334);
    cam.lookAt(0, 0);
    expect(cam.x).toBeCloseTo(375);
    expect(cam.y).toBeCloseTo(500);
    cam.lookAt(5000, 5000);
    expect(cam.x).toBeCloseTo(2000 - 375);
    const v = cam.visibleRect();
    expect(v.x + v.w).toBeCloseTo(2000);
  });

  it('follows with a deadzone and look-ahead', () => {
    const cam = new Camera2D().setViewport(750, 1334);
    const target = { x: 0, y: 0, vx: 0, vy: 0 };
    cam.follow(target, { lerp: 0, deadzoneWidth: 200, deadzoneHeight: 100, snap: true });
    target.x = 80;
    cam.update(1 / 60);
    expect(cam.x).toBe(0);
    target.x = 250;
    cam.update(1 / 60);
    expect(cam.x).toBeCloseTo(150);
    const lead = new Camera2D().setViewport(750, 1334);
    const runner = { x: 0, y: 0, vx: 600, vy: 0 };
    lead.follow(runner, { lerp: 0, lookAhead: 0.25, snap: true });
    for (let i = 0; i < 120; i++) lead.update(1 / 60);
    expect(lead.x).toBeGreaterThan(100);
    expect(lead.x).toBeLessThanOrEqual(150 + 1e-6);
  });

  it('shakes deterministically and settles', () => {
    const a = new Camera2D({ seed: 7 }).setViewport(100, 100);
    const b = new Camera2D({ seed: 7 }).setViewport(100, 100);
    a.shake(0.8);
    b.shake(0.8);
    const trace: number[] = [];
    for (let i = 0; i < 10; i++) {
      a.update(1 / 60);
      b.update(1 / 60);
      expect(a.shakeState).toEqual(b.shakeState);
      trace.push(a.shakeState.x);
    }
    expect(trace.some((v) => Math.abs(v) > 0.5)).toBe(true);
    for (let i = 0; i < 120; i++) a.update(1 / 60);
    expect(a.trauma).toBe(0);
    expect(a.shakeState).toEqual({ x: 0, y: 0, rotation: 0 });
  });
});

describe('World', () => {
  it('culls children outside the view and draws the rest', async () => {
    t = await createTestGame();
    const world = t.game.sceneLayer.add(new World());
    const near = world.add(new Probe({ x: 100, y: 100, width: 50, height: 50 }));
    const far = world.add(new Probe({ x: 5000, y: 5000, width: 50, height: 50 }));
    const container = world.add(new Probe({ x: 9000, y: 9000 }));
    world.camera.lookAt(375, 600);
    await t.step(1);
    expect(world.culledCount).toBe(1);
    expect(near.draws).toBeGreaterThan(0);
    expect(far.draws).toBe(0);
    expect(container.draws).toBeGreaterThan(0);
    world.camera.lookAt(5025, 5025);
    const before = near.draws;
    await t.step(1);
    expect(far.draws).toBe(1);
    expect(near.draws).toBe(before);
    expect(world.describe().camera).toContain('cam 5025,5025');
  });

  it('maps taps through the camera to world children', async () => {
    t = await createTestGame();
    const world = t.game.sceneLayer.add(new World());
    world.camera.lookAt(1000, 1000);
    world.camera.zoom = 2;
    world.camera.rotation = 0.3;
    let taps = 0;
    const box = world.add(new Box(40, 40, { fill: '#f00' }, { x: 1000, y: 1000, anchor: 0.5 }));
    box.onTap(() => taps++);
    await t.step(1);
    const c = box.worldCenter();
    expect(c.x).toBeCloseTo(t.game.view.width / 2, 3);
    expect(c.y).toBeCloseTo(t.game.view.height / 2, 3);
    await t.tap(box);
    expect(taps).toBe(1);
    const w = world.stageToWorld(c.x, c.y);
    expect(w.x).toBeCloseTo(1000, 3);
    expect(w.y).toBeCloseTo(1000, 3);
    const vb = world.worldBounds();
    expect(vb.w).toBeCloseTo(t.game.view.width);
  });

  it('visibleRectIn maps the camera view into a nested node', async () => {
    t = await createTestGame();
    const world = t.game.sceneLayer.add(new World());
    const inner = world.add(new Node({ x: 200, y: 100, scale: 2 }));
    world.camera.lookAt(375, 700);
    await t.step(1);
    const v = world.camera.visibleRect();
    const r = visibleRectIn(inner)!;
    expect(r.x).toBeCloseTo((v.x - 200) / 2);
    expect(r.w).toBeCloseTo(v.w / 2);
  });

  it('parallax layers scroll by their factor', async () => {
    t = await createTestGame();
    const world = t.game.sceneLayer.add(new World());
    const far = world.add(new ParallaxLayer(0.25, 0));
    const pin = far.add(new Node({ x: 0, y: 0 }));
    world.camera.lookAt(1000, 800);
    await t.step(1);
    const m = far.localMatrix();
    expect(m.e).toBeCloseTo(750);
    expect(m.f).toBeCloseTo(800);
    const before = pin.toWorld(0, 0).x;
    world.camera.lookAt(1400, 800);
    const after = pin.toWorld(0, 0).x;
    expect(before - after).toBeCloseTo(400 * 0.25);
  });
});

describe('DepthSortLayer + GroundObject', () => {
  it('sorts children by y, data.depth and zIndex', async () => {
    t = await createTestGame();
    const layer = t.game.sceneLayer.add(new DepthSortLayer());
    const a = layer.add(new Probe({ id: 'a', y: 300 }));
    const b = layer.add(new Probe({ id: 'b', y: 100 }));
    const c = layer.add(new Probe({ id: 'c', y: 200 }));
    await t.step(1);
    expect(layer.children.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    b.y = 400;
    c.data.depth = 1000;
    await t.step(1);
    expect(layer.children.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    a.zIndex = 5;
    await t.step(1);
    expect(layer.children.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('jumps with z-gravity, lifts its visual and lands', async () => {
    t = await createTestGame();
    const hero = t.game.sceneLayer.add(new GroundObject({ x: 100, y: 500, gravity: 2000 }));
    let impact = 0;
    hero.on('land', (v: number) => (impact = v));
    expect(hero.jump(800)).toBe(true);
    expect(hero.jump(800)).toBe(false);
    await t.step(10);
    expect(hero.z).toBeGreaterThan(50);
    expect(hero.toWorld(0, 0).y).toBeCloseTo(500 - hero.z);
    expect(hero.y).toBe(500);
    await t.step(60);
    expect(hero.z).toBe(0);
    expect(hero.grounded).toBe(true);
    expect(impact).toBeGreaterThan(700);
  });
});
