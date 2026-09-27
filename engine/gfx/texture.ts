import type { Rect } from '../core/math';
import { platform } from '../platform/current';
import type { Ctx2D, ImageSource, Surface } from './types';

/** A rectangular region of an image source. Sub-textures share the source (atlas frames). */
export class Texture {
  readonly frame: Rect;

  constructor(
    readonly source: ImageSource,
    frame?: Rect,
    public key = '',
  ) {
    this.frame = frame ?? { x: 0, y: 0, w: source.width, h: source.height };
  }

  get width(): number {
    return this.frame.w;
  }

  get height(): number {
    return this.frame.h;
  }

  /** A sub-region relative to this texture's frame. */
  sub(x: number, y: number, w: number, h: number, key = ''): Texture {
    return new Texture(this.source, { x: this.frame.x + x, y: this.frame.y + y, w, h }, key);
  }

  /** Splits into a grid of equally sized frames, row by row. */
  grid(frameW: number, frameH: number, count?: number, keyPrefix = this.key): Texture[] {
    const cols = Math.floor(this.width / frameW);
    const rows = Math.floor(this.height / frameH);
    const n = Math.min(count ?? cols * rows, cols * rows);
    const out: Texture[] = [];
    for (let i = 0; i < n; i++) {
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      out.push(this.sub(cx * frameW, cy * frameH, frameW, frameH, keyPrefix ? `${keyPrefix}#${i}` : ''));
    }
    return out;
  }

  draw(ctx: Ctx2D, dx = 0, dy = 0, dw = this.width, dh = this.height): void {
    const f = this.frame;
    if (f.w <= 0 || f.h <= 0) return;
    ctx.drawImage(this.source as unknown as CanvasImageSource, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
  }
}

/** Backing pixels per logical unit: a number, or 'auto' = the current game's device pixels per design unit. */
export type TextureResolution = number | 'auto';

export interface BakeTextureOptions {
  /** Backing pixels per logical unit (default 1). 'auto' follows the screen, see autoTextureResolution(). */
  resolution?: TextureResolution;
  /** Cap for resolution 'auto' (default 2). */
  maxResolution?: number;
  /** Label in textureStats(); baking again with the same key replaces the old entry there. */
  key?: string;
}

/**
 * Renders into a new offscreen canvas and wraps it as a texture. Draw in logical units;
 * `resolution` multiplies the backing size: 'auto' matches the screen (1 on most phones), 2 is crisp on
 * every screen but costs 4x the memory of 1.
 */
export function bakeTexture(
  width: number,
  height: number,
  draw: (ctx: Ctx2D, w: number, h: number) => void,
  opts: BakeTextureOptions = {},
): Texture {
  const res = resolveTextureResolution(opts.resolution, opts.maxResolution);
  const w = Math.max(1, Math.ceil(width * res));
  const h = Math.max(1, Math.ceil(height * res));
  const surface: Surface = platform().createCanvas(w, h);
  const ctx = surface.getContext('2d');
  ctx.save();
  ctx.scale(res, res);
  draw(ctx, width, height);
  ctx.restore();
  trackTexture(surface, opts.key ?? '', 'baked');
  return res === 1 ? new Texture(surface, undefined, opts.key ?? '') : new ScaledTexture(surface, res, opts.key ?? '');
}

/** A texture whose source is `resolution` times larger than its logical size. */
export class ScaledTexture extends Texture {
  constructor(
    source: ImageSource,
    readonly resolution: number,
    key = '',
    frame?: Rect,
  ) {
    super(source, frame, key);
  }

  override get width(): number {
    return this.frame.w / this.resolution;
  }

  override get height(): number {
    return this.frame.h / this.resolution;
  }

