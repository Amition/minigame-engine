import { withAlpha, type Color } from '../core/color';
import { Rng } from '../core/rng';
import { roundRectPath } from '../gfx/draw';
import { bakeTexture, type Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { Ctx2D } from '../gfx/types';
import { hueShade } from './palette';
import { svgPath } from './svgpath';

export type ArtShape =
  | 'star' | 'polygon' | 'heart' | 'gem' | 'coin' | 'blob' | 'cloud' | 'leaf' | 'drop' | 'bolt' | 'arrow'
  | 'bubble' | 'ribbon' | 'shield' | 'badge' | 'rays' | 'sparkle' | 'burst' | 'moon' | 'circle' | 'roundRect' | 'pill';

export const artShapes: readonly ArtShape[] = [
  'star', 'polygon', 'heart', 'gem', 'coin', 'blob', 'cloud', 'leaf', 'drop', 'bolt', 'arrow', 'bubble', 'ribbon',
  'shield', 'badge', 'rays', 'sparkle', 'burst', 'moon', 'circle', 'roundRect', 'pill',
];

/**
 * A colour, a list of colours (vertical gradient, top → bottom) or an explicit gradient.
 * angle: degrees, 90 = top → bottom, 0 = left → right. Radial gradients run from the centre outward.
 */
export type ArtFill = Color | readonly Color[] | { type: 'linear' | 'radial'; colors: readonly Color[]; angle?: number };

export interface ArtShapeStyle {
  fill?: ArtFill;
  /** Outline colour; 'auto' = dark hue-shifted shade of the fill ('rays' ignore 'auto' and shadow). */
  stroke?: Color | 'auto' | null;
  strokeWidth?: number;
  /** Turns a single fill colour into a soft top-light / bottom-dark gradient. */
  shade?: boolean;
  /** Glossy highlight: true = band + spot, 'spot', 'band', or a number (highlight alpha). */
  shine?: boolean | 'spot' | 'band' | number;
  /** Drop shadow below the shape: true = soft offset shadow. */
  shadow?: boolean | { color?: Color; x?: number; y?: number; blur?: number };
  /** Shape-specific details (gem facets, coin face, leaf vein, ribbon folds). Default true. */
  details?: boolean;
}

export interface ArtShapeParams {
  /** star / sparkle / burst / rays / badge: number of points (defaults 5 / 4 / 12 / 12 / 12). */
  points?: number;
  /** star / burst: inner radius as a fraction of the outer (default 0.5 / 0.72). */
  inner?: number;
  /** polygon: number of sides (default 6). */
  sides?: number;
  /** Corner rounding in px (star, polygon, bolt, arrow, roundRect, bubble). */
  radius?: number;
  /** Degrees (star, polygon, rays, burst). */
  rotation?: number;
  /** blob / cloud / burst variation. */
  seed?: number;
  /** blob irregularity 0..1 (default 0.25). */
  wobble?: number;
  /** arrow direction (default 'right'). */
  direction?: 'right' | 'left' | 'up' | 'down';
  /** bubble tail position (default 'left'). */
  tail?: 'left' | 'right' | 'center' | 'none';
}

export type ArtShapeOptions = ArtShapeStyle & ArtShapeParams;

type Pt = [number, number];

// ---------------------------------------------------------------- geometry helpers

/** Closed polygon with every corner rounded by up to `radius` (clamped so arcs never overlap). */
export function roundPolygonPath(ctx: Ctx2D, pts: readonly Pt[], radius = 0): void {
  const n = pts.length;
  if (n < 3) return;
  if (radius <= 0) {
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
    ctx.closePath();
    return;
  }
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i - 1 + n) % n]!;
    const [cx, cy] = pts[i]!;
    const [nx, ny] = pts[(i + 1) % n]!;
    const v1x = px - cx;
    const v1y = py - cy;
    const v2x = nx - cx;
    const v2y = ny - cy;
    const l1 = Math.hypot(v1x, v1y) || 1;
    const l2 = Math.hypot(v2x, v2y) || 1;
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
    const ang = Math.acos(cos);
    const t = Math.tan(ang / 2);
    if (t < 1e-4 || ang > Math.PI - 1e-4) {
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
      continue;
    }
    const r = Math.min(radius, (Math.min(l1, l2) / 2) * t);
    const d = r / t;
    const ax = cx + (v1x / l1) * d;
    const ay = cy + (v1y / l1) * d;
    if (i === 0) ctx.moveTo(ax, ay);
    else ctx.lineTo(ax, ay);
    ctx.arcTo(cx, cy, cx + (v2x / l2) * d, cy + (v2y / l2) * d, r);
  }
  ctx.closePath();
}

