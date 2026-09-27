import type { Vec2 } from '../core/math';

/** A grid cell (column x, row y). */
export interface GridPoint {
  x: number;
  y: number;
}

/**
 * What pathfinding needs from a grid. TileMap and IsoMap implement it; any object literal works too:
 * `{ cols, rows, passable: (x, y) => grid[y][x] === 0 }`.
 */
export interface PathGrid {
  readonly cols: number;
  readonly rows: number;
  /** The cell can be entered. */
  passable(x: number, y: number): boolean;
  /**
   * Cost multiplier for stepping from a cell to an adjacent one (default 1; the base step is 1 or √2).
   * Return Infinity to block that edge (e.g. a cliff too high to climb). Keep values ≥ 1 for optimal A*.
   */
  moveCost?(fromX: number, fromY: number, toX: number, toY: number): number;
}

/** Diagonal moves past blocked orthogonal neighbours: 'never' = both must be free, 'one' = one, 'always'. */
export type CornerRule = 'never' | 'one' | 'always';
export type GridHeuristic = 'manhattan' | 'octile' | 'euclidean' | 'chebyshev';

export interface GridPathOptions {
  /** Allow 8-directional moves. Default false. */
  diagonal?: boolean;
  /** Default 'never'. */
  cutCorners?: CornerRule;
  /** Default: manhattan (4-dir) / octile (8-dir). */
  heuristic?: GridHeuristic;
  /** > 1 searches faster but paths may be longer than optimal. Default 1. */
  heuristicWeight?: number;
  /** Node expansion budget. Default cols × rows. */
  maxNodes?: number;
  /** When the goal is unreachable, return the path to the reachable cell closest to it. */
  nearest?: boolean;
}

export interface FloodOptions {
  diagonal?: boolean;
  cutCorners?: CornerRule;
  /** Stop expanding beyond this path cost. */
  maxDistance?: number;
}

const SQRT2 = Math.SQRT2;
const DIRS4: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const DIRS8: readonly (readonly [number, number])[] = [...DIRS4, [1, 1], [-1, 1], [-1, -1], [1, -1]];

/** Binary min-heap of cell indices ordered by (f, h, insertion order) — deterministic tie-breaking. */
class CellHeap {
  private cells: number[] = [];
  private f: number[] = [];
  private h: number[] = [];
  private seq: number[] = [];
  private counter = 0;

  get size(): number {
    return this.cells.length;
  }

  push(cell: number, f: number, h: number): void {
    const { cells } = this;
    let i = cells.length;
    cells.push(cell);
    this.f.push(f);
    this.h.push(h);
    this.seq.push(this.counter++);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.cells[0]!;
    const last = this.cells.length - 1;
    this.swap(0, last);
    this.cells.pop();
    this.f.pop();
    this.h.pop();
    this.seq.pop();
    const n = this.cells.length;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const fa = this.f[a]!;
    const fb = this.f[b]!;
    if (fa !== fb) return fa < fb;
    const ha = this.h[a]!;
    const hb = this.h[b]!;
    if (ha !== hb) return ha < hb;
    return this.seq[a]! < this.seq[b]!;
  }

  private swap(a: number, b: number): void {
    if (a === b) return;
    swapIn(this.cells, a, b);
    swapIn(this.f, a, b);
    swapIn(this.h, a, b);
    swapIn(this.seq, a, b);
  }
}

function swapIn(arr: number[], a: number, b: number): void {
  const t = arr[a]!;
  arr[a] = arr[b]!;
  arr[b] = t;
}

function canStep(grid: PathGrid, x: number, y: number, dx: number, dy: number, rule: CornerRule): boolean {
  if (dx === 0 || dy === 0 || rule === 'always') return true;
  const a = grid.passable(x + dx, y);
  const b = grid.passable(x, y + dy);
  return rule === 'never' ? a && b : a || b;
}

function heuristic(kind: GridHeuristic, dx: number, dy: number): number {
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  switch (kind) {
    case 'manhattan':
      return dx + dy;
    case 'chebyshev':
      return Math.max(dx, dy);
    case 'euclidean':
      return Math.sqrt(dx * dx + dy * dy);
    default:
      return dx > dy ? dx - dy + dy * SQRT2 : dy - dx + dx * SQRT2;
  }
}

/**
 * A* on a grid. Returns the cells from start to goal (both included), or null when unreachable.
 * Deterministic: ties are broken by heuristic, then insertion order.
 *
 *     const path = findGridPath(map, 1, 1, 8, 5, { diagonal: true });  // [{x:1,y:1}, ..., {x:8,y:5}]
 */
