import { afterEach, describe, expect, it } from 'vitest';
import { fixedUpdate, Node, Scene, type SceneFactory } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const systemCount = (tg: TestGame) => (tg.game as unknown as { systems: unknown[] }).systems.length;

describe('fixedUpdate (game)', () => {
  it('calls fixed steps with alpha, caps the catch-up and stops when removed', async () => {
    t = await createTestGame();
    const steps: number[] = [];
    const alphas: number[] = [];
    const stop = fixedUpdate(t.game, 120, (s, a) => {
      steps.push(s);
      alphas.push(a);
    });
    await t.step(3);
    expect(steps.length).toBe(6);
    expect(steps[0]).toBeCloseTo(1 / 120);
    expect(alphas.every((a) => a >= 0 && a <= 1)).toBe(true);
    expect(alphas[alphas.length - 1]).toBeLessThan(0.01);
    stop();
    await t.step(3);
    expect(steps.length).toBe(6);

    let n = 0;
    fixedUpdate(t.game, 240, () => n++, { maxSteps: 5 });
    await t.step(1, 1 / 15);
    expect(n).toBe(5);
    await t.step(1, 1 / 60);
    expect(n).toBe(9);
  });

  it('follows game.paused and timeScale', async () => {
    t = await createTestGame();
    let n = 0;
    fixedUpdate(t.game, 60, () => n++);
    t.game.paused = true;
    await t.step(4);
    expect(n).toBe(0);
    t.game.paused = false;
    t.game.time.timeScale = 0.5;
    await t.step(4);
    expect(n).toBe(2);
  });
});

describe('fixedUpdate (node)', () => {
  it('runs while on the stage, skips while an ancestor is paused (no backlog) and stops on destroy', async () => {
    t = await createTestGame();
    const before = systemCount(t);
    const parent = t.game.sceneLayer.add(new Node({ id: 'parent' }));
    const child = parent.add(new Node({ id: 'child' }));
    let n = 0;
    fixedUpdate(child, 60, () => n++);
    await t.step(5);
    expect(n).toBe(5);
    parent.paused = true;
    await t.step(5);
    expect(n).toBe(5);
    parent.paused = false;
    await t.step(2);
    expect(n).toBe(7);
    child.removeFromParent();
    await t.step(2);
    expect(n).toBe(7);
    parent.add(child);
    await t.step(1);
    expect(n).toBe(8);
    child.destroy();
    expect(systemCount(t)).toBe(before);
    await t.step(2);
    expect(n).toBe(8);
  });

  it('steps before the stage updates, so update() sees this frame of simulation', async () => {
    t = await createTestGame();
    class Sim extends Node {
      steps = 0;
      readonly seen: number[] = [];
      override update(): void {
        this.seen.push(this.steps);
      }
    }
    const sim = t.game.sceneLayer.add(new Sim());
    fixedUpdate(sim, 60, () => sim.steps++);
    await t.step(3);
    expect(sim.seen).toEqual([1, 2, 3]);
  });

  it('stops mid catch-up when the callback pauses or destroys the node, and the remover works', async () => {
    t = await createTestGame();
    const a = t.game.sceneLayer.add(new Node());
    let na = 0;
    fixedUpdate(a, 240, () => {
      na++;
      if (na === 2) a.paused = true;
    });
    await t.step(1);
    expect(na).toBe(2);
    const b = t.game.sceneLayer.add(new Node());
    let nb = 0;
    fixedUpdate(b, 240, () => {
      nb++;
      b.destroy();
    });
    await t.step(1);
    expect(nb).toBe(1);
    const c = t.game.sceneLayer.add(new Node());
    let nc = 0;
    const stop = fixedUpdate(c, 60, () => nc++);
    await t.step(1);
    stop();
    stop();
    await t.step(2);
    expect(nc).toBe(1);
  });

  it('pauses a scene simulation while a scene is pushed above it and ends with the scene', async () => {
    let steps = 0;
    class Level extends Scene {
      override onEnter(): void {
        fixedUpdate(this, 60, () => steps++);
      }
    }
    const scenes: Record<string, SceneFactory> = { level: () => new Level(), dialog: () => new Scene(), menu: () => new Scene() };
    t = await createTestGame({ app: { design: { width: 750, height: 1334 }, scenes, start: 'level' } });
    const s0 = steps;
    expect(s0).toBeGreaterThan(0);
    void t.game.scenes.push('dialog');
    await t.step(5);
    const s1 = steps;
    expect(s1 - s0).toBeLessThanOrEqual(1);
    await t.game.scenes.pop();
    await t.step(3);
    expect(steps - s1).toBe(3);
    await t.go('menu');
    const s2 = steps;
    await t.step(3);
    expect(steps).toBe(s2);
  });
});
