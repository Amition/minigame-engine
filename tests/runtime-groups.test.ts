import { afterEach, describe, expect, it } from 'vitest';
import { Node, parallel, popOut, Scene, sequence, tween, type SceneFactory } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const scenes: Record<string, SceneFactory> = { a: () => new Scene(), b: () => new Scene(), dialog: () => new Scene() };

const boot = async () => {
  t = await createTestGame({ app: { design: { width: 750, height: 1334 }, scenes, start: '' }, render: 'none' });
  return t;
};

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('sequence / parallel ownership', () => {
  it('a sequence animating a scene node stops when the scene is left', async () => {
    const t = await boot();
    const a = await t.go('a');
    const box = a.add(new Node());
    let fired = false;
    const seq = sequence([tween(box, { x: 100 }, 0.2), 1, () => (fired = true)]);
    expect(seq.owner).toBe(a);
    await tick();
    await t.advance(0.4);
    expect(box.x).toBe(100);
    await t.go('b');
    await t.advance(2);
    expect(fired).toBe(false);
    expect(seq.killed).toBe(true);
  });

  it('a sequence of only waits and callbacks belongs to the top scene', async () => {
    const t = await boot();
    const a = await t.go('a');
    let fired = false;
    let settled = false;
    const seq = sequence([1, () => (fired = true)]);
    void seq.then(() => (settled = true));
    expect(seq.owner).toBe(a);
    await tick();
    await t.advance(0.5);
    await t.go('b');
    await t.advance(2);
    expect(fired).toBe(false);
    expect(settled).toBe(false);
  });

  it('owner: null keeps a group running across scene changes', async () => {
    const t = await boot();
    await t.go('a');
    let fired = false;
    const seq = sequence([1, () => (fired = true)], { owner: null });
    const par = parallel([0.5, 0.8], { owner: null });
    const scoped = parallel([0.5, 0.8]);
    expect(seq.owner).toBe(null);
    await tick();
    await t.go('b');
    await t.advance(1.2);
    expect(fired).toBe(true);
    expect(seq.finished).toBe(true);
    expect(par.finished).toBe(true);
    expect(scoped.killed).toBe(true);
  });

  it('a group owned by a node stops, with its tweens, when the node is destroyed', async () => {
    const t = await boot();
    const a = await t.go('a');
    const holder = a.add(new Node());
    const mover = a.add(new Node());
    let fired = false;
    let settled = false;
    const seq = sequence([0.5, () => (fired = true)], { owner: holder });
    const par = parallel([tween(mover, { x: 100 }, 1, { ease: 'linear' }), 2], { owner: holder });
    void seq.then(() => (settled = true));
    await tick();
    await t.advance(0.25);
    holder.destroy();
    const x = mover.x;
    await t.advance(1);
    expect(fired).toBe(false);
    expect(settled).toBe(false);
    expect(seq.killed).toBe(true);
    expect(par.killed).toBe(true);
    expect(mover.x).toBe(x);
    expect(sequence([() => (fired = true)], { owner: holder }).killed).toBe(true);
    await tick();
    expect(fired).toBe(false);
  });

  it('keeps running when the animated node destroys itself, and uses the node when it is in no scene', async () => {
    const t = await boot();
    const a = await t.go('a');
    const n = a.add(new Node());
    let fired = false;
    sequence([popOut(n, 0.2, { destroy: true }), () => (fired = true)]);
    await tick();
    await t.advance(0.4);
    expect(n.destroyed).toBe(true);
    expect(fired).toBe(true);

    const hud = t.game.sceneLayer.add(new Node());
    const loose = sequence([tween(hud, { x: 10 }, 0.1), 0.2]);
    expect(loose.owner).toBe(hud);
  });

  it('waits freeze while the owning scene is covered by a pushed scene', async () => {
    const t = await boot();
    await t.go('a');
    let fired = false;
    sequence([1, () => (fired = true)]);
    await tick();
    await t.advance(0.25);
    void t.game.scenes.push('dialog');
    await t.advance(2);
    expect(fired).toBe(false);
    await t.game.scenes.pop();
    await t.advance(0.5);
    expect(fired).toBe(false);
    await t.advance(0.4);
    expect(fired).toBe(true);
  });
});
