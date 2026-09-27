import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDebugQuery,
  Box,
  debugDraw,
  DebugOverlay,
  formatLint,
  getDebugOverlay,
  hideDebugOverlay,
  lintUI,
  Node,
  showDebugOverlay,
  Text,
  toggleDebugOverlay,
  type AppDef,
  type Game,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

/** RGBA of the backing pixel under a stage point (after the last render). */
function pixel(g: Game, x: number, y: number): [number, number, number, number] {
  const p = g.stageToScreen(x, y);
  const ctx = g.platform.canvas.getContext('2d');
  const d = ctx.getImageData(Math.round(p.x * g.pixelRatio), Math.round(p.y * g.pixelRatio), 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]!];
}

describe('debug overlay', () => {
  it('draws the stats panel on top of the stage without taking input or lint issues', async () => {
    t = await createTestGame();
    const g = t.game;
    g.background = '#000000';
    let taps = 0;
    const under = g.sceneLayer.add(new Box(g.view.width, g.view.height, { fill: '#000000' }, { id: 'under' }));
    under.onTap(() => taps++);
    g.sceneLayer.add(new Text('Hello', { fontSize: 32, color: '#ffffff' }, { x: 300, y: 700 }));
    // right end of the panel's first text row (the text is shorter than the 15 em panel)
    const panelAt = { x: g.safe.x + 330, y: g.safe.y + 20 };
    // an overlay child added before the debug layer is still drawn below it
    g.overlay.add(new Box(50, 50, { fill: '#ffffff' }, { x: panelAt.x - 25, y: panelAt.y - 25 }));
    const lintBefore = lintUI(g.stage, g);
    await t.step(1);
    expect(pixel(g, panelAt.x, panelAt.y).slice(0, 3)).toEqual([255, 255, 255]);

    const o = showDebugOverlay(g);
    expect(o).toBeInstanceOf(DebugOverlay);
    expect(o.parent).toBe(g.overlay);
    expect(o.tags.has('lint-ignore')).toBe(true);
    expect(o.interactive).toBe(false);
    expect(o.interactiveChildren).toBe(false);
    expect(t.find('DebugOverlay[stats=true][bounds=false]')).toBe(o);
    expect(showDebugOverlay(g, { bounds: true })).toBe(o);
    expect(o.options).toMatchObject({ stats: true, bounds: true, hits: false, draw: true });
    showDebugOverlay(g, { bounds: false });
    await t.step(10);
    const [r, gg, b] = pixel(g, panelAt.x, panelAt.y);
    expect(r).toBeLessThan(80);
    expect(gg).toBeLessThan(80);
    expect(b).toBeLessThan(80);
    expect(r + gg + b).toBeGreaterThan(0);
    expect(o.panelLines[0]).toMatch(/^60\.0 fps/);
    expect(o.panelLines.join('\n')).toMatch(/nodes \d+ {2}drawn \d+/);
    expect(o.panelLines[6]).toMatch(/^textures \d+ {2}[\d.]+ MB$/);

    expect(g.hitTest(panelAt.x, panelAt.y)).toBe(under);
    await t.tap(panelAt);
    expect(taps).toBe(1);
    const lintAfter = lintUI(g.stage, g);
    expect(lintAfter.length, formatLint(lintAfter)).toBe(lintBefore.length);

    // overlay children added later (toasts, modals) stay below the debug layer too
    g.overlay.add(new Box(50, 50, { fill: '#ffffff' }, { x: panelAt.x - 25, y: panelAt.y - 25 }));
    await t.step(1);
    expect(pixel(g, panelAt.x, panelAt.y)[0]).toBeLessThan(80);

    hideDebugOverlay(g);
    expect(o.destroyed).toBe(true);
    expect(getDebugOverlay(g)).toBeNull();
    expect(t.find('DebugOverlay')).toBeNull();
    hideDebugOverlay(g);
  });

  it('fills hit areas of nodes that receive input, including hitPadding', async () => {
    t = await createTestGame();
    const g = t.game;
    g.background = '#000000';
    const btn = g.sceneLayer.add(new Box(100, 100, { fill: '#000000' }, { x: 400, y: 800, hitPadding: 20 }));
    btn.onTap(() => {});
    const blocked = g.sceneLayer.add(new Node({ x: 100, y: 1000, width: 200, height: 100, interactiveChildren: false }));
    blocked.add(new Box(100, 100, { fill: '#000000' })).onTap(() => {});
    showDebugOverlay(g, { stats: false, hits: true });
    await t.step(1);
    const inside = pixel(g, 450, 850);
    const padding = pixel(g, 390, 850);
    expect(inside[0]).toBeGreaterThan(20);
    expect(inside[0]).toBeGreaterThan(inside[1]);
    expect(padding[0]).toBeGreaterThan(20);
    expect(pixel(g, 150, 1050)[0]).toBe(0);
    expect(pixel(g, 600, 850)[0]).toBe(0);

    showDebugOverlay(g, { hits: false, bounds: true });
    await t.step(1);
    expect(pixel(g, 450, 850)[0]).toBe(0);
    const edge = pixel(g, 400, 850);
    expect(edge[2]).toBeGreaterThan(edge[0]);
  });

  it('toggles and reads launch parameters', async () => {
    t = await createTestGame();
    const g = t.game;
    expect(applyDebugQuery(g, '?scene=play')).toBeNull();
    expect(applyDebugQuery(g, '?debug=0&stats=0')).toBeNull();
    expect(getDebugOverlay(g)).toBeNull();
    expect(applyDebugQuery(g, '?scene=play&stats=1')?.options).toMatchObject({ stats: true, hits: false, draw: false, bounds: false });
    hideDebugOverlay(g);
    expect(applyDebugQuery(g, 'debug=1')?.options).toMatchObject({ stats: true, hits: true, draw: true, bounds: false });
    hideDebugOverlay(g);
    expect(applyDebugQuery(g, '?debug=all')?.options).toMatchObject({ stats: true, hits: true, draw: true, bounds: true });
    hideDebugOverlay(g);
    expect(applyDebugQuery(g, { debug: 'bounds,hits' })?.options).toMatchObject({ stats: false, hits: true, bounds: true, draw: false });
    hideDebugOverlay(g);
    expect(applyDebugQuery(g, { stats: 'true' })?.options.stats).toBe(true);
    hideDebugOverlay(g);

    expect(toggleDebugOverlay(g, { hits: true })).toBe(true);
    expect(getDebugOverlay(g)?.options.hits).toBe(true);
    expect(toggleDebugOverlay(g)).toBe(false);
    expect(getDebugOverlay(g)).toBeNull();
  });
});