export function findGridPath(
  grid: PathGrid,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  opts: GridPathOptions = {},
): GridPoint[] | null {
  const { cols, rows } = grid;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
  if (!inb(sx, sy) || !inb(gx, gy)) return null;
  if (sx === gx && sy === gy) return [{ x: sx, y: sy }];
  const diagonal = opts.diagonal ?? false;
  const rule = opts.cutCorners ?? 'never';
  const hk = opts.heuristic ?? (diagonal ? 'octile' : 'manhattan');
  const hw = opts.heuristicWeight ?? 1;
  if (!grid.passable(gx, gy) && !opts.nearest) return null;
  const n = cols * rows;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = sy * cols + sx;
  const goal = gy * cols + gx;
  const dirs = diagonal ? DIRS8 : DIRS4;
  const heap = new CellHeap();
  const h0 = heuristic(hk, gx - sx, gy - sy) * hw;
  g[start] = 0;
  heap.push(start, h0, h0);
  let best = start;
  let bestH = h0;
  let expanded = 0;
  const budget = opts.maxNodes ?? n;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) return buildPath(parent, cur, cols);
    if (++expanded > budget) break;
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    const hc = heuristic(hk, gx - cx, gy - cy);
    if (hc < bestH || (hc === bestH && g[cur]! < g[best]!)) {
      best = cur;
      bestH = hc;
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inb(nx, ny)) continue;
      const ni = ny * cols + nx;
      if (closed[ni] || !grid.passable(nx, ny)) continue;
      if (!canStep(grid, cx, cy, dx, dy, rule)) continue;
      const mc = grid.moveCost ? grid.moveCost(cx, cy, nx, ny) : 1;
      if (!(mc < Infinity)) continue;
      const ng = g[cur]! + (dx !== 0 && dy !== 0 ? SQRT2 : 1) * mc;
      if (ng < g[ni]!) {
        g[ni] = ng;
        parent[ni] = cur;
        const h = heuristic(hk, gx - nx, gy - ny) * hw;
        heap.push(ni, ng + h, h);
      }
    }
  }
  return opts.nearest ? buildPath(parent, best, cols) : null;
}

function buildPath(parent: Int32Array, end: number, cols: number): GridPoint[] {
  const out: GridPoint[] = [];
  for (let c = end; c >= 0; c = parent[c]!) out.push({ x: c % cols, y: Math.floor(c / cols) });
  return out.reverse();
}

/** Total cost of a cell path (1 per straight step, √2 per diagonal, times moveCost). */
export function gridPathCost(grid: PathGrid, path: readonly GridPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const base = a.x !== b.x && a.y !== b.y ? SQRT2 : 1;
    total += base * (grid.moveCost ? grid.moveCost(a.x, a.y, b.x, b.y) : 1);
  }
  return total;
}

/** Drops cells in the middle of straight runs (keeps corners), e.g. for fewer waypoints. */
export function simplifyGridPath(path: readonly GridPoint[]): GridPoint[] {
  if (path.length <= 2) return path.slice();
  const out: GridPoint[] = [path[0]!];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const c = path[i + 1]!;
    if (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y) out.push(b);
  }
  out.push(path[path.length - 1]!);
  return out;
}

/**
 * Dijkstra distance field from one or more source cells (costs as in findGridPath). Unreachable cells are
 * Infinity. Index with `field[y * grid.cols + x]`; walk downhill with stepDownField to reach the nearest source.
 */
export function gridDistanceField(grid: PathGrid, sources: readonly GridPoint[], opts: FloodOptions = {}): Float64Array {
  const { cols, rows } = grid;
  const n = cols * rows;
  const dist = new Float64Array(n).fill(Infinity);
  const closed = new Uint8Array(n);
  const heap = new CellHeap();
  const dirs = opts.diagonal ? DIRS8 : DIRS4;
  const rule = opts.cutCorners ?? 'never';
  const maxD = opts.maxDistance ?? Infinity;
  for (const s of sources) {
    if (s.x < 0 || s.y < 0 || s.x >= cols || s.y >= rows) continue;
    const i = s.y * cols + s.x;
    dist[i] = 0;
    heap.push(i, 0, 0);
  }
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (closed[ni] || !grid.passable(nx, ny) || !canStep(grid, cx, cy, dx, dy, rule)) continue;
      const mc = grid.moveCost ? grid.moveCost(cx, cy, nx, ny) : 1;
      if (!(mc < Infinity)) continue;
      const nd = dist[cur]! + (dx !== 0 && dy !== 0 ? SQRT2 : 1) * mc;
      if (nd <= maxD && nd < dist[ni]!) {
        dist[ni] = nd;
        heap.push(ni, nd, 0);
      }
    }
  }
  return dist;
}

