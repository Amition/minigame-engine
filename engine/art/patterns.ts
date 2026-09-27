import { parseColor, type Color } from '../core/color';
import { Rng } from '../core/rng';
import { bakeTexture, type Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { Ctx2D } from '../gfx/types';
import { fbmNoise, makeNoise2D, type FbmOptions, type Noise2DKind } from './noise';
import { paletteColors, type PaletteName } from './palette';

type Lut = Uint8ClampedArray;

/** 256-entry RGBA lookup along a colour ramp; `steps` posterizes into flat bands. */
function buildLut(ramp: readonly Color[], steps = 0): Lut {
  const cols = (ramp.length ? ramp : ['#000000', '#ffffff']).map((c) => parseColor(c));
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    let t = i / 255;
    if (steps > 1) t = Math.min(steps - 1, Math.floor(t * steps)) / (steps - 1);
    const x = t * (cols.length - 1);
    const k = Math.min(cols.length - 2, Math.floor(x));
    const a = cols[Math.max(0, k)]!;
    const b = cols[Math.min(cols.length - 1, k + 1)]!;
    const f = cols.length === 1 ? 0 : x - k;
    lut[i * 4] = a.r + (b.r - a.r) * f;
    lut[i * 4 + 1] = a.g + (b.g - a.g) * f;
    lut[i * 4 + 2] = a.b + (b.b - a.b) * f;
    lut[i * 4 + 3] = (a.a + (b.a - a.a) * f) * 255;
  }
  return lut;
}

function putLut(data: Uint8ClampedArray, i: number, lut: Lut, t: number): void {
  const k = Math.max(0, Math.min(255, Math.round(t * 255))) * 4;
  data[i] = lut[k]!;
  data[i + 1] = lut[k + 1]!;
  data[i + 2] = lut[k + 2]!;
  data[i + 3] = lut[k + 3]!;
}

function rgba(c: Color): [number, number, number, number] {
  const p = parseColor(c);
  return [p.r, p.g, p.b, Math.round(p.a * 255)];
}

/** Bakes a texture by writing pixels directly. `fn` gets the RGBA buffer and pixel size. */
function bakePixels(
  w: number,
  h: number,
  res: number,
  fn: (data: Uint8ClampedArray, pw: number, ph: number, ctx: Ctx2D) => void,
): Texture {
  return bakeTexture(
    w,
    h,
    (ctx) => {
      const pw = Math.max(1, Math.ceil(w * res));
      const ph = Math.max(1, Math.ceil(h * res));
      const img = ctx.getImageData(0, 0, pw, ph);
      fn(img.data, pw, ph, ctx);
      ctx.putImageData(img, 0, 0);
    },
    { resolution: res },
  );
}

const ramp = (r: readonly Color[] | PaletteName | undefined, def: readonly Color[]) =>
  r === undefined ? def : typeof r === 'string' ? paletteColors(r) : r;

export interface NoiseTextureOptions {
  kind?: Noise2DKind;
  seed?: number | string;
  /** Feature size in logical px (default 32). */
  scale?: number;
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  mode?: FbmOptions['mode'];
  /** Colours mapped from low to high noise, or a palette name. Default black → white. */
  ramp?: readonly Color[] | PaletteName;
  /** Posterize into this many flat bands (casual/cel look). */
  steps?: number;
  /** Seamless in both directions (perlin/value/worley; the feature size is rounded to fit). */
  tileable?: boolean;
  /** Stretch the value range to the full ramp (default true). */
  normalize?: boolean;
  resolution?: number;
  key?: string;
}

/**
 * Noise mapped through a colour ramp.
 *
 *     noiseTexture(128, 128, { scale: 32, octaves: 4, seed: 7, ramp: ['#1b6fd1', '#6cc8ff'], tileable: true });
 */