  override sub(x: number, y: number, w: number, h: number, key = ''): Texture {
    const r = this.resolution;
    return new ScaledTexture(
      this.source,
      r,
      key,
      { x: this.frame.x + x * r, y: this.frame.y + y * r, w: w * r, h: h * r },
    );
  }
}

// ---------------------------------------------------------------- resolution 'auto'

let backingScale: () => number = () => 1;

/** Installed by Game: backing pixels per design unit of the current game (pixelRatio * scale). */
export function setTextureBackingScale(fn: () => number): void {
  backingScale = fn;
}

/**
 * Backing pixels per design unit of the current game (game.pixelRatio * game.scale), rounded to 0.25 steps and
 * clamped to [0.5, maxResolution]. 1 on a 720p Android or an iPhone at the default maxPixelRatio 2, 1.5 on an iPad.
 * Known from the Game constructor on, so it is valid inside an app's boot().
 */
export function autoTextureResolution(maxResolution = 2): number {
  const k = backingScale();
  if (!(k > 0) || !Number.isFinite(k)) return Math.min(1, maxResolution);
  return Math.min(Math.max(0.5, Math.round(k * 4) / 4), maxResolution);
}

/** A number stays as is (default 1); 'auto' becomes autoTextureResolution(maxResolution). */
export function resolveTextureResolution(res: TextureResolution | undefined, maxResolution = 2): number {
  return res === 'auto' ? autoTextureResolution(maxResolution) : (res ?? 1);
}

// ---------------------------------------------------------------- memory accounting

/** How a tracked source was made: bakeTexture, a loaded image file, or another canvas (atlas page, registry). */
export type TextureSourceKind = 'baked' | 'image' | 'canvas';

export interface TextureStatsEntry {
  key: string;
  kind: TextureSourceKind;
  /** Backing size in pixels. */
  width: number;
  height: number;
  /** Estimated decoded size: 4 bytes (RGBA) per pixel. */
  bytes: number;
}

export interface TextureStats {
  /** Tracked image sources (canvases/images); sub-textures and atlas frames share their source. */
  count: number;
  pixels: number;
  /** Estimated decoded bytes (4 per pixel). GPU upload can add a second copy on some runtimes. */
  bytes: number;
  /** bytes in MiB. */
  mb: number;
  /** Largest sources first. */
  top: TextureStatsEntry[];
}

interface TrackedSource extends TextureStatsEntry {
  pixels: number;
}

type FinalizerLike = { register(target: object, held: TrackedSource): void };
type FinalizerCtor = new (cleanup: (held: TrackedSource) => void) => FinalizerLike;
// ES2021 global, missing on older mini-game runtimes (builds target ES2017): only touched behind typeof.
declare const FinalizationRegistry: FinalizerCtor | undefined;

const bySource = new WeakMap<object, TrackedSource>();
const byKey = new Map<string, TrackedSource>();
const live = new Set<TrackedSource>();
const totals = { count: 0, pixels: 0, bytes: 0 };
// Entries never reference their source, so tracking can't keep pixels alive; the finalizer drops entries of
// garbage-collected sources where the runtime supports it.
const finalizer = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry((e) => dropEntry(e)) : null;

/** Running totals of tracked textures (O(1) to read; textureStats() adds the top list). */
export const textureMemory: Readonly<{ count: number; pixels: number; bytes: number }> = totals;

function dropEntry(e: TrackedSource): void {
  if (!live.delete(e)) return;
  totals.count--;
  totals.pixels -= e.pixels;
  totals.bytes -= e.bytes;
  if (e.key && byKey.get(e.key) === e) byKey.delete(e.key);
}

/**
 * Counts an image source in textureStats(). bakeTexture, loaded images and the `textures` registry call this;
 * call it for canvases you create yourself. Tracking the same source twice is a no-op (an empty key is filled in);
 * a new source under a key that is already tracked replaces the old entry (re-bake).
 */
export function trackTexture(source: ImageSource, key = '', kind: TextureSourceKind = 'canvas'): void {
  const obj = source as unknown as object;
  const prev = bySource.get(obj);
  if (prev && live.has(prev)) {
    if (!prev.key && key) claimKey(prev, key);
    return;
  }
  const width = Math.max(0, Math.floor(source.width));
  const height = Math.max(0, Math.floor(source.height));
  const pixels = width * height;
  const e: TrackedSource = { key: '', kind, width, height, pixels, bytes: pixels * 4 };
  live.add(e);
  bySource.set(obj, e);
  totals.count++;
  totals.pixels += pixels;
  totals.bytes += e.bytes;
  if (key) claimKey(e, key);
  finalizer?.register(obj, e);
}

function claimKey(e: TrackedSource, key: string): void {
  const old = byKey.get(key);
  if (old && old !== e) dropEntry(old);
  e.key = key;
  byKey.set(key, e);
}

/** Stops counting a source (it is no longer used). Safe for untracked sources. */
export function untrackTexture(source: ImageSource): void {
  const e = bySource.get(source as unknown as object);
  if (e) dropEntry(e);
}

/**
 * Frees a texture now: stops tracking its source and shrinks a canvas source to 1x1 so the runtime can reclaim
 * the pixels without waiting for GC (mini-game canvases are slow to be collected). Only call it when nothing
 * draws the texture (or another texture sharing its source) anymore.
 */
export function releaseTexture(tex: Texture): void {
  untrackTexture(tex.source);
  const s = tex.source as Partial<Surface>;
  if (typeof s.getContext === 'function') {
    s.width = 1;
    s.height = 1;
  }
}

/** Tracked texture memory: totals plus the `top` largest sources (default 5). */
export function textureStats(opts: { top?: number } = {}): TextureStats {
  const n = Math.max(0, Math.floor(opts.top ?? 5));
  const top: TextureStatsEntry[] = [];
  if (n > 0) {
    const sorted = [...live].sort((a, b) => b.bytes - a.bytes || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const e of sorted.slice(0, n)) {
      top.push({ key: e.key || `(${e.kind})`, kind: e.kind, width: e.width, height: e.height, bytes: e.bytes });
    }
  }
  return { count: totals.count, pixels: totals.pixels, bytes: totals.bytes, mb: totals.bytes / 1048576, top };
}
