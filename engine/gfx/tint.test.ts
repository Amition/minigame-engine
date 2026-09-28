import { afterEach, describe, expect, it } from 'vitest';
import {
  bakeTexture,
  clearTintCache,
  duotoneTexture,
  flushUILayout,
  parseColor,
  ScaledTexture,
  Sprite,
  textures,
  textureStats,
  tintMultiplySupported,
  tintTexture,
  ui,
  uiColor,
  type Node,
  type Surface,
  type Texture,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
  clearTintCache();
});

/** 1 stage unit = 1 canvas pixel. */
async function pixelGame(): Promise<TestGame> {
  t = await createTestGame({ device: '750x1334@1' });
  return t;
}

/** 50x10 strips of 10 px: white, mid grey, black, transparent, half-transparent white. */
function strips(): Texture {
  return bakeTexture(50, 10, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 10, 10);
    ctx.fillStyle = '#808080';
    ctx.fillRect(10, 0, 10, 10);
    ctx.fillStyle = '#000000';
    ctx.fillRect(20, 0, 10, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(40, 0, 10, 10);
  });
}
const WHITE = 5;
const GREY = 15;
const BLACK = 25;
const CLEAR = 35;
const HALF = 45;

/** RGBA of a texture at logical (x, y). */
function texel(tex: Texture, x: number, y = 5): number[] {
  const r = tex instanceof ScaledTexture ? tex.resolution : 1;
  const s = tex.source as Surface;
  return [...s.getContext('2d').getImageData(tex.frame.x + Math.floor(x * r), tex.frame.y + Math.floor(y * r), 1, 1).data];
}

function screen(x: number, y: number): number[] {
  return [...t!.platform.canvas.getContext('2d').getImageData(x, y, 1, 1).data];
}

function expectRGBA(actual: number[], expected: number[], tol = 3): void {
  expected.forEach((v, i) => expect(Math.abs(actual[i]! - v), `channel ${i}: got [${actual}], want [${expected}]`).toBeLessThanOrEqual(tol));
}

const rgb = (c: string) => {
  const p = parseColor(c);
  return [p.r, p.g, p.b, 255];
};

