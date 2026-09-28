import { clamp, clamp01 } from './math';

/** Any CSS color string accepted by canvas: '#rgb', '#rrggbb', '#rrggbbaa', 'rgb()', 'rgba()', 'hsl()', 'hsla()', named. */
export type Color = string;

/** r, g, b in 0..255, a in 0..1. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  transparent: '#0000',
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  silver: '#c0c0c0',
  navy: '#000080',
  teal: '#008080',
};

const cache = new Map<string, RGBA>();
const PARSE_CACHE_MAX = 2048;

/** Cached parse result: shared, never mutate it. */
function parsed(input: Color): RGBA {
  const hit = cache.get(input);
  if (hit) return hit;
  const out = parseUncached(input.trim().toLowerCase());
  if (cache.size >= PARSE_CACHE_MAX) cache.clear();
  cache.set(input, out);
  return out;
}

export function parseColor(input: Color): RGBA {
  const p = parsed(input);
  return { r: p.r, g: p.g, b: p.b, a: p.a };
}

function parseUncached(s: string): RGBA {
  const named = NAMED[s];
  if (named) s = named;
  if (s.startsWith('#')) {
    const h = s.slice(1);
    const v = (i: number, n: number) => parseInt(h.slice(i, i + n), 16);
    if (h.length === 3 || h.length === 4) {
      return {
        r: v(0, 1) * 17,
        g: v(1, 1) * 17,
        b: v(2, 1) * 17,
        a: h.length === 4 ? (v(3, 1) * 17) / 255 : 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return { r: v(0, 2), g: v(2, 2), b: v(4, 2), a: h.length === 8 ? v(6, 2) / 255 : 1 };
    }
  }
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (m) {
    const parts = m[2]!.split(/[\s,/]+/).filter(Boolean);
    const num = (p: string | undefined, scale: number) =>
      p === undefined ? undefined : p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p);
    if (m[1]!.startsWith('rgb')) {
      return {
        r: clamp(num(parts[0], 255) ?? 0, 0, 255),
        g: clamp(num(parts[1], 255) ?? 0, 0, 255),
        b: clamp(num(parts[2], 255) ?? 0, 0, 255),
        a: clamp01(num(parts[3], 1) ?? 1),
      };
    }
    const hsl = hslToRgb(parseFloat(parts[0] ?? '0'), num(parts[1], 1) ?? 0, num(parts[2], 1) ?? 0);
    return { ...hsl, a: clamp01(num(parts[3], 1) ?? 1) };
  }
  throw new Error(`parseColor: unsupported color "${s}"`);
}

// Direct-mapped cache of toCss() strings keyed by the rounded channels and the alpha in thousandths (1001 = opaque),
// so animated colours (tweens) reuse strings instead of building one per frame. Bounded: collisions overwrite.
const CSS_SLOTS = 4096;
const cssRgb = new Int32Array(CSS_SLOTS).fill(-1);
const cssAlpha = new Int16Array(CSS_SLOTS);
const cssText: string[] = new Array<string>(CSS_SLOTS).fill('');
const HEX2: readonly string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** '#rrggbb' when opaque, else 'rgba(r,g,b,a)' with a rounded to 3 decimals. Doesn't keep `c`. */
export function toCss(c: RGBA): Color {
  const r = Math.round(clamp(c.r, 0, 255));
  const g = Math.round(clamp(c.g, 0, 255));
  const b = Math.round(clamp(c.b, 0, 255));
  const opaque = c.a >= 1;
  const x = opaque ? 0 : clamp01(c.a) * 1000;
  const q = opaque ? 1001 : Math.round(x);
  // NaN channels, and products landing exactly on .5 (toFixed rounds the exact value, which may lie below): uncached.
  if (!(r + g + b + q >= 0) || x - Math.floor(x) === 0.5) return cssUncached(r, g, b, c.a);
  const rgb = (r << 16) | (g << 8) | b;
  const slot = (rgb ^ (rgb >>> 11) ^ (q * 2531)) & (CSS_SLOTS - 1);
  if (cssRgb[slot] === rgb && cssAlpha[slot] === q) return cssText[slot]!;
  const s = opaque ? '#' + HEX2[r] + HEX2[g] + HEX2[b] : `rgba(${r},${g},${b},${q / 1000})`;
  cssRgb[slot] = rgb;
  cssAlpha[slot] = q;
  cssText[slot] = s;
  return s;
}

function cssUncached(r: number, g: number, b: number, a: number): Color {
  if (a >= 1) return '#' + hex2(r) + hex2(g) + hex2(b);
  return `rgba(${r},${g},${b},${+clamp01(a).toFixed(3)})`;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

const scratch: RGBA = { r: 0, g: 0, b: 0, a: 1 };

function scratchCss(r: number, g: number, b: number, a: number): Color {
  scratch.r = r;
  scratch.g = g;
  scratch.b = b;
  scratch.a = a;
  return toCss(scratch);
}

/** h in degrees, s/l in 0..1. Returns r,g,b in 0..255. */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = (((h % 360) + 360) % 360) / 360;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

/** Returns h in degrees, s/l in 0..1. */
export function rgbToHsl(c: RGBA): { h: number; s: number; l: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export const rgb = (r: number, g: number, b: number, a = 1): Color => scratchCss(r, g, b, a);
export const hsl = (h: number, s: number, l: number, a = 1): Color => {
  const c = hslToRgb(h, s, l);
  return scratchCss(c.r, c.g, c.b, a);
};

export function mix(a: Color, b: Color, t: number): Color {
  const x = parsed(a);
  const y = parsed(b);
  return scratchCss(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t, x.a + (y.a - x.a) * t);
}

export const lighten = (c: Color, amount: number): Color => adjustHsl(c, 0, 0, amount);
export const darken = (c: Color, amount: number): Color => adjustHsl(c, 0, 0, -amount);
export const saturate = (c: Color, amount: number): Color => adjustHsl(c, 0, amount, 0);

export function adjustHsl(c: Color, dh: number, ds: number, dl: number): Color {
  const p = parsed(c);
  const { h, s, l } = rgbToHsl(p);
  const q = hslToRgb(h + dh, clamp01(s + ds), clamp01(l + dl));
  return scratchCss(q.r, q.g, q.b, p.a);
}

export function withAlpha(c: Color, a: number): Color {
  const p = parsed(c);
  return scratchCss(p.r, p.g, p.b, a);
}

/** WCAG relative luminance, 0..1. */
export function luminance(c: Color): number {
  const p = parsed(c);
  const ch = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(p.r) + 0.7152 * ch(p.g) + 0.0722 * ch(p.b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: Color, b: Color): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
