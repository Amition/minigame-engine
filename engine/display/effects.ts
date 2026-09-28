import { withAlpha, type Color } from '../core/color';
import { clamp01, TAU, type Vec2 } from '../core/math';
import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from '../scene/node';
import { flattenPoints, type GraphicsPoints } from './graphics';
import { describePaintStyle, resolvePaintStyle, type PaintStyle, type RadialGradientStyle } from './paint';

// ------------------------------------------------------------------ Trail

export interface TrailOptions extends NodeOptions {
  /** Node to follow (its anchor point). Put the Trail in a stable container, not inside the target. */
  target?: Node | null;
  /** Ribbon width at the head (default 16). */
  thickness?: number;
  color?: Color;
  /** Seconds each recorded point lives (default 0.35). */
  lifetime?: number;
  /** Ring buffer size (default 32). */
  maxPoints?: number;
  /** Minimum travel before a new point is recorded (default 4). */
  minDistance?: number;
  /** Narrow toward the tail (default true). */
  taper?: boolean;
  /** Fade toward the tail (default true). */
  fade?: boolean;
}

const tmpVec: Vec2 = { x: 0, y: 0 };

/**
 * Fading ribbon behind a moving node (or points fed with addPoint), drawn in this node's local space:
 *
 *     scene.add(new Trail({ target: ball, thickness: 20, color: '#7dd3fc' }));
 */
export class Trail extends Node {
  target: Node | null;
  thickness: number;
  color: Color;
  lifetime: number;
  minDistance: number;
  taper: boolean;
  fade: boolean;
  private readonly cap: number;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly ts: Float64Array;
  private readonly lx: Float64Array;
  private readonly ly: Float64Array;
  private readonly rx: Float64Array;
  private readonly ry: Float64Array;
  private readonly ks: Float64Array;
  private start = 0;
  private count = 0;
  private time = 0;

  constructor(opts: TrailOptions = {}) {
    super();
    this.target = opts.target ?? null;
    this.thickness = opts.thickness ?? 16;
    this.color = opts.color ?? '#ffffff';
    this.lifetime = opts.lifetime ?? 0.35;
    this.minDistance = opts.minDistance ?? 4;
    this.taper = opts.taper ?? true;
    this.fade = opts.fade ?? true;
    this.cap = Math.max(2, Math.floor(opts.maxPoints ?? 32));
    this.xs = new Float64Array(this.cap);
    this.ys = new Float64Array(this.cap);
    this.ts = new Float64Array(this.cap);
    this.lx = new Float64Array(this.cap);
    this.ly = new Float64Array(this.cap);
    this.rx = new Float64Array(this.cap);
    this.ry = new Float64Array(this.cap);
    this.ks = new Float64Array(this.cap);
    this.set(opts);
  }

  override get kind(): string {
    return 'Trail';
  }

  get pointCount(): number {
    return this.count;
  }

  /** Records a point in local coordinates (manual mode, or in addition to the target). */
  addPoint(x: number, y: number): this {
    const cap = this.cap;
    const n = this.count;
    if (n >= 1) {
      const li = (this.start + n - 1) % cap;
      if (Math.abs(this.xs[li]! - x) < 0.01 && Math.abs(this.ys[li]! - y) < 0.01) {
        this.ts[li] = this.time;
        return this;
      }
      if (n >= 2) {
        const pi = (this.start + n - 2) % cap;
        if (Math.hypot(this.xs[pi]! - this.xs[li]!, this.ys[pi]! - this.ys[li]!) < this.minDistance) {
          this.xs[li] = x;
          this.ys[li] = y;
          this.ts[li] = this.time;
          return this;
        }
      }
    }
    if (n === cap) {
      this.start = (this.start + 1) % cap;
      this.count--;
    }
    const i = (this.start + this.count) % cap;
    this.xs[i] = x;
    this.ys[i] = y;
    this.ts[i] = this.time;
    this.count++;
    return this;
  }

  clear(): this {
    this.count = 0;
    this.start = 0;
    return this;
  }

  override update(dt: number): void {
    this.time += dt;
    while (this.count > 0 && this.time - this.ts[this.start]! > this.lifetime) {
      this.start = (this.start + 1) % this.cap;
      this.count--;
    }
    const t = this.target;
    if (t && !t.destroyed && t.root === this.root) {
      const w = t.toWorld(t.anchorX * t.width, t.anchorY * t.height, tmpVec);
      const p = this.toLocal(w.x, w.y, tmpVec);
      this.addPoint(p.x, p.y);
    }
  }

