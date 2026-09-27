import type { Vec2 } from './math';

// Geometry queries and ballistics for projectile / ragdoll games. Screen space: y down, angles in radians,
// positive = clockwise (same as Node.rotation and Math.atan2(dy, dx)). A sweep tests the segment
// (x0, y0) -> (x1, y1), e.g. one frame of an arrow's flight, and returns the first parameter 0..1 along it where
// it enters the shape, or null. Starting inside counts as 0; touching the boundary counts as a hit.
// Everything is pure and allocation-free when an `out` object is passed.

/** Rectangle centred on (x, y), `w` x `h`, rotated by `angle` radians around its centre (default 0). */
export interface GeomBox {
  x: number;
  y: number;
  w: number;
  h: number;
  angle?: number;
}

/** Closest points of two segments: parameter 0..1 along each and their squared distance. */
export interface GeomClosestPair {
  s: number;
  t: number;
  d2: number;
}

/** Closest point on a segment: position, parameter 0..1 along the segment, squared distance to the query point. */
export interface GeomClosestPoint {
  x: number;
  y: number;
  t: number;
  d2: number;
}

const EPS = 1e-9;

// ---------------------------------------------------------------- closest points

/**
 * Closest points of segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9): `s` along the first,
 * `t` along the second, `d2` the squared distance between the two points. Degenerate segments act as points.
 *
 *     const c = closestSegmentSegment(x0, y0, x1, y1, ax, ay, bx, by, scratch);
 *     if (c.d2 <= r * r) hit(); // the segment touches the capsule a-b of radius r
 */
export function closestSegmentSegment(
  p1x: number,
  p1y: number,
  q1x: number,
  q1y: number,
  p2x: number,
  p2y: number,
  q2x: number,
  q2y: number,
  out: GeomClosestPair = { s: 0, t: 0, d2: 0 },
): GeomClosestPair {
  const d1x = q1x - p1x;
  const d1y = q1y - p1y;
  const d2x = q2x - p2x;
  const d2y = q2y - p2y;
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s = 0;
  let t = 0;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    t = unit(f / e);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) {
      s = unit(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom > EPS ? unit((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = unit(-c / a);
      } else if (t > 1) {
        t = 1;
        s = unit((b - c) / a);
      }
    }
  }
  const cx = p1x + d1x * s - (p2x + d2x * t);
  const cy = p1y + d1y * s - (p2y + d2y * t);
  out.s = s;
  out.t = t;
  out.d2 = cx * cx + cy * cy;
  return out;
}

/** Point of segment a-b closest to (px, py). A degenerate segment returns a (t = 0). */
export function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  out: GeomClosestPoint = { x: 0, y: 0, t: 0, d2: 0 },
): GeomClosestPoint {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  const t = l2 > EPS ? unit(((px - ax) * ex + (py - ay) * ey) / l2) : 0;
  const x = ax + ex * t;
  const y = ay + ey * t;
  const dx = px - x;
  const dy = py - y;
  out.x = x;
  out.y = y;
  out.t = t;
  out.d2 = dx * dx + dy * dy;
  return out;
}

// ---------------------------------------------------------------- sweeps

/** First parameter 0..1 where the segment enters the circle (cx, cy, r), or null. Starting inside returns 0. */
export function sweepSegmentCircle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  r: number,
): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a < EPS) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * First parameter 0..1 where the segment enters the capsule a-b of radius r (a thick line: a limb, a rope, a laser),
 * or null. Exact: the entry point lies on the capsule surface. A degenerate capsule (a = b) is a circle.
 */
export function sweepSegmentCapsule(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): number | null {
  let best = sweepSegmentCircle(x0, y0, x1, y1, ax, ay, r);
  if (best === 0) return 0;
  const ex = bx - ax;
  const ey = by - ay;
  const len = Math.sqrt(ex * ex + ey * ey);
  if (len < EPS) return best;
  best = minParam(best, sweepSegmentCircle(x0, y0, x1, y1, bx, by, r));
  if (best === 0) return 0;
  const ux = ex / len;
  const uy = ey / len;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const rx0 = x0 - mx;
  const ry0 = y0 - my;
  const rx1 = x1 - mx;
  const ry1 = y1 - my;
  const side = localBoxEntry(rx0 * ux + ry0 * uy, -rx0 * uy + ry0 * ux, rx1 * ux + ry1 * uy, -rx1 * uy + ry1 * ux, len / 2, r);
  return minParam(best, side);
}

/** First parameter 0..1 where the segment enters the (rotated) box, or null (Liang-Barsky in box space). */
export function sweepSegmentBox(x0: number, y0: number, x1: number, y1: number, box: GeomBox): number | null {
  const angle = box.angle ?? 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ax = x0 - box.x;
  const ay = y0 - box.y;
  const bx = x1 - box.x;
  const by = y1 - box.y;
  return localBoxEntry(ax * c + ay * s, -ax * s + ay * c, bx * c + by * s, -bx * s + by * c, box.w / 2, box.h / 2);
}

