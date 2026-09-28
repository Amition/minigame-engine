import { parseColor, toCss, type Color } from '../core/color';
import { platform } from '../platform/current';
import { bakeTexture, releaseTexture, resolveTextureResolution, ScaledTexture, Texture, type TextureResolution } from './texture';
import { textures } from './textures';
import type { Surface } from './types';

/** 'multiply': the texture's colours times the tint (white becomes the tint, shading kept). 'fill': flat silhouette. */
export type TintMode = 'multiply' | 'fill';

/** How a tint is baked: canvas composite operations, or a getImageData loop (exact on soft edges, reads pixels back). */
export type TintBakeMethod = 'composite' | 'pixels';

export interface TintTextureOptions {
  /** Default 'multiply'. */
  mode?: TintMode;
  /** Strength 0..1 (default 1): multiply fades from the original to the full product, fill paints at this opacity. */
  amount?: number;
  /** Backing resolution of the result. Default: the source's own, so a tint never holds more pixels than its source. */
  resolution?: TextureResolution;
  /** Default 'auto': composite where the runtime implements 'multiply' (tintMultiplySupported()), else 'pixels'. */
  method?: TintBakeMethod | 'auto';
}

export interface DuotoneTextureOptions {
  /** Backing resolution of the result. Default: the source's own. */
  resolution?: TextureResolution;
}

const MULTIPLY = 0;
const FILL = 1;
const DUOTONE = 2;

interface TintVariant {
  kind: number;
  a: string;
  b: string;
  amount: number;
  res: number;
  method: number;
  tex: Texture;
}

/**
 * Variants kept per source. Baking one more releases the oldest bake (canvas shrunk to 1x1, like releaseTexture):
 * Sprite.tint and ui icons look their tint up on every draw and simply re-bake it.
 */
const MAX_VARIANTS = 16;

let cache = new WeakMap<Texture, TintVariant[]>();
let multiplyOk: boolean | null = null;
let blank: Surface | null = null;
const anonIds = new WeakMap<Texture, number>();
let anonCount = 0;

/**
 * Recoloured copy of a texture, baked once and cached per source Texture object + parameters.
 *
 *     tintTexture('art:skull', '#e03131')                  // white art becomes red, painted shading kept
 *     tintTexture(hero, '#000000', { mode: 'fill', amount: 0.5 })   // half-dark silhouette
 *
 * 'multiply' (default) multiplies every colour by `color`; 'fill' paints `color` over the opaque pixels. Alpha is kept
 * in both; the colour's own alpha scales the strength like `amount`. A multiply by white (or strength 0) returns
 * the source itself. The cache is keyed on the Texture object, so re-registering a key (`textures.set`) bakes a
 * fresh tint on the next call. Strings resolve through the `textures` registry; an unregistered key returns a
 * 1x1 transparent placeholder named `missing:<key>` (not cached, so the real texture is used once registered).
 * Bake at load or scene enter, not per frame with changing colours: each distinct colour is a new canvas. At most 16
 * variants per source stay cached; the oldest is then released, so code that keeps a result (instead of calling
 * tintTexture per draw like Sprite.tint) must not hold more than 16 colours of one source.
 */
export function tintTexture(src: Texture | string, color: Color, opts?: TintTextureOptions): Texture {
  const tex = sourceOf(src);
  if (!tex) return missingTexture(src as string);
  const kind = opts?.mode === 'fill' ? FILL : MULTIPLY;
  const amount = Math.min(1, Math.max(0, opts?.amount ?? 1));
  const res = resolutionFor(tex, opts?.resolution);
  const method = opts?.method === 'composite' ? 1 : opts?.method === 'pixels' ? 2 : 0;
  const hit = lookup(tex, kind, color, '', amount, res, method);
  if (hit) return hit;

  const c = parseColor(color);
  const t = amount * c.a;
  if (t <= 0 || (kind === MULTIPLY && c.r === 255 && c.g === 255 && c.b === 255)) {
    return remember(tex, kind, color, '', amount, res, method, tex);
  }
  const key = `tint:${nameOf(tex)}~${color}${kind === FILL ? '~fill' : ''}${amount < 1 ? `~${+amount.toFixed(3)}` : ''}${resSuffix(tex, res)}`;
  const w = tex.width;
  const h = tex.height;
  if (kind === FILL) {
    const composite = method !== 2;
    const out = bakeTexture(w, h, (ctx) => {
      tex.draw(ctx, 0, 0, w, h);
      if (!composite) return;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = amount;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w + 1, h + 1);
    }, { resolution: res, key });
    if (!composite) {
      mapPixels(out, (d, i) => {
        d[i] = d[i]! + (c.r - d[i]!) * t;
        d[i + 1] = d[i + 1]! + (c.g - d[i + 1]!) * t;
        d[i + 2] = d[i + 2]! + (c.b - d[i + 2]!) * t;
      });
    }
    return remember(tex, kind, color, '', amount, res, method, out);
  }

  // Multiplying by mix(white, color, t) equals fading the full product in by t, and the fill stays opaque.
  const m = { r: 255 + (c.r - 255) * t, g: 255 + (c.g - 255) * t, b: 255 + (c.b - 255) * t, a: 1 };
  const composite = method === 1 || (method === 0 && tintMultiplySupported());
  const out = bakeTexture(w, h, (ctx) => {
    if (!composite) {
      tex.draw(ctx, 0, 0, w, h);
      return;
    }
    ctx.fillStyle = toCss(m);
    ctx.fillRect(0, 0, w + 1, h + 1);
    ctx.globalCompositeOperation = 'multiply';
    tex.draw(ctx, 0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    tex.draw(ctx, 0, 0, w, h);
  }, { resolution: res, key });
  if (!composite) {
    const kr = m.r / 255;
    const kg = m.g / 255;
    const kb = m.b / 255;
    mapPixels(out, (d, i) => {
      d[i] = d[i]! * kr;
      d[i + 1] = d[i + 1]! * kg;
      d[i + 2] = d[i + 2]! * kb;
    });
  }
  return remember(tex, kind, color, '', amount, res, method, out);
}