/** Scales points uniformly to fit (contain) and centres them in the box. */
function fitPoints(pts: Pt[], x: number, y: number, w: number, h: number): Pt[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of pts) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const s = Math.min(w / bw, h / bh);
  const ox = x + (w - bw * s) / 2 - minX * s;
  const oy = y + (h - bh * s) / 2 - minY * s;
  return pts.map(([px, py]) => [ox + px * s, oy + py * s]);
}

function starPoints(points: number, inner: number, rotationDeg: number): Pt[] {
  const out: Pt[] = [];
  const n = Math.max(2, Math.floor(points));
  const rot = (rotationDeg * Math.PI) / 180 - Math.PI / 2;
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    const r = i % 2 ? inner : 1;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** Runs `draw` in a 100×100 design space mapped onto the box (paths only; restore keeps the path). */
function unitPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, d: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / 100, h / 100);
  svgPath(ctx, d);
  ctx.restore();
}

const HEART = 'M50 96C22 76 2 58 2 34C2 15 15 3 30 3C40 3 46 9 50 17C54 9 60 3 70 3C85 3 98 15 98 34C98 58 78 76 50 96Z';
const DROP = 'M50 2C58 16 86 44 86 64C86 84 70 98 50 98C30 98 14 84 14 64C14 44 42 16 50 2Z';
const LEAF = 'M50 2C78 18 94 44 86 70C80 88 64 96 50 98C36 96 20 88 14 70C6 44 22 18 50 2Z';
const SHIELD = 'M50 3C64 11 80 14 94 14C94 50 88 78 50 97C12 78 6 50 6 14C20 14 36 11 50 3Z';
const BOLT: Pt[] = [[58, 0], [12, 57], [44, 57], [32, 100], [88, 38], [56, 38], [72, 0]];
const GEM: Pt[] = [[24, 6], [76, 6], [98, 36], [50, 96], [2, 36]];

function cloudCircles(w: number, h: number, seed: number | undefined): [number, number, number][] {
  const rng = new Rng(seed ?? 7);
  const j = (v: number) => (seed === undefined ? v : v * rng.float(0.9, 1.1));
  const base = h * 0.92;
  const r0 = j(h * 0.26);
  const r3 = j(h * 0.22);
  const c: [number, number, number][] = [
    [r0, base - r0, r0],
    [w * 0.36, h * 0.46, j(h * 0.3)],
    [w * 0.62, h * 0.4, j(h * 0.34)],
    [w - r3, base - r3, r3],
  ];
  return c;
}

function circleIntersect(a: [number, number, number], b: [number, number, number]): Pt | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > a[2] + b[2] || d < Math.abs(a[2] - b[2])) return null;
  const k = (a[2] * a[2] - b[2] * b[2] + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, a[2] * a[2] - k * k));
  const px = a[0] + (dx * k) / d;
  const py = a[1] + (dy * k) / d;
  const i1: Pt = [px + (dy * hh) / d, py - (dx * hh) / d];
  const i2: Pt = [px - (dy * hh) / d, py + (dx * hh) / d];
  return i1[1] < i2[1] ? i1 : i2;
}

function cloudPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, seed?: number): void {
  const cs = cloudCircles(w, h, seed).map(([cx, cy, r]) => [x + cx, y + cy, r] as [number, number, number]);
  const first = cs[0]!;
  const last = cs[cs.length - 1]!;
  ctx.moveTo(first[0], first[1] + first[2]);
  let startA = Math.PI / 2;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    const next = cs[i + 1];
    let endA = Math.PI / 2;
    if (next) {
      const p = circleIntersect(c, next);
      endA = p ? Math.atan2(p[1] - c[1], p[0] - c[0]) : -Math.PI / 2;
    }
    while (endA <= startA) endA += Math.PI * 2;
    while (endA - startA > Math.PI * 2) endA -= Math.PI * 2;
    ctx.arc(c[0], c[1], c[2], startA, endA, false);
    if (next) {
      const p = circleIntersect(c, next);
      startA = p ? Math.atan2(p[1] - next[1], p[0] - next[0]) : Math.PI;
    }
  }
  ctx.lineTo(last[0], last[1] + last[2]);
  ctx.closePath();
}

function blobPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, seed = 1, wobble = 0.25): void {
  const rng = new Rng(seed);
  const n = 7 + (seed % 3);
  const pts: Pt[] = [];
  const phase = rng.float(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const r = 1 - wobble * rng.float(0, 1);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const fit = fitPoints(pts, x, y, w, h);
  // Closed Catmull-Rom spline through the points.
  const P = (i: number) => fit[(i + n) % n]!;
  ctx.moveTo(P(0)[0], P(0)[1]);
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    );
  }
  ctx.closePath();
}

function bubblePath(ctx: Ctx2D, x: number, y: number, w: number, h: number, tail: string, radius?: number): void {
  const bh = tail === 'none' ? h : h * 0.8;
  const r = Math.min(radius ?? Math.min(w, bh) * 0.32, w / 2, bh / 2);
  const tw = Math.min(w * 0.2, bh * 0.45);
  const tx = tail === 'right' ? x + w * 0.72 : tail === 'center' ? x + w / 2 : x + w * 0.28;
  const tipX = tail === 'right' ? tx + tw * 0.55 : tail === 'center' ? tx : tx - tw * 0.55;
  const b = y + bh;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, b - r);
  ctx.arcTo(x + w, b, x + w - r, b, r);
  if (tail !== 'none') {
    ctx.lineTo(tx + tw / 2, b);
    ctx.lineTo(tipX, y + h);
    ctx.lineTo(tx - tw / 2, b);
  }
  ctx.lineTo(x + r, b);
  ctx.arcTo(x, b, x, b - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function ribbonParts(x: number, y: number, w: number, h: number) {
  const band: Pt[] = [[x + w * 0.12, y], [x + w * 0.88, y], [x + w * 0.88, y + h * 0.72], [x + w * 0.12, y + h * 0.72]];
  const tailL: Pt[] = [[x, y + h * 0.28], [x + w * 0.22, y + h * 0.28], [x + w * 0.22, y + h], [x, y + h], [x + w * 0.07, y + h * 0.64]];
  const tailR: Pt[] = tailL.map(([px, py]) => [2 * x + w - px, py]);
  const foldL: Pt[] = [[x + w * 0.12, y + h * 0.72], [x + w * 0.22, y + h * 0.72], [x + w * 0.22, y + h]];
  const foldR: Pt[] = foldL.map(([px, py]) => [2 * x + w - px, py]);
  return { band, tailL, tailR, foldL, foldR };
}

function moonPath(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
  const R = Math.min(w, h) / 2;
  const c1x = x + w / 2;
  const c1y = y + h / 2;
  const c2x = c1x + R * 0.42;
  const c2y = c1y - R * 0.28;
  const r2 = R * 0.82;
  const dx = c2x - c1x;
  const dy = c2y - c1y;
  const d = Math.hypot(dx, dy);
  const dir = Math.atan2(dy, dx);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (R * R - r2 * r2 + d * d) / (2 * d * R))));
  const ax = c1x + R * Math.cos(dir + alpha);
  const ay = c1y + R * Math.sin(dir + alpha);
  const bx = c1x + R * Math.cos(dir - alpha);
  const by = c1y + R * Math.sin(dir - alpha);
  ctx.moveTo(ax, ay);
  ctx.arc(c1x, c1y, R, dir + alpha, dir - alpha + Math.PI * 2, false);
  ctx.arc(c2x, c2y, r2, Math.atan2(by - c2y, bx - c2x), Math.atan2(ay - c2y, ax - c2x), true);
  ctx.closePath();
}

