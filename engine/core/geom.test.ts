import { describe, expect, it } from 'vitest';
import {
  ballisticAngle,
  ballisticApex,
  ballisticMinSpeed,
  ballisticPath,
  ballisticPosition,
  ballisticTimeToX,
  boxContainsPoint,
  boxToLocal,
  boxToWorld,
  closestPointOnSegment,
  closestSegmentSegment,
  sweepCircleBox,
  sweepCircleCircle,
  sweepSegmentBox,
  sweepSegmentCapsule,
  sweepSegmentCircle,
  type BallisticLaunch,
  type GeomBox,
} from './geom';
import { Rng } from './rng';

const DEG = Math.PI / 180;
const DIAG = (110 * Math.SQRT2) / 2;
/** A 110x110 block standing on its corner (the archer enemy platform). */
const DIAMOND: GeomBox = { x: 0, y: 0, w: 110, h: 110, angle: 45 * DEG };

// ---------------------------------------------------------------- independent references

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2));
  const dx = px - (ax + ex * t);
  const dy = py - (ay + ey * t);
  return dx * dx + dy * dy;
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Squared distance between two segments: 0 when they properly cross, else the best endpoint-to-segment distance. */
function segSegDist2(s: readonly number[]): number {
  const [ax, ay, bx, by, cx, cy, dx, dy] = s as [number, number, number, number, number, number, number, number];
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(segDist2(ax, ay, cx, cy, dx, dy), segDist2(bx, by, cx, cy, dx, dy), segDist2(cx, cy, ax, ay, bx, by), segDist2(dx, dy, ax, ay, bx, by));
}

/** Signed distance to a (rotated) box: negative inside. */
function sdBox(b: GeomBox, x: number, y: number): number {
  const a = b.angle ?? 0;
  const rx = x - b.x;
  const ry = y - b.y;
  const qx = Math.abs(rx * Math.cos(a) + ry * Math.sin(a)) - b.w / 2;
  const qy = Math.abs(-rx * Math.sin(a) + ry * Math.cos(a)) - b.h / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

/**
 * Checks a sweep result against dense sampling of a signed distance (<= 0 inside): the entry point lies on the
 * surface (or the start is inside) and no earlier sample is inside; null means no sample is inside. Returns the
 * number of violations.
 */
function sweepErrors(t: number | null, seg: readonly number[], sd: (x: number, y: number) => number, n = 1500): number {
  const [x0, y0, x1, y1] = seg as [number, number, number, number];
  const at = (u: number) => sd(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u);
  const tol = 1e-7;
  let bad = 0;
  if (t !== null) {
    if (t < 0 || t > 1) bad++;
    if (t > 0 && Math.abs(at(t)) > 1e-6) bad++;
    if (t === 0 && at(0) > tol) bad++;
  }
  const end = t ?? 1;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    if (t !== null && u >= end - 1e-9) break;
    if (at(u) < -tol) bad++;
  }
  return bad;
}

function randomSegment(r: Rng, span = 150): number[] {
  return [r.float(-span, span), r.float(-span, span), r.float(-span, span), r.float(-span, span)];
}

// ---------------------------------------------------------------- closest points

