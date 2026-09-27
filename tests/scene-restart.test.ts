import { afterEach, describe, expect, it } from 'vitest';
import { Box, Scene, type SceneFactory } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const entered: { name: string; params: unknown }[] = [];

class Level extends Scene {
  override onEnter(params?: unknown): void {
    entered.push({ name: this.sceneName, params });
    this.add(new Box(this.width, this.height, { fill: '#222222' }, { id: `${this.sceneName}-bg` }));
  }
}

const scenes: Record<string, SceneFactory> = {
  level: () => new Level(),
  other: () => new Level(),
  dialog: () => new Scene(),
};

const boot = async () => {
  entered.length = 0;
  t = await createTestGame({ app: { design: { width: 750, height: 1334 }, scenes, start: '' } });
  return t;
};

describe('SceneManager.restart', () => {
  it('re-enters the current scene as a new instance with its last params', async () => {
    const t = await boot();
    const sm = t.game.scenes;
    const first = await sm.go('level', { seed: 7 });
    expect(sm.currentParams).toEqual({ seed: 7 });
    const second = await sm.restart();
    expect(second).not.toBe(first);
    expect(first.destroyed).toBe(true);
    expect(sm.current).toBe(second);
    expect(second.sceneName).toBe('level');
    expect(entered.map((e) => e.params)).toEqual([{ seed: 7 }, { seed: 7 }]);
    expect(t.game.sceneLayer.children).toEqual([second]);
  });

  it('takes new params, which later restarts reuse; an explicit undefined clears them', async () => {
    const t = await boot();
    const sm = t.game.scenes;
    await sm.go('level', { seed: 1 });
    await sm.restart({ params: { seed: 2 } });
    await sm.restart();
    expect(sm.currentParams).toEqual({ seed: 2 });
    await sm.restart({ params: undefined });
    expect(entered.map((e) => e.params)).toEqual([{ seed: 1 }, { seed: 2 }, { seed: 2 }, undefined]);
    expect(sm.currentParams).toBeUndefined();
  });

  it('plays a transition with input locked, both instances on stage until it ends', async () => {
    const t = await boot();
    const sm = t.game.scenes;
    const old = await sm.go('level');
    const next = await sm.restart({ transition: 'fade', duration: 0.3 });
    expect(sm.transitioning).toBe(true);
    expect(t.game.inputLocked).toBe(true);
    expect(t.game.sceneLayer.children).toEqual([old, next]);
    expect(next.alpha).toBe(0);
    expect(old.paused).toBe(true);
    await t.advance(0.4);
    await sm.idle();
    expect(sm.transitioning).toBe(false);
    expect(old.destroyed).toBe(true);
    expect(next.alpha).toBe(1);
    expect(t.game.inputLocked).toBe(false);
  });

  it('closes pushed scenes (their push resolves undefined) and restarts the base scene', async () => {
    const t = await boot();
    const sm = t.game.scenes;
    const base = await sm.go('level', { n: 3 });
    const pushed = sm.push('dialog');
    await t.step(1);
    expect(sm.stack.length).toBe(2);
    const fresh = await sm.restart();
    expect(await pushed).toBeUndefined();
    expect(base.destroyed).toBe(true);
    expect(sm.stack).toEqual([fresh]);
    expect(fresh.paused).toBe(false);
    expect(entered[entered.length - 1]).toEqual({ name: 'level', params: { n: 3 } });
  });

  it('resolves the scene when the queued operation runs', async () => {
    const t = await boot();
    const sm = t.game.scenes;
    await sm.go('level', { a: 1 });
    void sm.go('other', { b: 2 }, { transition: 'fade', duration: 0.2 });
    const restarted = sm.restart();
    await t.advance(0.3);
    const s = await restarted;
    expect(s.sceneName).toBe('other');
    expect(entered.map((e) => e.name)).toEqual(['level', 'other', 'other']);
    expect(entered[2]!.params).toEqual({ b: 2 });
  });

  it('rejects without a current scene', async () => {
    const t = await boot();
    await expect(t.game.scenes.restart()).rejects.toThrow(/no current scene/);
    await t.game.scenes.go('level');
    await expect(t.game.scenes.restart()).resolves.toBeInstanceOf(Level);
  });
});
