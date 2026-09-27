import { afterEach, describe, expect, it } from 'vitest';
import {
  after,
  Box,
  countTo,
  easings,
  every,
  flash,
  getEase,
  isTweening,
  killTweensOf,
  nextFrame,
  Node,
  parallel,
  punch,
  sequence,
  shake,
  Text,
  tween,
  tweenValue,
  wait,
  waitUntil,
  type EaseName,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const setup = async () => {
  t = await createTestGame();
  const node = t.game.sceneLayer.add(new Node({ id: 'n' }));
  return { t, node };
};

/** Lets microtasks (group starts, promise continuations) run without advancing a frame. */
const tick = () => new Promise<void>((r) => setImmediate(r));

describe('easing', () => {
  it('every named easing starts at 0 and ends at 1', () => {
    for (const [name, f] of Object.entries(easings)) {
      expect(f(0), name).toBe(0);
      expect(f(1), name).toBe(1);
    }
    expect(Object.keys(easings)).toHaveLength(31);
  });

  it('has the expected shapes', () => {
    expect(easings.linear(0.25)).toBe(0.25);
    expect(easings.quadIn(0.5)).toBeCloseTo(0.25);
    expect(easings.quadOut(0.5)).toBeCloseTo(0.75);
    expect(easings.cubicInOut(0.5)).toBeCloseTo(0.5);
    expect(easings.backOut(0.7)).toBeGreaterThan(1);
    expect(easings.backIn(0.2)).toBeLessThan(0);
    expect(easings.bounceOut(0.99)).toBeLessThanOrEqual(1);
    expect(getEase((x) => x * 2)(0.5)).toBe(1);
    expect(() => getEase('nope' as EaseName)).toThrow(/unknown easing/);
  });
});

describe('tween', () => {
  it('interpolates over stepped frames and resolves when awaited', async () => {
    const { t, node } = await setup();
    let resolved = false;
    const tw = tween(node, { x: 100, y: 50 }, 0.5, { ease: 'linear' });
    void tw.then(() => (resolved = true));
    await t.step(15);
    expect(node.x).toBeCloseTo(50);
    expect(node.y).toBeCloseTo(25);
    expect(resolved).toBe(false);
    await t.step(15);
    expect(node.x).toBe(100);
    expect(resolved).toBe(true);
    expect(tw.finished).toBe(true);
    await tw;
  });

  it('supports relative values, color strings, nested props and the scale shorthand', async () => {
    const { t, node } = await setup();
    node.x = 10;
    node.y = 100;
    node.rotation = 2;
    const box = t.game.sceneLayer.add(new Box(10, 10, { fill: '#000000', stroke: null }));
    const obj = { pos: { x: 0, y: 0 } };
    tween(node, { x: '+=50', y: '-=40', rotation: '*=2', scale: 3 }, 0.5, { ease: 'linear' });
    tween(box, { fill: '#ffffff', stroke: '#ff0000' }, 0.5, { ease: 'linear' });
    tween(obj, { pos: { x: 10, y: 20 } }, 0.5, { ease: 'linear' });
    await t.step(15);
    expect(box.fill).toMatch(/^#(7f7f7f|808080)$/);
    expect(box.stroke).toMatch(/^rgba\(255,0,0,0\.5\)$/);
    expect(obj.pos.x).toBeCloseTo(5);
    await t.step(15);
    expect(node.x).toBe(60);
    expect(node.y).toBe(60);
    expect(node.rotation).toBe(4);
    expect([node.scaleX, node.scaleY]).toEqual([3, 3]);
    expect(box.fill).toBe('#ffffff');
    expect(box.stroke).toBe('#ff0000');
    expect(obj.pos).toEqual({ x: 10, y: 20 });
  });

  it('chains to/wait/call and continues from the previous end value', async () => {
    const { t, node } = await setup();
    const calls: number[] = [];
    const tw = tween(node, { x: 100 }, 0.5, { ease: 'linear' })
      .wait(0.5)
      .call(() => calls.push(node.x))
      .to({ x: '-=100' }, 0.5);
    expect(tw.duration).toBeCloseTo(1.5);
    await t.step(30);
    expect(node.x).toBe(100);
    await t.step(29);
    expect(calls).toEqual([]);
    await t.step(1);
    expect(calls).toEqual([100]);
    await t.step(15);
    expect(node.x).toBeCloseTo(50);
    await t.step(15);
    expect(node.x).toBe(0);
    expect(tw.finished).toBe(true);
  });

  it('repeats and yoyos', async () => {
    const { t, node } = await setup();
    const yo = tween(node, { x: 100 }, 0.5, { ease: 'linear' }).yoyo();
    await t.step(30);
    expect(node.x).toBe(100);
    await t.step(15);
    expect(node.x).toBeCloseTo(50);
    await t.step(15);
    expect(node.x).toBe(0);
    expect(yo.finished).toBe(true);

    const other = t.game.sceneLayer.add(new Node());
    const rep = tween(other, { y: 100 }, 0.5, { ease: 'linear', repeat: 2 });
    await t.step(45);
    expect(other.y).toBeCloseTo(50);
    await t.step(45);
    expect(other.y).toBe(100);
    expect(rep.finished).toBe(true);

    const forever = tween(other, { alpha: 0 }, 0.1).repeat(Infinity).yoyo();
    await t.advance(3);
    expect(forever.active).toBe(true);
    forever.kill(true);
    expect(forever.finished).toBe(true);
  });

  it('dies when its node is destroyed and never resolves', async () => {
    const { t, node } = await setup();
    let resolved = false;
    const tw = tween(node, { x: 100 }, 1, { ease: 'linear' });
    void tw.then(() => (resolved = true));
    await t.step(10);
    node.destroy();
    await t.step(1);
    expect(tw.killed).toBe(true);
    const x = node.x;
    await t.step(60);
    expect(node.x).toBe(x);
    expect(resolved).toBe(false);
  });

  it('skips while the node subtree or the game is paused; realtime tweens keep running', async () => {
    const { t, node } = await setup();
    const parent = t.game.sceneLayer.add(new Node());
    const child = parent.add(new Node());
    tween(child, { x: 100 }, 1, { ease: 'linear' });
    tween(node, { x: 100 }, 1, { ease: 'linear' });
    const ui = { v: 0 };
    tween(ui, { v: 100 }, 2, { ease: 'linear', realtime: true });
    await t.step(30);
    parent.paused = true;
    await t.step(30);
    expect(child.x).toBeCloseTo(50);
    expect(node.x).toBe(100);
    expect(ui.v).toBeCloseTo(50);
    parent.paused = false;
    t.game.paused = true;
    await t.step(15);
    expect(child.x).toBeCloseTo(50);
    expect(ui.v).toBeCloseTo(62.5);
    t.game.paused = false;
    await t.step(30);
    expect(child.x).toBe(100);
  });

  it('follows game timeScale', async () => {
    const { t, node } = await setup();
    t.game.time.timeScale = 0.5;
    tween(node, { x: 100 }, 1, { ease: 'linear' });
    await t.step(60);
    expect(node.x).toBeCloseTo(50);
  });

  it('killTweensOf stops everything on a target, optionally completing', async () => {
    const { t, node } = await setup();
    tween(node, { x: 100 }, 1);
    tween(node, { y: 100 }, 1);
    expect(isTweening(node)).toBe(true);
    await t.step(5);
    expect(killTweensOf(node)).toBe(2);
    expect(isTweening(node)).toBe(false);
    tween(node, { alpha: 0 }, 1);
    killTweensOf(node, true);
    expect(node.alpha).toBe(0);
  });

  it('runs sequence and parallel groups', async () => {
    const { t } = await setup();
    const a = t.game.sceneLayer.add(new Node());
    const b = t.game.sceneLayer.add(new Node());
    const c = t.game.sceneLayer.add(new Node());
    let done = false;
    const seq = sequence([
      tween(a, { x: 100 }, 0.5, { ease: 'linear' }),
      0.25,
      () => parallel([tween(b, { x: 100 }, 0.5, { ease: 'linear' }), tween(c, { x: 100 }, 0.25, { ease: 'linear' })]),
    ]);
    void seq.then(() => (done = true));
    await tick();
    await t.step(15);
    expect(a.x).toBeCloseTo(50);
    expect(b.x).toBe(0);
    await t.step(15);
    expect(a.x).toBe(100);
    await t.step(15);
    expect(b.x).toBe(0);
    await t.step(20);
    expect(b.x).toBeGreaterThan(0);
    expect(c.x).toBeGreaterThan(b.x);
    await t.advance(1);
    expect(b.x).toBe(100);
    expect(c.x).toBe(100);
    expect(done).toBe(true);

    const d = t.game.sceneLayer.add(new Node());
    const s2 = sequence([tween(d, { x: 100 }, 1), tween(d, { y: 100 }, 1)]);
    await tick();
    await t.step(10);
    s2.kill();
    await t.advance(3);
    expect(d.x).toBeLessThan(100);
    expect(d.y).toBe(0);
  });

  it('tweenValue reports numbers and colors', async () => {
    const { t } = await setup();
    const seen: number[] = [];
    let color = '';
    tweenValue(0, 10, 0.1, (v) => seen.push(v), { ease: 'linear' });
    tweenValue('#000000', '#ffffff', 0.1, (c) => (color = c));
    await t.advance(0.2);
    expect(seen[seen.length - 1]).toBe(10);
    expect(color).toBe('#ffffff');
  });
});

describe('juice', () => {
  it('shake returns to the rest position, punch restores scale, flash cleans up', async () => {
    const { t, node } = await setup();
    node.setPosition(100, 200);
    shake(node, 20, 0.3);
    await t.step(5);
    expect(node.x !== 100 || node.y !== 200).toBe(true);
    await t.advance(0.4);
    expect(node.x).toBeCloseTo(100, 6);
    expect(node.y).toBeCloseTo(200, 6);

    node.setScale(2);
    punch(node, 1.5, 0.3);
    await t.step(6);
    expect(node.scaleX).toBeGreaterThan(2);
    punch(node, 1.5, 0.3);
    await t.advance(0.5);
    expect(node.scaleX).toBeCloseTo(2);

    flash(t.game, '#ff0000', 0.2);
    expect(t.game.overlay.find('#flash')).not.toBeNull();
    await t.advance(0.3);
    expect(t.game.overlay.find('#flash')).toBeNull();

    const label = t.game.sceneLayer.add(new Text('0'));
    countTo(label, 250, 0.5);
    await t.advance(0.6);
    expect(label.text).toBe('250');
  });
});

describe('timers', () => {
  it('after/every run in game time and follow timeScale', async () => {
    const { t } = await setup();
    t.game.time.timeScale = 2;
    let fired = 0;
    const ticks: number[] = [];
    after(1, () => fired++);
    every(0.25, (n) => void ticks.push(n), { count: 3 });
    await t.step(29);
    expect(fired).toBe(0);
    await t.step(1);
    expect(fired).toBe(1);
    expect(ticks).toEqual([1, 2, 3]);
    await t.advance(1);
    expect(ticks).toEqual([1, 2, 3]);
  });

  it('pause, cancel, owner destroy and return false', async () => {
    const { t, node } = await setup();
    let a = 0;
    let b = 0;
    let c = 0;
    const timer = every(0.1, () => void a++);
    after(0.1, () => b++, { owner: node });
    every(0.1, (n) => {
      c = n;
      return n < 2;
    });
    t.game.paused = true;
    await t.advance(0.5);
    expect(a).toBe(0);
    t.game.paused = false;
    node.destroy();
    await t.advance(0.5);
    expect(a).toBe(5);
    expect(b).toBe(0);
    expect(c).toBe(2);
    timer.cancel();
    await t.advance(0.5);
    expect(a).toBe(5);
    expect(timer.active).toBe(false);
  });

  it('wait, waitUntil and nextFrame resolve on frames', async () => {
    const { t } = await setup();
    const log: string[] = [];
    void wait(0.5).then(() => log.push('wait'));
    let flag = false;
    void waitUntil(() => flag).then(() => log.push('until'));
    let dt = 0;
    void nextFrame().then((d) => (dt = d));
    await t.step(1);
    expect(dt).toBeCloseTo(1 / 60);
    await t.step(29);
    expect(log).toEqual(['wait']);
    flag = true;
    await t.step(1);
    expect(log).toEqual(['wait', 'until']);
  });
});
