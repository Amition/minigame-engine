import { afterEach, describe, expect, it } from 'vitest';
import {
  Box,
  drawUIBounds,
  flushUILayout,
  formatLint,
  lintUI,
  Node,
  setUILayout,
  showModal,
  ui,
  type UILintRule,
  type UIView,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

/** A 750-wide screen (inside the safe area of the default device) holding the fixture. */
async function screen(build: () => Node[], device = 'iphone-14'): Promise<UIView> {
  t = await createTestGame({ device });
  const root = ui.view({ id: 'screen', width: 750, height: 1000, fill: 'bg', padding: 20 }, build());
  root.y = t.game.safe.y + 20;
  t.game.sceneLayer.add(root);
  flushUILayout(root);
  return root;
}

const rules = (root: Node): UILintRule[] => lintUI(root, t!.game).map((i) => i.rule);
const abs = <T extends Node>(n: T, left: number, top: number): T => setUILayout(n, { position: 'absolute', left, top });

describe('lintUI rules (failing + passing fixture each)', () => {
  it('interactive-overlap', async () => {
    const bad = await screen(() => [abs(ui.button({ text: 'A' }), 20, 20), abs(ui.button({ text: 'B' }), 60, 40)]);
    expect(rules(bad)).toContain('interactive-overlap');
    const good = await screen(() => [abs(ui.button({ text: 'A' }), 20, 20), abs(ui.button({ text: 'B' }), 20, 200)]);
    expect(rules(good)).not.toContain('interactive-overlap');
  });

  it('text-overlap', async () => {
    const bad = await screen(() => [abs(ui.text('First line'), 20, 20), abs(ui.text('Second line'), 30, 30)]);
    expect(rules(bad)).toContain('text-overlap');
    const good = await screen(() => [ui.text('First line'), ui.text('Second line')]);
    expect(rules(good)).not.toContain('text-overlap');
  });

  it('outside-view', async () => {
    const bad = await screen(() => [abs(ui.button({ text: 'Off' }), -150, 100)]);
    expect(rules(bad)).toContain('outside-view');
    const good = await screen(() => [abs(ui.button({ text: 'On' }), 20, 100)]);
    expect(rules(good)).not.toContain('outside-view');
  });

  it('outside-safe', async () => {
    t = await createTestGame({ device: 'iphone-14' });
    const notch = t.game.sceneLayer.add(ui.view({ width: 750, height: 200 }, [abs(ui.button({ text: 'Notch' }), 20, 0)]));
    flushUILayout(notch);
    expect(lintUI(notch, t.game).map((i) => i.rule)).toContain('outside-safe');
    const good = await screen(() => [ui.button({ text: 'Safe' })]);
    expect(rules(good)).not.toContain('outside-safe');
  });

  it('text-truncated', async () => {
    const bad = await screen(() => [ui.view({ width: 200 }, [ui.text('A very long label that cannot fit on one line', { maxLines: 1 })])]);
    expect(rules(bad)).toContain('text-truncated');
    const good = await screen(() => [ui.view({ width: 600 }, [ui.text('Short enough', { maxLines: 1 })])]);
    expect(rules(good)).not.toContain('text-truncated');
  });

  it('text-overflow (text wider than its container)', async () => {
    const bad = await screen(() => [ui.view({ width: 300, height: 100 }, [abs(ui.text('Sticking out of the box'), 200, 10)])]);
    expect(rules(bad)).toContain('text-overflow');
    const good = await screen(() => [ui.view({ width: 300, height: 100 }, [abs(ui.text('Inside'), 10, 10)])]);
    expect(rules(good)).not.toContain('text-overflow');
  });

  it('small-tap-target (hitPadding counts)', async () => {
    const bad = await screen(() => [abs(new Box(48, 48, { fill: '#48f' }, { id: 'tiny', interactive: true }), 100, 100)]);
    const issues = lintUI(bad, t!.game);
    const tiny = issues.find((i) => i.rule === 'small-tap-target');
    expect(tiny?.severity).toBe('warn');
    expect(formatLint([tiny!])).toMatch(/^WARN {2}small-tap-target Box#tiny \[100,\d+ 48x48\] < 88x88$/m);
    const good = await screen(() => [
      abs(new Box(48, 48, { fill: '#48f' }, { interactive: true, hitPadding: 20 }), 100, 100),
      abs(ui.iconButton({ icon: 'close', label: 'Close', size: 'sm' }), 300, 100),
    ]);
    expect(rules(good)).not.toContain('small-tap-target');
  });

  it('low-contrast (effective background, outline rescue, disabled skipped)', async () => {
    const bad = await screen(() => [ui.view({ fill: '#666666', padding: 20 }, [ui.text('Grey on grey', { color: '#777777' })])]);
    const issue = lintUI(bad, t!.game).find((i) => i.rule === 'low-contrast');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toMatch(/contrast 1\.\d:1 \(#777777 on /);
    const good = await screen(() => [
      ui.view({ fill: '#222222', padding: 20 }, [ui.text('White on dark', { color: '#ffffff' })]),
      ui.view({ fill: '#666666', padding: 20 }, [ui.text('Outlined', { color: '#777777', stroke: { color: '#000000', width: 6 } })]),
      ui.button({ text: 'Disabled', disabled: true }),
      ui.button({ text: 'Primary' }),
    ]);
    expect(rules(good)).not.toContain('low-contrast');
  });

  it('low-contrast sees semi-transparent layers and scene boxes', async () => {
    t = await createTestGame();
    const scene = t.game.sceneLayer.add(new Node());
    scene.add(new Box(750, 400, { fill: '#ffffff' }));
    const root = scene.add(ui.view({ width: 750, height: 300, fill: 'rgba(255,255,255,0.5)' }, [ui.text('White text', { color: '#ffffff' })]));
    root.y = 100;
    flushUILayout(root);
    expect(lintUI(scene, t.game).map((i) => i.rule)).toContain('low-contrast');
  });

  it('small-font', async () => {
    const bad = await screen(() => [ui.text('Tiny', { size: 14 })]);
    expect(rules(bad)).toContain('small-font');
    const good = await screen(() => [ui.text('Readable', { size: 24 })]);
    expect(rules(good)).not.toContain('small-font');
  });

  it('duplicate-id', async () => {
    const bad = await screen(() => [ui.button({ id: 'play', text: 'A' }), ui.text('B', { id: 'play' })]);
    expect(rules(bad)).toContain('duplicate-id');
    const good = await screen(() => [ui.button({ id: 'play', text: 'A' }), ui.text('B', { id: 'title' })]);
    expect(rules(good)).not.toContain('duplicate-id');
  });

  it('empty-label', async () => {
    const bad = await screen(() => [ui.text(''), ui.button({})]);
    expect(rules(bad).filter((r) => r === 'empty-label').length).toBe(2);
    const good = await screen(() => [ui.text('Label'), ui.button({ icon: 'play' })]);
    expect(rules(good)).not.toContain('empty-label');
  });

  it('invisible-interactive and zero-size-interactive', async () => {
    const bad = await screen(() => [
      abs(new Box(100, 100, { fill: '#f00' }, { interactive: true, alpha: 0 }), 20, 20),
      abs(new Node({ interactive: true }), 300, 20),
    ]);
    const r = rules(bad);
    expect(r).toContain('invisible-interactive');
    expect(r).toContain('zero-size-interactive');
    const good = await screen(() => [abs(new Box(100, 100, { fill: '#f00' }, { interactive: true }), 20, 20)]);
    const g = rules(good);
    expect(g).not.toContain('invisible-interactive');
    expect(g).not.toContain('zero-size-interactive');
  });

  it('missing-texture', async () => {
    const bad = await screen(() => [ui.icon('no-such-icon'), ui.image('no-such-image', { width: 100, height: 100 })]);
    expect(rules(bad).filter((r) => r === 'missing-texture').length).toBe(2);
    const good = await screen(() => [ui.icon('coin')]);
    expect(rules(good)).not.toContain('missing-texture');
  });

  it('skips content covered by a modal backdrop and content clipped by a ScrollView', async () => {
    await screen(() => [
      ui.button({ id: 'under', text: 'Under the modal', width: 600 }),
      ui.scroll({ height: 200 }, [ui.view({ height: 400 }), abs(ui.button({ text: 'Hidden A' }), 0, 300), abs(ui.button({ text: 'Hidden B' }), 20, 310)]),
    ]);
    const before = lintUI(t!.game.stage, t!.game);
    expect(before.filter((i) => i.rule === 'interactive-overlap')).toHaveLength(0);
    showModal({ title: 'On top' }, [ui.button({ text: 'Modal button', width: 600 })]);
    await t!.advance(0.6);
    const issues = lintUI(t!.game.stage, t!.game);
    expect(issues.filter((i) => i.severity === 'error'), formatLint(issues)).toHaveLength(0);
  });

  it('rules can be re-graded or turned off', async () => {
    const root = await screen(() => [ui.text('Tiny', { size: 14 })]);
    expect(lintUI(root, t!.game, { rules: { 'small-font': 'error' } })[0]?.severity).toBe('error');
    expect(lintUI(root, t!.game, { rules: { 'small-font': 'off' } })).toHaveLength(0);
  });

  it('formatLint summarises and drawUIBounds draws an overlay', async () => {
    const root = await screen(() => [abs(new Box(40, 40, { fill: '#48f' }, { interactive: true }), 20, 20), ui.text('ok')]);
    const issues = lintUI(root, t!.game);
    expect(formatLint(issues)).toMatch(/UI lint: 0 errors, 1 warning$/);
    expect(formatLint([])).toBe('UI lint: no issues');
    const plain = t!.png();
    const withBounds = t!.png({ overlay: (ctx, game) => drawUIBounds(ctx, game.stage, { game, labels: true }) });
    expect(withBounds.equals(plain)).toBe(false);
  });
});
