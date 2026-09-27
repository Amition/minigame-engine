/**
 * Narrowphase for RigidWorld (internal): Box2D-style contact manifolds for circle/circle, polygon/circle and
 * polygon/polygon (SAT + reference-face clipping, up to two points with feature ids for warm starting), plus ray
 * casts. Manifold points are stored in body-local space so the position solver can re-evaluate separations.
 */
import type { RigidBody } from './rigid-body';
import type { RigidPolygonShape } from './rigid-shapes';

/** Manifold types: circles (point/point), face of A (polygon A's edge is the reference), face of B. */
export const RIGID_CIRCLES = 0;
export const RIGID_FACE_A = 1;
export const RIGID_FACE_B = 2;

const FEATURE_VERTEX = 0;
const FEATURE_FACE = 1;

/** Local-space manifold (Box2D b2Manifold). */
export interface RigidManifold {
  type: number;
  /** Local normal (face types) in the reference body's frame. */
  lnx: number;
  lny: number;
  /** Local reference point: circle centre (circles) or reference face centre (face types). */
  lpx: number;
  lpy: number;
  count: number;
  /** Contact points in the incident body's frame (circles: body B's circle centre). */
  px: [number, number];
  py: [number, number];
  /** Feature ids (for matching accumulated impulses between steps). */
  id: [number, number];
}

export const newRigidManifold = (): RigidManifold => ({
  type: RIGID_CIRCLES,
  lnx: 0,
  lny: 0,
  lpx: 0,
  lpy: 0,
  count: 0,
  px: [0, 0],
  py: [0, 0],
  id: [0, 0],
});

const radiusOf = (b: RigidBody): number => (b.shape.type === 'circle' ? b.shape.radius : 0);

/**
 * Computes the manifold of a (polygon or circle) against b. When the shapes are mixed, `a` must be the polygon.
 * Points closer than `margin` are included (speculative / "touching" contacts).
 */
export function collideRigid(m: RigidManifold, a: RigidBody, b: RigidBody, margin: number): void {
  m.count = 0;
  const sa = a.shape;
  const sb = b.shape;
  if (sa.type === 'circle') {
    if (sb.type === 'circle') collideCircles(m, a, sa.radius, b, sb.radius, margin);
    return;
  }
  if (sb.type === 'circle') collidePolygonCircle(m, a, sa, b, sb.radius, margin);
  else collidePolygons(m, a, sa, b, sb, margin);
}

function collideCircles(m: RigidManifold, a: RigidBody, ra: number, b: RigidBody, rb: number, margin: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const r = ra + rb + margin;
  if (dx * dx + dy * dy > r * r) return;
  m.type = RIGID_CIRCLES;
  m.lpx = m.lpy = m.lnx = m.lny = 0;
  m.count = 1;
  m.px[0] = m.py[0] = 0;
  m.id[0] = 0;
}

