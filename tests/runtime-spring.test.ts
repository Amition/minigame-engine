import { afterEach, describe, expect, it } from 'vitest';
import { Box, createSpring, Node, popIn, punch, springProp, squashBaseScale, squashSpring, Spring, wobble } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const run = (s: Spring, seconds: number, dt = 1 / 60) => {
  const out: number[] = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) out.push(s.step(dt));
  return out;
};

describe('Spring', () => {
  it('settles exactly on the target; low damping overshoots, critical damping does not', () => {
    const bouncy = createSpring({ frequency: 2, dampingRatio: 0.2, value: 0, target: 100 });
    const vals = run(bouncy, 5);
    expect(Math.max(...vals)).toBeGreaterThan(140);
    expect(bouncy.value).toBe(100);
    expect(bouncy.velocity).toBe(0);
    expect(bouncy.atRest).toBe(true);

    const critical = createSpring({ frequency: 2, dampingRatio: 1, value: 0, target: 100 });
    const cv = run(critical, 5);
    expect(Math.max(...cv)).toBeLessThanOrEqual(100);
    expect(critical.value).toBe(100);
  });

  it('converts between stiffness/damping and frequency/dampingRatio', () => {
    const s = new Spring({ frequency: 3, dampingRatio: 0.4, mass: 2 });
    expect(s.frequency).toBeCloseTo(3);
    expect(s.dampingRatio).toBeCloseTo(0.4);
    expect(s.stiffness).toBeCloseTo(2 * (2 * Math.PI * 3) ** 2);
    const d = new Spring({ stiffness: 100, dampingRatio: 1 });
    expect(d.damping).toBeCloseTo(20);
    const plain = new Spring();
    expect([plain.stiffness, plain.damping, plain.mass, plain.value, plain.target]).toEqual([180, 12, 1, 0, 0]);
  });

  it('is frame-rate independent enough and deterministic', () => {
    const a = createSpring({ frequency: 2, dampingRatio: 0.3, value: 0, target: 1 });
    const b = createSpring({ frequency: 2, dampingRatio: 0.3, value: 0, target: 1 });
    run(a, 0.5, 1 / 60);
    run(b, 0.5, 1 / 120);
    expect(a.value).toBeCloseTo(b.value, 2);
    const c = createSpring({ frequency: 2, dampingRatio: 0.3, value: 0, target: 1 });
    run(c, 0.5, 1 / 60);
    expect(c.value).toBe(a.value);
  });

  it('kick adds velocity, snap teleports, stiff springs stay stable', () => {
    const s = createSpring({ frequency: 4, dampingRatio: 0.3 });
    expect(s.step(1 / 60)).toBe(0);
    s.kick(10);
    expect(s.atRest).toBe(false);
    s.step(1 / 60);
    expect(s.value).toBeGreaterThan(0);
    s.snap(5);
    expect([s.value, s.target, s.velocity, s.atRest]).toEqual([5, 5, 0, true]);
    const stiff = createSpring({ stiffness: 1e6, damping: 50, value: 0, target: 1 });
    run(stiff, 1);
    expect(Number.isFinite(stiff.value)).toBe(true);
    expect(stiff.value).toBe(1);
  });
});

describe('springProp', () => {
  it('drives a node property toward its target, freezes while paused and stops with the node', async () => {
    t = await createTestGame();
    const dot = t.game.sceneLayer.add(new Node({ x: 100 }));
    const fx = springProp(dot, 'x', { frequency: 3, dampingRatio: 0.5 });
    expect(fx.value).toBe(100);
    fx.target = 300;
    await t.step(6);
    expect(dot.x).toBeGreaterThan(100);
    expect(dot.x).toBeLessThan(300);
    dot.paused = true;
    const x = dot.x;
    await t.step(5);
    expect(dot.x).toBe(x);
    dot.paused = false;
    await t.advance(3);
    expect(dot.x).toBe(300);
    dot.destroy();
    await t.step(1);
    expect(fx.active).toBe(false);
  });

  it('works on plain objects with an explicit owner, and stop() leaves the value', async () => {
    t = await createTestGame();
    const owner = t.game.sceneLayer.add(new Node());
    const obj = { zoom: 1 };
    const fx = springProp(obj, 'zoom', { owner, frequency: 2, dampingRatio: 1, target: 2 });
    await t.step(10);
    const z = obj.zoom;
    expect(z).toBeGreaterThan(1);
    fx.stop();
    await t.step(5);
    expect(obj.zoom).toBe(z);
    expect(() => springProp({ label: 'x' } as Record<string, unknown>, 'label')).toThrow(/not a number/);
  });
});

