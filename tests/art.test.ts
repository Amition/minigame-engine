import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  artShapes,
  colorHarmony,
  colorRamp,
  contrastRatio,
  creatureFrames,
  creatureTexture,
  fbmNoise,
  flipTexture,
  iconNames,
  iconSvg,
  iconTexture,
  luminance,
  makeNoise2D,
  mirrorRows,
  nearestColor,
  noiseTexture,
  outlineTexture,
  paletteRoles,
  palettes,
  parseColor,
  parseSvg,
  patternNames,
  patternTexture,
  pixelFrames,
  pixelGrid,
  pixelRows,
  pixelSprite,
  recolorTexture,
  registerIcons,
  rgbToHsl,
  Rng,
  setPlatform,
  shapeTexture,
  silhouetteTexture,
  TextureAtlas,
  texturePixels,
  textures,
  type Noise2DKind,
  type PaletteName,
  type Surface,
  type Texture,
} from '@engine';
import { HeadlessPlatform } from '@engine/testing';

beforeAll(() => setPlatform(new HeadlessPlatform()));
afterAll(() => setPlatform(null));

function pixel(tex: Texture, x: number, y: number): number[] {
  const s = tex.source as Surface;
  return [...s.getContext('2d').getImageData(tex.frame.x + x, tex.frame.y + y, 1, 1).data];
}

/** Fraction of pixels with alpha > 0. */
function coverage(tex: Texture): number {
  const { data } = texturePixels(tex);
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) n++;
  return n / (data.length / 4);
}

const hue = (c: string) => rgbToHsl(parseColor(c)).h;

describe('palettes and colour helpers', () => {
  it('ships the curated palettes with valid colours', () => {
    const expected: [PaletteName, number][] = [
      ['pico8', 16], ['sweetie16', 16], ['endesga32', 32], ['gameboy', 4], ['grayscale', 8],
      ['pastel', 11], ['candy', 10], ['forest', 10], ['ocean', 10], ['desert', 10], ['neon', 10],
      ['sunny', 11], ['jelly', 10], ['cozy', 10],
    ];
    for (const [name, n] of expected) {
      expect(palettes[name], name).toHaveLength(n);
      for (const c of palettes[name]) expect(() => parseColor(c)).not.toThrow();
    }
  });

  it('colorRamp runs dark → light with base in the middle, cool shadows and warm highlights', () => {
    const base = '#3fbf6f';
    const ramp = colorRamp(base, 5);
    expect(ramp).toHaveLength(5);
    expect(ramp[2]).toBe(base);
    for (let i = 1; i < ramp.length; i++) expect(luminance(ramp[i]!)).toBeGreaterThan(luminance(ramp[i - 1]!));
    expect(hue(ramp[0]!)).toBeGreaterThan(hue(base));
    expect(hue(ramp[4]!)).toBeLessThan(hue(base));
  });

  it('colorHarmony rotates hues around the colour wheel', () => {
    const [a, b] = colorHarmony('#ff0000', 'complementary');
    expect(parseColor(a!)).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor(b!)).toEqual({ r: 0, g: 255, b: 255, a: 1 });
    expect(colorHarmony('#ff0000', 'triadic').map(hue).map(Math.round)).toEqual([0, 120, 240]);
    expect(colorHarmony('#3fa7f5', 'analogous', { count: 5 })).toHaveLength(5);
    expect(colorHarmony('#3fa7f5', 'monochrome', { count: 4 })).toHaveLength(4);
  });

  it('derives semantic roles from palette colours', () => {
    for (const name of ['pico8', 'sweetie16', 'sunny'] as const) {
      const roles = paletteRoles(name);
      expect(Object.keys(roles).sort()).toEqual(
        ['accent', 'background', 'danger', 'highlight', 'outline', 'primary', 'secondary', 'shadow', 'success', 'surface', 'text', 'warning'],
      );
      expect(contrastRatio(roles.text, roles.background), name).toBeGreaterThan(4.5);
    }
    expect(nearestColor('#fe0101', 'pico8')).toBe('#ff004d');
  });
});