  override draw(ctx: Ctx2D): void {
    const n = this.count;
    if (n < 2 || this.thickness <= 0) return;
    const cap = this.cap;
    const { xs, ys, lx, ly, rx, ry, ks } = this;
    for (let i = 0; i < n; i++) {
      const c = (this.start + i) % cap;
      const a = (this.start + Math.max(0, i - 1)) % cap;
      const b = (this.start + Math.min(n - 1, i + 1)) % cap;
      let dx = xs[b]! - xs[a]!;
      let dy = ys[b]! - ys[a]!;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const k = clamp01(1 - (this.time - this.ts[c]!) / this.lifetime);
      const age = Math.min(k, (i + 1) / n);
      ks[i] = age;
      const hw = (this.thickness / 2) * (this.taper ? age : 1);
      lx[i] = xs[c]! - dy * hw;
      ly[i] = ys[c]! + dx * hw;
      rx[i] = xs[c]! + dy * hw;
      ry[i] = ys[c]! - dx * hw;
    }
    const base = ctx.globalAlpha;
    ctx.fillStyle = this.color;
    if (!this.fade) {
      ctx.beginPath();
      ctx.moveTo(lx[0]!, ly[0]!);
      for (let i = 1; i < n; i++) ctx.lineTo(lx[i]!, ly[i]!);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(rx[i]!, ry[i]!);
      ctx.closePath();
      ctx.fill();
      return;
    }
    for (let i = 0; i < n - 1; i++) {
      const a = (ks[i]! + ks[i + 1]!) / 2;
      if (a <= 0.01) continue;
      ctx.globalAlpha = base * a;
      ctx.beginPath();
      ctx.moveTo(lx[i]!, ly[i]!);
      ctx.lineTo(lx[i + 1]!, ly[i + 1]!);
      ctx.lineTo(rx[i + 1]!, ry[i + 1]!);
      ctx.lineTo(rx[i]!, ry[i]!);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = base;
  }

  override describe() {
    return { ...super.describe(), points: this.count, target: this.target ? this.target.id || this.target.kind : undefined };
  }
}

// ------------------------------------------------------------------ ShadowBlob

export interface ShadowBlobOptions extends NodeOptions {
  color?: Color;
  /** Center opacity (default 0.35). */
  opacity?: number;
  /** 0 = hard edge, 1 = fades from the center (default 0.6). */
  softness?: number;
}

/**
 * Soft elliptical ground shadow of size (width, height). Anchor defaults to the center (0.5, 0.5),
 * so place it at the character's feet.
 */
export class ShadowBlob extends Node {
  color: Color;
  opacity: number;
  softness: number;
  private grad: RadialGradientStyle | null = null;
  private gradKey = '';

  constructor(width = 80, height = 28, opts: ShadowBlobOptions = {}) {
    super();
    this.width = width;
    this.height = height;
    this.anchorX = this.anchorY = 0.5;
    this.color = opts.color ?? '#000000';
    this.opacity = opts.opacity ?? 0.35;
    this.softness = opts.softness ?? 0.6;
    this.set(opts);
  }

  override get kind(): string {
    return 'ShadowBlob';
  }

  override draw(ctx: Ctx2D): void {
    const w = this.width;
    const h = this.height;
    if (w <= 0 || h <= 0 || this.opacity <= 0) return;
    const key = `${this.color}|${this.opacity}|${this.softness}`;
    if (!this.grad || key !== this.gradKey) {
      const inner = withAlpha(this.color, this.opacity);
      const soft = clamp01(this.softness);
      this.grad = {
        type: 'radial',
        x: 0,
        y: 0,
        r: 1,
        stops: [
          [0, inner],
          [Math.max(0, 1 - soft), inner],
          [1, withAlpha(this.color, 0)],
        ],
      };
      this.gradKey = key;
    }
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(w / 2, h / 2);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fillStyle = resolvePaintStyle(ctx, this.grad);
    ctx.fill();
    ctx.restore();
  }