export function noiseTexture(width: number, height: number, opts: NoiseTextureOptions = {}): Texture {
  const res = opts.resolution ?? 1;
  const scale = opts.scale ?? 32;
  const noise = makeNoise2D(opts.kind ?? 'perlin', opts.seed ?? 0);
  const lut = buildLut(ramp(opts.ramp, ['#000000', '#ffffff']), opts.steps ?? 0);
  const tile = !!opts.tileable && opts.kind !== 'simplex';
  const periodX = tile ? Math.max(1, Math.round(width / scale)) : 0;
  const periodY = tile ? Math.max(1, Math.round(height / scale)) : 0;
  const fx = tile ? periodX / width : 1 / scale;
  const fy = tile ? periodY / height : 1 / scale;
  const fo: FbmOptions = { octaves: opts.octaves ?? 4, lacunarity: opts.lacunarity ?? 2, gain: opts.gain ?? 0.5 };
  if (opts.mode) fo.mode = opts.mode;
  if (tile) {
    fo.periodX = periodX;
    fo.periodY = periodY;
    fo.lacunarity = Math.max(1, Math.round(fo.lacunarity!));
  }
  const tex = bakePixels(width, height, res, (data, pw, ph) => {
    const vals = new Float32Array(pw * ph);
    let min = Infinity;
    let max = -Infinity;
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const v = fbmNoise(noise, ((x + 0.5) / res) * fx, ((y + 0.5) / res) * fy, fo);
        vals[y * pw + x] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const norm = opts.normalize !== false && max > min;
    for (let i = 0; i < vals.length; i++) {
      const v = norm ? (vals[i]! - min) / (max - min) : vals[i]!;
      putLut(data, i * 4, lut, v);
    }
  });
  if (opts.key) textures.set(opts.key, tex);
  return tex;
}

export type PatternName =
  | 'checker' | 'stripes' | 'dots' | 'grass' | 'water' | 'wood' | 'stone' | 'bricks' | 'sand' | 'clouds' | 'starfield' | 'sky';

export const patternNames: readonly PatternName[] = [
  'checker', 'stripes', 'dots', 'grass', 'water', 'wood', 'stone', 'bricks', 'sand', 'clouds', 'starfield', 'sky',
];

export interface PatternOptions {
  /** Logical size (default 128×128). Tileable patterns tile exactly when the size is a multiple of `size`. */
  width?: number;
  height?: number;
  /**
   * Main feature size in px: checker cell, stripe width, dot spacing, plank / brick / stone size,
   * noise scale (defaults: 16, 16, 24, 32, 16, 32, 32).
   */
  size?: number;
  /** Override the pattern's colours (see each pattern's defaults in patternDefaults). */
  colors?: readonly Color[];
  seed?: number;
  /** stripes: 0 (vertical), 45 (default), 90 (horizontal), 135; others work but do not tile. */
  angle?: number;
  resolution?: number;
  key?: string;
}

/** Default colours per pattern (documented order). */
export const patternDefaults: Record<PatternName, readonly Color[]> = {
  checker: ['#e9edf5', '#cfd6e4'],
  stripes: ['#ff5d73', '#fff7e6'],
  dots: ['#35508f', '#4a6bb8'],
  grass: ['#2f9e57', '#3fbf6f', '#6fd46a', '#a5ea7b', '#fff3a8'],
  water: ['#155fb8', '#2385e0', '#3aa6f2', '#dff6ff'],
  wood: ['#7a4a2a', '#9a6238', '#b87d4b', '#cf9a63', '#4a2a16'],
  stone: ['#6f7786', '#8a93a3', '#a7afbd', '#c4cad4', '#434956'],
  bricks: ['#b24f3a', '#c8654a', '#d9805e', '#ead9c6'],
  sand: ['#dcb06a', '#e8c283', '#f3d69f', '#b88a4a'],
  clouds: ['#ffffff', '#c9d8ee'],
  starfield: ['#0a0f2c', '#281a5c', '#ffffff', '#ffe7a3', '#9fd6ff'],
  sky: ['#3f8ff5', '#8fd0ff', '#ffe9c7'],
};

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function blend(data: Uint8ClampedArray, i: number, c: readonly number[], a: number): void {
  if (a <= 0) return;
  const k = Math.min(1, a);
  data[i] = data[i]! + (c[0]! - data[i]!) * k;
  data[i + 1] = data[i + 1]! + (c[1]! - data[i + 1]!) * k;
  data[i + 2] = data[i + 2]! + (c[2]! - data[i + 2]!) * k;
  data[i + 3] = Math.max(data[i + 3]!, c[3]! * k);
}