describe('closestSegmentSegment', () => {
  it('finds crossing, parallel and T-shaped closest points', () => {
    const out = { s: 0, t: 0, d2: 0 };
    expect(closestSegmentSegment(0, 0, 10, 0, 5, -5, 5, 5, out)).toBe(out);
    expect(out.d2).toBeCloseTo(0);
    expect(out.s).toBeCloseTo(0.5);
    expect(out.t).toBeCloseTo(0.5);
    closestSegmentSegment(0, 0, 10, 0, 0, 3, 10, 3, out);
    expect(out.d2).toBeCloseTo(9);
    closestSegmentSegment(0, 0, 10, 0, 5, 2, 5, 8, out);
    expect(out).toMatchObject({ s: 0.5, t: 0 });
    expect(out.d2).toBeCloseTo(4);
  });

  it('handles parallel, anti-parallel and collinear disjoint segments', () => {
    const p = closestSegmentSegment(0, 0, 10, 0, 2, 3, 8, 3);
    expect(p.d2).toBeCloseTo(9);
    const x = p.s * 10;
    expect(x).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(x).toBeLessThanOrEqual(8 + 1e-9);
    expect(closestSegmentSegment(0, 0, 10, 0, 10, 3, 0, 3).d2).toBeCloseTo(9);
    expect(closestSegmentSegment(0, 0, 10, 0, 12, 0, 20, 0)).toMatchObject({ s: 1, t: 0, d2: 4 });
    expect(closestSegmentSegment(0, 0, 10, 0, -8, 0, -3, 0)).toMatchObject({ s: 0, t: 1, d2: 9 });
  });

  it('treats degenerate segments as points', () => {
    expect(closestSegmentSegment(1, 1, 1, 1, 4, 5, 4, 5)).toEqual({ s: 0, t: 0, d2: 25 });
    const a = closestSegmentSegment(5, 3, 5, 3, 0, 0, 10, 0);
    expect(a.s).toBe(0);
    expect(a.t).toBeCloseTo(0.5);
    expect(a.d2).toBeCloseTo(9);
    const b = closestSegmentSegment(0, 0, 10, 0, 12, 4, 12, 4);
    expect(b.s).toBe(1);
    expect(b.t).toBe(0);
    expect(b.d2).toBeCloseTo(20);
  });

  it('matches a brute-force distance on random segments', () => {
    const r = new Rng(7);
    const out = { s: 0, t: 0, d2: 0 };
    for (let i = 0; i < 500; i++) {
      const s = [...randomSegment(r), ...randomSegment(r)];
      closestSegmentSegment(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!, s[6]!, s[7]!, out);
      expect(out.s).toBeGreaterThanOrEqual(0);
      expect(out.s).toBeLessThanOrEqual(1);
      expect(out.t).toBeGreaterThanOrEqual(0);
      expect(out.t).toBeLessThanOrEqual(1);
      expect(Math.abs(Math.sqrt(out.d2) - Math.sqrt(segSegDist2(s)))).toBeLessThan(1e-6);
    }
  });
});