function collidePolygonCircle(
  m: RigidManifold,
  a: RigidBody,
  poly: RigidPolygonShape,
  b: RigidBody,
  rb: number,
  margin: number,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cx = a.c * dx + a.s * dy;
  const cy = -a.s * dx + a.c * dy;
  const radius = rb + margin;
  const v = poly.vertices;
  const n = poly.normals;
  const count = poly.count;
  let normalIndex = 0;
  let separation = -Infinity;
  for (let i = 0; i < count; i++) {
    const s = n[i * 2]! * (cx - v[i * 2]!) + n[i * 2 + 1]! * (cy - v[i * 2 + 1]!);
    if (s > radius) return;
    if (s > separation) {
      separation = s;
      normalIndex = i;
    }
  }
  const i1 = normalIndex;
  const i2 = i1 + 1 < count ? i1 + 1 : 0;
  const v1x = v[i1 * 2]!;
  const v1y = v[i1 * 2 + 1]!;
  const v2x = v[i2 * 2]!;
  const v2y = v[i2 * 2 + 1]!;
  m.type = RIGID_FACE_A;
  m.px[0] = m.py[0] = 0;
  m.id[0] = 0;
  if (separation < 1e-10) {
    m.lnx = n[i1 * 2]!;
    m.lny = n[i1 * 2 + 1]!;
    m.lpx = (v1x + v2x) / 2;
    m.lpy = (v1y + v2y) / 2;
    m.count = 1;
    return;
  }
  const u1 = (cx - v1x) * (v2x - v1x) + (cy - v1y) * (v2y - v1y);
  const u2 = (cx - v2x) * (v1x - v2x) + (cy - v2y) * (v1y - v2y);
  if (u1 <= 0 || u2 <= 0) {
    const px = u1 <= 0 ? v1x : v2x;
    const py = u1 <= 0 ? v1y : v2y;
    const ex = cx - px;
    const ey = cy - py;
    const d2 = ex * ex + ey * ey;
    if (d2 > radius * radius) return;
    const d = Math.sqrt(d2);
    if (d > 1e-12) {
      m.lnx = ex / d;
      m.lny = ey / d;
    } else {
      m.lnx = n[i1 * 2]!;
      m.lny = n[i1 * 2 + 1]!;
    }
    m.lpx = px;
    m.lpy = py;
  } else {
    const fx = (v1x + v2x) / 2;
    const fy = (v1y + v2y) / 2;
    const s = (cx - fx) * n[i1 * 2]! + (cy - fy) * n[i1 * 2 + 1]!;
    if (s > radius) return;
    m.lnx = n[i1 * 2]!;
    m.lny = n[i1 * 2 + 1]!;
    m.lpx = fx;
    m.lpy = fy;
  }
  m.count = 1;
}

/** B's face must separate by this much more than A's to become the reference (avoids flip-flopping). */
const FLIP_TOLERANCE = 0.025;

let sepEdge = 0;

/** Max separation of poly2 from the edge normals of poly1 (Box2D b2FindMaxSeparation); sets sepEdge. */
function findMaxSeparation(p1: RigidPolygonShape, b1: RigidBody, p2: RigidPolygonShape, b2: RigidBody): number {
  const c = b2.c * b1.c + b2.s * b1.s;
  const s = b2.c * b1.s - b2.s * b1.c;
  const dx = b1.x - b2.x;
  const dy = b1.y - b2.y;
  const tx = b2.c * dx + b2.s * dy;
  const ty = -b2.s * dx + b2.c * dy;
  const v1 = p1.vertices;
  const n1 = p1.normals;
  const v2 = p2.vertices;
  const count2 = p2.count;
  let best = 0;
  let maxSep = -Infinity;
  for (let i = 0; i < p1.count; i++) {
    const lnx = n1[i * 2]!;
    const lny = n1[i * 2 + 1]!;
    const nx = c * lnx - s * lny;
    const ny = s * lnx + c * lny;
    const lvx = v1[i * 2]!;
    const lvy = v1[i * 2 + 1]!;
    const vx = c * lvx - s * lvy + tx;
    const vy = s * lvx + c * lvy + ty;
    let si = Infinity;
    for (let j = 0; j < count2; j++) {
      const sij = nx * (v2[j * 2]! - vx) + ny * (v2[j * 2 + 1]! - vy);
      if (sij < si) si = sij;
    }
    if (si > maxSep) {
      maxSep = si;
      best = i;
    }
  }
  sepEdge = best;
  return maxSep;
}

// Clip scratch: incident edge (in), after the first side plane (c1), after the second (c2). World space.
const inX = [0, 0];
const inY = [0, 0];
const inId = [0, 0];
const c1X = [0, 0];
const c1Y = [0, 0];
const c1Id = [0, 0];
const c2X = [0, 0];
const c2Y = [0, 0];
const c2Id = [0, 0];

const featureId = (indexA: number, indexB: number, typeA: number, typeB: number): number =>
  indexA | (indexB << 8) | (typeA << 16) | (typeB << 24);