/** Tileable cellular noise: nearest (f1), second nearest (f2) distance and nearest cell id. */
function cellular(seed: number, cellsX: number, cellsY: number) {
  const rng = new Rng(seed);
  const jx = new Float32Array(cellsX * cellsY);
  const jy = new Float32Array(cellsX * cellsY);
  for (let i = 0; i < jx.length; i++) {
    jx[i] = rng.float(0.15, 0.85);
    jy[i] = rng.float(0.15, 0.85);
  }
  return (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = x0 + ox;
        const cy = y0 + oy;
        const wx = ((cx % cellsX) + cellsX) % cellsX;
        const wy = ((cy % cellsY) + cellsY) % cellsY;
        const k = wy * cellsX + wx;
        const dx = cx + jx[k]! - x;
        const dy = cy + jy[k]! - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = k;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return { f1, f2, id };
  };
}

/** Draws `fn(ox, oy)` at every wrapped offset so shapes crossing an edge reappear on the other side. */
function wrapped(w: number, h: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const dx of [0, -w, w]) {
    for (const dy of [0, -h, h]) {
      const px = x + dx;
      const py = y + dy;
      if (px + r < 0 || py + r < 0 || px - r > w || py - r > h) continue;
      fn(px, py);
    }
  }
}

/**
 * Procedural pattern textures, mostly seamless (for tile maps and backgrounds):
 * checker, stripes, dots, grass, water, wood (planks), stone (cobbles), bricks, sand, clouds, starfield, sky.
 *
 *     const grass = patternTexture('grass', { width: 128, height: 128, seed: 3 });
 */