/**
 * Appends the outline of a named shape fitted into the box (x, y, w, h) to the current path.
 * Call ctx.beginPath() first; fill/stroke yourself or use drawArtShape for the styled version.
 */
export function traceArtShape(ctx: Ctx2D, shape: ArtShape, x: number, y: number, w: number, h: number, p: ArtShapeParams = {}): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const s = Math.min(w, h);
  switch (shape) {
    case 'star':
      roundPolygonPath(ctx, fitPoints(starPoints(p.points ?? 5, p.inner ?? 0.5, p.rotation ?? 0), x, y, w, h), p.radius ?? s * 0.04);
      break;
    case 'burst': {
      const rng = new Rng(p.seed ?? 3);
      const pts = starPoints(p.points ?? 12, p.inner ?? 0.72, p.rotation ?? 0).map(
        ([px, py], i) => (i % 2 ? [px, py] : [px * rng.float(0.9, 1.05), py * rng.float(0.9, 1.05)]) as Pt,
      );
      roundPolygonPath(ctx, fitPoints(pts, x, y, w, h), p.radius ?? s * 0.02);
      break;
    }
    case 'polygon': {
      const n = Math.max(3, p.sides ?? 6);
      const rot = ((p.rotation ?? 0) * Math.PI) / 180 - Math.PI / 2;
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++) pts.push([Math.cos(rot + (i / n) * Math.PI * 2), Math.sin(rot + (i / n) * Math.PI * 2)]);
      roundPolygonPath(ctx, fitPoints(pts, x, y, w, h), p.radius ?? s * 0.06);
      break;
    }
    case 'heart':
      unitPath(ctx, x, y, w, h, HEART);
      break;
    case 'drop':
      unitPath(ctx, x, y, w, h, DROP);
      break;
    case 'leaf':
      unitPath(ctx, x, y, w, h, LEAF);
      break;
    case 'shield':
      unitPath(ctx, x, y, w, h, SHIELD);
      break;
    case 'bolt':
      roundPolygonPath(ctx, fitPoints(BOLT, x, y, w, h), p.radius ?? s * 0.03);
      break;
    case 'gem':
      roundPolygonPath(ctx, fitPoints(GEM, x, y, w, h), p.radius ?? s * 0.02);
      break;
    case 'arrow': {
      const unit: Pt[] = [[0, 0.3], [0.52, 0.3], [0.52, 0.04], [1, 0.5], [0.52, 0.96], [0.52, 0.7], [0, 0.7]];
      const dir = p.direction ?? 'right';
      const map = ([u, v]: Pt): Pt =>
        dir === 'left' ? [1 - u, v] : dir === 'up' ? [v, 1 - u] : dir === 'down' ? [1 - v, u] : [u, v];
      roundPolygonPath(ctx, unit.map(map).map(([u, v]) => [x + u * w, y + v * h] as Pt), p.radius ?? s * 0.05);
      break;
    }
    case 'bubble':
      bubblePath(ctx, x, y, w, h, p.tail ?? 'left', p.radius);
      break;
    case 'ribbon': {
      const r = ribbonParts(x, y, w, h);
      roundPolygonPath(ctx, r.tailL, s * 0.02);
      roundPolygonPath(ctx, r.tailR, s * 0.02);
      roundPolygonPath(ctx, r.band, s * 0.04);
      break;
    }
    case 'badge': {
      const n = Math.max(3, p.points ?? 12);
      const R = s / 2;
      const steps = n * 12;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
        const r = R * (0.91 + 0.09 * Math.cos(a * n));
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'rays': {
      const n = Math.max(3, p.points ?? 12);
      const R = Math.hypot(w, h) / 2;
      const rot = ((p.rotation ?? 0) * Math.PI) / 180 - Math.PI / 2;
      for (let i = 0; i < n; i++) {
        const a0 = rot + (i / n) * Math.PI * 2 - Math.PI / (2 * n);
        const a1 = a0 + Math.PI / n;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
      }
      break;
    }
    case 'sparkle': {
      const n = Math.max(3, p.points ?? 4);
      const rx = w / 2;
      const ry = h / 2;
      const k = 0.18;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const b = a + Math.PI / n;
        const na = a + (Math.PI * 2) / n;
        if (i === 0) ctx.moveTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
        ctx.quadraticCurveTo(cx + Math.cos(b) * rx * k, cy + Math.sin(b) * ry * k, cx + Math.cos(na) * rx, cy + Math.sin(na) * ry);
      }
      ctx.closePath();
      break;
    }
    case 'moon':
      moonPath(ctx, x, y, w, h);
      break;
    case 'blob':
      blobPath(ctx, x, y, w, h, p.seed ?? 1, p.wobble ?? 0.25);
      break;
    case 'cloud':
      cloudPath(ctx, x, y, w, h, p.seed);
      break;
    case 'coin':
    case 'circle':
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'roundRect':
      roundRectPath(ctx, x, y, w, h, p.radius ?? s * 0.22);
      break;
    case 'pill':
      roundRectPath(ctx, x, y, w, h, s / 2);
      break;
  }
}