  override describe() {
    return { ...super.describe(), opacity: this.opacity };
  }
}

// ------------------------------------------------------------------ Line / DashedLine

const NO_DASH: number[] = [];

export interface LineStyle {
  color?: PaintStyle;
  /** Stroke width (default 4). */
  thickness?: number;
  cap?: CanvasLineCap;
  join?: CanvasLineJoin;
  /** Dash pattern, e.g. [16, 10]. */
  dash?: number[] | null;
  dashOffset?: number;
  /** Arrowhead length at the last point (0 = none). */
  arrow?: number;
}

/**
 * Stroked line / polyline through points in local coordinates (node size stays 0, the points are relative to x, y):
 *
 *     const aim = scene.add(new Line([0, 0, 200, -120], { color: '#fff', thickness: 6, arrow: 24 }, { x: 375, y: 1000 }));
 *     aim.setEnds(0, 0, dx, dy);
 */
export class Line extends Node {
  points: number[];
  color: PaintStyle;
  thickness: number;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  dash: number[] | null;
  dashOffset: number;
  arrow: number;

  constructor(points: GraphicsPoints, style: LineStyle = {}, opts?: NodeOptions) {
    super();
    this.points = flattenPoints(points);
    this.color = style.color ?? '#ffffff';
    this.thickness = style.thickness ?? 4;
    this.cap = style.cap ?? 'round';
    this.join = style.join ?? 'round';
    this.dash = style.dash && style.dash.length ? style.dash.slice() : null;
    this.dashOffset = style.dashOffset ?? 0;
    this.arrow = style.arrow ?? 0;
    if (opts) this.set(opts);
  }

  override get kind(): string {
    return 'Line';
  }

  setPoints(points: GraphicsPoints): this {
    this.points = flattenPoints(points);
    return this;
  }

  /** Sets a two-point line without allocating. */
  setEnds(x0: number, y0: number, x1: number, y1: number): this {
    const p = this.points;
    p.length = 4;
    p[0] = x0;
    p[1] = y0;
    p[2] = x1;
    p[3] = y1;
    return this;
  }

  /** Total polyline length. */
  get length(): number {
    const p = this.points;
    let len = 0;
    for (let i = 2; i + 1 < p.length; i += 2) len += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
    return len;
  }

  override draw(ctx: Ctx2D): void {
    const p = this.points;
    const n = p.length >> 1;
    if (n < 2 || this.thickness <= 0) return;
    const style = resolvePaintStyle(ctx, this.color);
    const ex = p[n * 2 - 2]!;
    const ey = p[n * 2 - 1]!;
    let ux = 0;
    let uy = 0;
    if (this.arrow > 0) {
      const dx = ex - p[n * 2 - 4]!;
      const dy = ey - p[n * 2 - 3]!;
      const len = Math.hypot(dx, dy) || 1;
      ux = dx / len;
      uy = dy / len;
    }
    const shorten = this.arrow > 0 ? this.arrow * 0.7 : 0;
    ctx.beginPath();
    ctx.moveTo(p[0]!, p[1]!);
    for (let i = 1; i < n - 1; i++) ctx.lineTo(p[i * 2]!, p[i * 2 + 1]!);
    ctx.lineTo(ex - ux * shorten, ey - uy * shorten);
    ctx.strokeStyle = style;
    ctx.lineWidth = this.thickness;
    ctx.lineCap = this.cap;
    ctx.lineJoin = this.join;
    if (this.dash) {
      ctx.setLineDash(this.dash);
      ctx.lineDashOffset = this.dashOffset;
    }
    ctx.stroke();
    if (this.dash) ctx.setLineDash(NO_DASH);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    if (this.arrow > 0) {
      const a = this.arrow;
      const hw = Math.max(a * 0.55, this.thickness);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * a - uy * hw, ey - uy * a + ux * hw);
      ctx.lineTo(ex - ux * a + uy * hw, ey - uy * a - ux * hw);
      ctx.closePath();
      ctx.fillStyle = style;
      ctx.fill();
    }
  }

  override describe() {
    return {
      ...super.describe(),
      pts: this.points.length >> 1,
      len: Math.round(this.length),
      color: describePaintStyle(this.color),
      dash: this.dash ? this.dash.join(',') : undefined,
    };
  }
}

/** A Line with a default dash pattern and optional marching-ants animation (`dashSpeed`, units per second). */
export class DashedLine extends Line {
  dashSpeed: number;

