import type { Rect } from '../core/math';

/** Segment/ray hit: t in [0, 1] along the segment, hit point and surface normal (0,0 when starting inside). */
export interface RayHit {
  t: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** Grid raycast hit: also the tile that was hit. */
export interface GridRayHit extends RayHit {
  tx: number;
  ty: number;
}

/** Overlap result: unit normal pointing from shape A to shape B and penetration depth. */
export interface Manifold {
  nx: number;
  ny: number;
  depth: number;
}

function writeRayHit(out: RayHit | undefined, t: number, x: number, y: number, nx: number, ny: number): RayHit {
  if (!out) return { t, x, y, nx, ny };
  out.t = t;
  out.x = x;
  out.y = y;
  out.nx = nx;
  out.ny = ny;
  return out;
}

function writeManifold(out: Manifold | undefined, nx: number, ny: number, depth: number): Manifold {
  if (!out) return { nx, ny, depth };
  out.nx = nx;
  out.ny = ny;
  out.depth = depth;
  return out;
}

/** Segment (x0,y0)→(x1,y1) against an axis-aligned rect (slab method). Writes into `out` when given. */
export function segmentVsRect(x0: number, y0: number, x1: number, y1: number, r: Rect, out?: RayHit): RayHit | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tmin = 0;
  let tmax = 1;
  let nx = 0;
  let ny = 0;
  if (dx === 0) {
    if (x0 < r.x || x0 > r.x + r.w) return null;
  } else {
    let t1 = (r.x - x0) / dx;
    let t2 = (r.x + r.w - x0) / dx;
    let n = -1;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = n;
      ny = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (dy === 0) {
    if (y0 < r.y || y0 > r.y + r.h) return null;
  } else {
    let t1 = (r.y - y0) / dy;
    let t2 = (r.y + r.h - y0) / dy;
    let n = -1;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = n;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return writeRayHit(out, tmin, x0 + dx * tmin, y0 + dy * tmin, nx, ny);
}

/** Segment against a circle. Writes into `out` when given. */
export function segmentVsCircle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  r: number,
  out?: RayHit,
): RayHit | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const mx = x0 - cx;
  const my = y0 - cy;
  const c = mx * mx + my * my - r * r;
  if (c <= 0) return writeRayHit(out, 0, x0, y0, 0, 0);
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (mx * dx + my * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return null;
  const x = x0 + dx * t;
  const y = y0 + dy * t;
  return writeRayHit(out, t, x, y, (x - cx) / r, (y - cy) / r);
}

/**
 * Grid raycast (Amanatides-Woo DDA) in grid-local units: visits every cell the segment crosses, in order, and
 * returns the first one where `solid(tx, ty)` is true. A segment starting in a solid cell hits at t = 0.
 */
export function raycastGrid(
  solid: (tx: number, ty: number) => boolean,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tileW: number,
  tileH = tileW,
  maxSteps = 4096,
): GridRayHit | null {
  let tx = Math.floor(x0 / tileW);
  let ty = Math.floor(y0 / tileH);
  if (solid(tx, ty)) return { t: 0, x: x0, y: y0, nx: 0, ny: 0, tx, ty };
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX ? tileW / Math.abs(dx) : Infinity;
  const tDeltaY = stepY ? tileH / Math.abs(dy) : Infinity;
  let tMaxX = stepX > 0 ? ((tx + 1) * tileW - x0) / dx : stepX < 0 ? (tx * tileW - x0) / dx : Infinity;
  let tMaxY = stepY > 0 ? ((ty + 1) * tileH - y0) / dy : stepY < 0 ? (ty * tileH - y0) / dy : Infinity;
  for (let i = 0; i < maxSteps; i++) {
    let t: number;
    let nx = 0;
    let ny = 0;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      if (t > 1) return null;
      tx += stepX;
      tMaxX += tDeltaX;
      nx = -stepX;
    } else {
      t = tMaxY;
      if (t > 1) return null;
      ty += stepY;
      tMaxY += tDeltaY;
      ny = -stepY;
    }
    if (solid(tx, ty)) return { t, x: x0 + dx * t, y: y0 + dy * t, nx, ny, tx, ty };
  }
  return null;
}

/**
 * Two AABBs given by center and half extents. Normal points from A to B along the axis of least penetration.
 * The overlap helpers write into `out` when given (no allocation) and return it, or null when apart.
 */
export function aabbOverlap(
  ax: number,
  ay: number,
  ahw: number,
  ahh: number,
  bx: number,
  by: number,
  bhw: number,
  bhh: number,
  out?: Manifold,
): Manifold | null {
  const dx = bx - ax;
  const px = ahw + bhw - Math.abs(dx);
  if (px <= 0) return null;
  const dy = by - ay;
  const py = ahh + bhh - Math.abs(dy);
  if (py <= 0) return null;
  if (px < py) return writeManifold(out, dx < 0 ? -1 : 1, 0, px);
  return writeManifold(out, 0, dy < 0 ? -1 : 1, py);
}

/** Two circles. */
export function circleOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
  out?: Manifold,
): Manifold | null {
  const dx = bx - ax;
  const dy = by - ay;
  const rr = ar + br;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2);
  if (d === 0) return writeManifold(out, 0, 1, rr);
  return writeManifold(out, dx / d, dy / d, rr - d);
}

/** AABB (center, half extents) against a circle. Normal points from the box to the circle. */
export function aabbCircleOverlap(
  bx: number,
  by: number,
  hw: number,
  hh: number,
  cx: number,
  cy: number,
  r: number,
  out?: Manifold,
): Manifold | null {
  const dx = cx - bx;
  const dy = cy - by;
  const qx = Math.max(-hw, Math.min(hw, dx));
  const qy = Math.max(-hh, Math.min(hh, dy));
  const inside = qx === dx && qy === dy;
  if (inside) {
    const px = hw - Math.abs(dx);
    const py = hh - Math.abs(dy);
    if (px < py) return writeManifold(out, dx < 0 ? -1 : 1, 0, px + r);
    return writeManifold(out, 0, dy < 0 ? -1 : 1, py + r);
  }
  const ex = dx - qx;
  const ey = dy - qy;
  const d2 = ex * ex + ey * ey;
  if (d2 >= r * r) return null;
  const d = Math.sqrt(d2);
  return writeManifold(out, ex / d, ey / d, r - d);
}