describe('closestPointOnSegment', () => {
  it('projects, clamps to the ends and handles a degenerate segment', () => {
    expect(closestPointOnSegment(5, 4, 0, 0, 10, 0)).toEqual({ x: 5, y: 0, t: 0.5, d2: 16 });
    expect(closestPointOnSegment(-3, 4, 0, 0, 10, 0)).toEqual({ x: 0, y: 0, t: 0, d2: 25 });
    expect(closestPointOnSegment(13, -4, 0, 0, 10, 0)).toEqual({ x: 10, y: 0, t: 1, d2: 25 });
    expect(closestPointOnSegment(3, 4, 0, 0, 0, 0)).toEqual({ x: 0, y: 0, t: 0, d2: 25 });
    const out = { x: 0, y: 0, t: 0, d2: 0 };
    expect(closestPointOnSegment(0, 10, -10, 0, 10, 20, out)).toBe(out);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(10);
    expect(out.t).toBeCloseTo(0.5);
    expect(out.d2).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------- sweeps

describe('sweepSegmentCircle', () => {
  it('returns the entry parameter or null', () => {
    expect(sweepSegmentCircle(-10, 0, 10, 0, 0, 0, 5)).toBeCloseTo(0.25);
    expect(sweepSegmentCircle(-10, 10, 10, 10, 0, 0, 5)).toBeNull();
    expect(sweepSegmentCircle(-20, 0, -10, 0, 0, 0, 5)).toBeNull();
    expect(sweepSegmentCircle(10, 0, 20, 0, 0, 0, 5)).toBeNull();
  });

  it('counts a start inside or on the circle as 0', () => {
    expect(sweepSegmentCircle(1, 1, 30, 0, 0, 0, 5)).toBe(0);
    expect(sweepSegmentCircle(-5, 0, -30, 0, 0, 0, 5)).toBe(0);
  });

  it('hits a tangent segment at the touching point', () => {
    expect(sweepSegmentCircle(-10, 5, 10, 5, 0, 0, 5)).toBeCloseTo(0.5);
    expect(sweepSegmentCircle(-10, 5.001, 10, 5.001, 0, 0, 5)).toBeNull();
  });

  it('treats a degenerate segment as a point', () => {
    expect(sweepSegmentCircle(-10, 0, -10, 0, 0, 0, 5)).toBeNull();
    expect(sweepSegmentCircle(1, 1, 1, 1, 0, 0, 5)).toBe(0);
  });

  it('agrees with dense sampling on random cases', () => {
    const r = new Rng(11);
    for (let i = 0; i < 200; i++) {
      const seg = randomSegment(r);
      const cx = r.float(-60, 60);
      const cy = r.float(-60, 60);
      const rad = r.float(3, 60);
      const t = sweepSegmentCircle(seg[0]!, seg[1]!, seg[2]!, seg[3]!, cx, cy, rad);
      expect(sweepErrors(t, seg, (x, y) => Math.hypot(x - cx, y - cy) - rad)).toBe(0);
    }
  });
});

describe('sweepCircleCircle', () => {
  it('touches when the centres are r + cr apart', () => {
    expect(sweepCircleCircle(-100, 0, 100, 0, 5, 0, 0, 10)).toBeCloseTo(85 / 200);
    expect(sweepCircleCircle(-100, 16, 100, 16, 5, 0, 0, 10)).toBeNull();
    expect(sweepCircleCircle(-12, 0, -100, 0, 5, 0, 0, 10)).toBe(0);
  });
});

describe('sweepSegmentCapsule', () => {
  const vertical = [0, -50, 0, 50] as const;

  it('hits the side, the end caps and oblique crossings on the surface', () => {
    expect(sweepSegmentCapsule(-100, 0, 100, 0, ...vertical, 5)).toBeCloseTo(0.475, 9);
    expect(sweepSegmentCapsule(100, 0, 0, 0, 0, 0, 50, 0, 5)).toBeCloseTo(0.45, 9);
    expect(sweepSegmentCapsule(0, 100, 0, 0, ...vertical, 5)).toBeCloseTo(0.45, 9);
    const t = sweepSegmentCapsule(-100, -100, 100, 100, ...vertical, 5)!;
    expect(t).toBeCloseTo(0.475, 9);
    const x = -100 + 200 * t;
    expect(segDist2(x, x, ...vertical)).toBeCloseTo(25, 6);
  });

  it('misses beyond the radius and grazes tangents', () => {
    expect(sweepSegmentCapsule(-100, 56, 100, 56, ...vertical, 5)).toBeNull();
    expect(sweepSegmentCapsule(-100, 55, 100, 55, ...vertical, 5)).toBeCloseTo(0.5, 6);
    expect(sweepSegmentCapsule(-100, -100, -100, 100, ...vertical, 5)).toBeNull();
    expect(sweepSegmentCapsule(5, -100, 5, 100, ...vertical, 5)).toBeCloseTo(0.25, 9);
  });

  it('counts a start inside the body or a cap as 0', () => {
    expect(sweepSegmentCapsule(2, 10, 100, 10, ...vertical, 5)).toBe(0);
    expect(sweepSegmentCapsule(0, 53, 100, 100, ...vertical, 5)).toBe(0);
  });

  it('is a circle when both ends coincide; a degenerate segment is a point', () => {
    for (const [x0, y0, x1, y1] of [
      [-10, 0, 10, 0],
      [-10, 3, 10, 3],
      [-10, 9, 10, 9],
    ] as const) {
      expect(sweepSegmentCapsule(x0, y0, x1, y1, 0, 0, 0, 0, 5)).toBe(sweepSegmentCircle(x0, y0, x1, y1, 0, 0, 5));
    }
    expect(sweepSegmentCapsule(0, 20, 0, 20, ...vertical, 5)).toBe(0);
    expect(sweepSegmentCapsule(20, 0, 20, 0, ...vertical, 5)).toBeNull();
  });

  it('agrees with closestSegmentSegment and dense sampling on random cases', () => {
    const r = new Rng(3);
    const c = { s: 0, t: 0, d2: 0 };
    for (let i = 0; i < 300; i++) {
      const seg = randomSegment(r);
      const cap = randomSegment(r, 80);
      const rad = r.float(2, 30);
      const [ax, ay, bx, by] = cap as [number, number, number, number];
      const t = sweepSegmentCapsule(seg[0]!, seg[1]!, seg[2]!, seg[3]!, ax, ay, bx, by, rad);
      expect(sweepErrors(t, seg, (x, y) => Math.sqrt(segDist2(x, y, ax, ay, bx, by)) - rad)).toBe(0);
      closestSegmentSegment(seg[0]!, seg[1]!, seg[2]!, seg[3]!, ax, ay, bx, by, c);
      if (Math.abs(Math.sqrt(c.d2) - rad) > 1e-6) expect(t !== null).toBe(c.d2 < rad * rad);
    }
  });
});

describe('sweepSegmentBox', () => {
  it('hits axis-aligned boxes (angle omitted or 0)', () => {
    expect(sweepSegmentBox(-100, 0, 100, 0, { x: 0, y: 0, w: 40, h: 20 })).toBeCloseTo(0.4);
    expect(sweepSegmentBox(-100, 0, 100, 0, { x: 0, y: 0, w: 40, h: 20, angle: 0 })).toBeCloseTo(0.4);
    expect(sweepSegmentBox(30, -100, 30, 100, { x: 30, y: 10, w: 40, h: 20 })).toBeCloseTo(0.5);
  });

  it('hits a 45 degree block on its corner and misses above it', () => {
    expect(sweepSegmentBox(-100, 0, 100, 0, DIAMOND)).toBeCloseTo((100 - DIAG) / 200, 9);
    expect(sweepSegmentBox(-100, -200, 100, -200, DIAMOND)).toBeNull();
    expect(sweepSegmentBox(0, -200, 0, 0, DIAMOND)).toBeCloseTo((200 - DIAG) / 200, 9);
  });

  it('swaps width and height at 90 degrees', () => {
    const box: GeomBox = { x: 0, y: 0, w: 100, h: 20, angle: 90 * DEG };
    expect(sweepSegmentBox(-100, 0, 100, 0, box)).toBeCloseTo(0.45, 9);
    expect(sweepSegmentBox(0, -100, 0, 100, box)).toBeCloseTo(0.25, 9);
    expect(sweepSegmentBox(-100, 55, 100, 55, box)).toBeNull();
  });

  it('handles starts inside, short and parallel segments, tangents and points', () => {
    const box: GeomBox = { x: 0, y: 0, w: 40, h: 20 };
    expect(sweepSegmentBox(5, 5, 100, 100, box)).toBe(0);
    expect(sweepSegmentBox(-100, 0, -30, 0, box)).toBeNull();
    expect(sweepSegmentBox(30, 0, 100, 0, box)).toBeNull();
    expect(sweepSegmentBox(-100, 11, 100, 11, box)).toBeNull();
    expect(sweepSegmentBox(-100, 10, 100, 10, box)).toBeCloseTo(0.4);
    expect(sweepSegmentBox(3, 3, 3, 3, box)).toBe(0);
    expect(sweepSegmentBox(30, 3, 30, 3, box)).toBeNull();
  });

  it('agrees with dense sampling on random rotated boxes', () => {
    const r = new Rng(5);
    for (let i = 0; i < 300; i++) {
      const seg = randomSegment(r);
      const box: GeomBox = { x: r.float(-50, 50), y: r.float(-50, 50), w: r.float(5, 120), h: r.float(5, 120), angle: r.float(-Math.PI, Math.PI) };
      const t = sweepSegmentBox(seg[0]!, seg[1]!, seg[2]!, seg[3]!, box);
      expect(sweepErrors(t, seg, (x, y) => sdBox(box, x, y))).toBe(0);
    }
  });
});

describe('sweepCircleBox', () => {
  const box: GeomBox = { x: 0, y: 0, w: 40, h: 20 };

  it('touches a face when the centre is r away from it', () => {
    expect(sweepCircleBox(-100, 0, 100, 0, 10, box)).toBeCloseTo(0.35, 9);
    expect(sweepCircleBox(0, -100, 0, 100, 10, box)).toBeCloseTo(0.4, 9);
    expect(sweepCircleBox(-100, 20.5, 100, 20.5, 10, box)).toBeNull();
  });

  it('rounds the corners', () => {
    const t = sweepCircleBox(120, 110, -80, -90, 10, box)!;
    expect(t).toBeCloseTo((100 * Math.SQRT2 - 10) / (200 * Math.SQRT2), 9);
    expect(sweepCircleBox(-100, 19, 100, 19, 10, { ...box, w: 20 })).toBeCloseTo((100 - 10 - Math.sqrt(19)) / 200, 9);
  });

  it('hits the corner of a 45 degree block first', () => {
    expect(sweepCircleBox(-200, 0, 200, 0, 10, DIAMOND)).toBeCloseTo((200 - DIAG - 10) / 400, 9);
  });

  it('returns 0 when overlapping at the start; radius 0 is a segment sweep', () => {
    expect(sweepCircleBox(25, 0, 100, 0, 10, box)).toBe(0);
    expect(sweepCircleBox(27, 17, 100, 100, 10, box)).toBe(0);
    const r = new Rng(9);
    for (let i = 0; i < 100; i++) {
      const seg = randomSegment(r);
      const b: GeomBox = { x: 0, y: 0, w: r.float(10, 100), h: r.float(10, 100), angle: r.float(0, Math.PI) };
      expect(sweepCircleBox(seg[0]!, seg[1]!, seg[2]!, seg[3]!, 0, b)).toBe(sweepSegmentBox(seg[0]!, seg[1]!, seg[2]!, seg[3]!, b));
    }
  });

  it('agrees with dense sampling on random rotated boxes', () => {
    const r = new Rng(13);
    for (let i = 0; i < 300; i++) {
      const seg = randomSegment(r);
      const b: GeomBox = { x: r.float(-40, 40), y: r.float(-40, 40), w: r.float(5, 100), h: r.float(5, 100), angle: r.float(-Math.PI, Math.PI) };
      const rad = r.float(1, 30);
      const t = sweepCircleBox(seg[0]!, seg[1]!, seg[2]!, seg[3]!, rad, b);
      expect(sweepErrors(t, seg, (x, y) => sdBox(b, x, y) - rad)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------- box frames

describe('box frames', () => {
  it('maps local points to world at 0, 45 and 90 degrees and back', () => {
    expect(boxToWorld({ x: 10, y: 20, w: 50, h: 30 }, 5, -3)).toEqual({ x: 15, y: 17 });
    const corner = boxToWorld(DIAMOND, 55, -55);
    expect(corner.x).toBeCloseTo(DIAG, 9);
    expect(corner.y).toBeCloseTo(0, 9);
    const turned: GeomBox = { x: 10, y: 20, w: 100, h: 20, angle: 90 * DEG };
    const w = boxToWorld(turned, 30, 0);
    expect(w.x).toBeCloseTo(10, 9);
    expect(w.y).toBeCloseTo(50, 9);
    const l = boxToLocal(turned, w.x, w.y);
    expect(l.x).toBeCloseTo(30, 9);
    expect(l.y).toBeCloseTo(0, 9);
  });

  it('round-trips random points and writes into `out`', () => {
    const r = new Rng(21);
    const out = { x: 0, y: 0 };
    for (let i = 0; i < 100; i++) {
      const box: GeomBox = { x: r.float(-500, 500), y: r.float(-500, 500), w: 10, h: 10, angle: r.float(-4, 4) };
      const x = r.float(-500, 500);
      const y = r.float(-500, 500);
      expect(boxToLocal(box, x, y, out)).toBe(out);
      expect(boxToWorld(box, out.x, out.y, out)).toBe(out);
      expect(out.x).toBeCloseTo(x, 9);
      expect(out.y).toBeCloseTo(y, 9);
    }
  });

  it('boxContainsPoint includes the edge, honours pad and rotation', () => {
    const box: GeomBox = { x: 0, y: 0, w: 40, h: 20 };
    expect(boxContainsPoint(box, 0, 0)).toBe(true);
    expect(boxContainsPoint(box, 20, 10)).toBe(true);
    expect(boxContainsPoint(box, 20.01, 0)).toBe(false);
    expect(boxContainsPoint(box, 24, 0, 5)).toBe(true);
    expect(boxContainsPoint(box, 18, 0, -5)).toBe(false);
    expect(boxContainsPoint(DIAMOND, DIAG - 1, 0)).toBe(true);
    expect(boxContainsPoint(DIAMOND, DIAG + 1, 0)).toBe(false);
    expect(boxContainsPoint(DIAMOND, 30, 30)).toBe(true);
    expect(boxContainsPoint(DIAMOND, 40, 40)).toBe(false);
    const turned: GeomBox = { x: 0, y: 0, w: 100, h: 20, angle: 90 * DEG };
    expect(boxContainsPoint(turned, 0, 45)).toBe(true);
    expect(boxContainsPoint(turned, 45, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------- ballistics

describe('ballistics', () => {
  const G = 1400;

  /** Where a shot at (angle, speed) is when it has travelled dx horizontally. */
  function reach(dx: number, angle: number, speed: number, g = G): { x: number; y: number } {
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const t = ballisticTimeToX(dx, vx);
    expect(t).not.toBeNull();
    return ballisticPosition(0, 0, vx, vy, g, t!);
  }

  it('low and high arcs both pass through the target', () => {
    for (const [dx, dy, v] of [
      [700, 0, 1400],
      [900, -250, 1500],
      [-800, 120, 1350],
      [300, 400, 900],
      [-1200, -300, 1650],
      [50, -200, 800],
    ] as const) {
      const lo = ballisticAngle(dx, dy, v, G)!;
      const hi = ballisticAngle(dx, dy, v, G, true)!;
      expect(lo).not.toBeNull();
      expect(hi).not.toBeNull();
      for (const a of [lo, hi]) {
        const p = reach(dx, a, v);
        expect(p.x).toBeCloseTo(dx, 6);
        expect(p.y).toBeCloseTo(dy, 4);
        if (dx > 0) expect(Math.abs(a)).toBeLessThan(Math.PI / 2);
        else expect(Math.abs(a - Math.PI)).toBeLessThan(Math.PI / 2);
      }
      const apexLo = ballisticApex(0, 0, Math.cos(lo) * v, Math.sin(lo) * v, G);
      const apexHi = ballisticApex(0, 0, Math.cos(hi) * v, Math.sin(hi) * v, G);
      expect(apexHi.y).toBeLessThan(apexLo.y);
    }
  });

  it('returns null out of range and handles vertical targets', () => {
    expect(ballisticAngle(5000, 0, 700, G)).toBeNull();
    expect(ballisticAngle(5000, 0, 700, G, true)).toBeNull();
    expect(ballisticAngle(0, -100, 1000, G)).toBe(-Math.PI / 2);
    expect(ballisticAngle(0, -500, 1000, G)).toBeNull();
    expect(ballisticAngle(0, 100, 1000, G)).toBe(Math.PI / 2);
    expect(ballisticAngle(0, 100, 1000, G, true)).toBe(-Math.PI / 2);
    expect(ballisticAngle(100, 0, 0, G)).toBeNull();
    expect(ballisticAngle(100, -100, 500, 0)).toBeCloseTo(-Math.PI / 4);
  });

  it('min speed: both arcs meet just above it and vanish just below', () => {
    for (const [dx, dy] of [
      [1000, 0],
      [-600, -300],
      [400, 350],
    ] as const) {
      const launch: BallisticLaunch = { speed: 0, angle: 0 };
      const v = ballisticMinSpeed(dx, dy, G, launch);
      expect(launch.speed).toBe(v);
      expect(ballisticAngle(dx, dy, v * 0.999, G)).toBeNull();
      const lo = ballisticAngle(dx, dy, v * 1.00001, G)!;
      const hi = ballisticAngle(dx, dy, v * 1.00001, G, true)!;
      expect(lo).toBeCloseTo(launch.angle, 2);
      expect(hi).toBeCloseTo(launch.angle, 2);
      const p = reach(dx, launch.angle, v);
      expect(p.y).toBeCloseTo(dy, 4);
    }
    expect(ballisticMinSpeed(1000, 0, G)).toBeCloseTo(Math.sqrt(G * 1000), 9);
    const left: BallisticLaunch = { speed: 0, angle: 0 };
    ballisticMinSpeed(-1000, 0, G, left);
    expect(left.angle).toBeCloseTo(Math.PI + Math.PI / 4, 9);
    const up: BallisticLaunch = { speed: 0, angle: 0 };
    expect(ballisticMinSpeed(0, -300, G, up)).toBeCloseTo(Math.sqrt(2 * G * 300), 9);
    expect(up.angle).toBeCloseTo(-Math.PI / 2, 9);
    expect(ballisticMinSpeed(0, 300, G)).toBe(0);
    expect(ballisticMinSpeed(300, 400, 0)).toBe(0);
  });

  it('position, time to x and apex follow the parabola', () => {
    expect(ballisticPosition(5, 6, 100, -200, G, 0)).toEqual({ x: 5, y: 6 });
    expect(ballisticPosition(0, 0, 100, -200, 0, 2)).toEqual({ x: 200, y: -400 });
    const out = { x: 0, y: 0 };
    expect(ballisticPosition(0, 0, 100, -700, G, 0.5, out)).toBe(out);
    expect(out).toEqual({ x: 50, y: -350 + 175 });
    expect(ballisticTimeToX(100, 50)).toBe(2);
    expect(ballisticTimeToX(-100, -50)).toBe(2);
    expect(ballisticTimeToX(100, -50)).toBeNull();
    expect(ballisticTimeToX(100, 0)).toBeNull();
    expect(ballisticTimeToX(0, 0)).toBe(0);
    const apex = ballisticApex(0, 0, 100, -700, G);
    expect(apex.t).toBeCloseTo(0.5, 12);
    expect(apex.x).toBeCloseTo(50, 9);
    expect(apex.y).toBeCloseTo(-175, 9);
    for (const dt of [-0.01, 0.01]) expect(ballisticPosition(0, 0, 100, -700, G, apex.t + dt).y).toBeGreaterThan(apex.y);
    expect(ballisticApex(3, 4, 100, 50, G)).toEqual({ x: 3, y: 4, t: 0 });
  });

  it('samples the path every step up to maxTime', () => {
    const pts = ballisticPath(10, 20, 300, -600, G, { step: 0.1, maxTime: 1 });
    expect(pts).toHaveLength(22);
    for (let i = 0; i <= 10; i++) {
      const p = ballisticPosition(10, 20, 300, -600, G, i * 0.1);
      expect(pts[i * 2]).toBeCloseTo(p.x, 9);
      expect(pts[i * 2 + 1]).toBeCloseTo(p.y, 9);
    }
    const odd = ballisticPath(0, 0, 300, -600, G, { step: 0.3, maxTime: 1 });
    expect(odd).toHaveLength(10);
    expect(odd[8]).toBeCloseTo(300, 9);
  });

  it('stops at `until`, on the crossing, and reuses `out`', () => {
    const ground = 200;
    const reuse = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const pts = ballisticPath(0, 0, 300, -600, G, { step: 1 / 30, maxTime: 5, until: (_x, y) => y >= ground }, reuse);
    expect(pts).toBe(reuse);
    const n = pts.length / 2;
    for (let i = 0; i < n - 1; i++) expect(pts[i * 2 + 1]!).toBeLessThan(ground);
    const lastY = pts[pts.length - 1]!;
    expect(lastY).toBeGreaterThanOrEqual(ground);
    expect(lastY - ground).toBeLessThan(0.05);
    const tHit = (600 + Math.sqrt(600 * 600 + 2 * G * ground)) / G;
    expect(pts[pts.length - 2]).toBeCloseTo(300 * tHit, 1);
    expect(n).toBeLessThan(5 * 30);
    expect(ballisticPath(0, 0, 300, -600, G, { until: () => true })).toEqual([0, 0]);
  });
});
