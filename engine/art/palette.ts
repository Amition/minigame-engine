import { hslToRgb, luminance, mix, parseColor, rgbToHsl, toCss, type Color } from '../core/color';
import { clamp01 } from '../core/math';

/** Curated palettes. Retro sets keep their canonical order; the others run roughly dark → light. */
export const palettes = {
  pico8: [
    '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
    '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  ],
  sweetie16: [
    '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
    '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
  ],
  endesga32: [
    '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
    '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
    '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
    '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569',
  ],
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  grayscale: ['#000000', '#242424', '#494949', '#6d6d6d', '#929292', '#b6b6b6', '#dbdbdb', '#ffffff'],
  pastel: ['#6d6875', '#b5838d', '#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#fffcf5'],
  candy: ['#3d1a4d', '#8e3b8f', '#ff4f8b', '#ff8fb8', '#ffc2d6', '#ffe45e', '#7be0ad', '#4cc9f0', '#b69cff', '#fff4fa'],
  forest: ['#16241b', '#243b27', '#35562f', '#4f7a38', '#79a04a', '#b5cf6b', '#5a3d2b', '#8a5f3c', '#c29a62', '#efe3c0'],
  ocean: ['#051937', '#0a2f5c', '#0b4f8a', '#0077b6', '#0096c7', '#00b4d8', '#48cae4', '#90e0ef', '#caf0f8', '#f6fbff'],
  desert: ['#3b2621', '#6e3b2a', '#a0522d', '#c97b3e', '#e0a458', '#f2cc8f', '#f7e4bc', '#8f9d5b', '#5d7a5f', '#7fb7be'],
  neon: ['#0b0221', '#241050', '#ff2a6d', '#ff6ec7', '#b967ff', '#05d9e8', '#01ffc3', '#fffb00', '#ff9e00', '#e8fbff'],
  /** Bright, friendly casual-game set: ink outline, sky, grass, sun, berry. */
  sunny: ['#1f2440', '#35508f', '#3fa7f5', '#8fdcff', '#3fbf6f', '#9be15d', '#ffd23f', '#ff9f1c', '#ff5d73', '#b57bff', '#fff7e6'],
  /** Saturated match-3 "jelly" set. */
  jelly: ['#2a1b4a', '#5b2a86', '#ff3864', '#ff7aa2', '#ffb400', '#ffe066', '#2ec4b6', '#1b98e0', '#7b5cff', '#fdf6ff'],
  /** Warm, soft cosy-game set. */
  cozy: ['#3a2e39', '#6b4e5c', '#b0735f', '#e07a5f', '#f2cc8f', '#f4e9cd', '#81b29a', '#4f7c6e', '#3d5a80', '#98c1d9'],
} satisfies Record<string, readonly Color[]>;

export type PaletteName = keyof typeof palettes;

/** Semantic colour roles, e.g. for UI tinting or picking sprite colours by meaning. */
export interface PaletteRoles {
  background: Color;
  surface: Color;
  outline: Color;
  text: Color;
  primary: Color;
  secondary: Color;
  accent: Color;
  success: Color;
  warning: Color;
  danger: Color;
  highlight: Color;
  shadow: Color;
}

const CURATED_ROLES: Partial<Record<PaletteName, PaletteRoles>> = {
  sunny: {
    background: '#8fdcff', surface: '#fff7e6', outline: '#1f2440', text: '#1f2440',
    primary: '#3fa7f5', secondary: '#ff9f1c', accent: '#ffd23f',
    success: '#3fbf6f', warning: '#ffd23f', danger: '#ff5d73', highlight: '#ffffff', shadow: '#35508f',
  },
  jelly: {
    background: '#2a1b4a', surface: '#5b2a86', outline: '#2a1b4a', text: '#fdf6ff',
    primary: '#ff3864', secondary: '#1b98e0', accent: '#ffb400',
    success: '#2ec4b6', warning: '#ffe066', danger: '#ff3864', highlight: '#fdf6ff', shadow: '#2a1b4a',
  },
  cozy: {
    background: '#f4e9cd', surface: '#f2cc8f', outline: '#3a2e39', text: '#3a2e39',
    primary: '#e07a5f', secondary: '#81b29a', accent: '#3d5a80',
    success: '#81b29a', warning: '#f2cc8f', danger: '#b0735f', highlight: '#fffaf0', shadow: '#6b4e5c',
  },
};

/** Resolves a palette name or passes a colour list through. */
export function paletteColors(p: PaletteName | readonly Color[]): readonly Color[] {
  if (typeof p !== 'string') return p;
  const colors = (palettes as Record<string, readonly Color[]>)[p];
  if (!colors) throw new Error(`unknown palette "${p}" (have: ${Object.keys(palettes).join(', ')})`);
  return colors;
}

/**
 * Maps single characters to palette colours for `pixelSprite`: index 0 → '0' … 9 → '9', 10 → 'a' …
 * (so pico8 uses its conventional hex digits). Pass `keys` to choose your own characters.
 */
export function paletteMap(
  p: PaletteName | readonly Color[],
  keys = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
): Record<string, Color> {
  const colors = paletteColors(p);
  const out: Record<string, Color> = {};
  for (let i = 0; i < colors.length && i < keys.length; i++) out[keys[i]!] = colors[i]!;
  return out;
}

/** Palette colour closest to `c` (weighted RGB distance). */
export function nearestColor(c: Color, p: PaletteName | readonly Color[]): Color {
  const a = parseColor(c);
  let best = '';
  let bestD = Infinity;
  for (const col of paletteColors(p)) {
    const b = parseColor(col);
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bestD) {
      bestD = d;
      best = col;
    }
  }
  return best;
}

