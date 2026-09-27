import { afterEach, describe, expect, it } from 'vitest';
import { Box, Scene, tween, type SceneFactory } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const taps: Record<string, number> = {};

class ButtonScene extends Scene {
  override onEnter(): void {
    this.add(new Box(this.width, this.height, { fill: '#222222' }, { id: `${this.sceneName}-bg` }));
    const btn = this.add(new Box(200, 100, { fill: '#3b82f6' }, { id: `${this.sceneName}-btn`, x: 100, y: 300 }));
    btn.onTap(() => (taps[this.sceneName] = (taps[this.sceneName] ?? 0) + 1));
  }
}

class Dialog extends Scene {
  override onEnter(params?: unknown): void {
    this.add(new Box(this.width, this.height, { fill: '#0008' }, { id: 'backdrop' }));
    const ok = this.add(new Box(200, 100, { fill: '#10b981' }, { id: 'ok', x: 400, y: 800 }));
    ok.onTap(() => void this.close((params as { answer?: string } | undefined)?.answer ?? 'ok'));
  }
}

const scenes: Record<string, SceneFactory> = {
  a: () => new ButtonScene(),
  b: () => new ButtonScene(),
  dialog: () => new Dialog(),
};

const boot = async () => {
  for (const k of Object.keys(taps)) delete taps[k];
  t = await createTestGame({ app: { design: { width: 750, height: 1334 }, scenes, start: 'a' } });
  return t;
};

describe('scene transitions', () => {
  it('fade renders both scenes, blocks input, then completes', async () => {
    const t = await boot();
    const sm = t.game.scenes;
    const old = sm.current!;
    const scene = await sm.go('b', undefined, { transition: 'fade', duration: 0.5 });
    expect(sm.current).toBe(scene);
    expect(sm.transitioning).toBe(true);
    expect(t.game.inputLocked).toBe(true);
    expect(t.game.sceneLayer.children).toEqual([old, scene]);
    expect(scene.alpha).toBe(0);
    await t.step(15);
    expect(scene.alpha).toBeGreaterThan(0);
    expect(scene.alpha).toBeLessThan(1);
    expect(old.paused).toBe(true);
    await t.tap('#b-btn');
    expect(taps.b).toBeUndefined();
    await t.advance(0.5);
    await sm.idle();
    expect(sm.transitioning).toBe(false);
    expect(t.game.inputLocked).toBe(false);
    expect(old.destroyed).toBe(true);
    expect(t.game.sceneLayer.children).toEqual([scene]);
    expect(scene.alpha).toBe(1);
    await t.tap('#b-btn');
    expect(taps.b).toBe(1);
  });

  it('slide and zoom move the scenes and restore transforms', async () => {
    const t = await boot();
    const sm = t.game.scenes;
    const w = t.game.view.width;
    const old = sm.current!;
    const next = await sm.go('b', undefined, { transition: 'slide-left', duration: 0.4 });
    await t.step(12);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(w);
    expect(old.x).toBeLessThan(0);
    await t.advance(0.4);
    expect(next.x).toBe(0);

    const z = await sm.go('a', undefined, { transition: 'zoom', duration: 0.4 });
    await t.step(12);
    expect(z.scaleX).toBeGreaterThan(0.6);
    expect(z.scaleX).toBeLessThan(1);
    await t.advance(0.4);
    expect([z.scaleX, z.x, z.y, z.alpha]).toEqual([1, 0, 0, 1]);
  });

  it('queues scene operations and keeps plain go instant', async () => {
    const t = await boot();
    const sm = t.game.scenes;
    void sm.go('b', undefined, { transition: 'slide-up', duration: 0.3 });
    const second = sm.go('a');
    await t.step(5);
    expect(sm.currentName).toBe('b');
    await t.advance(0.4);
    await second;
    expect(sm.currentName).toBe('a');
    expect(t.game.sceneLayer.children.length).toBe(1);
    await expect(sm.go('missing')).rejects.toThrow(/not registered/);
    expect(sm.currentName).toBe('a');
    expect(sm.current!.destroyed).toBe(false);
  });

  it('custom transition functions receive eased progress', async () => {
    const t = await boot();
    const seen: number[] = [];
    const spin = (k: number, inc: Scene) => {
      seen.push(k);
      inc.rotation = k;
    };
    await t.game.scenes.go('b', undefined, { transition: spin, duration: 0.2 });
    await t.advance(0.3);
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(1);
    expect(t.scene!.rotation).toBe(0);
  });

  it('transitions run while the game is paused', async () => {
    const t = await boot();
    t.game.paused = true;
    await t.game.scenes.go('b', undefined, { transition: 'fade', duration: 0.2 });
    await t.advance(0.3);
    expect(t.game.scenes.transitioning).toBe(false);
  });
});

describe('scene stack', () => {
  it('push shows a scene above, pauses the one below and resolves with the pop result', async () => {
    const t = await boot();
    const sm = t.game.scenes;
    const base = sm.current!;
    const n = t.game.sceneLayer.add(new Box(10, 10));
    base.add(n);
    const tw = tween(n, { x: 100 }, 1, { ease: 'linear' });
    const result = sm.push<string>('dialog', { answer: 'yes' });
    await t.step(1);
    expect(sm.top?.sceneName).toBe('dialog');
    expect(sm.top?.pushed).toBe(true);
    expect(sm.current).toBe(base);
    expect(sm.stack.map((s) => s.sceneName)).toEqual(['a', 'dialog']);
    expect(base.paused).toBe(true);
    const x = n.x;
    await t.step(10);
    expect(n.x).toBe(x);
    await t.tap('#a-btn');
    expect(taps.a).toBeUndefined();
    expect(t.dump()).toContain('pushed');

    await t.tap('#ok');
    expect(await result).toBe('yes');
    expect(sm.top).toBe(base);
    expect(base.paused).toBe(false);
    expect(base.interactiveChildren).toBe(true);
    await t.step(10);
    expect(n.x).toBeGreaterThan(x);
    expect(tw.active).toBe(true);
    await t.tap('#a-btn');
    expect(taps.a).toBe(1);
  });

  it('push/pop with transitions animate in and out', async () => {
    const t = await boot();
    const sm = t.game.scenes;
    const h = t.game.view.height;
    const result = sm.push('dialog', undefined, { transition: 'slide-up', duration: 0.3 });
    await t.step(9);
    const dlg = sm.top!;
    expect(dlg.y).toBeGreaterThan(0);
    expect(dlg.y).toBeLessThan(h);
    await t.advance(0.3);
    expect(dlg.y).toBe(0);
    const popped = sm.pop(42);
    await t.step(9);
    expect(dlg.destroyed).toBe(false);
    expect(dlg.y).toBeGreaterThan(0);
    await t.advance(0.3);
    await popped;
    expect(dlg.destroyed).toBe(true);
    expect(await result).toBe(42);
    expect(t.game.sceneLayer.children.length).toBe(1);
  });

  it('go() closes pushed scenes, resolving them with undefined; pop without overlays is a no-op', async () => {
    const t = await boot();
    const sm = t.game.scenes;
    const r1 = sm.push('dialog');
    const r2 = sm.push('dialog');
    await t.step(1);
    expect(sm.stack.length).toBe(3);
    await sm.go('b');
    expect(await r1).toBeUndefined();
    expect(await r2).toBeUndefined();
    expect(sm.stack.map((s) => s.sceneName)).toEqual(['b']);
    expect(sm.current!.paused).toBe(false);
    await sm.pop();
    expect(sm.currentName).toBe('b');
  });
});