// ---------------------------------------------------------------- styling

/** Main colour of a fill (used for auto outline and shading). */
export function fillBaseColor(fill: ArtFill): Color {
  if (typeof fill === 'string') return fill;
  const list = Array.isArray(fill) ? (fill as readonly Color[]) : (fill as { colors: readonly Color[] }).colors;
  return list[Math.floor((list.length - 1) / 2)] ?? '#888888';
}

/** Builds a fillStyle for a box from an ArtFill. */
export function artFillStyle(ctx: Ctx2D, fill: ArtFill, x: number, y: number, w: number, h: number): string | CanvasGradient {
  if (typeof fill === 'string') return fill;
  const spec = Array.isArray(fill)
    ? { type: 'linear' as const, colors: fill as readonly Color[], angle: 90 }
    : (fill as { type: 'linear' | 'radial'; colors: readonly Color[]; angle?: number });
  const colors = spec.colors.length ? spec.colors : ['#888888'];
  if (colors.length === 1) return colors[0]!;
  const cx = x + w / 2;
  const cy = y + h / 2;
  let g: CanvasGradient;
  if (spec.type === 'radial') {
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2);
  } else {
    const a = ((spec.angle ?? 90) * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
  return g;
}

interface ShadowSpec {
  color: Color;
  x: number;
  y: number;
  blur: number;
}

function shadowSpec(s: ArtShapeStyle['shadow'], w: number, h: number): ShadowSpec | null {
  if (!s) return null;
  const d = Math.max(1.5, Math.min(w, h) * 0.05);
  const o = s === true ? {} : s;
  return { color: o.color ?? 'rgba(20,16,40,0.28)', x: o.x ?? 0, y: o.y ?? d, blur: o.blur ?? 0 };
}

const DEFAULT_FILL = '#ffc93c';

function withPath(ctx: Ctx2D, trace: () => void, fn: () => void): void {
  ctx.beginPath();
  trace();
  fn();
}

function drawDetails(ctx: Ctx2D, shape: ArtShape, x: number, y: number, w: number, h: number, base: Color): void {
  const s = Math.min(w, h);
  switch (shape) {
    case 'gem': {
      const [A, C, G3, P, G0] = fitPoints(GEM, x, y, w, h) as [Pt, Pt, Pt, Pt, Pt];
      const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const G1 = lerp(G0, G3, 0.29);
      const G2 = lerp(G0, G3, 0.71);
      const facets: [Pt[], number][] = [
        [[A, G1, G0], 0.12],
        [[A, C, G2, G1], 0.42],
        [[C, G3, G2], -0.12],
        [[G0, G1, P], -0.05],
        [[G1, G2, P], 0.18],
        [[G2, G3, P], -0.35],
      ];
      for (const [pts, k] of facets) {
        ctx.beginPath();
        roundPolygonPath(ctx, pts, 0);
        ctx.fillStyle = hueShade(base, k);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, s * 0.015);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(G0[0], G0[1]);
      ctx.lineTo(G3[0], G3[1]);
      ctx.moveTo(G1[0], G1[1]);
      ctx.lineTo(A[0], A[1]);
      ctx.moveTo(G2[0], G2[1]);
      ctx.lineTo(C[0], C[1]);
      ctx.moveTo(G1[0], G1[1]);
      ctx.lineTo(P[0], P[1]);
      ctx.lineTo(G2[0], G2[1]);
      ctx.stroke();
      break;
    }
    case 'coin': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = w / 2;
      const ry = h / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * 0.74, ry * 0.74, 0, 0, Math.PI * 2);
      ctx.fillStyle = artFillStyle(ctx, [hueShade(base, -0.28), hueShade(base, 0.12)], x, cy - ry * 0.74, w, ry * 1.48);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cy + ry * 0.03, rx * 0.64, ry * 0.64, 0, 0, Math.PI * 2);
      ctx.fillStyle = artFillStyle(ctx, [hueShade(base, 0.18), base], x, cy - ry * 0.64, w, ry * 1.28);
      ctx.fill();
      const starBox = s * 0.52;
      ctx.beginPath();
      traceArtShape(ctx, 'star', cx - starBox / 2, cy - starBox / 2 + s * 0.035, starBox, starBox);
      ctx.fillStyle = hueShade(base, -0.35);
      ctx.fill();
      ctx.beginPath();
      traceArtShape(ctx, 'star', cx - starBox / 2, cy - starBox / 2, starBox, starBox);
      ctx.fillStyle = hueShade(base, 0.45);
      ctx.fill();
      break;
    }
    case 'leaf': {
      ctx.strokeStyle = hueShade(base, -0.3);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.beginPath();
      ctx.moveTo(x + w * 0.5, y + h * 0.16);
      ctx.quadraticCurveTo(x + w * 0.53, y + h * 0.6, x + w * 0.5, y + h * 1.0);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, s * 0.025);
      ctx.beginPath();
      for (const t of [0.36, 0.54, 0.72]) {
        const vy = y + h * t;
        ctx.moveTo(x + w * 0.51, vy + h * 0.06);
        ctx.lineTo(x + w * 0.74, vy - h * 0.04);
        ctx.moveTo(x + w * 0.51, vy + h * 0.06);
        ctx.lineTo(x + w * 0.28, vy - h * 0.04);
      }
      ctx.stroke();
      break;
    }
    case 'shield': {
      ctx.beginPath();
      unitPath(ctx, x + w * 0.5, y, w * 0.5, h, 'M0 3C14 11 30 14 44 14C44 50 38 78 0 97Z');
      ctx.fillStyle = withAlpha(hueShade(base, -0.4), 0.35);
      ctx.fill();
      break;
    }
    case 'badge': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.strokeStyle = withAlpha(hueShade(base, 0.5), 0.8);
      ctx.setLineDash([s * 0.04, s * 0.04]);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
  }
}