describe('squashSpring', () => {
  it('squashes volume-preserving, peaks near 19% for strength 1 and restores the base scale exactly', async () => {
    t = await createTestGame();
    const n = t.game.sceneLayer.add(new Box(100, 100, {}, { anchor: 0.5, scaleX: 1.5, scaleY: 0.8 }));
    const fx = squashSpring(n, 1);
    let peak = 0;
    let stretched = false;
    for (let i = 0; i < 12; i++) {
      await t.step(1);
      expect(n.scaleX * n.scaleY).toBeCloseTo(1.5 * 0.8, 10);
      peak = Math.max(peak, n.scaleX / 1.5 - 1);
      if (n.scaleY > 0.8) stretched = true;
    }
    expect(peak).toBeGreaterThan(0.15);
    expect(peak).toBeLessThan(0.23);
    expect(stretched).toBe(true);
    await t.advance(1.5);
    expect(fx.active).toBe(false);
    expect([n.scaleX, n.scaleY]).toEqual([1.5, 0.8]);
  });

  it('adds up repeated kicks on one effect, capped at max; axis x and negative strength', async () => {
    t = await createTestGame();
    const one = t.game.sceneLayer.add(new Node({ anchor: 0.5 }));
    const many = t.game.sceneLayer.add(new Node({ anchor: 0.5 }));
    const fx1 = squashSpring(one, 1);
    const fxs = [squashSpring(many, 1), squashSpring(many, 1), squashSpring(many, 1), squashSpring(many, 1)];
    expect(new Set(fxs).size).toBe(1);
    expect(fx1).not.toBe(fxs[0]);
    let p1 = 0;
    let pm = 0;
    for (let i = 0; i < 10; i++) {
      await t.step(1);
      p1 = Math.max(p1, one.scaleX - 1);
      pm = Math.max(pm, many.scaleX - 1);
    }
    expect(pm).toBeGreaterThan(p1);
    expect(pm).toBeLessThanOrEqual(0.35 + 1e-9);

    const tall = t.game.sceneLayer.add(new Node({ anchor: 0.5 }));
    squashSpring(tall, 1, { axis: 'x', max: 0.1 });
    const stretch = t.game.sceneLayer.add(new Node({ anchor: 0.5 }));
    squashSpring(stretch, -1);
    await t.step(3);
    expect(tall.scaleX).toBeLessThan(1);
    expect(tall.scaleY).toBeCloseTo(1.1);
    expect(stretch.scaleY).toBeGreaterThan(1);
    expect(stretch.scaleX).toBeLessThan(1);
  });

  it('stop() restores at once, destroy ends it, paused subtrees freeze it', async () => {
    t = await createTestGame();
    const n = t.game.sceneLayer.add(new Node({ anchor: 0.5 }));
    const fx = squashSpring(n, 1);
    await t.step(3);
    expect(n.scaleX).not.toBe(1);
    fx.stop();
    expect([n.scaleX, n.scaleY, fx.active]).toEqual([1, 1, false]);

    const parent = t.game.sceneLayer.add(new Node());
    const child = parent.add(new Node({ anchor: 0.5 }));
    squashSpring(child, 1);
    await t.step(2);
    parent.paused = true;
    const sx = child.scaleX;
    await t.step(5);
    expect(child.scaleX).toBe(sx);
    parent.paused = false;
    const gone = squashSpring(child, 1);
    child.destroy();
    await t.step(2);
    expect(gone.active).toBe(false);
  });

  it('composes with popIn and punch and leaves their rest scale intact', async () => {
    t = await createTestGame();
    const n = t.game.sceneLayer.add(new Node({ anchor: 0.5, scale: 2 }));
    popIn(n, 0.3);
    squashSpring(n, 1);
    await t.step(5);
    expect(n.scaleX).toBeGreaterThan(0);
    await t.advance(1.5);
    expect([n.scaleX, n.scaleY]).toEqual([2, 2]);

    squashSpring(n, 1);
    await t.step(4);
    expect(squashBaseScale(n)).toEqual({ x: 2, y: 2 });
    punch(n, 1.3, 0.3);
    await t.step(3);
    expect(n.scaleX).not.toBe(n.scaleY);
    await t.advance(1.5);
    expect([n.scaleX, n.scaleY]).toEqual([2, 2]);
    expect(squashBaseScale(n)).toEqual({ x: 2, y: 2 });
  });
});

describe('wobble', () => {
  it('swings the rotation around its base and restores it exactly; kicks add up', async () => {
    t = await createTestGame();
    const n = t.game.sceneLayer.add(new Node({ anchor: 0.5, rotation: 0.5 }));
    const fx = wobble(n, 1);
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = 0; i < 30; i++) {
      await t.step(1);
      hi = Math.max(hi, n.rotation - 0.5);
      lo = Math.min(lo, n.rotation - 0.5);
    }
    expect(hi).toBeGreaterThan(0.15);
    expect(hi).toBeLessThan(0.3);
    expect(lo).toBeLessThan(0);
    await t.advance(3);
    expect(fx.active).toBe(false);
    expect(n.rotation).toBe(0.5);
    const again = wobble(n, -1, { max: 0.1 });
    expect(wobble(n, -1)).toBe(again);
    await t.step(4);
    expect(n.rotation).toBeCloseTo(0.4);
  });
});