describe('debugDraw', () => {
  it('ignores requests while no overlay draws them', async () => {
    t = await createTestGame();
    expect(debugDraw.enabled).toBe(false);
    debugDraw.line(0, 0, 10, 10);
    debugDraw.text('x', 0, 0, { duration: 5 });
    expect(debugDraw.count).toBe(0);
    showDebugOverlay(t.game, { draw: false });
    expect(debugDraw.enabled).toBe(false);
    showDebugOverlay(t.game, { draw: true });
    expect(debugDraw.enabled).toBe(true);
    hideDebugOverlay(t.game);
    expect(debugDraw.enabled).toBe(false);
  });

  it('draws requests for one frame and flushes them every frame', async () => {
    t = await createTestGame();
    const g = t.game;
    g.background = '#000000';
    showDebugOverlay(g, { stats: false });
    const perFrame = g.sceneLayer.add(new Node());
    perFrame.onUpdate(() => {
      debugDraw.line(0, 0, 100, 100, '#ffffff');
      debugDraw.arrow(0, 0, 50, 0);
      debugDraw.point(10, 10);
    });
    for (let i = 0; i < 5; i++) {
      await t.step(1);
      expect(debugDraw.count).toBe(3);
    }
    perFrame.destroy();

    // between frames (like an input handler): drawn on the next frame, gone on the one after
    debugDraw.rect(400, 800, 200, 200, { color: '#ff0000', fill: true });
    await t.step(1);
    expect(pixel(g, 500, 900)).toEqual([255, 0, 0, 255]);
    await t.step(1);
    expect(pixel(g, 500, 900)).toEqual([0, 0, 0, 255]);
    expect(debugDraw.count).toBe(0);

    // duration keeps a request for that many seconds
    debugDraw.circle(500, 900, 60, { color: '#00ff00', fill: true, duration: 0.5 });
    await t.step(20);
    expect(pixel(g, 500, 900)).toEqual([0, 255, 0, 255]);
    await t.step(20);
    expect(pixel(g, 500, 900)).toEqual([0, 0, 0, 255]);
  });

  it('maps coordinates through a node space and skips destroyed spaces', async () => {
    t = await createTestGame();
    const g = t.game;
    g.background = '#000000';
    showDebugOverlay(g, { stats: false });
    const layer = g.sceneLayer.add(new Node({ x: 300, y: 600, scale: 2 }));
    debugDraw.rect(10, 10, 40, 40, { color: '#0000ff', fill: true, space: layer });
    debugDraw.polygon([0, 0, 30, 0, 30, 30], { color: '#00ffff', fill: true, space: layer, duration: 1 });
    debugDraw.text('hi', 200, 300, { size: 24, color: '#ffffff' });
    await t.step(1);
    // (10..50) * 2 + (300, 600) = (320..400, 620..700)
    expect(pixel(g, 385, 685)).toEqual([0, 0, 255, 255]);
    expect(pixel(g, 330, 690)[2]).toBe(255);
    expect(pixel(g, 250, 660)).toEqual([0, 0, 0, 255]);
    expect(pixel(g, 350, 610)).toEqual([0, 255, 255, 255]);
    layer.destroy();
    await t.step(1);
    expect(pixel(g, 350, 610)).toEqual([0, 0, 0, 255]);
    debugDraw.clear();
    expect(debugDraw.count).toBe(0);
  });
});

describe('sandbox debug-overlay scene', () => {
  it('lints clean on three devices, toggles overlay parts and hides the overlay on exit', async () => {
    for (const device of ['iphone-se', 'iphone-14', 'ipad']) {
      t = await createTestGame({ app: sandbox as AppDef, scene: 'debug-overlay', device });
      await t.advance(0.5);
      const issues = lintUI(t.game.stage, t.game);
      expect(issues.filter((i) => i.severity === 'error'), `${device}\n${formatLint(issues)}`).toHaveLength(0);
      const o = getDebugOverlay(t.game)!;
      expect(o.options).toMatchObject({ stats: true, bounds: true, hits: true, draw: true });
      expect(debugDraw.count).toBeGreaterThan(10);
      expect(t.game.stats.nodes).toBeGreaterThan(160);
      expect(t.game.stats.particles).toBeGreaterThan(0);
      t.destroy();
      t = null;
    }
    t = await createTestGame({ app: sandbox as AppDef, scene: 'debug-overlay' });
    await t.tap('#toggle-bounds');
    expect(getDebugOverlay(t.game)?.options.bounds).toBe(false);
    await t.tap('#toggle-draw');
    expect(debugDraw.enabled).toBe(false);
    await t.tap('#target-a');
    await t.tap('#back');
    expect(t.scene?.sceneName).toBe('home');
    expect(getDebugOverlay(t.game)).toBeNull();
  }, 60_000);
});