describe('tintTexture', () => {
  for (const method of ['composite', 'pixels'] as const) {
    it(`multiply (${method}) turns white into the colour, keeps shading, black and alpha`, async () => {
      await pixelGame();
      const tex = tintTexture(strips(), '#ff8000', { method });
      expect([tex.width, tex.height]).toEqual([50, 10]);
      expectRGBA(texel(tex, WHITE), [255, 128, 0, 255]);
      expectRGBA(texel(tex, GREY), [128, 64, 0, 255]);
      expectRGBA(texel(tex, BLACK), [0, 0, 0, 255]);
      expect(texel(tex, CLEAR)[3]).toBe(0);
      expectRGBA(texel(tex, HALF), [255, 128, 0, 128], 4);
    });

    it(`fill (${method}) paints a silhouette keeping alpha; amount blends`, async () => {
      await pixelGame();
      const src = strips();
      const sil = tintTexture(src, '#00c0ff', { mode: 'fill', method });
      for (const x of [WHITE, GREY, BLACK]) expectRGBA(texel(sil, x), [0, 192, 255, 255]);
      expect(texel(sil, CLEAR)[3]).toBe(0);
      expectRGBA(texel(sil, HALF), [0, 192, 255, 128], 4);
      const half = tintTexture(src, '#ff0000', { mode: 'fill', amount: 0.5, method });
      expectRGBA(texel(half, GREY), [192, 64, 64, 255]);
      expectRGBA(texel(half, BLACK), [128, 0, 0, 255]);
    });
  }

  it('multiply amount and colour alpha fade towards the original', async () => {
    await pixelGame();
    const src = strips();
    const byAmount = tintTexture(src, '#ff0000', { amount: 0.5 });
    const byAlpha = tintTexture(src, 'rgba(255,0,0,0.5)');
    expectRGBA(texel(byAmount, WHITE), [255, 128, 128, 255]);
    expectRGBA(texel(byAlpha, WHITE), texel(byAmount, WHITE));
    expect(tintTexture(src, '#ffffff')).toBe(src);
    expect(tintTexture(src, '#ff0000', { amount: 0 })).toBe(src);
  });

  it('caches per source object + params and re-bakes after the key is re-registered', async () => {
    await pixelGame();
    const key = 'tint-test:cache';
    const first = textures.set(key, strips());
    const a = tintTexture(key, '#ff0000');
    expect(tintTexture(key, '#ff0000')).toBe(a);
    expect(tintTexture(first, '#ff0000')).toBe(a);
    expect(tintTexture(key, '#00ff00')).not.toBe(a);
    expect(tintTexture(key, '#ff0000', { mode: 'fill' })).not.toBe(a);
    expect(tintTexture(key, '#ff0000', { amount: 0.5 })).not.toBe(a);
    expect(a.key).toBe(`tint:${key}~#ff0000`);

    const grey = textures.set(key, bakeTexture(50, 10, (ctx) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 50, 10);
    }));
    const b = tintTexture(key, '#ff0000');
    expect(b).not.toBe(a);
    expectRGBA(texel(b, WHITE), [128, 0, 0, 255]);
    expect(tintTexture(grey, '#ff0000')).toBe(b);
    const entries = textureStats({ top: 1000 }).top.filter((e) => e.key === `tint:${key}~#ff0000`);
    expect(entries).toHaveLength(1);

    clearTintCache();
    expect(tintTexture(key, '#ff0000')).not.toBe(b);
  });

  it('keeps only the newest variants per source and releases the canvas of an evicted one', async () => {
    await pixelGame();
    const src = strips();
    const first = tintTexture(src, '#010000');
    const second = tintTexture(src, '#020000');
    expect((first.source as Surface).width).toBe(50);
    for (let i = 3; i <= 17; i++) tintTexture(src, `#${i.toString(16).padStart(2, '0')}0000`);
    expect([(first.source as Surface).width, (first.source as Surface).height]).toEqual([1, 1]);
    expect((second.source as Surface).width).toBe(50);
    expect(tintTexture(src, '#010000')).not.toBe(first);
    expect((src.source as Surface).width).toBe(50);
  });

  it("bakes at the source's resolution by default and names textureStats entries", async () => {
    await pixelGame();
    const hi = textures.set('tint-test:hi', bakeTexture(20, 10, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 20, 10);
    }, { resolution: 2 }));
    const same = tintTexture(hi, '#ff0000');
    expect(same).toBeInstanceOf(ScaledTexture);
    expect((same as ScaledTexture).resolution).toBe(2);
    expect([same.width, same.height, same.frame.w]).toEqual([20, 10, 40]);
    const low = tintTexture(hi, '#ff0000', { resolution: 1 });
    expect([low.width, low.frame.w]).toEqual([20, 20]);
    expect(low.key).toBe('tint:tint-test:hi~#ff0000@1x');
    expect(tintTexture(hi, '#00ff00', { mode: 'fill', amount: 0.25 }).key).toBe('tint:tint-test:hi~#00ff00~fill~0.25');
    const keys = textureStats({ top: 1000 }).top.map((e) => e.key);
    expect(keys).toContain('tint:tint-test:hi~#ff0000');
    expect(tintTexture(strips(), '#00ff00').key).toMatch(/^tint:anon\d+~#00ff00$/);
  });

  it('returns a transparent `missing:<key>` placeholder for unregistered keys, uncached', async () => {
    await pixelGame();
    const miss = tintTexture('tint-test:later', '#ff0000');
    expect(miss.key).toBe('missing:tint-test:later');
    expect([miss.width, miss.height]).toEqual([1, 1]);
    expect(duotoneTexture('tint-test:later', '#000', '#fff').key).toBe('missing:tint-test:later');
    textures.set('tint-test:later', strips());
    expectRGBA(texel(tintTexture('tint-test:later', '#ff0000'), WHITE), [255, 0, 0, 255]);
  });

  it('uses composite multiply on the headless canvas', async () => {
    await pixelGame();
    expect(tintMultiplySupported()).toBe(true);
  });
});

describe('duotoneTexture', () => {
  it('maps black -> dark, white -> light, grey in between, alpha kept', async () => {
    await pixelGame();
    const tex = duotoneTexture(strips(), '#204060', '#e0c0a0');
    expectRGBA(texel(tex, BLACK), [0x20, 0x40, 0x60, 255]);
    expectRGBA(texel(tex, WHITE), [0xe0, 0xc0, 0xa0, 255]);
    const l = 128 / 255;
    expectRGBA(texel(tex, GREY), [0x20 + (0xe0 - 0x20) * l, 0x40 + (0xc0 - 0x40) * l, 0x60 + (0xa0 - 0x60) * l, 255]);
    expect(texel(tex, CLEAR)[3]).toBe(0);
    expectRGBA(texel(tex, HALF), [0xe0, 0xc0, 0xa0, 128], 4);
  });

  it('scales alpha by the colour alpha, caches and names entries', async () => {
    await pixelGame();
    const src = textures.set('tint-test:duo', strips());
    const tex = duotoneTexture(src, '#000000', 'rgba(255,255,255,0.5)');
    expectRGBA(texel(tex, WHITE), [255, 255, 255, 128], 4);
    expectRGBA(texel(tex, BLACK), [0, 0, 0, 255]);
    expect(duotoneTexture('tint-test:duo', '#000000', 'rgba(255,255,255,0.5)')).toBe(tex);
    expect(duotoneTexture(src, '#111111', '#eeeeee').key).toBe('duotone:tint-test:duo~#111111~#eeeeee');
  });
});

