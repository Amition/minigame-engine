import { afterEach, describe, expect, it } from 'vitest';
import { drawUIBounds, formatLint, lintUI, ScrollView, type AppDef, type UILintIssue } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const DEVICES = ['iphone-se', 'iphone-14', 'ipad'] as const;
const CASES: { name: string; scene: string; params?: unknown }[] = [
  { name: 'ui-kit', scene: 'ui-kit' },
  { name: 'ui-menu', scene: 'ui-menu' },
  { name: 'ui-menu-settings', scene: 'ui-menu', params: { open: 'settings' } },
  { name: 'ui-menu-result', scene: 'ui-menu', params: { open: 'result' } },
  { name: 'ui-list', scene: 'ui-list' },
];
const SHOTS = !!process.env.UI_SHOTS;

/** Lints the stage; for scroll views, lints every page of their content too. */
async function lintAllPages(tg: TestGame, name: string): Promise<UILintIssue[]> {
  const all: UILintIssue[] = [];
  const seen = new Set<string>();
  const add = (list: UILintIssue[]) => {
    for (const i of list) {
      const key = `${i.rule} ${i.name} ${i.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(i);
      }
    }
  };
  const shoot = async (suffix: string, issues: UILintIssue[]) => {
    if (!SHOTS) return;
    await tg.screenshot(`.shots/ui/${name}${suffix}.png`);
    await tg.screenshot(`.shots/ui/${name}${suffix}-bounds.png`, {
      overlay: (ctx, game) => drawUIBounds(ctx, game.stage, { game, lint: issues }),
    });
  };
  const first = lintUI(tg.stage, tg.game);
  add(first);
  await shoot('', first);
  const scrolls = tg.findAll<ScrollView>('ScrollView').filter((s) => s.maxOffset > 0 && s.kind === 'ScrollView');
  for (const sv of scrolls) {
    let page = 1;
    for (let o = sv.viewport * 0.8; o < sv.maxOffset + sv.viewport * 0.8; o += sv.viewport * 0.8, page++) {
      sv.scrollTo(o, false);
      await tg.step(2);
      const issues = lintUI(tg.stage, tg.game);
      add(issues);
      await shoot(`-p${page}`, issues);
    }
    sv.scrollTo(0, false);
  }
  return all;
}

describe('ui demo scenes are lint-clean', () => {
  for (const c of CASES) {
    for (const device of DEVICES) {
      it(`${c.name} on ${device}`, async () => {
        t = await createTestGame({ app: sandbox as AppDef, device, scene: c.scene, render: 'none', ...(c.params ? { params: c.params } : {}) });
        await t.advance(1.5);
        const issues = await lintAllPages(t, `${c.name}-${device}`);
        if (process.env.UI_LINT_VERBOSE && issues.length) console.log(`${c.name} ${device}\n${formatLint(issues)}`);
        const errors = issues.filter((i) => i.severity === 'error');
        expect(formatLint(errors)).toBe('UI lint: no issues');
      });
    }
  }
});