/** Sutherland-Hodgman clip of a 2-point segment against the half-plane dot(n, p) <= offset. */
function clipSegment(
  xs: number[],
  ys: number[],
  ids: number[],
  ox: number[],
  oy: number[],
  oid: number[],
  nx: number,
  ny: number,
  offset: number,
  vertexIndexA: number,
): number {
  let count = 0;
  const d0 = nx * xs[0]! + ny * ys[0]! - offset;
  const d1 = nx * xs[1]! + ny * ys[1]! - offset;
  if (d0 <= 0) {
    ox[count] = xs[0]!;
    oy[count] = ys[0]!;
    oid[count++] = ids[0]!;
  }
  if (d1 <= 0) {
    ox[count] = xs[1]!;
    oy[count] = ys[1]!;
    oid[count++] = ids[1]!;
  }
  if (d0 * d1 < 0 && count < 2) {
    const t = d0 / (d0 - d1);
    ox[count] = xs[0]! + t * (xs[1]! - xs[0]!);
    oy[count] = ys[0]! + t * (ys[1]! - ys[0]!);
    oid[count++] = featureId(vertexIndexA, (ids[0]! >> 8) & 0xff, FEATURE_VERTEX, FEATURE_FACE);
  }
  return count;
}

function collidePolygons(
  m: RigidManifold,
  a: RigidBody,
  pa: RigidPolygonShape,
  b: RigidBody,
  pb: RigidPolygonShape,
  margin: number,
): void {
  const sepA = findMaxSeparation(pa, a, pb, b);
  if (sepA > margin) return;
  const edgeA = sepEdge;
  const sepB = findMaxSeparation(pb, b, pa, a);
  if (sepB > margin) return;
  const edgeB = sepEdge;

  let p1: RigidPolygonShape;
  let p2: RigidPolygonShape;
  let b1: RigidBody;
  let b2: RigidBody;
  let edge1: number;
  let flip: boolean;
  if (sepB > sepA + FLIP_TOLERANCE) {
    p1 = pb;
    p2 = pa;
    b1 = b;
    b2 = a;
    edge1 = edgeB;
    flip = true;
  } else {
    p1 = pa;
    p2 = pb;
    b1 = a;
    b2 = b;
    edge1 = edgeA;
    flip = false;
  }

  // Incident edge on p2: the edge whose normal is most anti-parallel to the reference normal.
  const n1 = p1.normals;
  const v1 = p1.vertices;
  const rnx = n1[edge1 * 2]!;
  const rny = n1[edge1 * 2 + 1]!;
  const wnx = b1.c * rnx - b1.s * rny;
  const wny = b1.s * rnx + b1.c * rny;
  const inx = b2.c * wnx + b2.s * wny;
  const iny = -b2.s * wnx + b2.c * wny;
  const n2 = p2.normals;
  const v2 = p2.vertices;
  const count2 = p2.count;
  let index = 0;
  let minDot = Infinity;
  for (let i = 0; i < count2; i++) {
    const d = inx * n2[i * 2]! + iny * n2[i * 2 + 1]!;
    if (d < minDot) {
      minDot = d;
      index = i;
    }
  }
  const j1 = index;
  const j2 = j1 + 1 < count2 ? j1 + 1 : 0;
  inX[0] = b2.x + b2.c * v2[j1 * 2]! - b2.s * v2[j1 * 2 + 1]!;
  inY[0] = b2.y + b2.s * v2[j1 * 2]! + b2.c * v2[j1 * 2 + 1]!;
  inId[0] = featureId(edge1, j1, FEATURE_FACE, FEATURE_VERTEX);
  inX[1] = b2.x + b2.c * v2[j2 * 2]! - b2.s * v2[j2 * 2 + 1]!;
  inY[1] = b2.y + b2.s * v2[j2 * 2]! + b2.c * v2[j2 * 2 + 1]!;
  inId[1] = featureId(edge1, j2, FEATURE_FACE, FEATURE_VERTEX);

  const count1 = p1.count;
  const iv1 = edge1;
  const iv2 = edge1 + 1 < count1 ? edge1 + 1 : 0;
  const l11x = v1[iv1 * 2]!;
  const l11y = v1[iv1 * 2 + 1]!;
  const l12x = v1[iv2 * 2]!;
  const l12y = v1[iv2 * 2 + 1]!;
  let ltx = l12x - l11x;
  let lty = l12y - l11y;
  const len = Math.hypot(ltx, lty);
  ltx /= len;
  lty /= len;
  const tx = b1.c * ltx - b1.s * lty;
  const ty = b1.s * ltx + b1.c * lty;
  const nx = ty;
  const ny = -tx;
  const w11x = b1.x + b1.c * l11x - b1.s * l11y;
  const w11y = b1.y + b1.s * l11x + b1.c * l11y;
  const w12x = b1.x + b1.c * l12x - b1.s * l12y;
  const w12y = b1.y + b1.s * l12x + b1.c * l12y;
  const frontOffset = nx * w11x + ny * w11y;
  const sideOffset1 = -(tx * w11x + ty * w11y) + margin;
  const sideOffset2 = tx * w12x + ty * w12y + margin;

  if (clipSegment(inX, inY, inId, c1X, c1Y, c1Id, -tx, -ty, sideOffset1, iv1) < 2) return;
  if (clipSegment(c1X, c1Y, c1Id, c2X, c2Y, c2Id, tx, ty, sideOffset2, iv2) < 2) return;

  m.type = flip ? RIGID_FACE_B : RIGID_FACE_A;
  m.lnx = lty;
  m.lny = -ltx;
  m.lpx = (l11x + l12x) / 2;
  m.lpy = (l11y + l12y) / 2;
  let count = 0;
  for (let i = 0; i < 2; i++) {
    const wx = c2X[i]!;
    const wy = c2Y[i]!;
    if (nx * wx + ny * wy - frontOffset > margin) continue;
    const dx = wx - b2.x;
    const dy = wy - b2.y;
    m.px[count] = b2.c * dx + b2.s * dy;
    m.py[count] = -b2.s * dx + b2.c * dy;
    let id = c2Id[i]!;
    if (flip) {
      const ia = id & 0xff;
      const ib = (id >> 8) & 0xff;
      const ta = (id >> 16) & 0xff;
      const tb = (id >> 24) & 0xff;
      id = featureId(ib, ia, tb, ta);
    }
    m.id[count] = id;
    count++;
  }
  m.count = count;
}