/**
 * Moving circle vs static circle: the circle of radius `r` travels (x0, y0) -> (x1, y1); returns the first
 * parameter 0..1 where it touches the circle (cx, cy, cr), or null. Overlapping at the start returns 0.
 */
export function sweepCircleCircle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  cx: number,
  cy: number,
  cr: number,
): number | null {
  return sweepSegmentCircle(x0, y0, x1, y1, cx, cy, r + cr);
}

/**
 * Moving circle vs static (rotated) box: the circle of radius `r` travels (x0, y0) -> (x1, y1); returns the first
 * parameter 0..1 where it touches the box, or null. Exact, including the rounded corners. Overlapping at the start
 * returns 0.
 */
export function sweepCircleBox(x0: number, y0: number, x1: number, y1: number, r: number, box: GeomBox): number | null {
  const angle = box.angle ?? 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ax = x0 - box.x;
  const ay = y0 - box.y;
  const bx = x1 - box.x;
  const by = y1 - box.y;
  const lx0 = ax * c + ay * s;
  const ly0 = -ax * s + ay * c;
  const lx1 = bx * c + by * s;
  const ly1 = -bx * s + by * c;
  const hx = box.w / 2;
  const hy = box.h / 2;
  let best = localBoxEntry(lx0, ly0, lx1, ly1, hx + r, hy);
  if (r <= 0 || best === 0) return best;
  best = minParam(best, localBoxEntry(lx0, ly0, lx1, ly1, hx, hy + r));
  for (let i = 0; i < 4 && best !== 0; i++) {
    best = minParam(best, sweepSegmentCircle(lx0, ly0, lx1, ly1, i & 1 ? hx : -hx, i & 2 ? hy : -hy, r));
  }
  return best;
}

// ---------------------------------------------------------------- box frames

/** World point -> box-local coordinates (origin at the box centre, x along its width). */
export function boxToLocal(box: GeomBox, x: number, y: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const angle = box.angle ?? 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = x - box.x;
  const dy = y - box.y;
  out.x = dx * c + dy * s;
  out.y = -dx * s + dy * c;
  return out;
}

/** Box-local point -> world coordinates; inverse of boxToLocal. Pins things (stuck arrows, decals) to a moving box. */
export function boxToWorld(box: GeomBox, lx: number, ly: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const angle = box.angle ?? 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out.x = box.x + lx * c - ly * s;
  out.y = box.y + lx * s + ly * c;
  return out;
}

/** True when (x, y) is inside the box or on its edge; `pad` grows (or, negative, shrinks) it on every side. */
export function boxContainsPoint(box: GeomBox, x: number, y: number, pad = 0): boolean {
  const angle = box.angle ?? 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = x - box.x;
  const dy = y - box.y;
  return Math.abs(dx * c + dy * s) <= box.w / 2 + pad && Math.abs(-dx * s + dy * c) <= box.h / 2 + pad;
}

// ---------------------------------------------------------------- ballistics

/** A launch: speed (units/s) and angle (radians, screen space). */
export interface BallisticLaunch {
  speed: number;
  angle: number;
}

/** A point of a flight and the time (s) it is reached. */
export interface BallisticPoint {
  x: number;
  y: number;
  t: number;
}

export interface BallisticPathOptions {
  /** Seconds between samples (default 1/30). */
  step?: number;
  /** Seconds of flight sampled (default 2). */
  maxTime?: number;
  /**
   * Stop condition, e.g. `(x, y) => y > groundY`. The path ends with the first point where it returns true,
   * refined by bisection to lie on the crossing (within step / 4096 s).
   */
  until?: (x: number, y: number) => boolean;
}

/**
 * Launch angle that sends a projectile from the origin through (dx, dy) at `speed` under `gravity` (units/s², y down,
 * > 0 pulls down; 0 means a straight line). The flatter arc, or the lob with `high`; null when out of range.
 * Radians like Math.atan2(vy, vx): -PI/2 is straight up. Leftward shots return PI - elevation, in (PI/2, 3PI/2), so
 * they stay continuous around PI (a left-facing archer) instead of wrapping to atan2's (-PI, PI].
 *
 *     const a = ballisticAngle(tx - x, ty - y, 1300, 1400);
 *     if (a !== null) fire(Math.cos(a) * 1300, Math.sin(a) * 1300);
 */
export function ballisticAngle(dx: number, dy: number, speed: number, gravity: number, high = false): number | null {
  if (!(speed > 0)) return null;
  if (!(gravity > 0)) return Math.atan2(dy, dx);
  const x = Math.abs(dx);
  const y = -dy;
  const v2 = speed * speed;
  if (x < 1e-6) {
    if (dy >= 0) return high ? -Math.PI / 2 : Math.PI / 2;
    return 2 * gravity * y <= v2 ? -Math.PI / 2 : null;
  }
  const disc = v2 * v2 - gravity * (gravity * x * x + 2 * y * v2);
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const up = Math.atan((v2 + (high ? root : -root)) / (gravity * x));
  return dx >= 0 ? -up : Math.PI + up;
}