describe('Sprite.tint', () => {
  it('draws the tinted texture and shows the tint in describe() / selectors', async () => {
    await pixelGame();
    const src = strips();
    const plain = t!.game.sceneLayer.add(new Sprite(src, { x: 100, y: 100 }));
    const red = t!.game.sceneLayer.add(new Sprite(src, { x: 100, y: 200, tint: '#ff0000' }));
    const sil = t!.game.sceneLayer.add(new Sprite(src, { x: 100, y: 300, tint: '#0000ff', tintMode: 'fill' }));
    t!.game.render();
    expectRGBA(screen(100 + WHITE, 105), [255, 255, 255, 255]);
    expectRGBA(screen(100 + WHITE, 205), [255, 0, 0, 255]);
    expectRGBA(screen(100 + GREY, 205), [128, 0, 0, 255]);
    expectRGBA(screen(100 + BLACK, 305), [0, 0, 255, 255]);
    expect(red.describe()).toMatchObject({ tint: '#ff0000' });
    expect(plain.describe().tint).toBeUndefined();
    expect(t!.find('Sprite[tint=#ff0000]')).toBe(red);
    expect(t!.find('Sprite[tintMode=fill]')).toBe(sil);
    red.tint = null;
    t!.game.render();
    expectRGBA(screen(100 + WHITE, 205), [255, 255, 255, 255]);
  });
});

describe('ui.icon / ui.image tint and duotone', () => {
  /** 40x40 white square with a 4 px transparent border and a black 8x8 centre ("eye"). */
  const iconKey = 'tint-test:icon';
  const bakeIcon = () =>
    textures.set(iconKey, bakeTexture(40, 40, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(4, 4, 32, 32);
      ctx.fillStyle = '#000000';
      ctx.fillRect(16, 16, 8, 8);
    }));
  const at = <T extends Node>(n: T, x: number, y: number): T => {
    n.x = x;
    n.y = y;
    t!.game.sceneLayer.add(n);
    flushUILayout(n);
    return n;
  };

  it('tints texture icons (theme tokens resolve), duotones them, and leaves `color` to glyphs', async () => {
    await pixelGame();
    bakeIcon();
    const bg = screen(700, 1300);
    const tinted = at(ui.icon(iconKey, { id: 'i-tint', size: 40, tint: 'danger' }), 100, 100);
    at(ui.icon(iconKey, { id: 'i-duo', size: 40, duotone: ['#ff0000', '#0000ff'] }), 200, 100);
    at(ui.icon(iconKey, { id: 'i-color', size: 40, color: '#ff0000' }), 300, 100);
    at(ui.icon(iconKey, { id: 'i-fill', size: 40, tint: '#00ff00', tintMode: 'fill' }), 400, 100);
    at(ui.icon('lock', { id: 'i-glyph', size: 100, tint: '#00ff00' }), 500, 100);
    t!.game.render();
    expectRGBA(screen(108, 108), rgb(uiColor('danger')));
    expectRGBA(screen(120, 120), [0, 0, 0, 255]);
    expectRGBA(screen(101, 101), bg);
    expectRGBA(screen(208, 108), [0, 0, 255, 255]);
    expectRGBA(screen(220, 120), [255, 0, 0, 255]);
    expectRGBA(screen(308, 108), [255, 255, 255, 255]);
    expectRGBA(screen(420, 120), [0, 255, 0, 255]);
    expectRGBA(screen(550, 170), [0, 255, 0, 255]);
    expect(tinted.describe()).toMatchObject({ icon: iconKey, tint: 'danger' });
    expect(t!.find('Icon[duotone=#ff0000/#0000ff]')?.id).toBe('i-duo');
    expect(t!.find('Icon[tintMode=fill]')?.id).toBe('i-fill');
  });

  it('keeps the missing-texture fallback and tints ui.image', async () => {
    await pixelGame();
    const missing = at(ui.icon('tint-test:nope', { size: 40, duotone: ['#000', '#fff'] }), 100, 100);
    expect(missing.missing).toBe(true);
    bakeIcon();
    const img = at(ui.image(iconKey, { id: 'img', width: 40, height: 40, tint: '#ff00ff' }), 200, 200);
    t!.game.render();
    expectRGBA(screen(208, 208), [255, 0, 255, 255]);
    expectRGBA(screen(220, 220), [0, 0, 0, 255]);
    expect(img.describe()).toMatchObject({ src: iconKey, tint: '#ff00ff' });
  });
});
