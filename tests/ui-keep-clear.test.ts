import { afterEach, describe, expect, it } from 'vitest';
import {
  Box,
  drawUIBounds,
  formatLint,
  keepClearZones,
  lintUI,
  mountScreen,
  Node,
  showModal,
  ui,
  UI_LINT_RULES,
  World,
  type Rect,
  type UILintIssue,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const keepClear = (issues: UILintIssue[]) => issues.filter((i) => i.rule === 'covers-keep-clear');

/** A World (lint-ignore) whose camera maps world units 1:1 onto the stage. */
function stageWorld(parent: Node): World {
  const world = parent.add(new World({ id: 'world', width: 750, height: 1334 }));
  world.camera.x = 375;
  world.camera.y = 667;
  return world;
}

/** A scene layer with a World holding a tagged enemy area at stage [300,500 200x300], plus a HUD layer. */
async function battlefield(): Promise<{ world: World; enemy: Node; hud: Node }> {
  t = await createTestGame({ device: '750x1334@1' });
  const layer = t.game.sceneLayer;
  const world = stageWorld(layer);
  const actor = world.add(new Node({ id: 'actor', x: 100, y: 200 }));
  const enemy = actor.add(new Node({ id: 'enemy-zone', tags: ['lint-keep-clear'], x: 200, y: 300, width: 200, height: 300 }));
  const hud = layer.add(new Node({ id: 'hud', width: 750, height: 1334 }));
  return { world, enemy, hud };
}

const place = (hud: Node, kids: Node[]) => mountScreen(hud, ui.view({}, kids), { area: 'view' });

describe('lint rule covers-keep-clear', () => {
  it('is an error by default', () => {
    expect(UI_LINT_RULES['covers-keep-clear']).toBe('error');
  });

  it('finds a tagged node inside a World (lint-ignore) and reports a button covering it, not decor', async () => {
    const { enemy, hud } = await battlefield();
    expect(keepClearZones(t!.stage, t!.game)).toEqual([{ name: 'Node#enemy-zone', rect: { x: 300, y: 500, w: 200, h: 300 }, node: enemy }]);
    place(hud, [
      ui.button({ id: 'buy', text: 'Buy', position: 'absolute', left: 350, top: 600, width: 200 }),
      ui.view({ id: 'glow', position: 'absolute', left: 280, top: 480, width: 240, height: 340, fill: 'rgba(255,255,255,0.2)', lintRole: 'decor' }),
      ui.button({ id: 'ok', text: 'OK', position: 'absolute', left: 40, top: 1000, width: 200 }),
    ]);
    const issues = keepClear(lintUI(t!.stage, t!.game));
    expect(issues.map((i) => i.name)).toEqual(['Button#buy']);
    const [buy] = issues;
    expect(buy!.severity).toBe('error');
    expect(buy!.other).toBe(enemy);
    expect(buy!.message).toMatch(/^covers keep-clear Node#enemy-zone \[300,500 200x300\] by 150x\d+$/);
    expect(formatLint(issues)).toMatch(/^ERROR covers-keep-clear Button#buy \[350,600 200x\d+\] covers keep-clear Node#enemy-zone/m);
  });

  it('reports only the outermost covering node, and text, icons and filled panels count', async () => {
    const { hud } = await battlefield();
    place(hud, [
      ui.panel({ id: 'card', position: 'absolute', left: 320, top: 520, width: 160, height: 120 }, [ui.text('Inside the card')]),
      ui.text('Loose text', { id: 'note', position: 'absolute', left: 320, top: 700 }),
      ui.icon('coin', { id: 'coin', size: 48, position: 'absolute', left: 420, top: 740 }),
      ui.view({ id: 'layout-only', position: 'absolute', left: 250, top: 450, width: 300, height: 30 }, [ui.spacer()]),
    ]);
    const names = keepClear(lintUI(t!.stage, t!.game)).map((i) => i.name);
    expect(names).toEqual(['Panel#card', 'Label#note', 'Icon#coin']);
  });

  it('a keepClearRect() method narrows the zone to a rect in the node space', async () => {
    t = await createTestGame({ device: '750x1334@1' });
    class Enemy extends Node {
      keepClearRect(): Rect {
        return { x: -50, y: -120, w: 100, h: 120 };
      }
    }
    const zoomed = stageWorld(t.game.sceneLayer).add(new Node({ scale: 2 }));
    zoomed.add(new Enemy({ id: 'boss', tags: ['lint-keep-clear'], x: 200, y: 400 }));
    expect(keepClearZones(t.stage, t.game).map((z) => z.rect)).toEqual([{ x: 300, y: 560, w: 200, h: 240 }]);
  });

  it('option zones: stage rects, named rects and nodes', async () => {
    const { hud } = await battlefield();
    const marker = t!.game.sceneLayer.add(new Node({ id: 'marker', x: 40, y: 40, width: 100, height: 100 }));
    place(hud, [
      ui.button({ id: 'top', text: 'Top', position: 'absolute', left: 60, top: 60, width: 200 }),
      ui.button({ id: 'bottom', text: 'Bottom', position: 'absolute', left: 60, top: 1100, width: 200 }),
    ]);
    const clean = keepClear(lintUI(t!.stage, t!.game));
    expect(clean).toHaveLength(0);
    const issues = keepClear(
      lintUI(t!.stage, t!.game, { keepClear: [{ x: 0, y: 1050, w: 750, h: 200 }, { rect: { x: 0, y: 0, w: 100, h: 100 }, name: 'aim zone' }, marker] }),
    );
    expect(issues.map((i) => `${i.name} ${i.message.split(' [')[0]}`)).toEqual([
      'Button#bottom covers keep-clear keepClear[0]',
      'Button#top covers keep-clear aim zone',
      'Button#top covers keep-clear Node#marker',
    ]);
  });

  it("severity override 'off' silences it, 'warn' downgrades it", async () => {
    const { hud } = await battlefield();
    place(hud, [ui.button({ id: 'buy', text: 'Buy', position: 'absolute', left: 350, top: 600, width: 200 })]);
    expect(keepClear(lintUI(t!.stage, t!.game, { rules: { 'covers-keep-clear': 'off' } }))).toHaveLength(0);
    expect(keepClear(lintUI(t!.stage, t!.game, { rules: { 'covers-keep-clear': 'warn' } }))[0]?.severity).toBe('warn');
  });

  it('ignores touches of 2 units or less, UI painted before the zone, hidden zones and zones under a modal backdrop', async () => {
    const { enemy, hud } = await battlefield();
    t!.game.sceneLayer.addAt(new Box(750, 1334, { fill: '#335577' }, { id: 'sky' }), 0);
    place(hud, [ui.button({ id: 'edge', text: 'Edge', position: 'absolute', left: 498, top: 600, width: 200 })]);
    expect(keepClear(lintUI(t!.stage, t!.game))).toHaveLength(0);

    place(hud, [ui.button({ id: 'buy', text: 'Buy', position: 'absolute', left: 350, top: 600, width: 200 })]);
    expect(keepClear(lintUI(t!.stage, t!.game))).toHaveLength(1);
    enemy.visible = false;
    expect(keepClearZones(t!.stage, t!.game)).toHaveLength(0);
    expect(keepClear(lintUI(t!.stage, t!.game))).toHaveLength(0);
    enemy.visible = true;

    showModal({ title: 'Paused' }, [ui.text('A dialog may cover the world')]);
    await t!.advance(0.6);
    expect(keepClearZones(t!.stage, t!.game)).toHaveLength(0);
    const issues = lintUI(t!.stage, t!.game);
    expect(keepClear(issues), formatLint(issues)).toHaveLength(0);
  });

  it('drawUIBounds draws the zones', async () => {
    const { hud } = await battlefield();
    place(hud, [ui.button({ id: 'ok', text: 'OK', position: 'absolute', left: 40, top: 1000, width: 200 })]);
    const lint = lintUI(t!.stage, t!.game);
    const withZone = t!.png({ overlay: (ctx, game) => drawUIBounds(ctx, game.stage, { game, lint }) });
    t!.get('#enemy-zone').tags.delete('lint-keep-clear');
    const without = t!.png({ overlay: (ctx, game) => drawUIBounds(ctx, game.stage, { game, lint }) });
    expect(withZone.equals(without)).toBe(false);
    const optionZone = t!.png({ overlay: (ctx, game) => drawUIBounds(ctx, game.stage, { game, lint, keepClear: [{ x: 300, y: 500, w: 200, h: 300 }] }) });
    expect(optionZone.equals(without)).toBe(false);
  });
});