/**
 * Two-colour recolour by brightness: black -> `dark`, white -> `light`, greys in between (Rec. 601 luma), alpha
 * kept (scaled by the colours' alpha). Turns white-on-transparent art into ink on a light button while painted
 * details (eye sockets, outlines) stay visible: `duotoneTexture('art:skull', '#d9d9de', '#1e1e22')`.
 * Reads pixels once at bake time; cached and resolved like tintTexture (same `missing:<key>` placeholder).
 */
export function duotoneTexture(src: Texture | string, dark: Color, light: Color, opts?: DuotoneTextureOptions): Texture {
  const tex = sourceOf(src);
  if (!tex) return missingTexture(src as string);
  const res = resolutionFor(tex, opts?.resolution);
  const hit = lookup(tex, DUOTONE, dark, light, 1, res, 2);
  if (hit) return hit;
  const a = parseColor(dark);
  const b = parseColor(light);
  const w = tex.width;
  const h = tex.height;
  const out = bakeTexture(w, h, (ctx) => tex.draw(ctx, 0, 0, w, h), {
    resolution: res,
    key: `duotone:${nameOf(tex)}~${dark}~${light}${resSuffix(tex, res)}`,
  });
  const alpha = a.a < 1 || b.a < 1;
  mapPixels(out, (d, i) => {
    const l = (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) / 255;
    d[i] = a.r + (b.r - a.r) * l;
    d[i + 1] = a.g + (b.g - a.g) * l;
    d[i + 2] = a.b + (b.b - a.b) * l;
    if (alpha) d[i + 3] = d[i + 3]! * (a.a + (b.a - a.a) * l);
  });
  return remember(tex, DUOTONE, dark, light, 1, res, 2, out);
}

/**
 * Forgets every cached tint / duotone (the next call bakes again; textures you still hold stay valid) and re-probes
 * tintMultiplySupported(). Re-bakes reuse their textureStats keys, so the old entries are replaced there.
 * Game.memoryWarning() calls it.
 */
export function clearTintCache(): void {
  cache = new WeakMap();
  multiplyOk = null;
}

/**
 * True when the runtime's canvas implements globalCompositeOperation 'multiply' (probed once on a 1x1 canvas:
 * the mode must stick and produce the product). Otherwise multiply tints use the getImageData loop.
 */
export function tintMultiplySupported(): boolean {
  if (multiplyOk !== null) return multiplyOk;
  let ok = false;
  try {
    const ctx = platform().createCanvas(1, 1).getContext('2d');
    ctx.fillStyle = '#ff8040';
    ctx.fillRect(0, 0, 1, 1);
    ctx.globalCompositeOperation = 'multiply';
    ok = ctx.globalCompositeOperation === 'multiply';
    if (ok) {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 1, 1);
      try {
        const d = ctx.getImageData(0, 0, 1, 1).data;
        ok = Math.abs(d[0]! - 128) <= 4 && Math.abs(d[1]! - 64) <= 4 && Math.abs(d[2]! - 32) <= 4;
      } catch {
        // No pixel readback: trust that the mode stuck.
      }
    }
  } catch {
    ok = false;
  }
  multiplyOk = ok;
  return ok;
}

function sourceOf(src: Texture | string): Texture | null {
  return typeof src === 'string' ? textures.tryGet(src) ?? null : src;
}

function missingTexture(key: string): Texture {
  if (!blank) blank = platform().createCanvas(1, 1);
  return new Texture(blank, undefined, `missing:${key}`);
}

const sourceResolution = (tex: Texture) => (tex instanceof ScaledTexture ? tex.resolution : 1);

function resolutionFor(tex: Texture, res: TextureResolution | undefined): number {
  return res === undefined ? sourceResolution(tex) : resolveTextureResolution(res);
}

const resSuffix = (tex: Texture, res: number) => (res === sourceResolution(tex) ? '' : `@${res}x`);

function nameOf(tex: Texture): string {
  if (tex.key) return tex.key;
  let id = anonIds.get(tex);
  if (id === undefined) anonIds.set(tex, (id = ++anonCount));
  return `anon${id}`;
}

function lookup(tex: Texture, kind: number, a: string, b: string, amount: number, res: number, method: number): Texture | null {
  const list = cache.get(tex);
  if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    const v = list[i]!;
    if (v.kind === kind && v.a === a && v.b === b && v.amount === amount && v.res === res && v.method === method) return v.tex;
  }
  return null;
}

function remember(src: Texture, kind: number, a: string, b: string, amount: number, res: number, method: number, tex: Texture): Texture {
  let list = cache.get(src);
  if (!list) cache.set(src, (list = []));
  if (list.length >= MAX_VARIANTS) {
    const old = list.shift()!.tex;
    // No-op variants (white multiply, strength 0) are the source itself: never release those.
    if (old.source !== src.source) releaseTexture(old);
  }
  list.push({ kind, a, b, amount, res, method, tex });
  return tex;
}

/** Runs `fn(data, i)` for every non-transparent pixel of a freshly baked texture and writes the result back. */
function mapPixels(tex: Texture, fn: (d: Uint8ClampedArray, i: number) => void): void {
  const s = tex.source as Surface;
  const ctx = s.getContext('2d');
  const img = ctx.getImageData(0, 0, s.width, s.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] !== 0) fn(d, i);
  ctx.putImageData(img, 0, 0);
}