function drawShine(ctx: Ctx2D, shape: ArtShape, x: number, y: number, w: number, h: number, shine: ArtShapeStyle['shine']): void {
  if (!shine) return;
  const mode = shine === 'spot' || shine === 'band' ? shine : 'both';
  const alpha = typeof shine === 'number' ? shine : 1;
  if (mode !== 'spot' && shape !== 'rays' && shape !== 'coin') {
    ctx.beginPath();
    ctx.ellipse(x + w * 0.5, y + h * 0.08, w * 0.62, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${(0.22 * alpha).toFixed(3)})`;
    ctx.fill();
  }
  if (mode !== 'band') {
    const sx = shape === 'heart' ? 0.27 : shape === 'drop' ? 0.36 : shape === 'star' ? 0.4 : 0.3;
    const sy = shape === 'heart' ? 0.24 : shape === 'drop' ? 0.52 : shape === 'star' ? 0.34 : 0.26;
    ctx.save();
    ctx.translate(x + w * sx, y + h * sy);
    ctx.rotate(-0.6);
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(1, w * 0.11), Math.max(0.6, h * 0.055), 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, 0.75 * alpha).toFixed(3)})`;
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Draws a styled shape into the box: optional drop shadow, fill (colour / gradient / auto shade), details,
 * glossy shine and outline. The outline is centred on the edge, so keep strokeWidth/2 of margin.
 *
 *     drawArtShape(ctx, 'star', 10, 10, 80, 80, { fill: '#ffc93c', stroke: 'auto', shine: true, shadow: true });
 */
export function drawArtShape(
  ctx: Ctx2D,
  shape: ArtShape,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: ArtShapeOptions = {},
  pixelScale = 1,
): void {
  const fill: ArtFill = opts.fill ?? DEFAULT_FILL;
  const base = fillBaseColor(fill);
  const soft = shape === 'rays';
  const strokeColor =
    opts.stroke === 'auto' ? (soft ? null : hueShade(base, -0.72, { range: 0.55 })) : (opts.stroke ?? null);
  const sw = strokeColor ? (opts.strokeWidth ?? Math.max(1.5, Math.min(w, h) * 0.05)) : 0;
  const shadow = soft ? null : shadowSpec(opts.shadow, w, h);
  const trace = () => traceArtShape(ctx, shape, x, y, w, h, opts);
  let bodyFill: ArtFill = fill;
  if (opts.shade && typeof fill === 'string') bodyFill = [hueShade(fill, 0.28), fill, hueShade(fill, -0.3)];
  if (shape === 'rays' && typeof fill === 'string') {
    bodyFill = { type: 'radial', colors: [withAlpha(fill, 0.95), withAlpha(fill, 0.5), withAlpha(fill, 0)] };
  }
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (shape === 'ribbon') {
    drawRibbon(ctx, x, y, w, h, bodyFill, base, strokeColor, sw, shadow, opts, pixelScale);
    ctx.restore();
    return;
  }

  if (shadow) {
    ctx.save();
    if (shadow.blur > 0) {
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = shadow.blur * pixelScale;
      ctx.shadowOffsetX = shadow.x * pixelScale;
      ctx.shadowOffsetY = shadow.y * pixelScale;
      withPath(ctx, trace, () => {
        ctx.fillStyle = '#000';
        ctx.fill();
      });
    } else {
      ctx.translate(shadow.x, shadow.y);
      withPath(ctx, trace, () => {
        ctx.fillStyle = shadow.color;
        ctx.fill();
        if (sw > 0) {
          ctx.strokeStyle = shadow.color;
          ctx.lineWidth = sw;
          ctx.stroke();
        }
      });
    }
    ctx.restore();
  }

  withPath(ctx, trace, () => {
    ctx.fillStyle = artFillStyle(ctx, bodyFill, x, y, w, h);
    ctx.fill();
  });

  const details = opts.details !== false;
  if ((details && shape !== 'rays') || opts.shine) {
    ctx.save();
    withPath(ctx, trace, () => ctx.clip());
    if (details) drawDetails(ctx, shape, x, y, w, h, base);
    drawShine(ctx, shape, x, y, w, h, opts.shine);
    ctx.restore();
  }

  if (strokeColor && sw > 0) {
    withPath(ctx, trace, () => {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = sw;
      ctx.stroke();
    });
  }
  ctx.restore();
}

function drawRibbon(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: ArtFill,
  base: Color,
  stroke: Color | null,
  sw: number,
  shadow: ShadowSpec | null,
  opts: ArtShapeOptions,
  pixelScale: number,
): void {
  const s = Math.min(w, h);
  const r = ribbonParts(x, y, w, h);
  const part = (pts: Pt[], style: string | CanvasGradient, radius: number, withStroke = true) => {
    ctx.beginPath();
    roundPolygonPath(ctx, pts, radius);
    ctx.fillStyle = style;
    ctx.fill();
    if (withStroke && stroke && sw > 0) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = sw;
      ctx.stroke();
    }
  };
  if (shadow) {
    ctx.save();
    ctx.translate(shadow.x, shadow.y);
    if (shadow.blur > 0) {
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = shadow.blur * pixelScale;
    }
    for (const pts of [r.tailL, r.tailR, r.band]) part(pts, shadow.color, s * 0.03, false);
    ctx.restore();
  }
  const dark = hueShade(base, -0.3);
  part(r.tailL, dark, s * 0.02);
  part(r.tailR, dark, s * 0.02);
  part(r.foldL, hueShade(base, -0.6), 0);
  part(r.foldR, hueShade(base, -0.6), 0);
  const [bx, by] = r.band[0]!;
  const bw = r.band[1]![0] - bx;
  const bh = r.band[2]![1] - by;
  ctx.beginPath();
  roundPolygonPath(ctx, r.band, s * 0.04);
  ctx.fillStyle = artFillStyle(ctx, fill, bx, by, bw, bh);
  ctx.fill();
  if (opts.shine) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(bx, by, bw, bh * 0.38);
    ctx.restore();
  }
  if (stroke && sw > 0) {
    ctx.beginPath();
    roundPolygonPath(ctx, r.band, s * 0.04);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sw;
    ctx.stroke();
  }
}

