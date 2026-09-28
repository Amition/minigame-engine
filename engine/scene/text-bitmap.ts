import { trackTexture, untrackTexture } from '../gfx/texture';
import type { Ctx2D, Surface } from '../gfx/types';
import { hasPlatform, platform } from '../platform/current';
import type { Platform } from '../platform/types';

/** One offscreen rendering of a text block, shared by every Text node with the same key (see TextStyle.cache). */
export interface TextBitmap {
  readonly key: string;
  /** Null once released or evicted: holders drop the bitmap and draw directly or bake again. */
  surface: Surface | null;
  /** Backing pixels per local unit. */
  readonly res: number;
  /** Sub-pixel phase (backing px) the text was rasterized at. */
  readonly phaseX: number;
  readonly phaseY: number;
  /** Backing-pixel position of the alignment anchor (x) and of the text's top edge (y) inside the bitmap. */
  readonly anchorX: number;
  readonly anchorY: number;
  /** Bitmap size in backing pixels. */
  readonly pw: number;
  readonly ph: number;
  refs: number;
  /** Frame it was last drawn in (LRU eviction). */
  lastUsed: number;
}

export interface TextBitmapStats {
  /** Live bitmaps and their backing pixels (4 bytes each). */
  count: number;
  pixels: number;
  bytes: number;
  mb: number;
  /** Pixel cap (setTextBitmapBudget). */
  budget: number;
  /** Totals since start: rasterizations, acquisitions served by an existing bitmap, LRU evictions. */
  bakes: number;
  shared: number;
  evictions: number;
}

const DEFAULT_BUDGET = 1_500_000;
const MAX_SIDE = 2048;
/** Bakes allowed per frame; more requests fall back to direct drawing until a later frame (no bake spikes). */
const MAX_BAKES_PER_FRAME = 8;
/** Only bitmaps not drawn for this many frames can be evicted to make room. */
const EVICT_IDLE_FRAMES = 30;
const POOL_SIZE = 8;

const entries = new Map<string, TextBitmap>();
const counters = { pixels: 0, bakes: 0, shared: 0, evictions: 0 };
let budget = DEFAULT_BUDGET;
let serial = 0;
let bakeFrame = -1;
let bakesInFrame = 0;
const pool: Surface[] = [];
let poolPlatform: Platform | null = null;

/** Caps the backing pixels of all cached text bitmaps (default 1.5 M = ~5.7 MB); lower it on tight memory. */
export function setTextBitmapBudget(pixels: number): void {
  budget = Math.max(0, pixels);
}

/** Memory and hit counters of the Text bitmap cache (bitmaps also show in textureStats() as `text:<text>#n`). */
export function textBitmapStats(): TextBitmapStats {
  const bytes = counters.pixels * 4;
  return {
    count: entries.size,
    pixels: counters.pixels,
    bytes,
    mb: bytes / 1048576,
    budget,
    bakes: counters.bakes,
    shared: counters.shared,
    evictions: counters.evictions,
  };
}

/** Frees every cached text bitmap now; Text nodes bake again (or draw directly) on their next draw. */
export function clearTextBitmaps(): void {
  for (const b of [...entries.values()]) drop(b);
}

/**
 * Returns the bitmap for `key` (refcount + 1), or rasterizes a new one with `paint` (the context is fresh or
 * pooled: reset its state). Null when the bitmap is too big, the frame's bake allowance is used up (`frame` < 0
 * = no limit) or the budget is full of bitmaps that were drawn recently.
 */
export function acquireTextBitmap(
  key: string,
  res: number,
  phaseX: number,
  phaseY: number,
  anchorX: number,
  anchorY: number,
  pw: number,
  ph: number,
  frame: number,
  label: string,
  paint: (ctx: Ctx2D) => void,
): TextBitmap | null {
  const hit = entries.get(key);
  if (hit && hit.surface) {
    hit.refs++;
    hit.lastUsed = frame;
    counters.shared++;
    return hit;
  }
  const px = pw * ph;
  if (pw > MAX_SIDE || ph > MAX_SIDE || px > budget / 4) return null;
  if (frame >= 0) {
    if (frame !== bakeFrame) {
      bakeFrame = frame;
      bakesInFrame = 0;
    }
    if (bakesInFrame >= MAX_BAKES_PER_FRAME) return null;
  }
  if (counters.pixels + px > budget && !evict(counters.pixels + px - budget, frame)) return null;
  const surface = takeSurface(pw, ph);
  const b: TextBitmap = { key, surface, res, phaseX, phaseY, anchorX, anchorY, pw, ph, refs: 1, lastUsed: frame };
  paint(surface.getContext('2d'));
  trackTexture(surface, `text:${label}#${++serial}`, 'canvas');
  entries.set(key, b);
  counters.pixels += px;
  counters.bakes++;
  bakesInFrame++;
  return b;
}

/** Drops one reference; the last one frees the bitmap (untracked, canvas shrunk and pooled). */
export function releaseTextBitmap(b: TextBitmap): void {
  if (!b.surface) return;
  if (--b.refs > 0) return;
  drop(b);
}

function drop(b: TextBitmap): void {
  const s = b.surface;
  if (!s) return;
  b.surface = null;
  if (entries.get(b.key) === b) entries.delete(b.key);
  counters.pixels -= b.pw * b.ph;
  untrackTexture(s);
  s.width = 1;
  s.height = 1;
  if (pool.length < POOL_SIZE && hasPlatform() && poolPlatform === platform()) pool.push(s);
}

/** Frees least recently drawn bitmaps (idle for EVICT_IDLE_FRAMES) until `need` pixels are free. */
function evict(need: number, frame: number): boolean {
  if (frame < 0) return false;
  const idle: TextBitmap[] = [];
  let avail = 0;
  for (const b of entries.values()) {
    if (frame - b.lastUsed < EVICT_IDLE_FRAMES) continue;
    idle.push(b);
    avail += b.pw * b.ph;
  }
  if (avail < need) return false;
  idle.sort((a, b) => a.lastUsed - b.lastUsed);
  let freed = 0;
  for (const b of idle) {
    if (freed >= need) break;
    freed += b.pw * b.ph;
    drop(b);
    counters.evictions++;
  }
  return true;
}

function takeSurface(w: number, h: number): Surface {
  const p = platform();
  if (p !== poolPlatform) {
    pool.length = 0;
    poolPlatform = p;
  }
  const s = pool.pop();
  if (!s) return p.createCanvas(w, h);
  s.width = w;
  s.height = h;
  return s;
}