/** Scratch world manifold produced by rigidWorldManifold. */
export interface RigidWorldPoint {
  nx: number;
  ny: number;
  x: [number, number];
  y: [number, number];
  separation: [number, number];
}

/**
 * World normal (from a to b), contact points (midway between the surfaces) and separations of a local manifold
 * at the bodies' current poses (Box2D b2WorldManifold).
 */
export function rigidWorldManifold(out: RigidWorldPoint, m: RigidManifold, a: RigidBody, b: RigidBody): void {
  const ra = radiusOf(a);
  const rb = radiusOf(b);
  if (m.type === RIGID_CIRCLES) {
    const pax = a.x + a.c * m.lpx - a.s * m.lpy;
    const pay = a.y + a.s * m.lpx + a.c * m.lpy;
    const pbx = b.x + b.c * m.px[0] - b.s * m.py[0];
    const pby = b.y + b.s * m.px[0] + b.c * m.py[0];
    let nx = 1;
    let ny = 0;
    const dx = pbx - pax;
    const dy = pby - pay;
    const d = Math.hypot(dx, dy);
    if (d > 1e-12) {
      nx = dx / d;
      ny = dy / d;
    }
    const cax = pax + ra * nx;
    const cay = pay + ra * ny;
    const cbx = pbx - rb * nx;
    const cby = pby - rb * ny;
    out.nx = nx;
    out.ny = ny;
    out.x[0] = (cax + cbx) / 2;
    out.y[0] = (cay + cby) / 2;
    out.separation[0] = (cbx - cax) * nx + (cby - cay) * ny;
    return;
  }
  const ref = m.type === RIGID_FACE_A ? a : b;
  const inc = m.type === RIGID_FACE_A ? b : a;
  const rRef = m.type === RIGID_FACE_A ? ra : rb;
  const rInc = m.type === RIGID_FACE_A ? rb : ra;
  const nx = ref.c * m.lnx - ref.s * m.lny;
  const ny = ref.s * m.lnx + ref.c * m.lny;
  const planeX = ref.x + ref.c * m.lpx - ref.s * m.lpy;
  const planeY = ref.y + ref.s * m.lpx + ref.c * m.lpy;
  for (let i = 0; i < m.count; i++) {
    const cx = inc.x + inc.c * m.px[i]! - inc.s * m.py[i]!;
    const cy = inc.y + inc.s * m.px[i]! + inc.c * m.py[i]!;
    const raw = (cx - planeX) * nx + (cy - planeY) * ny;
    const refX = cx + (rRef - raw) * nx;
    const refY = cy + (rRef - raw) * ny;
    const incX = cx - rInc * nx;
    const incY = cy - rInc * ny;
    out.x[i] = (refX + incX) / 2;
    out.y[i] = (refY + incY) / 2;
    out.separation[i] = raw - rRef - rInc;
  }
  if (m.type === RIGID_FACE_A) {
    out.nx = nx;
    out.ny = ny;
  } else {
    out.nx = -nx;
    out.ny = -ny;
  }
}