export interface ShapeTextureOptions extends ArtShapeOptions {
  /** Square size shortcut (default 64). */
  size?: number;
  width?: number;
  height?: number;
  resolution?: number;
  /** Register in the textures registry under this key. */
  key?: string;
}

const shapeCache = new Map<string, Texture>();

/**
 * Bakes a styled shape into a texture of exactly width×height (the shape is inset so outline and shadow fit).
 * Cached by options.
 *
 *     const star = shapeTexture('star', { size: 96, fill: '#ffc93c', stroke: 'auto', shine: true, shadow: true });
 */
export function shapeTexture(shape: ArtShape, opts: ShapeTextureOptions = {}): Texture {
  const w = opts.width ?? opts.size ?? 64;
  const h = opts.height ?? opts.size ?? 64;
  const res = opts.resolution ?? 1;
  const ck = `${shape}|${w}x${h}@${res}|${JSON.stringify({ ...opts, key: undefined })}`;
  let tex = shapeCache.get(ck);
  if (!tex) {
    const fill: ArtFill = opts.fill ?? DEFAULT_FILL;
    const hasStroke = !!opts.stroke;
    const sw = hasStroke ? (opts.strokeWidth ?? Math.max(1.5, Math.min(w, h) * 0.05)) : 0;
    const sh = shadowSpec(opts.shadow, w * 0.9, h * 0.9);
    const m = sw / 2 + 1;
    const blur = sh ? sh.blur : 0;
    const left = m + (sh ? Math.max(0, -sh.x) + blur : 0);
    const right = m + (sh ? Math.max(0, sh.x) + blur : 0);
    const top = m + (sh ? Math.max(0, -sh.y) + blur : 0);
    const bottom = m + (sh ? Math.max(0, sh.y) + blur : 0);
    const o: ArtShapeOptions = { ...opts, fill };
    if (sh && opts.shadow === true) o.shadow = sh;
    tex = bakeTexture(
      w,
      h,
      (ctx) => drawArtShape(ctx, shape, left, top, Math.max(1, w - left - right), Math.max(1, h - top - bottom), o, res),
      { resolution: res },
    );
    shapeCache.set(ck, tex);
  }
  if (opts.key) textures.set(opts.key, tex);
  return tex;
}