export function patternTexture(name: PatternName, opts: PatternOptions = {}): Texture {
  const w = opts.width ?? 128;
  const h = opts.height ?? w;
  const res = opts.resolution ?? 1;
  const seed = opts.seed ?? 1;
  const colors = opts.colors ?? patternDefaults[name];
  if (!colors) throw new Error(`unknown pattern "${name}" (have: ${patternNames.join(', ')})`);
  const C = (i: number) => colors[Math.min(i, colors.length - 1)]!;
  const tileNoise = (sd: number, cell: number) => {
    const n = makeNoise2D('perlin', seed * 7919 + sd);
    const px = Math.max(1, Math.round(w / cell));
    const py = Math.max(1, Math.round(h / cell));
    return (x: number, y: number, octaves = 3) =>
      fbmNoise(n, (x / w) * px, (y / h) * py, { octaves, periodX: px, periodY: py });
  };
  let tex: Texture;
  switch (name) {
    case 'checker': {
      const s = opts.size ?? 16;
      tex = bakeTexture(w, h, (ctx) => {
        ctx.fillStyle = C(0);
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = C(1);
        for (let y = 0; y * s < h; y++) for (let x = 0; x * s < w; x++) if ((x + y) % 2) ctx.fillRect(x * s, y * s, s, s);
      }, { resolution: res });
      break;
    }
    case 'stripes': {
      const s = opts.size ?? 16;
      const a = opts.angle ?? 45;
      const ca = rgba(C(0));
      const cb = rgba(C(1));
      const rad = (a * Math.PI) / 180;
      const proj =
        a === 45 ? (x: number, y: number) => (x + y) / s
        : a === 135 || a === -45 ? (x: number, y: number) => (x - y) / s
        : a === 0 ? (x: number) => x / s
        : a === 90 ? (_x: number, y: number) => y / s
        : (x: number, y: number) => (x * Math.cos(rad) + y * Math.sin(rad)) / s;
      const pxPerUnit = a === 45 || a === 135 || a === -45 ? s / Math.SQRT2 : s;
      tex = bakePixels(w, h, res, (data, pw, ph) => {
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            const u = proj((x + 0.5) / res, (y + 0.5) / res);
            const fl = Math.floor(u);
            const f = u - fl;
            const own = ((fl % 2) + 2) % 2 === 0 ? ca : cb;
            const other = own === ca ? cb : ca;
            const dist = Math.min(f, 1 - f) * pxPerUnit * res;
            const wgt = Math.min(1, 0.5 + dist);
            const i = (y * pw + x) * 4;
            for (let k = 0; k < 4; k++) data[i + k] = other[k]! + (own[k]! - other[k]!) * wgt;
          }
        }
      });
      break;
    }
    case 'dots': {
      const s = opts.size ?? 24;
      const r = s * 0.22;
      tex = bakeTexture(w, h, (ctx) => {
        ctx.fillStyle = C(0);
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = C(1);
        for (let row = 0; row * s < h + s; row++) {
          for (let col = 0; col * s < w + s; col++) {
            const cx = col * s + (row % 2 ? s / 2 : 0) + s / 4;
            const cy = row * s + s / 2;
            wrapped(w, h, cx, cy, r, (px, py) => {
              ctx.beginPath();
              ctx.arc(px, py, r, 0, Math.PI * 2);
              ctx.fill();
            });
          }
        }
      }, { resolution: res });
      break;
    }
    case 'grass': {
      const n = tileNoise(1, opts.size ?? 32);
      const lut = buildLut([C(0), C(1), C(2)], 3);
      const rng = new Rng(seed);
      tex = bakePixels(w, h, res, (data, pw, ph) => {
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) putLut(data, (y * pw + x) * 4, lut, n(x / res, y / res) * 1.25 - 0.1);
        }
      });
      const ctx = (tex.source as unknown as { getContext(t: '2d'): Ctx2D }).getContext('2d');
      ctx.save();
      ctx.scale(res, res);
      ctx.lineCap = 'round';
      const blades = Math.round((w * h) / 90);
      for (let i = 0; i < blades; i++) {
        const bx = rng.float(0, w);
        const by = rng.float(0, h);
        const len = rng.float(3, 7);
        const lean = rng.float(-2, 2);
        const light = rng.chance(0.6);
        ctx.strokeStyle = light ? C(3) : C(0);
        ctx.globalAlpha = light ? 0.8 : 0.6;
        ctx.lineWidth = rng.float(1, 1.8);
        wrapped(w, h, bx, by, len + 2, (px, py) => {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + lean * 0.3, py - len * 0.6, px + lean, py - len);
          ctx.stroke();
        });
      }
      ctx.globalAlpha = 1;
      const flowers = Math.round((w * h) / 2600);
      for (let i = 0; i < flowers; i++) {
        const fx = rng.float(0, w);
        const fy = rng.float(0, h);
        wrapped(w, h, fx, fy, 3, (px, py) => {
          ctx.fillStyle = C(4);
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.arc(px + Math.cos((k * Math.PI) / 2) * 1.6, py + Math.sin((k * Math.PI) / 2) * 1.6, 1.3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#ff9f1c';
          ctx.beginPath();
          ctx.arc(px, py, 1, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      ctx.restore();
      break;
    }
    case 'water': {
      const s = opts.size ?? 48;
      const n = tileNoise(2, s);
      const n2 = tileNoise(3, s * 0.75);
      const lut = buildLut([C(0), C(1), C(2)], 4);
      const hi = rgba(C(3));
      tex = bakePixels(w, h, res, (data, pw, ph) => {
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            const lx = x / res;
            const ly = y / res;
            const i = (y * pw + x) * 4;
            putLut(data, i, lut, n(lx, ly) * 1.3 - 0.15);
            const c = Math.abs(Math.sin(n2(lx, ly, 2) * Math.PI * 7));
            blend(data, i, hi, smooth(0.93, 0.985, c) * 0.85);
          }
        }
      });
      break;
    }
    case 'wood': {
      const plank = opts.size ?? 32;
      const n = tileNoise(4, 64);
      const lut = buildLut([C(0), C(1), C(2), C(3)], 0);
      const gap = rgba(C(4));
      const rng = new Rng(seed);
      const rows = Math.max(1, Math.round(h / plank));
      const ph0 = h / rows;
      const joints = Array.from({ length: rows }, () => rng.float(0.1, 0.9) * w);
      const tones = Array.from({ length: rows }, () => rng.float(-0.12, 0.12));
      tex = bakePixels(w, h, res, (data, pw, ph) => {
        for (let y = 0; y < ph; y++) {
          const ly = y / res;
          const row = Math.min(rows - 1, Math.floor(ly / ph0));
          const inRow = ly - row * ph0;
          for (let x = 0; x < pw; x++) {
            const lx = x / res;
            const i = (y * pw + x) * 4;
            const g = n(lx * 0.5, ly * 3 + row * 13, 3);
            const ring = (g * 9 + (inRow / ph0) * 0.6) % 1;
            const t = 0.35 + tones[row]! + (ring < 0.5 ? ring : 1 - ring) * 0.9;
            putLut(data, i, lut, t);
            const jd = Math.abs(((lx - joints[row]! + w * 1.5) % w) - w / 2);
            if (inRow < 1.5 || jd > w / 2 - 1) blend(data, i, gap, 0.9);
            else if (inRow < 3) blend(data, i, [255, 240, 210, 255], 0.18);
          }
        }
      });
      break;
    }
    case 'stone': {
      const s = opts.size ?? 32;
      const cx = Math.max(1, Math.round(w / s));
      const cy = Math.max(1, Math.round(h / s));
      const cell = cellular(seed, cx, cy);
      const n = tileNoise(5, 12);
      const lut = buildLut([C(0), C(1), C(2), C(3)], 0);
      const mortar = rgba(C(4));
      const rng = new Rng(seed + 1);
      const tone = Array.from({ length: cx * cy }, () => rng.float(0.25, 0.7));
      tex = bakePixels(w, h, res, (data, pw, ph) => {
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            const lx = x / res;
            const ly = y / res;
            const c = cell((lx / w) * cx, (ly / h) * cy);
            const i = (y * pw + x) * 4;
            const edge = (c.f2 - c.f1) * s;
            const shade = tone[c.id]! + (0.5 - c.f1) * 0.5 + (n(lx, ly, 2) - 0.5) * 0.25;
            putLut(data, i, lut, shade);
            blend(data, i, mortar, 1 - smooth(1.5, 3.5, edge));
          }
        }
      });
      break;
    }
    case 'bricks': {
      const bh = opts.size ?? 16;
      const rows = Math.max(1, Math.round(h / bh));
      const rh = h / rows;
      const cols = Math.max(1, Math.round(w / (rh * 2)));
      const bw = w / cols;
      const rng = new Rng(seed);
      const tones = Array.from({ length: rows * cols }, () => rng.int(0, 2));
      const n = tileNoise(6, 8);
      const mortar = rgba(C(3));
      tex = bakePixels(w, h, res, (data, pw, ph) => {
        const cs = [rgba(C(0)), rgba(C(1)), rgba(C(2))];
        for (let y = 0; y < ph; y++) {
          const ly = y / res;
          const row = Math.min(rows - 1, Math.floor(ly / rh));
          const iy = ly - row * rh;
          for (let x = 0; x < pw; x++) {
            const lx = x / res;
            const sx = (lx + (row % 2 ? bw / 2 : 0)) % w;
            const col = Math.min(cols - 1, Math.floor(sx / bw));
            const ix = sx - col * bw;
            const i = (y * pw + x) * 4;
            const base = cs[tones[row * cols + col]!]!;
            const v = (n(lx, ly, 2) - 0.5) * 40;
            data[i] = base[0]! + v;
            data[i + 1] = base[1]! + v;
            data[i + 2] = base[2]! + v;
            data[i + 3] = 255;
            if (iy < 1.6 || ix < 1.6) blend(data, i, mortar, 1);
            else if (iy < 3.2) blend(data, i, [255, 255, 255, 255], 0.16);
            else if (iy > rh - 2.4) blend(data, i, [60, 20, 20, 255], 0.18);
          }
        }
      });
      break;
    }
    case 'sand': {
      const n = tileNoise(7, opts.size ?? 32);
      const lut = buildLut([C(0), C(1), C(2)], 3);
      const speck = rgba(C(3));
      const rng = new Rng(seed);
      tex = bakePixels(w, h, res, (data, pw, ph) => {
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            const lx = x / res;
            const ly = y / res;
            const i = (y * pw + x) * 4;
            const ripple = Math.sin((ly / h) * Math.PI * 2 * Math.round(h / 16) + n(lx, ly, 2) * 8) * 0.12;
            putLut(data, i, lut, n(lx, ly) * 1.2 - 0.1 + ripple);
          }
        }
        const specks = Math.round((pw * ph) / 60);
        for (let k = 0; k < specks; k++) {
          const i = (rng.int(0, ph - 1) * pw + rng.int(0, pw - 1)) * 4;
          blend(data, i, speck, rng.float(0.3, 0.7));
        }
      });
      break;
    }
    case 'clouds': {
      const n = tileNoise(8, opts.size ?? 48);
      const top = rgba(C(0));
      const shadow = rgba(C(1));
      tex = bakePixels(w, h, res, (data, pw, ph) => {
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            const lx = x / res;
            const ly = y / res;
            const v = n(lx, ly, 5);
            const a = smooth(0.5, 0.62, v);
            if (a <= 0) continue;
            const below = n(lx, ly - 3, 5);
            const sh = smooth(0.0, 0.12, v - below + 0.04);
            const i = (y * pw + x) * 4;
            for (let k = 0; k < 3; k++) data[i + k] = shadow[k]! + (top[k]! - shadow[k]!) * sh;
            data[i + 3] = a * 255;
          }
        }
      });
      break;
    }
    case 'starfield': {
      const n = tileNoise(9, 64);
      const lut = buildLut([C(0), C(0), C(1)], 0);
      const rng = new Rng(seed);
      tex = bakePixels(w, h, res, (data, pw, ph) => {
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) putLut(data, (y * pw + x) * 4, lut, n(x / res, y / res, 4) * 1.4 - 0.3);
        }
      });
      const ctx = (tex.source as unknown as { getContext(t: '2d'): Ctx2D }).getContext('2d');
      ctx.save();
      ctx.scale(res, res);
      const stars = Math.round((w * h) / 220);
      for (let i = 0; i < stars; i++) {
        const sx = rng.float(0, w);
        const sy = rng.float(0, h);
        const roll = rng.next();
        ctx.fillStyle = rng.pick([C(2), C(2), C(3), C(4)]);
        if (roll < 0.9) {
          ctx.globalAlpha = rng.float(0.35, 1);
          const r = roll < 0.7 ? 0.6 : 1;
          ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
        } else {
          ctx.globalAlpha = 1;
          const r = rng.float(2.5, 4.5);
          wrapped(w, h, sx, sy, r, (px, py) => {
            ctx.beginPath();
            ctx.moveTo(px, py - r);
            ctx.quadraticCurveTo(px, py, px + r, py);
            ctx.quadraticCurveTo(px, py, px, py + r);
            ctx.quadraticCurveTo(px, py, px - r, py);
            ctx.quadraticCurveTo(px, py, px, py - r);
            ctx.fill();
          });
        }
      }
      ctx.restore();
      break;
    }
    case 'sky': {
      tex = bakeTexture(w, h, (ctx) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        colors.forEach((c, i) => g.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }, { resolution: res });
      break;
    }
    default:
      throw new Error(`unknown pattern "${String(name)}" (have: ${patternNames.join(', ')})`);
  }
  if (opts.key) textures.set(opts.key, tex);
  return tex;
}
