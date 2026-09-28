import { TAU, type Rect, type Vec2 } from '../core/math';
import { roundRectPath } from '../gfx/draw';
import { bakeTexture, type Texture } from '../gfx/texture';
import type { Ctx2D } from '../gfx/types';
import type { ShadowStyle } from '../scene/box';
import { Node, type NodeOptions } from '../scene/node';
import { describePaintStyle, resolvePaintStyle, type PaintStyle } from './paint';

export interface GraphicsOptions extends NodeOptions {
  /** width/height follow the drawn bounds (default true unless width or height is given). */
  autoSize?: boolean;
}

export interface GraphicsFillOptions {
  /** Multiplies the node alpha for this fill. */
  alpha?: number;
  shadow?: ShadowStyle | null;
  /** 'evenodd' punches holes where subpaths overlap (e.g. a ring from two circles). */
  rule?: 'nonzero' | 'evenodd';
}

export interface GraphicsStrokeOptions {
  cap?: CanvasLineCap;
  join?: CanvasLineJoin;
  /** Dash pattern in local units, e.g. [12, 8]. */
  dash?: number[] | null;
  dashOffset?: number;
  miterLimit?: number;
  alpha?: number;
  shadow?: ShadowStyle | null;
}

/** Points as a flat list `[x0, y0, x1, y1, ...]` or as objects. */
export type GraphicsPoints = readonly number[] | readonly Vec2[];

type GCmd =
  | { k: 'begin' }
  | { k: 'move' | 'line'; x: number; y: number }
  | { k: 'quad'; cx: number; cy: number; x: number; y: number }
  | { k: 'bezier'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { k: 'arc'; x: number; y: number; r: number; a0: number; a1: number; ccw: boolean }
  | { k: 'arcTo'; x1: number; y1: number; x2: number; y2: number; r: number }
  | { k: 'circle'; x: number; y: number; r: number }
  | { k: 'ellipse'; x: number; y: number; rx: number; ry: number; rot: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number }
  | { k: 'rrect'; x: number; y: number; w: number; h: number; r: number | [number, number, number, number] }
  | { k: 'poly'; pts: number[]; close: boolean }
  | { k: 'close' }
  | { k: 'fill'; style: PaintStyle; alpha: number; shadow: ShadowStyle | null; evenOdd: boolean }
  | {
      k: 'stroke';
      style: PaintStyle;
      width: number;
      cap: CanvasLineCap;
      join: CanvasLineJoin;
      dash: number[] | null;
      dashOffset: number;
      miter: number;
      alpha: number;
      shadow: ShadowStyle | null;
    };

class Box2 {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  get empty(): boolean {
    return this.minX > this.maxX;
  }

  reset(): void {
    this.minX = this.minY = Infinity;
    this.maxX = this.maxY = -Infinity;
  }

  add(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }

  addBox(b: Box2, pad: number): void {
    if (b.empty) return;
    this.add(b.minX - pad, b.minY - pad);
    this.add(b.maxX + pad, b.maxY + pad);
  }
}

const EMPTY_DASH: number[] = [];
const mod = (v: number, m: number) => ((v % m) + m) % m;

/** Flattens GraphicsPoints to `[x0, y0, x1, y1, ...]`. */
export function flattenPoints(points: GraphicsPoints): number[] {
  if (points.length === 0) return [];
  if (typeof points[0] === 'number') return (points as readonly number[]).slice();
  const out: number[] = [];
  for (const p of points as readonly Vec2[]) out.push(p.x, p.y);
  return out;
}

/** Vertices of a regular polygon (flat list), first vertex at `rotation` (radians, 0 = right, default: pointing up). */
export function regularPolygonPoints(x: number, y: number, radius: number, sides: number, rotation = -Math.PI / 2): number[] {
  const n = Math.max(3, Math.floor(sides));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = rotation + (i * TAU) / n;
    out.push(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
  }
  return out;
}

/** Vertices of a star (flat list) with `points` tips; first tip at `rotation` (default: pointing up). */
export function starPoints(
  x: number,
  y: number,
  points: number,
  outer: number,
  inner = outer * 0.5,
  rotation = -Math.PI / 2,
): number[] {
  const n = Math.max(2, Math.floor(points));
  const out: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i * Math.PI) / n;
    out.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  return out;
}

