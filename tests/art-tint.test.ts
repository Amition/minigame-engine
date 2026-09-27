import { afterEach, describe, expect, it } from 'vitest';
import { formatLint, lintUI, type AppDef, type Sprite } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

describe('art-tint sandbox scene', () => {
  for (const device of ['iphone-se', 'iphone-14', 'ipad'] as const) {
    it(`shows tints, duotones, Sprite.tint and ui.icon tints on ${device}`, async () => {
      t = await createTestGame({ app: sandbox as AppDef, scene: 'art-tint', device, pixelRatio: 1 });
      await t.advance(0.2);
      expect(t.get<Sprite>('#tint-multiply-0').texture?.key).toBe('tint:tint-demo:skull~#ff6b6b');
      expect(t.get<Sprite>('#tint-duotone-0').texture?.key).toBe('duotone:tint-demo:skull~#d9d9de~#1e1e22');
      expect(t.get('Sprite[tint=#ff922b]').id).toBe('tint-sprite');
      expect(t.get('#tint-icon').describe()).toMatchObject({ tint: 'primary' });
      expect(t.get('#tint-icon-duotone').describe()).toMatchObject({ duotone: 'danger/onDanger' });
      const view = t.game.view;
      for (const s of t.findAll<Sprite>('Sprite')) {
        const b = s.worldBounds();
        expect(b.x + b.w, s.id).toBeLessThanOrEqual(view.width);
        expect(b.y + b.h, s.id).toBeLessThanOrEqual(view.height);
      }
      const errors = lintUI(t.stage, t.game).filter((i) => i.severity === 'error');
      expect(formatLint(errors)).toBe('UI lint: no issues');
    });
  }
});
