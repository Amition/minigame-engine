import { afterEach, describe, expect, it } from 'vitest';
import {
  Box,
  draggable,
  onDoubleTap,
  onLongPress,
  onSwipe,
  pinch,
  VirtualJoystick,
  type DragInfo,
  type PinchEvent,
  type SwipeDir,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

/** Raw multi-touch helper in stage coordinates. */
const touch = (tg: TestGame, phase: 'start' | 'move' | 'end', pts: [number, number, number][]) =>
  tg.platform.touch(
    phase,
    pts.map(([id, x, y]) => ({ id, ...tg.game.stageToScreen(x, y) })),
  );

describe('draggable', () => {
  it('moves a node with t.drag and reports start/move/end', async () => {
    t = await createTestGame();
    const box = t.game.sceneLayer.add(new Box(100, 100, {}, { x: 100, y: 100 }));
    const log: string[] = [];
    let end: DragInfo | null = null;
    let taps = 0;
    box.onTap(() => taps++);
    draggable(box, {
      onStart: () => log.push('start'),
      onMove: () => log.push('move'),
      onEnd: (e) => {
        log.push('end');
        end = e;
      },
    });
    await t.drag({ x: 150, y: 150 }, { x: 350, y: 250 });
    expect(box.x).toBeCloseTo(300);
    expect(box.y).toBeCloseTo(200);
    expect(log[0]).toBe('start');
    expect(log[log.length - 1]).toBe('end');
    expect(log.filter((s) => s === 'move').length).toBe(12);
    expect(end!.dx).toBeCloseTo(200);
    expect(end!.dy).toBeCloseTo(100);
    expect(taps).toBe(0);
  });

  it('respects bounds, axis and enabled', async () => {
    t = await createTestGame();
    const box = t.game.sceneLayer.add(new Box(100, 100, {}, { x: 100, y: 100 }));
    const d = draggable(box, { bounds: { x: 0, y: 0, w: 400, h: 400 } });
    await t.drag({ x: 150, y: 150 }, { x: 700, y: 900 });
    expect([box.x, box.y]).toEqual([300, 300]);

    const centered = t.game.sceneLayer.add(new Box(100, 100, {}, { x: 500, y: 600, anchor: 0.5 }));
    draggable(centered, { axis: 'x' });
    await t.drag({ x: 500, y: 600 }, { x: 600, y: 900 });
    expect(centered.x).toBeCloseTo(600);
    expect(centered.y).toBe(600);

    d.enabled = false;
    await t.drag({ x: 350, y: 350 }, { x: 150, y: 150 });
    expect([box.x, box.y]).toEqual([300, 300]);
  });
});

describe('gestures', () => {
  it('detects swipes on the stage with direction and speed', async () => {
    t = await createTestGame();
    const got: [SwipeDir, number][] = [];
    onSwipe(t.game, (dir, v) => got.push([dir, v]));
    await t.drag({ x: 600, y: 500 }, { x: 200, y: 500 });
    await t.drag({ x: 300, y: 800 }, { x: 320, y: 400 });
    expect(got.map((g) => g[0])).toEqual(['left', 'up']);
    expect(got[0]![1]).toBeCloseTo(400 / (13 / 60), 0);
    await t.drag({ x: 300, y: 800 }, { x: 330, y: 800 });
    await t.drag({ x: 100, y: 800 }, { x: 600, y: 800 }, 60);
    expect(got.length).toBe(2);
  });

  it('detects swipes on a node only, ignoring them while its owner is paused', async () => {
    t = await createTestGame();
    const area = t.game.sceneLayer.add(new Box(400, 400, {}, { x: 0, y: 0 }));
    const got: SwipeDir[] = [];
    onSwipe(area, (dir) => got.push(dir));
    await t.drag({ x: 100, y: 100 }, { x: 100, y: 350 });
    await t.drag({ x: 500, y: 700 }, { x: 500, y: 300 });
    expect(got).toEqual(['down']);
    const stageSwipes: SwipeDir[] = [];
    onSwipe(t.game, (dir) => stageSwipes.push(dir), { owner: area });
    area.paused = true;
    await t.drag({ x: 500, y: 700 }, { x: 100, y: 700 });
    area.paused = false;
    await t.drag({ x: 100, y: 700 }, { x: 500, y: 700 });
    expect(stageSwipes).toEqual(['right']);
  });

  it('long press fires after the hold time and cancels the tap', async () => {
    t = await createTestGame();
    const box = t.game.sceneLayer.add(new Box(200, 200, {}, { x: 100, y: 100 }));
    let long = 0;
    let taps = 0;
    box.onTap(() => taps++);
    onLongPress(box, () => long++, 0.5);
    await t.press(box, 0.6);
    expect(long).toBe(1);
    expect(taps).toBe(0);
    await t.press(box, 0.2);
    expect(long).toBe(1);
    expect(taps).toBe(1);
  });

  it('double tap needs two quick taps', async () => {
    t = await createTestGame();
    const box = t.game.sceneLayer.add(new Box(200, 200, {}, { x: 100, y: 100 }));
    let dbl = 0;
    onDoubleTap(box, () => dbl++);
    await t.tap(box);
    expect(dbl).toBe(0);
    await t.tap(box);
    expect(dbl).toBe(1);
    await t.tap(box);
    await t.advance(0.5);
    await t.tap(box);
    expect(dbl).toBe(1);
  });

  it('pinch reports scale, center and rotation from two pointers', async () => {
    t = await createTestGame();
    const evs: PinchEvent[] = [];
    pinch(t.game, (e) => evs.push(e));
    touch(t, 'start', [[1, 300, 500]]);
    touch(t, 'start', [[2, 400, 500]]);
    touch(t, 'move', [[2, 500, 500]]);
    touch(t, 'move', [[1, 300, 300]]);
    touch(t, 'end', [[1, 300, 300], [2, 500, 500]]);
    await t.step(1);
    expect(evs.map((e) => e.phase)).toEqual(['start', 'move', 'move', 'end']);
    expect(evs[1]!.scale).toBeCloseTo(2);
    expect(evs[1]!.center.x).toBeCloseTo(400);
    expect(evs[2]!.rotation).toBeCloseTo(Math.PI / 4);
  });
});

describe('VirtualJoystick', () => {
  it('fixed stick reports a normalized vector and magnitude, and resets on release', async () => {
    t = await createTestGame();
    const stick = t.game.sceneLayer.add(new VirtualJoystick({ mode: 'fixed', radius: 100, x: 100, y: 100 }));
    const changes: number[] = [];
    stick.onChange = (s) => changes.push(s.magnitude);
    touch(t, 'start', [[1, 200, 200]]);
    expect(stick.active).toBe(true);
    expect(stick.magnitude).toBe(0);
    touch(t, 'move', [[1, 400, 200]]);
    expect(stick.value.x).toBeCloseTo(1);
    expect(stick.value.y).toBeCloseTo(0);
    expect(stick.dir4).toBe('right');
    touch(t, 'move', [[1, 200, 250]]);
    expect(stick.direction.y).toBeCloseTo(1);
    expect(stick.magnitude).toBeCloseTo((0.5 - 0.12) / 0.88);
    expect(stick.dir4).toBe('down');
    touch(t, 'end', [[1, 200, 250]]);
    expect(stick.active).toBe(false);
    expect(stick.value).toEqual({ x: 0, y: 0 });
    expect(changes.length).toBe(4);
    expect(t.dump()).toContain('VirtualJoystick');
  });

  it('floating stick centers where the zone is touched', async () => {
    t = await createTestGame();
    const stick = t.game.sceneLayer.add(new VirtualJoystick({ width: 400, height: 400, radius: 80 }));
    touch(t, 'start', [[3, 300, 300]]);
    touch(t, 'move', [[3, 300, 220]]);
    expect(stick.dir4).toBe('up');
    expect(stick.magnitude).toBeCloseTo(1);
    expect(stick.angle).toBeCloseTo(-Math.PI / 2);
    touch(t, 'end', [[3, 300, 220]]);
    expect(stick.magnitude).toBe(0);
  });
});