/**
 * Retained vector drawing with a chainable API (coordinates are the node's local space):
 *
 *     new Graphics({ x: 100, y: 100 })
 *       .roundRect(0, 0, 200, 80, 16).fill({ type: 'linear', x0: 0, y0: 0, x1: 0, y1: 80, stops: [[0, '#6cf'], [1, '#36c']] })
 *       .stroke('#fff', 4)
 *       .circle(100, 140, 30).fill('#f55', { shadow: { color: '#0006', blur: 8, y: 4 } });
 *
 * Shape calls add to the current path; fill()/stroke() paint it (both may follow the same shape); the next shape
 * call after a fill/stroke starts a new path. With autoSize (default) width/height follow the painted bounds and
 * hit tests / dumps use the `bounds` rect, which may start at negative coordinates (e.g. circle(0, 0, r)).
 * Anchors still offset by anchor * size from the local origin, so combine anchors with shapes drawn from (0, 0).
 */
export class Graphics extends Node {
  autoSize: boolean;
  private cmds: GCmd[] = [];
  private draws = 0;
  private pathUsed = false;
  private cx = 0;
  private cy = 0;
  private sx = 0;
  private sy = 0;
  private readonly pathBox = new Box2();
  private readonly totalBox = new Box2();
  private maxPad = 0;
  private readonly _bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(opts: GraphicsOptions = {}) {
    super();
    this.autoSize = opts.autoSize ?? (opts.width === undefined && opts.height === undefined);
    this.set(opts);
  }

  override get kind(): string {
    return 'Graphics';
  }

  /** Painted bounds in local coordinates (stroke widths included, shadows excluded). */
  get bounds(): Readonly<Rect> {
    return this._bounds;
  }

  /** Number of recorded commands. */
  get commandCount(): number {
    return this.cmds.length;
  }

  /** Removes all commands and resets bounds. */
  clear(): this {
    this.cmds = [];
    this.draws = 0;
    this.pathUsed = false;
    this.cx = this.cy = this.sx = this.sy = 0;
    this.pathBox.reset();
    this.totalBox.reset();
    this.maxPad = 0;
    this.syncBounds();
    return this;
  }

  // ---------------------------------------------------------------- path commands

  /** Explicitly starts a new path. */
  beginPath(): this {
    this.cmds.push({ k: 'begin' });
    this.pathBox.reset();
    this.pathUsed = false;
    return this;
  }

  moveTo(x: number, y: number): this {
    this.pathCmd({ k: 'move', x, y });
    this.pathBox.add(x, y);
    this.cx = this.sx = x;
    this.cy = this.sy = y;
    return this;
  }

  lineTo(x: number, y: number): this {
    this.pathCmd({ k: 'line', x, y });
    this.pathBox.add(this.cx, this.cy);
    this.pathBox.add(x, y);
    this.cx = x;
    this.cy = y;
    return this;
  }

  quadTo(cpx: number, cpy: number, x: number, y: number): this {
    this.pathCmd({ k: 'quad', cx: cpx, cy: cpy, x, y });
    const b = this.pathBox;
    const x0 = this.cx;
    const y0 = this.cy;
    b.add(x0, y0);
    b.add(x, y);
    const tx = quadExtremum(x0, cpx, x);
    const ty = quadExtremum(y0, cpy, y);
    if (tx > 0 && tx < 1) b.add(quadAt(x0, cpx, x, tx), quadAt(y0, cpy, y, tx));
    if (ty > 0 && ty < 1) b.add(quadAt(x0, cpx, x, ty), quadAt(y0, cpy, y, ty));
    this.cx = x;
    this.cy = y;
    return this;
  }

  bezierTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.pathCmd({ k: 'bezier', c1x, c1y, c2x, c2y, x, y });
    const b = this.pathBox;
    const x0 = this.cx;
    const y0 = this.cy;
    b.add(x0, y0);
    b.add(x, y);
    const add = (t: number) => {
      if (t > 0 && t < 1) b.add(cubicAt(x0, c1x, c2x, x, t), cubicAt(y0, c1y, c2y, y, t));
    };
    cubicExtrema(x0, c1x, c2x, x, add);
    cubicExtrema(y0, c1y, c2y, y, add);
    this.cx = x;
    this.cy = y;
    return this;
  }

  /** Circular arc (radians, canvas semantics: connects from the current point). */
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false): this {
    this.pathCmd({ k: 'arc', x, y, r: radius, a0: startAngle, a1: endAngle, ccw: counterclockwise });
    if (this.hasCurrent()) this.pathBox.add(this.cx, this.cy);
    addArcBounds(this.pathBox, x, y, radius, startAngle, endAngle, counterclockwise);
    this.cx = x + Math.cos(endAngle) * radius;
    this.cy = y + Math.sin(endAngle) * radius;
    return this;
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): this {
    this.pathCmd({ k: 'arcTo', x1, y1, x2, y2, r: radius });
    const b = this.pathBox;
    const x0 = this.cx;
    const y0 = this.cy;
    b.add(x0, y0);
    const ux = x0 - x1;
    const uy = y0 - y1;
    const vx = x2 - x1;
    const vy = y2 - y1;
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    const cross = ux * vy - uy * vx;
    if (radius <= 0 || lu === 0 || lv === 0 || Math.abs(cross) < 1e-9) {
      b.add(x1, y1);
      this.cx = x1;
      this.cy = y1;
      return this;
    }
    const cos = (ux * vx + uy * vy) / (lu * lv);
    const half = Math.acos(Math.max(-1, Math.min(1, cos))) / 2;
    const d = radius / Math.tan(half);
    const t1x = x1 + (ux / lu) * d;
    const t1y = y1 + (uy / lu) * d;
    const t2x = x1 + (vx / lv) * d;
    const t2y = y1 + (vy / lv) * d;
    const bx = ux / lu + vx / lv;
    const by = uy / lu + vy / lv;
    const bl = Math.hypot(bx, by) || 1;
    const cd = radius / Math.sin(half);
    const ccx = x1 + (bx / bl) * cd;
    const ccy = y1 + (by / bl) * cd;
    b.add(t1x, t1y);
    b.add(t2x, t2y);
    b.add(ccx - (bx / bl) * radius, ccy - (by / bl) * radius);
    this.cx = t2x;
    this.cy = t2y;
    return this;
  }

  closePath(): this {
    this.pathCmd({ k: 'close' });
    this.cx = this.sx;
    this.cy = this.sy;
    return this;
  }

  // ---------------------------------------------------------------- shapes

  rect(x: number, y: number, w: number, h: number): this {
    this.pathCmd({ k: 'rect', x, y, w, h });
    this.pathBox.add(x, y);
    this.pathBox.add(x + w, y + h);
    this.setCurrent(x, y);
    return this;
  }

  /** Rounded rectangle; radius or [topLeft, topRight, bottomRight, bottomLeft]. */
  roundRect(x: number, y: number, w: number, h: number, radius: number | [number, number, number, number]): this {
    this.pathCmd({ k: 'rrect', x, y, w, h, r: Array.isArray(radius) ? [...radius] : radius });
    this.pathBox.add(x, y);
    this.pathBox.add(x + w, y + h);
    this.setCurrent(x, y);
    return this;
  }

  circle(x: number, y: number, radius: number): this {
    this.pathCmd({ k: 'circle', x, y, r: radius });
    this.pathBox.add(x - radius, y - radius);
    this.pathBox.add(x + radius, y + radius);
    this.setCurrent(x + radius, y);
    return this;
  }

  /** Full ellipse with radii (rx, ry), optionally rotated (radians). */
  ellipse(x: number, y: number, rx: number, ry: number, rotation = 0): this {
    this.pathCmd({ k: 'ellipse', x, y, rx, ry, rot: rotation });
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const hw = Math.sqrt(rx * rx * c * c + ry * ry * s * s);
    const hh = Math.sqrt(rx * rx * s * s + ry * ry * c * c);
    this.pathBox.add(x - hw, y - hh);
    this.pathBox.add(x + hw, y + hh);
    this.setCurrent(x + rx * c, y + rx * s);
    return this;
  }

  /** Closed polygon through the points. */
  polygon(points: GraphicsPoints): this {
    return this.poly(flattenPoints(points), true);
  }

  /** Open polyline through the points (stroke it). */
  polyline(points: GraphicsPoints): this {
    return this.poly(flattenPoints(points), false);
  }

  /** Straight segment as its own subpath. */
  line(x0: number, y0: number, x1: number, y1: number): this {
    return this.poly([x0, y0, x1, y1], false);
  }

  /** Regular polygon centered at (x, y); rotation in radians (default: a vertex points up). */
  regularPolygon(x: number, y: number, radius: number, sides: number, rotation?: number): this {
    return this.poly(regularPolygonPoints(x, y, radius, sides, rotation), true);
  }

  /** Star with `points` tips; inner radius defaults to half the outer one. */
  star(x: number, y: number, points: number, outerRadius: number, innerRadius?: number, rotation?: number): this {
    return this.poly(starPoints(x, y, points, outerRadius, innerRadius, rotation), true);
  }

  // ---------------------------------------------------------------- paint

  /** Fills the current path with a color or gradient. */
  fill(style: PaintStyle = '#ffffff', opts: GraphicsFillOptions = {}): this {
    this.cmds.push({
      k: 'fill',
      style,
      alpha: opts.alpha ?? 1,
      shadow: opts.shadow ?? null,
      evenOdd: opts.rule === 'evenodd',
    });
    this.draws++;
    this.totalBox.addBox(this.pathBox, 0);
    if (opts.shadow) this.maxPad = Math.max(this.maxPad, shadowPad(opts.shadow));
    this.pathUsed = true;
    this.syncBounds();
    return this;
  }

  /** Strokes the current path: `stroke('#fff', 4, { cap: 'round', dash: [10, 6] })`. */
  stroke(style: PaintStyle = '#ffffff', width = 1, opts: GraphicsStrokeOptions = {}): this {
    this.cmds.push({
      k: 'stroke',
      style,
      width,
      cap: opts.cap ?? 'butt',
      join: opts.join ?? 'miter',
      dash: opts.dash && opts.dash.length ? opts.dash.slice() : null,
      dashOffset: opts.dashOffset ?? 0,
      miter: opts.miterLimit ?? 10,
      alpha: opts.alpha ?? 1,
      shadow: opts.shadow ?? null,
    });
    this.draws++;
    this.totalBox.addBox(this.pathBox, width / 2);
    const join = opts.join ?? 'miter';
    this.maxPad = Math.max(this.maxPad, join === 'miter' ? width * 2 : width / 2);
    if (opts.shadow) this.maxPad = Math.max(this.maxPad, width / 2 + shadowPad(opts.shadow));
    this.pathUsed = true;
    this.syncBounds();
    return this;
  }

  // ---------------------------------------------------------------- output

  /**
   * Renders the commands into a texture. The texture's top-left corresponds to local
   * (bounds.x - padding, bounds.y - padding); padding defaults to room for miter joins and shadows.
   */
  bake(resolution = 1, opts: { key?: string; padding?: number } = {}): Texture {
    const b = this._bounds;
    const pad = Math.ceil(opts.padding ?? this.maxPad);
    return bakeTexture(
      b.w + pad * 2,
      b.h + pad * 2,
      (ctx) => {
        ctx.translate(pad - b.x, pad - b.y);
        this.draw(ctx);
      },
      { resolution, ...(opts.key ? { key: opts.key } : {}) },
    );
  }

  override draw(ctx: Ctx2D): void {
    if (this.cmds.length === 0) return;
    const base = ctx.globalAlpha;
    ctx.beginPath();
    for (const c of this.cmds) {
      switch (c.k) {
        case 'begin':
          ctx.beginPath();
          break;
        case 'move':
          ctx.moveTo(c.x, c.y);
          break;
        case 'line':
          ctx.lineTo(c.x, c.y);
          break;
        case 'quad':
          ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
          break;
        case 'bezier':
          ctx.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, c.x, c.y);
          break;
        case 'arc':
          ctx.arc(c.x, c.y, c.r, c.a0, c.a1, c.ccw);
          break;
        case 'arcTo':
          ctx.arcTo(c.x1, c.y1, c.x2, c.y2, c.r);
          break;
        case 'circle':
          ctx.moveTo(c.x + c.r, c.y);
          ctx.arc(c.x, c.y, c.r, 0, TAU);
          break;
        case 'ellipse':
          ctx.moveTo(c.x + c.rx * Math.cos(c.rot), c.y + c.rx * Math.sin(c.rot));
          ctx.ellipse(c.x, c.y, c.rx, c.ry, c.rot, 0, TAU);
          break;
        case 'rect':
          ctx.rect(c.x, c.y, c.w, c.h);
          break;
        case 'rrect':
          roundRectPath(ctx, c.x, c.y, c.w, c.h, c.r);
          break;
        case 'poly': {
          const p = c.pts;
          if (p.length < 2) break;
          ctx.moveTo(p[0]!, p[1]!);
          for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
          if (c.close) ctx.closePath();
          break;
        }
        case 'close':
          ctx.closePath();
          break;
        case 'fill':
          ctx.fillStyle = resolvePaintStyle(ctx, c.style);
          ctx.globalAlpha = base * c.alpha;
          if (c.shadow) applyShadow(ctx, c.shadow);
          if (c.evenOdd) ctx.fill('evenodd');
          else ctx.fill();
          if (c.shadow) clearShadow(ctx);
          break;
        case 'stroke':
          if (c.width <= 0) break;
          ctx.strokeStyle = resolvePaintStyle(ctx, c.style);
          ctx.globalAlpha = base * c.alpha;
          ctx.lineWidth = c.width;
          ctx.lineCap = c.cap;
          ctx.lineJoin = c.join;
          ctx.miterLimit = c.miter;
          ctx.setLineDash(c.dash ?? EMPTY_DASH);
          ctx.lineDashOffset = c.dashOffset;
          if (c.shadow) applyShadow(ctx, c.shadow);
          ctx.stroke();
          if (c.shadow) clearShadow(ctx);
          if (c.dash) ctx.setLineDash(EMPTY_DASH);
          break;
      }
    }
    ctx.globalAlpha = base;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 10;
  }

  override hitTest(lx: number, ly: number): boolean {
    if (!this.autoSize) return super.hitTest(lx, ly);
    const b = this._bounds;
    const p = this.hitPadding;
    return lx >= b.x - p && ly >= b.y - p && lx < b.x + b.w + p && ly < b.y + b.h + p;
  }

  override worldBounds(): Rect {
    return this.autoSize ? this.worldMatrix().applyRect(this._bounds) : super.worldBounds();
  }

  override worldCenter(): Vec2 {
    if (!this.autoSize) return super.worldCenter();
    const b = this._bounds;
    return this.toWorld(b.x + b.w / 2, b.y + b.h / 2);
  }

  protected override renderContent(ctx: Ctx2D): void {
    if (!this.clip || !this.autoSize) return super.renderContent(ctx);
    const b = this._bounds;
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    this.renderDraw(ctx);
    this.renderChildren(ctx);
    this.renderDrawOver(ctx);
  }

  override describe() {
    const first = this.cmds.find((c) => c.k === 'fill' || c.k === 'stroke') as
      | { style: PaintStyle }
      | undefined;
    return {
      ...super.describe(),
      cmds: this.cmds.length,
      draws: this.draws,
      paint: describePaintStyle(first?.style),
    };
  }

  // ---------------------------------------------------------------- internals

  private poly(pts: number[], close: boolean): this {
    if (pts.length < 2) return this;
    this.pathCmd({ k: 'poly', pts, close });
    for (let i = 0; i + 1 < pts.length; i += 2) this.pathBox.add(pts[i]!, pts[i + 1]!);
    this.sx = pts[0]!;
    this.sy = pts[1]!;
    if (close) {
      this.cx = this.sx;
      this.cy = this.sy;
    } else {
      this.cx = pts[pts.length - 2]!;
      this.cy = pts[pts.length - 1]!;
    }
    return this;
  }

  private pathCmd(c: GCmd): void {
    if (this.pathUsed) {
      this.cmds.push({ k: 'begin' });
      this.pathBox.reset();
      this.pathUsed = false;
    }
    this.cmds.push(c);
  }

  private hasCurrent(): boolean {
    return !this.pathBox.empty;
  }

  private setCurrent(x: number, y: number): void {
    this.cx = this.sx = x;
    this.cy = this.sy = y;
  }

  private syncBounds(): void {
    const t = this.totalBox;
    const b = this._bounds;
    if (t.empty) {
      b.x = b.y = b.w = b.h = 0;
    } else {
      b.x = t.minX;
      b.y = t.minY;
      b.w = t.maxX - t.minX;
      b.h = t.maxY - t.minY;
    }
    if (this.autoSize) {
      this.width = b.w;
      this.height = b.h;
    }
  }
}