/** Interpolates along a list of colours, t in 0..1. */
export function rampColor(ramp: readonly Color[], t: number): Color {
  if (ramp.length === 0) return '#000000';
  if (ramp.length === 1) return ramp[0]!;
  const x = clamp01(t) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  return mix(ramp[i]!, ramp[i + 1]!, x - i);
}

const SHADOW_HUE = 245;
const LIGHT_HUE = 55;

function towardHue(h: number, target: number, maxShift: number): number {
  const d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), maxShift);
}

function shadeHsl(c: Color, t: number, hueShift: number, range: number): Color {
  const p = parseColor(c);
  let { h, s, l } = rgbToHsl(p);
  const k = Math.abs(t);
  if (s < 0.06) {
    h = t < 0 ? 225 : 45;
    s = s + 0.1 * k;
  } else {
    h = towardHue(h, t < 0 ? SHADOW_HUE : LIGHT_HUE, hueShift * k);
    s = clamp01(t < 0 ? s + 0.08 * k : s - 0.12 * k);
  }
  if (t < 0) l = l + (Math.max(0.04, l - range) - l) * k;
  else l = l + Math.min(range, Math.max(0, 0.95 - l) * 0.78) * k;
  return toCss({ ...hslToRgb(h, s, l), a: p.a });
}

/**
 * One hue-shifted shade of `c`: amount < 0 gives a cooler, darker shadow; > 0 a warmer, lighter highlight.
 * amount is in -1..1 (±1 = a full `range` of lightness, default 0.35).
 */
export function hueShade(c: Color, amount: number, opts: { hueShift?: number; range?: number } = {}): Color {
  if (amount === 0) return c;
  return shadeHsl(c, Math.max(-1, Math.min(1, amount)), opts.hueShift ?? 22, opts.range ?? 0.35);
}

/**
 * Pixel-art style shade ramp, darkest → lightest, with `base` in the middle (exact for odd `steps`).
 * Shadows drift toward blue/violet and gain saturation; highlights drift toward warm yellow.
 */
export function colorRamp(
  base: Color,
  steps = 5,
  opts: { hueShift?: number; range?: number } = {},
): Color[] {
  const n = Math.max(1, Math.floor(steps));
  if (n === 1) return [base];
  const out: Color[] = [];
  for (let i = 0; i < n; i++) {
    const t = -1 + (2 * i) / (n - 1);
    out.push(Math.abs(t) < 1e-9 ? toCss(parseColor(base)) : hueShade(base, t, opts));
  }
  return out;
}

export type ColorHarmonyKind = 'complementary' | 'analogous' | 'triadic' | 'split' | 'tetradic' | 'monochrome';

