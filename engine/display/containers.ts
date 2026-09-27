import type { Color } from '../core/color';
import { Game } from '../core/game';
import { TAU } from '../core/math';
import { roundRectPath } from '../gfx/draw';
import { Texture } from '../gfx/texture';
import type { Ctx2D, Surface } from '../gfx/types';
import { platform } from '../platform/current';
import { Node, type NodeOptions } from '../scene/node';
import { flattenPoints, type GraphicsPoints } from './graphics';

/** Clip shape in local coordinates; omitted geometry defaults to the container's (0, 0, width, height) box. */
export type MaskShape =
  | { type: 'rect'; x?: number; y?: number; width?: number; height?: number }
  | { type: 'roundRect'; radius: number | [number, number, number, number]; x?: number; y?: number; width?: number; height?: number }
  | { type: 'circle'; x?: number; y?: number; radius?: number }
  | { type: 'ellipse'; x?: number; y?: number; rx?: number; ry?: number }
  | { type: 'polygon'; points: GraphicsPoints };

export interface MaskContainerOptions extends NodeOptions {
  /** Stroke drawn along the mask edge, above the children (e.g. an avatar ring). */
  outline?: { color: Color; width: number } | null;
  /** Children outside the shape don't receive pointer events (default true). */
  maskHits?: boolean;
}

/**
 * Clips its own drawing and children to a circle / rounded rect / ellipse / polygon:
 *
 *     const avatar = scene.add(new MaskContainer({ type: 'circle' }, { width: 120, height: 120, x: 40, y: 40 }));
 *     avatar.add(new Sprite('portrait', { width: 120, height: 120, fit: 'cover' }));
 *
 * Mask geometry is live: change `mask` (e.g. tween a circle radius for a reveal).
 */
export class MaskContainer extends Node {
  mask: MaskShape;
  outline: { color: Color; width: number } | null = null;
  maskHits = true;
  private suppressed = false;
  private polyCache: { src: GraphicsPoints; flat: number[] } | null = null;

  constructor(mask: MaskShape, opts: MaskContainerOptions = {}) {
    super();
    this.mask = mask;
    if (opts.outline !== undefined) this.outline = opts.outline;
    if (opts.maskHits !== undefined) this.maskHits = opts.maskHits;
    this.set(opts);
  }

  override get kind(): string {
    return 'MaskContainer';
  }

  /** True if the local point lies inside the mask shape. */
  containsPoint(lx: number, ly: number): boolean {
    const m = this.mask;
    const w = this.width;
    const h = this.height;
    switch (m.type) {
      case 'rect': {
        const x = m.x ?? 0;
        const y = m.y ?? 0;
        return lx >= x && ly >= y && lx < x + (m.width ?? w) && ly < y + (m.height ?? h);
      }
      case 'roundRect': {
        const x = m.x ?? 0;
        const y = m.y ?? 0;
        const rw = m.width ?? w;
        const rh = m.height ?? h;
        if (lx < x || ly < y || lx >= x + rw || ly >= y + rh) return false;
        const [tl, tr, br, bl] = (Array.isArray(m.radius) ? m.radius : [m.radius, m.radius, m.radius, m.radius]).map(
          (v) => Math.max(0, Math.min(v, rw / 2, rh / 2)),
        ) as [number, number, number, number];
        const corner = (cx: number, cy: number, r: number) => (lx - cx) ** 2 + (ly - cy) ** 2 <= r * r;
        if (lx < x + tl && ly < y + tl) return corner(x + tl, y + tl, tl);
        if (lx > x + rw - tr && ly < y + tr) return corner(x + rw - tr, y + tr, tr);
        if (lx > x + rw - br && ly > y + rh - br) return corner(x + rw - br, y + rh - br, br);
        if (lx < x + bl && ly > y + rh - bl) return corner(x + bl, y + rh - bl, bl);
        return true;
      }
      case 'circle': {
        const r = m.radius ?? Math.min(w, h) / 2;
        const dx = lx - (m.x ?? w / 2);
        const dy = ly - (m.y ?? h / 2);
        return dx * dx + dy * dy <= r * r;
      }
      case 'ellipse': {
        const rx = m.rx ?? w / 2;
        const ry = m.ry ?? h / 2;
        if (rx <= 0 || ry <= 0) return false;
        const dx = (lx - (m.x ?? w / 2)) / rx;
        const dy = (ly - (m.y ?? h / 2)) / ry;
        return dx * dx + dy * dy <= 1;
      }
      case 'polygon': {
        const p = this.flatPolygon(m.points);
        let inside = false;
        for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
          const xi = p[i]!;
          const yi = p[i + 1]!;
          const xj = p[j]!;
          const yj = p[j + 1]!;
          if (yi > ly !== yj > ly && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      }
    }
  }

  override hitTest(lx: number, ly: number): boolean {
    const inside = this.containsPoint(lx, ly);
    if (this.maskHits) {
      // The game's hit test calls hitTest() right before descending into children, so this gates child hits.
      if (!inside && this.interactiveChildren) {
        this.interactiveChildren = false;
        this.suppressed = true;
      } else if (inside && this.suppressed) {
        this.interactiveChildren = true;
        this.suppressed = false;
      }
    }
    return inside;
  }

  /** Adds the mask outline to the current path. */
  maskPath(ctx: Ctx2D): void {
    const m = this.mask;
    const w = this.width;
    const h = this.height;
    switch (m.type) {
      case 'rect':
        ctx.rect(m.x ?? 0, m.y ?? 0, m.width ?? w, m.height ?? h);
        break;
      case 'roundRect':
        roundRectPath(ctx, m.x ?? 0, m.y ?? 0, m.width ?? w, m.height ?? h, m.radius);
        break;
      case 'circle': {
        const x = m.x ?? w / 2;
        const y = m.y ?? h / 2;
        const r = Math.max(0, m.radius ?? Math.min(w, h) / 2);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
        break;
      }
      case 'ellipse': {
        const x = m.x ?? w / 2;
        const y = m.y ?? h / 2;
        const rx = Math.max(0, m.rx ?? w / 2);
        ctx.moveTo(x + rx, y);
        ctx.ellipse(x, y, rx, Math.max(0, m.ry ?? h / 2), 0, 0, TAU);
        break;
      }
      case 'polygon': {
        const p = this.flatPolygon(m.points);
        if (p.length < 6) break;
        ctx.moveTo(p[0]!, p[1]!);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
        ctx.closePath();
        break;
      }
    }
  }

  protected override renderContent(ctx: Ctx2D): void {
    ctx.save();
    ctx.beginPath();
    this.maskPath(ctx);
    ctx.clip();
    this.draw(ctx);
    this.renderChildren(ctx);
    ctx.restore();
    this.drawOver(ctx);
  }

  override drawOver(ctx: Ctx2D): void {
    const o = this.outline;
    if (!o || o.width <= 0) return;
    ctx.beginPath();
    this.maskPath(ctx);
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.width;
    ctx.stroke();
  }

  override describe() {
    return { ...super.describe(), mask: this.mask.type };
  }

  private flatPolygon(points: GraphicsPoints): number[] {
    if (this.polyCache?.src !== points) this.polyCache = { src: points, flat: flattenPoints(points) };
    return this.polyCache.flat;
  }
}

export interface CacheContainerOptions extends NodeOptions {
  /** Backing pixels per local unit (default: the game's current device pixels per design unit). */
  resolution?: number;
}

/**
 * Renders its subtree into an offscreen canvas once and then just blits it, until markDirty() is called.
 * Use for static, expensive content (map decorations, complex Graphics, many Text labels).
 * Children are cropped to (0, 0, width, height) and still receive input normally.
 */
export class CacheContainer extends Node {
  /** Backing pixels per local unit; null = auto (game scale * pixel ratio). */
  resolution: number | null = null;
  /** When false, renders children directly (no caching). */
  cacheEnabled = true;
  private surface: Surface | null = null;
  private dirty = true;
  private _redraws = 0;

