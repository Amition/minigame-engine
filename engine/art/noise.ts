import { Rng } from '../core/rng';

/**
 * 2D noise sampler returning values in 0..1. Lattice noises (value, perlin, worley) tile when given
 * integer periods: `n(x, y, 8, 8)` repeats every 8 units.
 */
export type Noise2D = (x: number, y: number, periodX?: number, periodY?: number) => number;

export type Noise2DKind = 'value' | 'perlin' | 'simplex' | 'worley';

function permutation(seed: number | string): Uint8Array {
  const rng = new Rng(seed);
  const p = new Uint8Array(512);
  const base: number[] = [];
  for (let i = 0; i < 256; i++) base.push(i);
  rng.shuffle(base);
  for (let i = 0; i < 512; i++) p[i] = base[i & 255]!;
  return p;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const wrapI = (i: number, period?: number) => (period && period > 0 ? ((i % period) + period) % period : i);

const GRAD_X = new Float32Array(8);
const GRAD_Y = new Float32Array(8);
for (let i = 0; i < 8; i++) {
  GRAD_X[i] = Math.cos((i * Math.PI) / 4);
  GRAD_Y[i] = Math.sin((i * Math.PI) / 4);
}

function valueNoise(p: Uint8Array): Noise2D {
  const h = (ix: number, iy: number) => p[(p[ix & 255]! + (iy & 255)) & 511]! / 255;
  return (x, y, px, py) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = fade(x - x0);
    const ty = fade(y - y0);
    const ax = wrapI(x0, px);
    const bx = wrapI(x0 + 1, px);
    const ay = wrapI(y0, py);
    const by = wrapI(y0 + 1, py);
    const a = h(ax, ay) + (h(bx, ay) - h(ax, ay)) * tx;
    const b = h(ax, by) + (h(bx, by) - h(ax, by)) * tx;
    return a + (b - a) * ty;
  };
}

function perlinNoise(p: Uint8Array): Noise2D {
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const k = p[(p[ix & 255]! + (iy & 255)) & 511]! & 7;
    return GRAD_X[k]! * dx + GRAD_Y[k]! * dy;
  };
  return (x, y, px, py) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ax = wrapI(x0, px);
    const bx = wrapI(x0 + 1, px);
    const ay = wrapI(y0, py);
    const by = wrapI(y0 + 1, py);
    const u = fade(fx);
    const v = fade(fy);
    const n00 = g(ax, ay, fx, fy);
    const n10 = g(bx, ay, fx - 1, fy);
    const n01 = g(ax, by, fx, fy - 1);
    const n11 = g(bx, by, fx - 1, fy - 1);
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    const n = (a + (b - a) * v) * Math.SQRT2;
    return Math.max(0, Math.min(1, n * 0.5 + 0.5));
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

function simplexNoise(p: Uint8Array): Noise2D {
  const corner = (ix: number, iy: number, x: number, y: number) => {
    let t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    const k = p[(p[ix & 255]! + (iy & 255)) & 511]! & 7;
    t *= t;
    return t * t * (GRAD_X[k]! * x + GRAD_Y[k]! * y);
  };
  return (x, y) => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const n =
      corner(i, j, x0, y0) +
      corner(i + i1, j + j1, x0 - i1 + G2, y0 - j1 + G2) +
      corner(i + 1, j + 1, x0 - 1 + 2 * G2, y0 - 1 + 2 * G2);
    return Math.max(0, Math.min(1, 0.5 + 35 * n));
  };
}

function worleyNoise(p: Uint8Array): Noise2D {
  const h = (ix: number, iy: number, salt: number) => p[(p[(ix + salt) & 255]! + (iy & 255)) & 511]! / 255;
  return (x, y, px, py) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    let best = 9;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = x0 + ox;
        const cy = y0 + oy;
        const wx = wrapI(cx, px);
        const wy = wrapI(cy, py);
        const fx = cx + h(wx, wy, 0) - x;
        const fy = cy + h(wx, wy, 101) - y;
        const d = fx * fx + fy * fy;
        if (d < best) best = d;
      }
    }
    return Math.min(1, Math.sqrt(best));
  };
}

/**
 * Creates a seeded 2D noise function (0..1). 'perlin' (default) is smooth and tileable; 'value' is blockier;
 * 'simplex' is smooth but not tileable; 'worley' returns distance to the nearest cell point (cells, stones).
 */
export function makeNoise2D(kind: Noise2DKind = 'perlin', seed: number | string = 0): Noise2D {
  const p = permutation(seed);
  switch (kind) {
    case 'value':
      return valueNoise(p);
    case 'simplex':
      return simplexNoise(p);
    case 'worley':
      return worleyNoise(p);
    default:
      return perlinNoise(p);
  }
}

export interface FbmOptions {
  /** Layers of detail (default 4). */
  octaves?: number;
  /** Frequency multiplier per octave (default 2; keep an integer for tiling). */
  lacunarity?: number;
  /** Amplitude multiplier per octave (default 0.5). */
  gain?: number;
  /** 'fbm' (default), 'ridged' (sharp crests: mountains, marble) or 'turbulence' (billowy: fire, clouds). */
  mode?: 'fbm' | 'ridged' | 'turbulence';
  /** Tiling period of the first octave in noise units (later octaves scale with lacunarity). */
  periodX?: number;
  periodY?: number;
}

/** Fractal sum of `noise` octaves at (x, y), normalized to 0..1. */
export function fbmNoise(noise: Noise2D, x: number, y: number, opts: FbmOptions = {}): number {
  const octaves = Math.max(1, Math.floor(opts.octaves ?? 4));
  const lac = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  const mode = opts.mode ?? 'fbm';
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const px = opts.periodX ? Math.round(opts.periodX * freq) : undefined;
    const py = opts.periodY ? Math.round(opts.periodY * freq) : undefined;
    let n = noise(x * freq + o * 17, y * freq + o * 31, px, py);
    if (mode === 'ridged') n = 1 - Math.abs(n * 2 - 1);
    else if (mode === 'turbulence') n = Math.abs(n * 2 - 1);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}