/** Result of rigidRaycastBody (fraction along the segment and the surface normal). */
export interface RigidRayScratch {
  fraction: number;
  nx: number;
  ny: number;
}

/** Segment (x0,y0)-(x1,y1) against one body's shape. Segments starting inside the shape do not hit. */
export function rigidRaycastBody(
  out: RigidRayScratch,
  body: RigidBody,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  maxFraction: number,
): boolean {
  const sh = body.shape;
  if (sh.type === 'circle') {
    const sx = x0 - body.x;
    const sy = y0 - body.y;
    const b = sx * sx + sy * sy - sh.radius * sh.radius;
    if (b < 0) return false;
    const rx = x1 - x0;
    const ry = y1 - y0;
    const c = sx * rx + sy * ry;
    const rr = rx * rx + ry * ry;
    const sigma = c * c - rr * b;
    if (sigma < 0 || rr < 1e-12) return false;
    let t = -(c + Math.sqrt(sigma));
    if (t < 0 || t > maxFraction * rr) return false;
    t /= rr;
    const nx = sx + t * rx;
    const ny = sy + t * ry;
    const len = Math.hypot(nx, ny);
    out.fraction = t;
    out.nx = nx / len;
    out.ny = ny / len;
    return true;
  }
  const dx0 = x0 - body.x;
  const dy0 = y0 - body.y;
  const dx1 = x1 - body.x;
  const dy1 = y1 - body.y;
  const p1x = body.c * dx0 + body.s * dy0;
  const p1y = -body.s * dx0 + body.c * dy0;
  const p2x = body.c * dx1 + body.s * dy1;
  const p2y = -body.s * dx1 + body.c * dy1;
  const dx = p2x - p1x;
  const dy = p2y - p1y;
  let lower = 0;
  let upper = maxFraction;
  let index = -1;
  const v = sh.vertices;
  const n = sh.normals;
  for (let i = 0; i < sh.count; i++) {
    const nx = n[i * 2]!;
    const ny = n[i * 2 + 1]!;
    const num = nx * (v[i * 2]! - p1x) + ny * (v[i * 2 + 1]! - p1y);
    const den = nx * dx + ny * dy;
    if (den === 0) {
      if (num < 0) return false;
    } else if (den < 0 && num < lower * den) {
      lower = num / den;
      index = i;
    } else if (den > 0 && num < upper * den) {
      upper = num / den;
    }
    if (upper < lower) return false;
  }
  if (index < 0) return false;
  const lnx = n[index * 2]!;
  const lny = n[index * 2 + 1]!;
  out.fraction = lower;
  out.nx = body.c * lnx - body.s * lny;
  out.ny = body.s * lnx + body.c * lny;
  return true;
}