function applyShadow(ctx: Ctx2D, s: ShadowStyle): void {
  ctx.shadowColor = s.color;
  ctx.shadowBlur = s.blur;
  ctx.shadowOffsetX = s.x ?? 0;
  ctx.shadowOffsetY = s.y ?? 0;
}

function clearShadow(ctx: Ctx2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

const shadowPad = (s: ShadowStyle) => s.blur + Math.max(Math.abs(s.x ?? 0), Math.abs(s.y ?? 0));

const quadAt = (a: number, b: number, c: number, t: number) => {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
};

const quadExtremum = (a: number, b: number, c: number) => {
  const d = a - 2 * b + c;
  return d === 0 ? -1 : (a - b) / d;
};

const cubicAt = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/** Calls fn with each t where the cubic's derivative is zero. */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number, fn: (t: number) => void): void {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) fn(-c / b);
    return;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return;
  const sq = Math.sqrt(disc);
  fn((-b + sq) / (2 * a));
  fn((-b - sq) / (2 * a));
}

function addArcBounds(b: Box2, x: number, y: number, r: number, a0: number, a1: number, ccw: boolean): void {
  let start: number;
  let sweep: number;
  if (!ccw) {
    start = a0;
    sweep = a1 - a0 >= TAU ? TAU : mod(a1 - a0, TAU);
  } else {
    start = a1;
    sweep = a0 - a1 >= TAU ? TAU : mod(a0 - a1, TAU);
  }
  b.add(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
  b.add(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    if (sweep >= TAU || mod(a - start, TAU) <= sweep) b.add(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
}
