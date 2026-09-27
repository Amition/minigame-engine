import { wrap } from '../core/math';
import type { Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from '../scene/node';

export interface TilingSpriteOptions extends NodeOptions {
  /** Uniform tile scale (tileScaleX/Y override). */
  tileScale?: number;
  tileScaleX?: number;
  tileScaleY?: number;
  /** Initial tile offset. */
  tileX?: number;
  tileY?: number;
  /** Auto-scroll speed in local units per second (parallax backgrounds, conveyor belts). */
  scrollX?: number;
  scrollY?: number;
}

/** Hard cap on drawn tiles per frame (protects against tiny tile scales). */
const MAX_TILES = 4096;

/**
 * Repeats a texture over (width, height). tileX/tileY shift the pattern (positive = right/down);
 * scrollX/scrollY scroll it automatically. Edge tiles are cropped via source rects (no clip, no patterns).
 */
export class TilingSprite extends Node {
  tileX = 0;
  tileY = 0;
  tileScaleX = 1;
  tileScaleY = 1;
  scrollX = 0;
  scrollY = 0;
  /** Interior tiles are drawn this much wider/taller (local units) so anti-aliased edges don't leave hairline seams. */
  seamOverlap = 0.5;
  private _texture: Texture | null = null;

  constructor(texture: Texture | string | null, width: number, height: number, opts?: TilingSpriteOptions) {
    super();
    this.texture = texture;
    this.width = width;
    this.height = height;
    if (opts) {
      if (opts.tileScale !== undefined) this.tileScaleX = this.tileScaleY = opts.tileScale;
      if (opts.tileScaleX !== undefined) this.tileScaleX = opts.tileScaleX;
      if (opts.tileScaleY !== undefined) this.tileScaleY = opts.tileScaleY;
      if (opts.tileX !== undefined) this.tileX = opts.tileX;
      if (opts.tileY !== undefined) this.tileY = opts.tileY;
      if (opts.scrollX !== undefined) this.scrollX = opts.scrollX;
      if (opts.scrollY !== undefined) this.scrollY = opts.scrollY;
      this.set(opts);
    }
  }

  override get kind(): string {
    return 'TilingSprite';
  }

  get texture(): Texture | null {
    return this._texture;
  }

  set texture(t: Texture | string | null) {
    this._texture = typeof t === 'string' ? textures.get(t) : t;
  }

  /** Size of one tile on screen (local units). */
  get tileWidth(): number {
    return (this._texture?.width ?? 0) * this.tileScaleX;
  }

  get tileHeight(): number {
    return (this._texture?.height ?? 0) * this.tileScaleY;
  }

  override update(dt: number): void {
    if (this.scrollX === 0 && this.scrollY === 0) return;
    const tw = this.tileWidth;
    const th = this.tileHeight;
    this.tileX += this.scrollX * dt;
    this.tileY += this.scrollY * dt;
    if (tw > 0) this.tileX = wrap(this.tileX, 0, tw);
    if (th > 0) this.tileY = wrap(this.tileY, 0, th);
  }

  override draw(ctx: Ctx2D): void {
    const t = this._texture;
    const w = this.width;
    const h = this.height;
    const tw = this.tileWidth;
    const th = this.tileHeight;
    if (!t || w <= 0 || h <= 0 || tw <= 0 || th <= 0) return;
    const f = t.frame;
    const src = t.source as unknown as CanvasImageSource;
    const kx = f.w / tw;
    const ky = f.h / th;
    const startX = wrap(this.tileX, 0, tw) - tw;
    const startY = wrap(this.tileY, 0, th) - th;
    const ov = this.seamOverlap;
    let n = 0;
    for (let y = startY; y < h; y += th) {
      const y0 = y < 0 ? 0 : y;
      const y1 = y + th > h ? h : y + th;
      if (y1 <= y0) continue;
      const dh = (y1 < h ? Math.min(y1 + ov, h) : y1) - y0;
      for (let x = startX; x < w; x += tw) {
        const x0 = x < 0 ? 0 : x;
        const x1 = x + tw > w ? w : x + tw;
        if (x1 <= x0) continue;
        if (++n > MAX_TILES) return;
        const dw = (x1 < w ? Math.min(x1 + ov, w) : x1) - x0;
        ctx.drawImage(src, f.x + (x0 - x) * kx, f.y + (y0 - y) * ky, (x1 - x0) * kx, (y1 - y0) * ky, x0, y0, dw, dh);
      }
    }
  }

  override describe() {
    return {
      ...super.describe(),
      tex: this._texture?.key || (this._texture ? '(anon)' : '(none)'),
      tile: `${+this.tileX.toFixed(1)},${+this.tileY.toFixed(1)}`,
      tileScale: this.tileScaleX === 1 && this.tileScaleY === 1 ? undefined : `${this.tileScaleX}x${this.tileScaleY}`,
    };
  }
}
