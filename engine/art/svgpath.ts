import type { Rect } from '../core/math';
import type { Ctx2D } from '../gfx/types';

/** Normalized path command: absolute coordinates; H/V → L, S/T → C/Q, arcs → cubic segments. */
export type SvgPathCmd =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['Z'];

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

class PathSyntaxError extends Error {}

/**
 * Parses SVG path data (full grammar: M L H V C S Q T A Z, absolute and relative, implicit repeats,
 * compact numbers like `1.5.5-2e1`, packed arc flags like `a1 1 0 01 5 5`).
 * Like browsers, a syntax error ends parsing and everything before it is kept.
 */
export function parsePathData(d: string): SvgPathCmd[] {
  const out: SvgPathCmd[] = [];
  const n = d.length;
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let ctrlX = 0;
  let ctrlY = 0;
  let prev = '';
  let cmd = '';

  const skip = () => {
    while (i < n) {
      const c = d.charCodeAt(i);
      if (c === 32 || c === 44 || (c >= 9 && c <= 13)) i++;
      else break;
    }
  };
  const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  const num = (): number => {
    skip();
    const start = i;
    if (d[i] === '+' || d[i] === '-') i++;
    let digits = false;
    while (isDigit(d[i])) {
      i++;
      digits = true;
    }
    if (d[i] === '.') {
      i++;
      while (isDigit(d[i])) {
        i++;
        digits = true;
      }
    }
    if (!digits) throw new PathSyntaxError(`number expected at ${start}`);
    if (d[i] === 'e' || d[i] === 'E') {
      const save = i;
      i++;
      if (d[i] === '+' || d[i] === '-') i++;
      if (isDigit(d[i])) while (isDigit(d[i])) i++;
      else i = save;
    }
    return parseFloat(d.slice(start, i));
  };
  const flag = (): number => {
    skip();
    const c = d[i];
    if (c !== '0' && c !== '1') throw new PathSyntaxError(`arc flag expected at ${i}`);
    i++;
    return c === '1' ? 1 : 0;
  };

  try {
    while (true) {
      skip();
      if (i >= n) break;
      const ch = d[i]!;
      const lower = ch.toLowerCase();
      if (lower >= 'a' && lower <= 'z') {
        if (!(lower in ARGS)) break;
        cmd = ch;
        i++;
        if (lower === 'z') {
          out.push(['Z']);
          cx = sx;
          cy = sy;
          prev = 'Z';
          continue;
        }
      } else if (!cmd || cmd === 'z' || cmd === 'Z') {
        break;
      }
      const rel = cmd === cmd.toLowerCase();
      const ox = rel ? cx : 0;
      const oy = rel ? cy : 0;
      switch (cmd.toUpperCase()) {
        case 'M': {
          cx = ox + num();
          cy = oy + num();
          sx = cx;
          sy = cy;
          out.push(['M', cx, cy]);
          cmd = rel ? 'l' : 'L';
          prev = 'M';
          break;
        }
        case 'L':
          cx = ox + num();
          cy = oy + num();
          out.push(['L', cx, cy]);
          prev = 'L';
          break;
        case 'H':
          cx = ox + num();
          out.push(['L', cx, cy]);
          prev = 'L';
          break;
        case 'V':
          cy = oy + num();
          out.push(['L', cx, cy]);
          prev = 'L';
          break;
        case 'C': {
          const x1 = ox + num();
          const y1 = oy + num();
          ctrlX = ox + num();
          ctrlY = oy + num();
          cx = ox + num();
          cy = oy + num();
          out.push(['C', x1, y1, ctrlX, ctrlY, cx, cy]);
          prev = 'C';
          break;
        }
        case 'S': {
          const x1 = prev === 'C' ? 2 * cx - ctrlX : cx;
          const y1 = prev === 'C' ? 2 * cy - ctrlY : cy;
          ctrlX = ox + num();
          ctrlY = oy + num();
          cx = ox + num();
          cy = oy + num();
          out.push(['C', x1, y1, ctrlX, ctrlY, cx, cy]);
          prev = 'C';
          break;
        }
        case 'Q':
          ctrlX = ox + num();
          ctrlY = oy + num();
          cx = ox + num();
          cy = oy + num();
          out.push(['Q', ctrlX, ctrlY, cx, cy]);
          prev = 'Q';
          break;
        case 'T': {
          ctrlX = prev === 'Q' ? 2 * cx - ctrlX : cx;
          ctrlY = prev === 'Q' ? 2 * cy - ctrlY : cy;
          cx = ox + num();
          cy = oy + num();
          out.push(['Q', ctrlX, ctrlY, cx, cy]);
          prev = 'Q';
          break;
        }
        case 'A': {
          const rx = num();
          const ry = num();
          const rot = num();
          const large = flag();
          const sweep = flag();
          const x = ox + num();
          const y = oy + num();
          arcToCubics(out, cx, cy, rx, ry, rot, large, sweep, x, y);
          cx = x;
          cy = y;
          prev = 'A';
          break;
        }
      }
    }
  } catch (e) {
    if (!(e instanceof PathSyntaxError)) throw e;
  }
  return out;
}