  constructor(points: GraphicsPoints, style: LineStyle & { dashSpeed?: number } = {}, opts?: NodeOptions) {
    super(points, { dash: [16, 10], ...style }, opts);
    this.dashSpeed = style.dashSpeed ?? 0;
  }

  override get kind(): string {
    return 'DashedLine';
  }

  override update(dt: number): void {
    if (this.dashSpeed === 0 || !this.dash) return;
    let period = 0;
    for (const d of this.dash) period += d;
    this.dashOffset -= this.dashSpeed * dt;
    if (period > 0) this.dashOffset %= period * (this.dash.length % 2 === 1 ? 2 : 1);
  }
}

// ------------------------------------------------------------------ ArcProgress

export interface ArcProgressOptions extends NodeOptions {
  /** Outer radius; the node is (2 * radius) square (default 40). */
  radius?: number;
  /** Ring thickness (default 10; ignored in 'pie' mode). */
  thickness?: number;
  /** Progress 0..1. */
  value?: number;
  color?: PaintStyle;
  /** Background ring / disc (null = none). */
  trackColor?: Color | null;
  /** Degrees, -90 = top (default). */
  startAngle?: number;
  clockwise?: boolean;
  cap?: 'round' | 'butt';
  /** 'ring' (default) or 'pie' (filled wedge, e.g. a cooldown overlay). */
  mode?: 'ring' | 'pie';
}

/** Ring / pie progress indicator for cooldowns, timers and loading. Set `value` (0..1) every frame. */
export class ArcProgress extends Node {
  value: number;
  radius: number;
  thickness: number;
  color: PaintStyle;
  trackColor: Color | null;
  startAngle: number;
  clockwise: boolean;
  cap: 'round' | 'butt';
  mode: 'ring' | 'pie';

  constructor(opts: ArcProgressOptions = {}) {
    super();
    this.radius = opts.radius ?? 40;
    this.thickness = opts.thickness ?? 10;
    this.value = opts.value ?? 0;
    this.color = opts.color ?? '#3b82f6';
    this.trackColor = opts.trackColor === undefined ? 'rgba(255,255,255,0.15)' : opts.trackColor;
    this.startAngle = opts.startAngle ?? -90;
    this.clockwise = opts.clockwise ?? true;
    this.cap = opts.cap ?? 'round';
    this.mode = opts.mode ?? 'ring';
    this.width = this.height = this.radius * 2;
    this.set(opts);
  }

  override get kind(): string {
    return 'ArcProgress';
  }

  override draw(ctx: Ctx2D): void {
    const r = this.radius;
    if (r <= 0) return;
    const v = clamp01(this.value);
    const a0 = (this.startAngle * Math.PI) / 180;
    const a1 = a0 + (this.clockwise ? 1 : -1) * v * TAU;
    if (this.mode === 'pie') {
      if (this.trackColor) {
        ctx.beginPath();
        ctx.arc(r, r, r, 0, TAU);
        ctx.fillStyle = this.trackColor;
        ctx.fill();
      }
      if (v <= 0) return;
      ctx.beginPath();
      if (v >= 1) ctx.arc(r, r, r, 0, TAU);
      else {
        ctx.moveTo(r, r);
        ctx.arc(r, r, r, a0, a1, !this.clockwise);
        ctx.closePath();
      }
      ctx.fillStyle = resolvePaintStyle(ctx, this.color);
      ctx.fill();
      return;
    }
    const t = Math.min(this.thickness, r);
    const rr = r - t / 2;
    ctx.lineWidth = t;
    if (this.trackColor) {
      ctx.beginPath();
      ctx.arc(r, r, rr, 0, TAU);
      ctx.strokeStyle = this.trackColor;
      ctx.stroke();
    }
    if (v <= 0) return;
    ctx.beginPath();
    if (v >= 1) ctx.arc(r, r, rr, 0, TAU);
    else ctx.arc(r, r, rr, a0, a1, !this.clockwise);
    ctx.lineCap = v >= 1 ? 'butt' : this.cap;
    ctx.strokeStyle = resolvePaintStyle(ctx, this.color);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  override describe() {
    return { ...super.describe(), value: +clamp01(this.value).toFixed(3), mode: this.mode };
  }
}
