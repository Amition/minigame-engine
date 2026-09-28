import type { Vec2 } from '../core/math';

/** Circle centred on the body origin. */
export interface RigidCircleShape {
  readonly type: 'circle';
  readonly radius: number;
}

/**
 * Convex polygon in body-local coordinates, recentred so its centroid is the body origin (the body position is
 * the centre of mass). Winding is positive in the maths sense (clockwise on screen with y down).
 */
export interface RigidPolygonShape {
  readonly type: 'polygon';
  /** Flat local vertices x0, y0, x1, y1, ... */
  readonly vertices: readonly number[];
  /** Flat outward unit edge normals; normal i belongs to the edge from vertex i to vertex i + 1. */
  readonly normals: readonly number[];
  readonly count: number;
  /** Where the centroid was in the input coordinates: place the body there to keep the input points. */
  readonly centroidX: number;
  readonly centroidY: number;
  /** Size of the local bounding box (for dumps). */
  readonly width: number;
  readonly height: number;
  /** Farthest vertex distance from the centroid. */
  readonly extent: number;
  /** Made by rigidBox. */
  readonly box: boolean;
}

export type RigidShape = RigidCircleShape | RigidPolygonShape;

export function rigidCircle(radius: number): RigidCircleShape {
  if (!(radius > 0)) throw new Error(`rigidCircle: radius must be > 0 (got ${radius})`);
  return { type: 'circle', radius };
}

/** Axis-aligned box centred on the body origin (rotate it with the body angle). */
export function rigidBox(width: number, height: number): RigidPolygonShape {
  if (!(width > 0 && height > 0)) throw new Error(`rigidBox: size must be > 0 (got ${width}x${height})`);
  const hw = width / 2;
  const hh = height / 2;
  return makePolygon([-hw, -hh, hw, -hh, hw, hh, -hw, hh], true);
}

/**
 * Convex polygon from points (flat numbers or {x, y}); the convex hull is used, collinear points are dropped and
 * the result is recentred on its centroid. To keep world-space input points in place, add the body at
 * (shape.centroidX, shape.centroidY).
 */
export function rigidPolygon(points: readonly number[] | readonly Vec2[]): RigidPolygonShape {
  const flat: number[] = [];
  if (points.length > 0 && typeof points[0] === 'number') flat.push(...(points as readonly number[]));
  else for (const p of points as readonly Vec2[]) flat.push(p.x, p.y);
  return makePolygon(convexHull(flat), false);
}

function makePolygon(flat: number[], box: boolean): RigidPolygonShape {
  const n = flat.length / 2;
  if (n < 3) throw new Error('rigidPolygon: need at least 3 non-collinear points');
  let area = 0;
  let cx = 0;
  let cy = 0;
  const ox = flat[0]!;
  const oy = flat[1]!;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = flat[i * 2]! - ox;
    const y1 = flat[i * 2 + 1]! - oy;
    const x2 = flat[j * 2]! - ox;
    const y2 = flat[j * 2 + 1]! - oy;
    const d = x1 * y2 - y1 * x2;
    area += d / 2;
    cx += (d / 6) * (x1 + x2);
    cy += (d / 6) * (y1 + y2);
  }
  if (area < 0) {
    const rev: number[] = [];
    for (let i = n - 1; i >= 0; i--) rev.push(flat[i * 2]!, flat[i * 2 + 1]!);
    return makePolygon(rev, box);
  }
  if (area < 1e-9) throw new Error('rigidPolygon: polygon has no area');
  cx = cx / area + ox;
  cy = cy / area + oy;
  const vertices: number[] = [];
  const normals: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let extent = 0;
  for (let i = 0; i < n; i++) {
    const x = flat[i * 2]! - cx;
    const y = flat[i * 2 + 1]! - cy;
    vertices.push(x, y);
    extent = Math.max(extent, Math.sqrt(x * x + y * y));
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = vertices[j * 2]! - vertices[i * 2]!;
    const ey = vertices[j * 2 + 1]! - vertices[i * 2 + 1]!;
    const len = Math.sqrt(ex * ex + ey * ey);
    normals.push(ey / len, -ex / len);
  }
  return {
    type: 'polygon',
    vertices,
    normals,
    count: n,
    centroidX: cx,
    centroidY: cy,
    width: maxX - minX,
    height: maxY - minY,
    extent,
    box,
  };
}

/** Andrew's monotone chain; drops duplicate and collinear points. */
function convexHull(flat: number[]): number[] {
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i]!, flat[i + 1]!]);
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const out: number[] = [];
  for (const p of lower.concat(upper)) out.push(p[0], p[1]);
  return out;
}

/** Area-based mass and rotational inertia about the centroid. */
export function rigidShapeMass(shape: RigidShape, density: number): { mass: number; inertia: number } {
  if (shape.type === 'circle') {
    const r = shape.radius;
    const mass = density * Math.PI * r * r;
    return { mass, inertia: (mass * r * r) / 2 };
  }
  const v = shape.vertices;
  const n = shape.count;
  const sx = v[0]!;
  const sy = v[1]!;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let I = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex1 = v[i * 2]! - sx;
    const ey1 = v[i * 2 + 1]! - sy;
    const ex2 = v[j * 2]! - sx;
    const ey2 = v[j * 2 + 1]! - sy;
    const d = ex1 * ey2 - ey1 * ex2;
    const tri = d / 2;
    area += tri;
    cx += (tri / 3) * (ex1 + ex2);
    cy += (tri / 3) * (ey1 + ey2);
    const intx2 = ex1 * ex1 + ex2 * ex1 + ex2 * ex2;
    const inty2 = ey1 * ey1 + ey2 * ey1 + ey2 * ey2;
    I += (d / 12) * (intx2 + inty2);
  }
  const mass = density * area;
  cx /= area;
  cy /= area;
  return { mass, inertia: density * I - mass * (cx * cx + cy * cy) };
}