/** Appends an SVG elliptical arc (endpoint parameterization) as cubic Béziers of at most 90° each. */
function arcToCubics(
  out: SvgPathCmd[],
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  angleDeg: number,
  large: number,
  sweep: number,
  x2: number,
  y2: number,
): void {
  if (x1 === x2 && y1 === y2) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) {
    out.push(['L', x2, y2]);
    return;
  }
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, (rx2 * ry2 - den) / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const ccx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const ccy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = Math.atan2(uy, ux);
  let dtheta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!sweep && dtheta > 0) dtheta -= Math.PI * 2;
  else if (sweep && dtheta < 0) dtheta += Math.PI * 2;
  const segs = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2) - 1e-7));
  const delta = dtheta / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  const mapX = (px: number, py: number) => ccx + rx * px * cos - ry * py * sin;
  const mapY = (px: number, py: number) => ccy + rx * px * sin + ry * py * cos;
  let a = theta1;
  for (let k = 0; k < segs; k++) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const b = a + delta;
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    const p1x = ca - t * sa;
    const p1y = sa + t * ca;
    const p2x = cb + t * sb;
    const p2y = sb - t * cb;
    const last = k === segs - 1;
    out.push([
      'C',
      mapX(p1x, p1y),
      mapY(p1x, p1y),
      mapX(p2x, p2y),
      mapY(p2x, p2y),
      last ? x2 : mapX(cb, sb),
      last ? y2 : mapY(cb, sb),
    ]);
    a = b;
  }
}

/** Issues the commands on ctx (appends to the current path; call ctx.beginPath() first if needed). */
export function traceSvgPath(ctx: Ctx2D, cmds: readonly SvgPathCmd[]): void {
  for (const c of cmds) {
    switch (c[0]) {
      case 'M':
        ctx.moveTo(c[1], c[2]);
        break;
      case 'L':
        ctx.lineTo(c[1], c[2]);
        break;
      case 'C':
        ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
        break;
      case 'Q':
        ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]);
        break;
      case 'Z':
        ctx.closePath();
        break;
    }
  }
}

const pathCache = new Map<string, SvgPathCmd[]>();

/** parsePathData with a bounded cache (path strings are usually constants). */
export function cachedPathData(d: string): SvgPathCmd[] {
  let cmds = pathCache.get(d);
  if (!cmds) {
    if (pathCache.size > 1024) pathCache.clear();
    cmds = parsePathData(d);
    pathCache.set(d, cmds);
  }
  return cmds;
}

/**
 * Portable Path2D replacement: issues SVG path data `d` as ctx path commands (appends to the current path).
 *
 *     ctx.beginPath(); svgPath(ctx, 'M2 12 L12 2 L22 12 Z'); ctx.fill();
 */
export function svgPath(ctx: Ctx2D, d: string): void {
  traceSvgPath(ctx, cachedPathData(d));
}

function extend(b: number[], x: number, y: number): void {
  if (x < b[0]!) b[0] = x;
  if (y < b[1]!) b[1] = y;
  if (x > b[2]!) b[2] = x;
  if (y > b[3]!) b[3] = y;
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number, ts: number[]): void {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
    return;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return;
  const sq = Math.sqrt(disc);
  ts.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
}

/** Exact bounding box of normalized commands (curve extrema included). Empty paths give a zero rect. */
export function svgPathBounds(cmds: readonly SvgPathCmd[]): Rect {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const c of cmds) {
    switch (c[0]) {
      case 'M':
        x = sx = c[1];
        y = sy = c[2];
        extend(b, x, y);
        break;
      case 'L':
        x = c[1];
        y = c[2];
        extend(b, x, y);
        break;
      case 'C': {
        const ts: number[] = [];
        cubicExtrema(x, c[1], c[3], c[5], ts);
        cubicExtrema(y, c[2], c[4], c[6], ts);
        for (const t of ts) {
          if (t <= 0 || t >= 1) continue;
          const mt = 1 - t;
          const k0 = mt * mt * mt;
          const k1 = 3 * mt * mt * t;
          const k2 = 3 * mt * t * t;
          const k3 = t * t * t;
          extend(b, k0 * x + k1 * c[1] + k2 * c[3] + k3 * c[5], k0 * y + k1 * c[2] + k2 * c[4] + k3 * c[6]);
        }
        x = c[5];
        y = c[6];
        extend(b, x, y);
        break;
      }
      case 'Q': {
        for (const [p0, p1, p2] of [
          [x, c[1], c[3]],
          [y, c[2], c[4]],
        ] as const) {
          const den = p0 - 2 * p1 + p2;
          if (Math.abs(den) < 1e-12) continue;
          const t = (p0 - p1) / den;
          if (t <= 0 || t >= 1) continue;
          const mt = 1 - t;
          const qx = mt * mt * x + 2 * mt * t * c[1] + t * t * c[3];
          const qy = mt * mt * y + 2 * mt * t * c[2] + t * t * c[4];
          extend(b, qx, qy);
        }
        x = c[3];
        y = c[4];
        extend(b, x, y);
        break;
      }
      case 'Z':
        x = sx;
        y = sy;
        break;
    }
  }
  if (b[0] === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: b[0]!, y: b[1]!, w: b[2]! - b[0]!, h: b[3]! - b[1]! };
}