  constructor(width: number, height: number, opts: CacheContainerOptions = {}) {
    super();
    this.width = width;
    this.height = height;
    if (opts.resolution !== undefined) this.resolution = opts.resolution;
    this.set(opts);
  }

  override get kind(): string {
    return 'CacheContainer';
  }

  /** How many times the cache was (re)rendered. */
  get redraws(): number {
    return this._redraws;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /** Re-render on the next frame (call after changing children). */
  markDirty(): this {
    this.dirty = true;
    return this;
  }

  /** The cached content as a texture (renders now if needed). Shares the backing canvas: it changes on redraw. */
  cacheTexture(): Texture | null {
    if (!this.refresh()) return null;
    const s = this.surface!;
    return new Texture(s, { x: 0, y: 0, w: s.width, h: s.height });
  }

  /** Drops the offscreen canvas; the next render rebuilds it. */
  releaseCache(): void {
    this.surface = null;
    this.dirty = true;
  }

  protected override renderContent(ctx: Ctx2D): void {
    if (!this.cacheEnabled || !this.refresh()) return super.renderContent(ctx);
    const s = this.surface!;
    ctx.drawImage(s as unknown as CanvasImageSource, 0, 0, s.width, s.height, 0, 0, this.width, this.height);
  }

  protected override onDestroy(): void {
    this.surface = null;
  }

  override describe() {
    return { ...super.describe(), cached: this.cacheEnabled, dirty: this.dirty, redraws: this._redraws };
  }

  /** Ensures the cache is up to date; false when there is nothing to cache (zero size). */
  private refresh(): boolean {
    if (this.width <= 0 || this.height <= 0) return false;
    const g = Game.current;
    const res = this.resolution ?? (g ? Math.max(0.25, Math.min(4, g.scale * g.pixelRatio)) : 1);
    const pw = Math.max(1, Math.ceil(this.width * res));
    const ph = Math.max(1, Math.ceil(this.height * res));
    if (!this.surface || this.surface.width !== pw || this.surface.height !== ph) {
      this.surface = platform().createCanvas(pw, ph);
      this.dirty = true;
    }
    if (!this.dirty) return true;
    const c = this.surface.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, pw, ph);
    c.save();
    c.scale(pw / this.width, ph / this.height);
    this.draw(c);
    this.renderChildren(c);
    this.drawOver(c);
    c.restore();
    this.dirty = false;
    this._redraws++;
    return true;
  }
}
