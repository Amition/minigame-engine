import type { Insets } from '../core/math';
import type { Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from '../scene/node';

/** Slice insets: one number for all sides, [top, right, bottom, left], or an Insets object. */
export type SliceInsets = number | readonly [number, number, number, number] | Insets;

/** One of the nine pieces: source rect (texture logical units) → destination rect (local units). */
export interface SliceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface NineSliceOptions extends NodeOptions {
  /** Scales the corners/edges on screen (e.g. 0.5 for a texture drawn at 2x detail). Default 1. */
  borderScale?: number;
  /** Draw the center piece (default true). */
  fillCenter?: boolean;
}

export function toInsets(v: SliceInsets): Insets {
  if (typeof v === 'number') return { top: v, right: v, bottom: v, left: v };
  if (Array.isArray(v)) {
    const a = v as readonly number[];
    return { top: a[0]!, right: a[1]!, bottom: a[2]!, left: a[3]! };
  }
  const i = v as Insets;
  return { top: i.top, right: i.right, bottom: i.bottom, left: i.left };
}

/**
 * The nine source → destination rects (row-major: top-left, top, top-right, left, center, ...).
 * Corners keep their size (times borderScale) and shrink proportionally when the box is smaller than both borders.
 */
export function nineSliceRects(
  texW: number,
  texH: number,
  insets: Insets,
  width: number,
  height: number,
  borderScale = 1,
  out: SliceRect[] = [],
): SliceRect[] {
  const sl = Math.min(insets.left, texW);
  const sr = Math.min(insets.right, texW - sl);
  const st = Math.min(insets.top, texH);
  const sb = Math.min(insets.bottom, texH - st);
  let l = sl * borderScale;
  let r = sr * borderScale;
  let t = st * borderScale;
  let b = sb * borderScale;
  if (l + r > width && l + r > 0) {
    const k = width / (l + r);
    l *= k;
    r *= k;
  }
  if (t + b > height && t + b > 0) {
    const k = height / (t + b);
    t *= k;
    b *= k;
  }
  const sx = [0, sl, texW - sr];
  const sw = [sl, texW - sl - sr, sr];
  const sy = [0, st, texH - sb];
  const sh = [st, texH - st - sb, sb];
  const dx = [0, l, width - r];
  const dw = [l, Math.max(0, width - l - r), r];
  const dy = [0, t, height - b];
  const dh = [t, Math.max(0, height - t - b), b];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const i = row * 3 + col;
      const o = (out[i] ??= { sx: 0, sy: 0, sw: 0, sh: 0, dx: 0, dy: 0, dw: 0, dh: 0 });
      o.sx = sx[col]!;
      o.sw = sw[col]!;
      o.sy = sy[row]!;
      o.sh = sh[row]!;
      o.dx = dx[col]!;
      o.dw = dw[col]!;
      o.dy = dy[row]!;
      o.dh = dh[row]!;
    }
  }
  out.length = 9;
  return out;
}

/**
 * Scalable panel/button skin: corners stay crisp, edges stretch along one axis, the center stretches both ways.
 *
 *     new NineSlice('ui-panel', 24, 400, 260)          // 24px borders on every side
 *     new NineSlice(tex, [20, 30, 20, 30], 300, 90, { borderScale: 0.5 })
 */
export class NineSlice extends Node {
  insets: Insets;
  borderScale = 1;
  fillCenter = true;
  /** Pieces followed by another piece are drawn this much larger (local units) to hide anti-aliasing seams. */
  seamOverlap = 0.5;
  private _texture: Texture | null = null;
  private readonly rects: SliceRect[] = [];
  private readonly rectsKey = new Float64Array(9);

  constructor(texture: Texture | string | null, insets: SliceInsets, width?: number, height?: number, opts?: NineSliceOptions) {
    super();
    this.insets = toInsets(insets);
    this.texture = typeof texture === 'string' ? textures.get(texture) : texture;
    this.width = width ?? this._texture?.width ?? 0;
    this.height = height ?? this._texture?.height ?? 0;
    if (opts) {
      if (opts.borderScale !== undefined) this.borderScale = opts.borderScale;
      if (opts.fillCenter !== undefined) this.fillCenter = opts.fillCenter;
      this.set(opts);
    }
  }

  override get kind(): string {
    return 'NineSlice';
  }

  get texture(): Texture | null {
    return this._texture;
  }

  set texture(t: Texture | string | null) {
    this._texture = typeof t === 'string' ? textures.get(t) : t;
  }

  setInsets(v: SliceInsets): this {
    this.insets = toInsets(v);
    return this;
  }

  /** Current source → destination rects (reused array, recomputed only when inputs change). */
  sliceRects(): readonly SliceRect[] {
    const t = this._texture;
    const i = this.insets;
    const k = this.rectsKey;
    const tw = t?.width ?? 0;
    const th = t?.height ?? 0;
    if (
      this.rects.length !== 9 ||
      k[0] !== tw ||
      k[1] !== th ||
      k[2] !== i.top ||
      k[3] !== i.right ||
      k[4] !== i.bottom ||
      k[5] !== i.left ||
      k[6] !== this.width ||
      k[7] !== this.height ||
      k[8] !== this.borderScale
    ) {
      k.set([tw, th, i.top, i.right, i.bottom, i.left, this.width, this.height, this.borderScale]);
      nineSliceRects(tw, th, i, this.width, this.height, this.borderScale, this.rects);
    }
    return this.rects;
  }

  override draw(ctx: Ctx2D): void {
    const t = this._texture;
    if (!t || this.width <= 0 || this.height <= 0 || t.width <= 0 || t.height <= 0) return;
    const rects = this.sliceRects();
    const f = t.frame;
    const kx = f.w / t.width;
    const ky = f.h / t.height;
    const src = t.source as unknown as CanvasImageSource;
    const ov = this.seamOverlap;
    for (let i = 0; i < 9; i++) {
      if (i === 4 && !this.fillCenter) continue;
      const r = rects[i]!;
      if (r.sw <= 0 || r.sh <= 0 || r.dw <= 0 || r.dh <= 0) continue;
      const col = i % 3;
      const row = (i / 3) | 0;
      const dw = col < 2 && rects[i + 1]!.dw > 0 ? r.dw + ov : r.dw;
      const dh = row < 2 && rects[i + 3]!.dh > 0 ? r.dh + ov : r.dh;
      ctx.drawImage(src, f.x + r.sx * kx, f.y + r.sy * ky, r.sw * kx, r.sh * ky, r.dx, r.dy, dw, dh);
    }
  }

  override describe() {
    const i = this.insets;
    return {
      ...super.describe(),
      tex: this._texture?.key || (this._texture ? '(anon)' : '(none)'),
      insets: `${i.top}/${i.right}/${i.bottom}/${i.left}`,
    };
  }
}