/**
 * Colour-wheel harmonies around `c` (the first entry is always `c`):
 * complementary (2), analogous (count, ±spread°), triadic (3), split complementary (3), tetradic (4),
 * monochrome (count lightness steps).
 */
export function colorHarmony(c: Color, kind: ColorHarmonyKind, opts: { count?: number; spread?: number } = {}): Color[] {
  const p = parseColor(c);
  const { h, s, l } = rgbToHsl(p);
  const at = (dh: number, dl = 0) => toCss({ ...hslToRgb(h + dh, s, clamp01(l + dl)), a: p.a });
  const base = toCss(p);
  switch (kind) {
    case 'complementary':
      return [base, at(180)];
    case 'triadic':
      return [base, at(120), at(240)];
    case 'split':
      return [base, at(150), at(210)];
    case 'tetradic':
      return [base, at(90), at(180), at(270)];
    case 'analogous': {
      const n = Math.max(2, opts.count ?? 3);
      const spread = opts.spread ?? 30;
      const out = [base];
      for (let i = 1; out.length < n; i++) {
        out.push(at(spread * Math.ceil(i / 2) * (i % 2 ? 1 : -1)));
      }
      return out;
    }
    case 'monochrome': {
      const n = Math.max(2, opts.count ?? 5);
      return [base, ...colorRamp(c, n + 1).filter((x) => x !== base).slice(0, n - 1)];
    }
  }
}

function roleByHue(hsl: { c: Color; h: number; s: number; l: number }[], hue: number, fallback: Color): Color {
  let best: Color = fallback;
  let bestScore = Infinity;
  for (const x of hsl) {
    if (x.s < 0.3 || x.l < 0.2 || x.l > 0.85) continue;
    const dh = Math.abs(((x.h - hue + 540) % 360) - 180);
    const score = dh - x.s * 20;
    if (dh < 50 && score < bestScore) {
      bestScore = score;
      best = x.c;
    }
  }
  return best;
}

/**
 * Semantic roles for a palette. The casual palettes (sunny, jelly, cozy) have hand-picked roles; others are
 * derived: darkest → outline/background, lightest → text/highlight, most saturated mid tones → primary/accent,
 * nearest green/yellow/red hues → success/warning/danger.
 */
export function paletteRoles(p: PaletteName | readonly Color[]): PaletteRoles {
  if (typeof p === 'string' && CURATED_ROLES[p]) return { ...CURATED_ROLES[p]! };
  const colors = [...paletteColors(p)];
  const byLum = [...colors].sort((a, b) => luminance(a) - luminance(b));
  const darkest = byLum[0] ?? '#000000';
  const lightest = byLum[byLum.length - 1] ?? '#ffffff';
  const hsl = colors.map((c) => ({ c, ...rgbToHsl(parseColor(c)) }));
  const vivid = hsl
    .filter((x) => x.l > 0.25 && x.l < 0.8)
    .sort((a, b) => b.s - a.s || Math.abs(a.l - 0.55) - Math.abs(b.l - 0.55));
  const primary = vivid[0]?.c ?? byLum[Math.floor(byLum.length / 2)] ?? darkest;
  const primaryHue = vivid[0]?.h ?? 0;
  const secondary =
    vivid.find((x) => Math.abs(((x.h - primaryHue + 540) % 360) - 180) > 60)?.c ?? vivid[1]?.c ?? primary;
  const accent =
    vivid.find((x) => x.c !== primary && x.c !== secondary && x.l > 0.5)?.c ?? secondary;
  return {
    background: byLum[Math.min(1, byLum.length - 1)] ?? darkest,
    surface: byLum[Math.min(2, byLum.length - 1)] ?? darkest,
    outline: darkest,
    text: lightest,
    primary,
    secondary,
    accent,
    success: roleByHue(hsl, 130, mix(primary, '#3fbf6f', 0.7)),
    warning: roleByHue(hsl, 45, mix(primary, '#ffd23f', 0.7)),
    danger: roleByHue(hsl, 355, mix(primary, '#ff5d73', 0.7)),
    highlight: lightest,
    shadow: darkest,
  };
}