/** Breadth-first flood fill from a cell: every reachable cell in BFS order (start first). */
export function gridFloodFill(grid: PathGrid, sx: number, sy: number, opts: FloodOptions = {}): GridPoint[] {
  const { cols, rows } = grid;
  if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) return [];
  const seen = new Uint8Array(cols * rows);
  const steps = new Float64Array(cols * rows);
  const dirs = opts.diagonal ? DIRS8 : DIRS4;
  const rule = opts.cutCorners ?? 'never';
  const maxD = opts.maxDistance ?? Infinity;
  const out: GridPoint[] = [{ x: sx, y: sy }];
  seen[sy * cols + sx] = 1;
  for (let head = 0; head < out.length; head++) {
    const c = out[head]!;
    const d = steps[c.y * cols + c.x]! + 1;
    if (d > maxD) continue;
    for (const [dx, dy] of dirs) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (seen[ni] || !grid.passable(nx, ny) || !canStep(grid, c.x, c.y, dx, dy, rule)) continue;
      seen[ni] = 1;
      steps[ni] = d;
      out.push({ x: nx, y: ny });
    }
  }
  return out;
}

/** The neighbour with the lowest field value below the current cell's, or null at a source / local minimum. */
export function stepDownField(
  grid: PathGrid,
  field: Float64Array,
  x: number,
  y: number,
  opts: { diagonal?: boolean; cutCorners?: CornerRule } = {},
): GridPoint | null {
  const { cols, rows } = grid;
  let best: GridPoint | null = null;
  let bestD = field[y * cols + x] ?? Infinity;
  const rule = opts.cutCorners ?? 'never';
  for (const [dx, dy] of opts.diagonal ? DIRS8 : DIRS4) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    if (!canStep(grid, x, y, dx, dy, rule)) continue;
    const d = field[ny * cols + nx]!;
    if (d < bestD) {
      bestD = d;
      best = { x: nx, y: ny };
    }
  }
  return best;
}

/**
 * Moves a point along a polyline at constant speed (pure logic; copy x/y to a node or body each frame).
 *
 *     const walker = new PathFollower(map.findWorldPath(hx, hy, tx, ty) ?? [], 180);
 *     hero.onUpdate((dt) => { walker.update(dt); hero.setPosition(walker.x, walker.y); });
 */
export class PathFollower {
  readonly points: Vec2[];
  speed: number;
  x = 0;
  y = 0;
  /** Index of the point being walked toward. */
  index = 1;
  /** Unit direction of the last movement. */
  dirX = 0;
  dirY = 0;
  /** Distance travelled so far. */
  travelled = 0;

  constructor(points: readonly Vec2[], speed: number) {
    this.points = points.map((p) => ({ x: p.x, y: p.y }));
    this.speed = speed;
    if (this.points.length) {
      this.x = this.points[0]!.x;
      this.y = this.points[0]!.y;
    }
  }

  get done(): boolean {
    return this.index >= this.points.length;
  }

  /** The point currently walked toward, or null when done. */
  get target(): Vec2 | null {
    return this.points[this.index] ?? null;
  }

  /** Remaining distance to the last point. */
  get remaining(): number {
    let d = 0;
    let px = this.x;
    let py = this.y;
    for (let i = this.index; i < this.points.length; i++) {
      const p = this.points[i]!;
      d += Math.hypot(p.x - px, p.y - py);
      px = p.x;
      py = p.y;
    }
    return d;
  }

  /** Advances by speed × dt. Returns true while still moving. */
  update(dt: number): boolean {
    let step = this.speed * dt;
    while (step > 0 && this.index < this.points.length) {
      const p = this.points[this.index]!;
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 0) {
        this.dirX = dx / d;
        this.dirY = dy / d;
      }
      if (d <= step) {
        this.x = p.x;
        this.y = p.y;
        this.travelled += d;
        step -= d;
        this.index++;
      } else {
        this.x += (dx / d) * step;
        this.y += (dy / d) * step;
        this.travelled += step;
        step = 0;
      }
    }
    return !this.done;
  }
}