describe('pixel sprites', () => {
  const pal = { r: '#ff0000', b: '#0000ff' };

  it('bakes crisp cells at the given scale with transparent "." and " "', () => {
    const tex = pixelSprite(['r.b', 'bbr', 'r r'], pal, { scale: 4 });
    expect([tex.width, tex.height]).toEqual([12, 12]);
    expect(pixel(tex, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(tex, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(pixel(tex, 4, 3)[3]).toBe(0);
    expect(pixel(tex, 7, 0)[3]).toBe(0);
    expect(pixel(tex, 8, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(tex, 11, 7)).toEqual([255, 0, 0, 255]);
    expect(pixel(tex, 5, 9)[3]).toBe(0);
  });

  it('adds a round or square outline, growing the sprite by one cell per side', () => {
    const round = pixelSprite(['r'], pal, { outline: '#000000', scale: 2 });
    expect([round.width, round.height]).toEqual([6, 6]);
    expect(pixel(round, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(round, 2, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(round, 0, 0)[3]).toBe(0);
    const square = pixelSprite(['r'], pal, { outline: '#000000', outlineMode: 'square' });
    expect(pixel(square, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it('mirrors half grids and accepts template strings', () => {
    expect(mirrorRows(['ab'], 'x')).toEqual(['abba']);
    expect(mirrorRows(['ab'], 'x', true)).toEqual(['aba']);
    expect(mirrorRows(['ab', 'cd'], 'y')).toEqual(['ab', 'cd', 'cd', 'ab']);
    expect(mirrorRows(['ab', 'cd'], 'y', true)).toEqual(['ab', 'cd', 'ab']);
    expect(pixelGrid(['rb'], pal, { mirrorX: true }).cells).toEqual(['#ff0000', '#0000ff', '#0000ff', '#ff0000']);
    expect(pixelGrid(['rb'], pal, { mirrorX: 'odd' }).w).toBe(3);
    expect(pixelRows(`
      r.r
      .r.
    `)).toEqual(['r.r', '.r.']);
  });

  it('shades edges and rejects unknown characters', () => {
    const g = pixelGrid(['rr', 'rr', 'rr'], pal, { shade: true });
    expect(g.cells[0]).not.toBe('#ff0000');
    expect(luminance(g.cells[0]!)).toBeGreaterThan(luminance('#ff0000'));
    expect(luminance(g.cells[4]!)).toBeLessThan(luminance('#ff0000'));
    expect(() => pixelSprite(['rx'], pal)).toThrow(/"x".*not in the palette/);
  });

  it('pixelFrames pads frames to one size on a shared strip and registers keys', () => {
    const frames = pixelFrames([['rr', 'rr'], ['r']], pal, { scale: 2, key: 'test:blink' });
    expect(frames).toHaveLength(2);
    expect(frames.map((f) => [f.width, f.height])).toEqual([[4, 4], [4, 4]]);
    expect(frames[0]!.source).toBe(frames[1]!.source);
    expect(pixel(frames[1]!, 0, 0)[3]).toBe(0);
    expect(pixel(frames[1]!, 1, 3)).toEqual([255, 0, 0, 255]);
    expect(textures.get('test:blink#1')).toBe(frames[1]);
  });
});

describe('noise', () => {
  const kinds: Noise2DKind[] = ['value', 'perlin', 'simplex', 'worley'];
  const sample = (kind: Noise2DKind, seed: number) => {
    const n = makeNoise2D(kind, seed);
    const out: number[] = [];
    for (let i = 0; i < 64; i++) out.push(n(i * 0.37, i * 0.61 + 0.5));
    return out;
  };

  it('is deterministic by seed and stays in 0..1', () => {
    for (const kind of kinds) {
      const a = sample(kind, 42);
      expect(sample(kind, 42), kind).toEqual(a);
      expect(sample(kind, 43), kind).not.toEqual(a);
      for (const v of a) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('tiles lattice noises and fbm with integer periods', () => {
    for (const kind of ['value', 'perlin', 'worley'] as const) {
      const n = makeNoise2D(kind, 5);
      for (const [x, y] of [[0.3, 0.7], [2.5, 6.1], [7.9, 3.3]] as const) {
        expect(n(x + 8, y, 8, 8), kind).toBeCloseTo(n(x, y, 8, 8), 9);
        expect(n(x, y + 8, 8, 8), kind).toBeCloseTo(n(x, y, 8, 8), 9);
      }
    }
    const p = makeNoise2D('perlin', 9);
    const o = { octaves: 4, periodX: 4, periodY: 4 };
    expect(fbmNoise(p, 4.3, 1.2, o)).toBeCloseTo(fbmNoise(p, 0.3, 1.2, o), 9);
  });

  it('noiseTexture and seeded patterns bake identical pixels for identical seeds', () => {
    const opts = { scale: 8, octaves: 3, seed: 11, ramp: 'ocean' as const };
    const a = texturePixels(noiseTexture(32, 32, opts)).data;
    expect(texturePixels(noiseTexture(32, 32, opts)).data).toEqual(a);
    expect(texturePixels(noiseTexture(32, 32, { ...opts, seed: 12 })).data).not.toEqual(a);
    const g = texturePixels(patternTexture('grass', { width: 32, height: 32, seed: 3 })).data;
    expect(texturePixels(patternTexture('grass', { width: 32, height: 32, seed: 3 })).data).toEqual(g);
  });

  it('bakes every pattern at the requested size', () => {
    for (const name of patternNames) {
      const t = patternTexture(name, { width: 48, height: 32 });
      expect([t.width, t.height], name).toEqual([48, 32]);
      expect(coverage(t), name).toBeGreaterThan(0.2);
    }
  });
});

describe('TextureAtlas', () => {
  it('packs many entries without overlap, clipped to their cells, and registers them', () => {
    const pad = 2;
    const atlas = new TextureAtlas({ width: 256, height: 256, padding: pad });
    const rng = new Rng(7);
    const n = 80;
    for (let i = 0; i < n; i++) {
      const r = (i * 29) & 255;
      atlas.add(`test-atlas:${i}`, rng.int(8, 60), rng.int(8, 60), (ctx, w, h) => {
        ctx.fillStyle = `rgb(${r}, 128, 64)`;
        ctx.fillRect(-20, -20, w + 40, h + 40);
      });
    }
    const list = atlas.list();
    expect(list).toHaveLength(n);
    expect(atlas.pages.length).toBeGreaterThanOrEqual(2);
    expect(atlas.occupancy).toBeGreaterThan(0.3);
    expect(atlas.occupancy).toBeLessThan(1);
    for (const e of list) {
      expect(e.x).toBeGreaterThanOrEqual(pad);
      expect(e.y).toBeGreaterThanOrEqual(pad);
      expect(e.x + e.w + pad).toBeLessThanOrEqual(256);
      expect(e.y + e.h + pad).toBeLessThanOrEqual(256);
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.page !== b.page) continue;
        const apart =
          a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y;
        expect(apart, `${a.key} overlaps ${b.key}`).toBe(true);
      }
    }
    list.forEach((e, i) => {
      const tex = atlas.get(e.key);
      expect(textures.get(e.key)).toBe(tex);
      expect(tex.source).toBe(atlas.pages[e.page]);
      expect(tex.frame).toEqual({ x: e.x, y: e.y, w: e.w, h: e.h });
      expect(pixel(tex, Math.floor(e.w / 2), Math.floor(e.h / 2))[0]).toBe((i * 29) & 255);
      expect(pixel(tex, -1, Math.floor(e.h / 2))[3]).toBe(0);
    });
  });

  it('rejects duplicate keys and oversized entries; scales with resolution', () => {
    const atlas = new TextureAtlas({ width: 64, height: 64, resolution: 2, register: false });
    const t = atlas.add('a', 10, 12, () => {});
    expect([t.width, t.height]).toEqual([10, 12]);
    expect(atlas.pages[0]!.width).toBe(128);
    expect(textures.has('a')).toBe(false);
    expect(() => atlas.add('a', 4, 4, () => {})).toThrow(/already/);
    expect(() => atlas.add('big', 70, 10, () => {})).toThrow(/does not fit/);
  });
});

describe('icons', () => {
  const required = [
    'play', 'pause', 'stop', 'settings', 'home', 'back', 'close', 'check', 'plus', 'minus', 'restart',
    'sound-on', 'sound-off', 'music', 'music-off', 'vibrate', 'star', 'star-outline', 'heart', 'heart-outline',
    'lock', 'unlock', 'coin', 'gem', 'trophy', 'crown', 'share', 'video-ad', 'gift', 'info', 'question',
    'warning', 'menu', 'shop', 'user', 'clock', 'lightning', 'fire', 'shield', 'hint',
  ];

  it('covers the required set', () => {
    expect(iconNames.length).toBeGreaterThanOrEqual(40);
    for (const name of required) expect(iconNames, name).toContain(name);
  });

  it('every icon parses cleanly and draws a visible, non-solid glyph', () => {
    for (const name of iconNames) {
      expect(parseSvg(iconSvg(name)).warnings, name).toEqual([]);
      const c = coverage(iconTexture(name, { size: 32 }));
      expect(c, name).toBeGreaterThan(0.04);
      expect(c, name).toBeLessThan(0.85);
    }
  });

  it('registerIcons fills the registry as icon:<name>', () => {
    const keys = registerIcons({ size: 40 });
    expect(keys).toEqual(iconNames.map((n) => `icon:${n}`));
    const coin = textures.get('icon:coin');
    expect([coin.width, coin.height]).toEqual([40, 40]);
    expect(iconTexture('coin', { size: 40 })).toBe(coin);
  });
});

describe('shapes, creatures, effects', () => {
  it('bakes every shape recipe', () => {
    for (const name of artShapes) {
      const t = shapeTexture(name, { size: 48, stroke: 'auto', shine: true, shadow: true });
      expect([t.width, t.height], name).toEqual([48, 48]);
      expect(coverage(t), name).toBeGreaterThan(0.08);
    }
  });

  it('creatures are deterministic by seed; frames share one size', () => {
    const a = texturePixels(creatureTexture({ seed: 4, size: 64 })).data;
    expect(texturePixels(creatureTexture({ seed: 4, size: 64 })).data).toEqual(a);
    expect(texturePixels(creatureTexture({ seed: 5, size: 64 })).data).not.toEqual(a);
    const frames = creatureFrames({ seed: 4, size: 64 }, 'squash', 6);
    expect(frames).toHaveLength(6);
    for (const f of frames) expect([f.width, f.height]).toEqual([64, 64]);
  });

  it('silhouette, recolor, flip and outline transform pixels as documented', () => {
    const src = pixelSprite(['rb.'], { r: '#ff0000', b: '#0000ff' }, { scale: 2 });
    const sil = silhouetteTexture(src, '#00ff00');
    expect(pixel(sil, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(pixel(sil, 5, 0)[3]).toBe(0);
    const swap = recolorTexture(src, { '#ff0000': '#ffff00' });
    expect(pixel(swap, 0, 0)).toEqual([255, 255, 0, 255]);
    expect(pixel(swap, 2, 0)).toEqual([0, 0, 255, 255]);
    const flip = flipTexture(src, 'x');
    expect(pixel(flip, 0, 0)[3]).toBe(0);
    expect(pixel(flip, 5, 0)).toEqual([255, 0, 0, 255]);
    const out = outlineTexture(src, { width: 2, color: '#000000' });
    expect([out.width, out.height]).toEqual([src.width + 4, src.height + 4]);
    expect(pixel(out, 1, 3)).toEqual([0, 0, 0, 255]);
  });
});
