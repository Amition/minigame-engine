import { afterEach, describe, expect, it } from 'vitest';
import { lintUI, type AppDef, type Box, type Node } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const errors = (tg: TestGame) => lintUI(tg.game.stage, tg.game).filter((i) => i.severity === 'error');

describe('sandbox helpers scenes', () => {
  it('helpers-aim: pulls the slingshot, flies a shot that lands and reloads; restart re-enters', async () => {
    t = await createTestGame({ app: sandbox as AppDef, scene: 'helpers-aim' });
    expect(t.get('Trajectory').describe().dots).toBeGreaterThan(5);
    expect(errors(t)).toEqual([]);
    const sling = t.get<Node>('#slingshot');
    const from = sling.worldCenter();
    await t.drag(from, { x: from.x - 60, y: from.y + 160 }, 8);
    const shot = t.get<Box>('Box.shot');
    const y0 = shot.worldCenter().y;
    await t.step(10);
    expect(shot.worldCenter().y).toBeLessThan(y0 - 100);
    await t.advance(0.5);
    expect(t.find('#ball')).not.toBeNull();
    await t.advance(4);
    expect(shot.destroyed).toBe(true);
    expect(errors(t)).toEqual([]);
    const before = t.scene;
    await t.tap('#restart');
    await t.advance(0.5);
    expect(t.scene).not.toBe(before);
    expect(t.scene?.sceneName).toBe('helpers-aim');
  });

  it('helpers-spring: jelly buttons squash and wobble back to rest, followers chase the target', async () => {
    t = await createTestGame({ app: sandbox as AppDef, scene: 'helpers-spring' });
    const jelly = t.get<Box>('#spring-jelly');
    await t.tap(jelly);
    await t.step(2);
    expect(jelly.rotation).not.toBe(0);
    expect(jelly.scaleX).not.toBe(1);
    await t.advance(3);
    expect([jelly.rotation, jelly.scaleX, jelly.scaleY]).toEqual([0, 1, 1]);
    const mark = t.get<Node>('#follow-target');
    const dot = t.get<Node>('#follower-2');
    expect(Math.hypot(dot.x - mark.x, dot.y - mark.y)).toBeLessThan(5);
    expect(errors(t)).toEqual([]);
  });
});
