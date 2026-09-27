import { afterEach, describe, expect, it } from 'vitest';
import { Box, Node, onAim, type AimInfo } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

/** Raw touch in stage coordinates. */
const touch = (tg: TestGame, phase: 'start' | 'move' | 'end' | 'cancel', id: number, x: number, y: number) =>
  tg.platform.touch(phase, [{ id, ...tg.game.stageToScreen(x, y) }]);

const recorder = () => {
  const log: [string, AimInfo][] = [];
  const handlers = {
    start: (a: AimInfo) => void log.push(['start', a]),
    move: (a: AimInfo) => void log.push(['move', a]),
    release: (a: AimInfo) => void log.push(['release', a]),
    cancel: (a: AimInfo) => void log.push(['cancel', a]),
  };
  return { log, handlers, kinds: () => log.map((l) => l[0]), last: () => log[log.length - 1]![1] };
};

describe('onAim', () => {
  it('reports start, moves and a release with drag vector, angle and duration (zone space)', async () => {
    t = await createTestGame();
    const zone = t.game.sceneLayer.add(new Box(600, 600, {}, { x: 100, y: 200 }));
    const r = recorder();
    onAim(zone, r.handlers);
    await t.drag({ x: 300, y: 400 }, { x: 400, y: 500 }, 6);
    expect(r.kinds()).toEqual(['start', 'move', 'move', 'move', 'move', 'move', 'move', 'release']);
    const start = r.log[0]![1];
    expect([start.x, start.y, start.stageX, start.stageY]).toEqual([200, 200, 300, 400]);
    const rel = r.last();
    expect(rel.x).toBeCloseTo(300);
    expect(rel.y).toBeCloseTo(300);
    expect(rel.dx).toBeCloseTo(100);
    expect(rel.dy).toBeCloseTo(100);
    expect(rel.distance).toBeCloseTo(Math.SQRT2 * 100);
    expect(rel.angle).toBeCloseTo(Math.PI / 4);
    expect(rel.duration).toBeCloseTo(7 / 60);
    expect(rel.vx).toBeGreaterThan(0);
    expect(rel.vy).toBeGreaterThan(0);
    expect(zone.interactive).toBe(true);
  });

  it('reports positions in opts.space and clamps the drag vector to maxDistance', async () => {
    t = await createTestGame();
    const zone = t.game.sceneLayer.add(new Box(750, 1000, {}, { x: 0, y: 0 }));
    const field = t.game.sceneLayer.add(new Node({ x: 100, y: 100, scale: 2 }));
    const r = recorder();
    onAim(zone, r.handlers, { space: field, maxDistance: 50 });
    await t.drag({ x: 300, y: 300 }, { x: 700, y: 300 }, 4);
    const rel = r.last();
    expect(rel.startX).toBeCloseTo(100);
    expect(rel.x).toBeCloseTo(300);
    expect(rel.stageX).toBeCloseTo(700);
    expect(rel.dx).toBeCloseTo(50);
    expect(rel.dy).toBeCloseTo(0);
    expect(rel.distance).toBeCloseTo(50);
  });

  it('captures the first pointer: others are ignored, moves outside the zone still count', async () => {
    t = await createTestGame();
    const zone = t.game.sceneLayer.add(new Box(300, 300, {}, { x: 0, y: 0 }));
    const r = recorder();
    onAim(zone, r.handlers);
    touch(t, 'start', 1, 100, 100);
    await t.step(1);
    touch(t, 'start', 2, 200, 200);
    touch(t, 'move', 2, 250, 250);
    touch(t, 'end', 2, 250, 250);
    await t.step(1);
    touch(t, 'move', 1, 600, 900);
    await t.step(1);
    touch(t, 'end', 1, 600, 900);
    await t.step(1);
    expect(r.kinds()).toEqual(['start', 'move', 'release']);
    expect(r.last().pointer.pointerId).toBe(1);
    expect([r.last().dx, r.last().dy]).toEqual([500, 800]);
    touch(t, 'start', 2, 50, 50);
    await t.step(1);
    expect(r.kinds()).toEqual(['start', 'move', 'release', 'start']);
  });

  it('cancels on pointercancel and frees the capture', async () => {
    t = await createTestGame();
    const zone = t.game.sceneLayer.add(new Box(300, 300, {}, { x: 0, y: 0 }));
    const r = recorder();
    onAim(zone, r.handlers);
    touch(t, 'start', 1, 100, 100);
    touch(t, 'move', 1, 120, 100);
    touch(t, 'cancel', 1, 120, 100);
    await t.step(1);
    expect(r.kinds()).toEqual(['start', 'move', 'cancel']);
    expect(r.last().dx).toBeCloseTo(20);
    touch(t, 'start', 3, 50, 50);
    touch(t, 'end', 3, 50, 50);
    await t.step(1);
    expect(r.kinds().slice(3)).toEqual(['start', 'release']);
  });

  it('ignores presses while disabled or paused and cancels a running aim when that changes', async () => {
    t = await createTestGame();
    const parent = t.game.sceneLayer.add(new Node());
    const zone = parent.add(new Box(300, 300, {}, { x: 0, y: 0 }));
    let enabled = false;
    const r = recorder();
    onAim(zone, r.handlers, { enabled: () => enabled });
    await t.drag({ x: 100, y: 100 }, { x: 150, y: 100 }, 2);
    expect(r.kinds()).toEqual([]);
    enabled = true;
    touch(t, 'start', 1, 100, 100);
    enabled = false;
    touch(t, 'move', 1, 120, 100);
    touch(t, 'end', 1, 120, 100);
    await t.step(1);
    expect(r.kinds()).toEqual(['start', 'cancel']);
    enabled = true;
    parent.paused = true;
    await t.drag({ x: 100, y: 100 }, { x: 150, y: 100 }, 2);
    expect(r.kinds()).toEqual(['start', 'cancel']);
    parent.paused = false;
    touch(t, 'start', 1, 100, 100);
    parent.paused = true;
    touch(t, 'end', 1, 100, 100);
    await t.step(1);
    expect(r.kinds()).toEqual(['start', 'cancel', 'start', 'cancel']);
  });

  it('works on the whole stage in stage space; the remover and owner destroy detach it', async () => {
    t = await createTestGame();
    const owner = t.game.sceneLayer.add(new Node());
    const r = recorder();
    const off = onAim(t.game, r.handlers, { owner });
    await t.drag({ x: 100, y: 1000 }, { x: 100, y: 800 }, 2);
    expect(r.kinds()).toEqual(['start', 'move', 'move', 'release']);
    expect(r.last().x).toBeCloseTo(100);
    expect(r.last().dy).toBeCloseTo(-200);
    expect(r.last().angle).toBeCloseTo(-Math.PI / 2);
    owner.destroy();
    await t.drag({ x: 100, y: 1000 }, { x: 100, y: 800 }, 2);
    expect(r.log.length).toBe(4);
    off();

    const zone = t.game.sceneLayer.add(new Box(300, 300, {}, { x: 0, y: 0 }));
    const r2 = recorder();
    const off2 = onAim(zone, r2.handlers);
    off2();
    await t.drag({ x: 100, y: 100 }, { x: 150, y: 100 }, 2);
    expect(r2.log.length).toBe(0);
  });
});