/**
 * Slowest launch speed that reaches (dx, dy) under `gravity`; `out` also receives that speed and its angle (the
 * two arcs of ballisticAngle meet there). Aim a little faster: at exactly this speed rounding can make
 * ballisticAngle return null.
 */
export function ballisticMinSpeed(dx: number, dy: number, gravity: number, out?: BallisticLaunch): number {
  if (!(gravity > 0)) {
    if (out) {
      out.speed = 0;
      out.angle = Math.atan2(dy, dx);
    }
    return 0;
  }
  const speed = Math.sqrt(Math.max(0, gravity * (Math.hypot(dx, dy) - dy)));
  if (out) {
    const up = (Math.PI / 2 + Math.atan2(-dy, Math.abs(dx))) / 2;
    out.speed = speed;
    out.angle = dx >= 0 ? -up : Math.PI + up;
  }
  return speed;
}

/** Position after `t` seconds of flight from (x0, y0) with velocity (vx, vy) under `gravity` (exact parabola). */
export function ballisticPosition(
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  gravity: number,
  t: number,
  out: Vec2 = { x: 0, y: 0 },
): Vec2 {
  out.x = x0 + vx * t;
  out.y = y0 + vy * t + 0.5 * gravity * t * t;
  return out;
}

/** Seconds until the projectile has moved `dx` horizontally, or null when it never does (vx is 0 or points away). */
export function ballisticTimeToX(dx: number, vx: number): number | null {
  if (dx === 0) return 0;
  if (vx === 0) return null;
  const t = dx / vx;
  return t >= 0 ? t : null;
}

/** Highest point of the flight (smallest y) and when it is reached; the start (t = 0) when already falling. */
export function ballisticApex(
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  gravity: number,
  out: BallisticPoint = { x: 0, y: 0, t: 0 },
): BallisticPoint {
  if (!(gravity > 0) || vy >= 0) {
    out.x = x0;
    out.y = y0;
    out.t = 0;
    return out;
  }
  const t = -vy / gravity;
  out.x = x0 + vx * t;
  out.y = y0 - (vy * vy) / (2 * gravity);
  out.t = t;
  return out;
}

/**
 * Samples the flight into flat [x0, y0, x1, y1, ...] (cleared first) for aim previews: one point per `step` seconds
 * up to `maxTime`, ending early at the crossing where `until` becomes true.
 *
 *     const pts = ballisticPath(x, y, vx, vy, 1400, { maxTime: 1, until: (px, py) => py > groundY }, this.pts);
 */
export function ballisticPath(
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  gravity: number,
  opts: BallisticPathOptions = {},
  out: number[] = [],
): number[] {
  const step = opts.step !== undefined && opts.step > 0 ? opts.step : 1 / 30;
  const maxTime = Math.max(0, opts.maxTime ?? 2);
  const until = opts.until;
  out.length = 0;
  out.push(x0, y0);
  if (until && until(x0, y0)) return out;
  const n = Math.ceil(maxTime / step - 1e-9);
  let prev = 0;
  for (let i = 1; i <= n; i++) {
    const t = Math.min(i * step, maxTime);
    const x = x0 + vx * t;
    const y = y0 + vy * t + 0.5 * gravity * t * t;
    if (until && until(x, y)) {
      let lo = prev;
      let hi = t;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (until(x0 + vx * mid, y0 + vy * mid + 0.5 * gravity * mid * mid)) hi = mid;
        else lo = mid;
      }
      out.push(x0 + vx * hi, y0 + vy * hi + 0.5 * gravity * hi * hi);
      return out;
    }
    out.push(x, y);
    prev = t;
  }
  return out;
}

// ---------------------------------------------------------------- internals

function unit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function minParam(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null || a <= b ? a : b;
}

let clipT0 = 0;
let clipT1 = 1;

/** One Liang-Barsky boundary: narrows [clipT0, clipT1]; false when the segment is entirely outside it. */
function clipEdge(p: number, q: number): boolean {
  if (Math.abs(p) < 1e-12) return q >= 0;
  const r = q / p;
  if (p < 0) {
    if (r > clipT1) return false;
    if (r > clipT0) clipT0 = r;
  } else {
    if (r < clipT0) return false;
    if (r < clipT1) clipT1 = r;
  }
  return true;
}

/** Entry parameter of the local segment (lx0, ly0) -> (lx1, ly1) into the centred box with half extents hx, hy. */
function localBoxEntry(lx0: number, ly0: number, lx1: number, ly1: number, hx: number, hy: number): number | null {
  const dx = lx1 - lx0;
  const dy = ly1 - ly0;
  clipT0 = 0;
  clipT1 = 1;
  if (!clipEdge(-dx, lx0 + hx) || !clipEdge(dx, hx - lx0) || !clipEdge(-dy, ly0 + hy) || !clipEdge(dy, hy - ly0)) return null;
  return clipT0 <= clipT1 ? clipT0 : null;
}
