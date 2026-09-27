import { afterEach, describe, expect, it } from 'vitest';
import type { AppDef, Sprite } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

describe('art-gallery sandbox scene', () => {
  it('shows every section inside the view and animates frame sprites', async () => {
    t = await createTestGame({ app: sandbox as AppDef, scene: 'art-gallery', device: 'iphone-se' });
    expect(t.scene?.sceneName).toBe('art-gallery');
    for (const sel of ['#pal-sunny', '#icon-play', '#shape-star', '#creature-0', '#pixel-heart', '#svg-banner', '#pattern-grass']) {
      t.get(sel);
    }
    const view = t.game.view;
    for (const s of t.findAll<Sprite>('Sprite')) {
      const b = s.worldBounds();
      expect(b.x, s.id).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, s.id).toBeLessThanOrEqual(view.width);
      expect(b.y + b.h, s.id).toBeLessThanOrEqual(view.height);
    }
    const coin = t.get<Sprite>('#pixel-coin');
    const first = coin.texture;
    await t.advance(0.2);
    expect(coin.texture).not.toBe(first);
    await t.tap('#back');
    expect(t.scene?.sceneName).toBe('home');
  });
});
