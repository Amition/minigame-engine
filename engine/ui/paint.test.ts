import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestGame, type TestGame } from '@engine/testing';
import { darken, lighten, mix } from '../core/color';
import type { Ctx2D } from '../gfx/types';
import { Node } from '../scene/node';
import { mountScreen, ui } from './builder';
import { UIGradientCache, clearUIPaintCaches, uiMix, uiShade } from './paint';
import { setUITheme } from './theme';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
  setUITheme('dark');
  vi.restoreAllMocks();
});

function fakeCtx() {
  const made: { args: number[]; stops: [number, string][] }[] = [];
  const ctx = {
    createLinearGradient: (...args: number[]) => {
      const g = { args, stops: [] as [number, string][], addColorStop: (o: number, c: string) => g.stops.push([o, c]) };
      made.push(g);
      return g;
    },
  };
  return { ctx: ctx as unknown as Ctx2D, made };
}

describe('colour caches', () => {
  it('uiShade / uiMix return exactly what darken / lighten / mix return, and new colours give new results', () => {
    clearUIPaintCaches();
    expect(uiShade('#3b82f6', -0.18)).toBe(darken('#3b82f6', 0.18));
    expect(uiShade('#3b82f6', 0.09)).toBe(lighten('#3b82f6', 0.09));
    expect(uiShade('#3b82f6', -0.18)).toBe(darken('#3b82f6', 0.18));
    expect(uiShade('#ef4444', -0.18)).toBe(darken('#ef4444', 0.18));
    expect(uiShade('#ef4444', -0.18)).not.toBe(uiShade('#3b82f6', -0.18));
    expect(uiMix('#3b82f6', '#ffffff', 0.7)).toBe(mix('#3b82f6', '#ffffff', 0.7));
    expect(uiMix('#3b82f6', '#000000', 0.7)).toBe(mix('#3b82f6', '#000000', 0.7));
  });

  it('stays bounded and correct when many colours go through it', () => {
    clearUIPaintCaches();
    for (let i = 0; i < 2000; i++) {
      const c = `rgb(${i % 256},${(i * 7) % 256},${(i * 13) % 256})`;
      expect(uiShade(c, -0.1)).toBe(darken(c, 0.1));
    }
  });
});

describe('UIGradientCache', () => {
  it('reuses the gradient until the context, the geometry or a colour changes', () => {
    const cache = new UIGradientCache();
    const a = fakeCtx();
    const b = fakeCtx();
    const g1 = cache.get2(a.ctx, 0, 0, 0, 100, '#fff', '#000');
    expect(cache.get2(a.ctx, 0, 0, 0, 100, '#fff', '#000')).toBe(g1);
    expect(a.made).toHaveLength(1);
    expect(a.made[0]!.stops).toEqual([
      [0, '#fff'],
      [1, '#000'],
    ]);
    const g2 = cache.get2(a.ctx, 0, 0, 0, 100, '#fff', '#111');
    expect(g2).not.toBe(g1);
    expect(a.made[1]!.stops).toEqual([
      [0, '#fff'],
      [1, '#111'],
    ]);
    cache.get2(a.ctx, 0, 0, 0, 120, '#fff', '#111');
    expect(a.made[2]!.args).toEqual([0, 0, 0, 120]);
    cache.get2(b.ctx, 0, 0, 0, 120, '#fff', '#111');
    expect(b.made).toHaveLength(1);
    expect(cache.builds).toBe(4);
    cache.get2(b.ctx, 0, 0, 0, 120, '#fff', '#111');
    expect(cache.builds).toBe(4);
  });

  it('getN: evenly spaced stops, rebuilt on a colour or stop-count change, not on a new array with the same colours', () => {
    const cache = new UIGradientCache();
    const { ctx, made } = fakeCtx();
    cache.getN(ctx, 0, 0, 50, 50, ['#a00', '#0a0', '#00a'], 3);
    cache.getN(ctx, 0, 0, 50, 50, ['#a00', '#0a0', '#00a'], 3);
    expect(made).toHaveLength(1);
    expect(made[0]!.stops).toEqual([
      [0, '#a00'],
      [0.5, '#0a0'],
      [1, '#00a'],
    ]);
    cache.getN(ctx, 0, 0, 50, 50, ['#a00', '#0a0', '#00b'], 3);
    cache.getN(ctx, 0, 0, 50, 50, ['#a00', '#0a0', '#00b'], 2);
    cache.getN(ctx, 0, 0, 50, 50, ['#a00'], 1);
    expect(made.map((m) => m.stops.length)).toEqual([3, 3, 2, 1]);
    expect(made[3]!.stops).toEqual([[0, '#a00']]);
  });
});

describe('widget draw caches', () => {
  it('static widgets create no gradients per frame; a theme (colour) change rebuilds them once', async () => {
    t = await createTestGame({ render: 'every' });
    const scene = t.game.sceneLayer.add(new Node());
    scene.setSize(t.game.view.width, t.game.view.height);
    mountScreen(
      scene,
      ui.column({ padding: 'lg', gap: 'md' }, [
        ui.panel({ variant: 'raised' }, [ui.text('Raised panel')]),
        ui.button({ text: 'Play', variant: 'primary' }),
        ui.button({ text: 'Quit', variant: 'danger' }),
        ui.progress({ value: 0.6, animate: false }),
        ui.stars({ value: 2, max: 3 }),
      ]),
    );
    await t.step(2);
    const ctx = t.platform.canvas.getContext('2d');
    const spy = vi.spyOn(ctx, 'createLinearGradient');
    await t.step(5);
    expect(spy).not.toHaveBeenCalled();
    setUITheme('light');
    await t.step(1);
    const rebuilt = spy.mock.calls.length;
    expect(rebuilt).toBeGreaterThan(0);
    await t.step(5);
    expect(spy.mock.calls.length).toBe(rebuilt);
  });
});
