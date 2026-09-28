import type { Rect } from '../core/math';

const OFF = 32768;
const SMI = 16384;
const clampCell = (c: number) => Math.max(-OFF, Math.min(OFF - 1, c));
/** Cells within ±16384 get small-integer keys (< 2^30, no heap numbers); the rest a disjoint range above. */
const cellKey = (cx: number, cy: number) =>
  cx >= -SMI && cx < SMI && cy >= -SMI && cy < SMI
    ? (cx + SMI) * 32768 + (cy + SMI)
    : 1073741824 + (cx + OFF) * 65536 + (cy + OFF);

/** Items of one cell in insertion order; `recs[0..n)` is valid only while `gen` is the hash's generation. */
interface HashCell<T> {
  recs: HashRec<T>[];
  n: number;
  gen: number;
}

/** Per-item record, kept across clear() so re-inserting the same items allocates nothing. */
interface HashRec<T> {
  item: T | null;
  /** Cells covered at the last insert, row by row: cell range x0..x1, y0..y1. */
  cells: HashCell<T>[];
  nc: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  gen: number;
  stamp: number;
}

/**
 * Uniform-grid broadphase: items are bucketed by the cells their rect covers. Query results are in a
 * deterministic order (cells scanned row by row, items in insertion order) without duplicates.
 * clear() + re-insert every frame is cheap: cells and item records are reused, not reallocated.
 *
 *     const hash = new SpatialHash<Enemy>(128);
 *     hash.insert(e, e.bounds());
 *     for (const other of hash.query({ x: 0, y: 0, w: 200, h: 200 })) ...
 */
export class SpatialHash<T> {
  readonly cellSize: number;
  private cells = new Map<number, HashCell<T>>();
  private recs = new Map<T, HashRec<T>>();
  private gen = 1;
  private stamp = 0;
  private live = 0;
  private liveCells = 0;

  constructor(cellSize = 128) {
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.live;
  }

  has(item: T): boolean {
    return this.recs.get(item)?.gen === this.gen;
  }

  insert(item: T, r: Rect): void {
    const gen = this.gen;
    let rec = this.recs.get(item);
    if (rec === undefined) {
      rec = { item, cells: [], nc: 0, x0: 0, y0: 0, x1: -1, y1: -1, gen: 0, stamp: 0 };
      this.recs.set(item, rec);
    }
    const cs = this.cellSize;
    const x0 = clampCell(Math.floor(r.x / cs));
    const y0 = clampCell(Math.floor(r.y / cs));
    const x1 = clampCell(Math.floor((r.x + r.w) / cs));
    const y1 = clampCell(Math.floor((r.y + r.h) / cs));
    // Cells used in the last generation survive clear() (see its pruning), so an item that stays in the same
    // cells re-links into them without map lookups.
    const same = rec.gen >= gen - 1 && rec.x0 === x0 && rec.y0 === y0 && rec.x1 === x1 && rec.y1 === y1;
    let nc = rec.nc;
    if (rec.gen === gen) this.unlink(rec);
    else {
      rec.gen = gen;
      this.live++;
    }
    const own = rec.cells;
    if (same) {
      for (let c = 0; c < nc; c++) this.link(own[c]!, rec, gen);
      rec.nc = nc;
      return;
    }
    rec.x0 = x0;
    rec.y0 = y0;
    rec.x1 = x1;
    rec.y1 = y1;
    const cells = this.cells;
    nc = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = cellKey(cx, cy);
        let cell = cells.get(k);
        if (cell === undefined) cells.set(k, (cell = { recs: [], n: 0, gen }));
        this.link(cell, rec, gen);
        own[nc++] = cell;
      }
    }
    rec.nc = nc;
  }

  /** Same as insert (re-buckets an existing item). */
  update(item: T, r: Rect): void {
    this.insert(item, r);
  }

  remove(item: T): void {
    const rec = this.recs.get(item);
    if (rec === undefined) return;
    if (rec.gen === this.gen) {
      this.unlink(rec);
      this.live--;
    }
    rec.gen = 0;
    rec.item = null;
    this.recs.delete(item);
  }

  /** O(1): bumps the generation; stale cells and records are recycled by the next inserts. */
  clear(): void {
    const gen = this.gen;
    if (this.recs.size > 64 && this.recs.size > 4 * this.live) {
      for (const [item, rec] of this.recs) {
        if (rec.gen === gen) continue;
        rec.item = null;
        this.recs.delete(item);
      }
    }
    if (this.cells.size > 64 && this.cells.size > 4 * this.liveCells) {
      for (const [k, cell] of this.cells) if (cell.gen !== gen || cell.n === 0) this.cells.delete(k);
    }
    this.gen = gen + 1;
    this.live = 0;
    this.liveCells = 0;
  }

  /** Items whose cells touch the rect (a superset of true overlaps: do an exact test afterwards). */
  query(r: Rect, out: T[] = []): T[] {
    const cs = this.cellSize;
    this.collect(Math.floor(r.x / cs), Math.floor(r.y / cs), Math.floor((r.x + r.w) / cs), Math.floor((r.y + r.h) / cs), out, out.length);
    return out;
  }

  /**
   * Like query() but overwrites out[0..count) and returns count. `out` never shrinks, so an array reused every
   * frame keeps its capacity; entries past count are stale.
   */
  queryInto(r: Rect, out: T[]): number {
    const cs = this.cellSize;
    return this.collect(Math.floor(r.x / cs), Math.floor(r.y / cs), Math.floor((r.x + r.w) / cs), Math.floor((r.y + r.h) / cs), out, 0);
  }

  queryPoint(x: number, y: number, out: T[] = []): T[] {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    this.collect(cx, cy, cx, cy, out, out.length);
    return out;
  }

  /** Number of non-empty cells (for debugging/perf). */
  get cellCount(): number {
    return this.liveCells;
  }

  /** Writes the items of a cell range to out[k..), row by row, each once; returns the end index. */
  private collect(x0: number, y0: number, x1: number, y1: number, out: T[], k: number): number {
    x0 = clampCell(x0);
    y0 = clampCell(y0);
    x1 = clampCell(x1);
    y1 = clampCell(y1);
    let stamp = ++this.stamp;
    if (stamp > 0x3fffffff) {
      for (const rec of this.recs.values()) rec.stamp = 0;
      stamp = this.stamp = 1;
    }
    const gen = this.gen;
    const cells = this.cells;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = cells.get(cellKey(cx, cy));
        if (cell === undefined || cell.gen !== gen) continue;
        const recs = cell.recs;
        for (let i = 0, n = cell.n; i < n; i++) {
          const rec = recs[i]!;
          if (rec.stamp === stamp) continue;
          rec.stamp = stamp;
          out[k++] = rec.item as T;
        }
      }
    }
    return k;
  }

  /** Appends a record to a cell, resetting the cell first when it is left over from an older generation. */
  private link(cell: HashCell<T>, rec: HashRec<T>, gen: number): void {
    if (cell.gen !== gen) {
      cell.gen = gen;
      cell.n = 0;
    }
    if (cell.n === 0) this.liveCells++;
    cell.recs[cell.n++] = rec;
  }

  /** Takes a live record out of its cells, keeping the order of the other items (its cell list stays valid). */
  private unlink(rec: HashRec<T>): void {
    const own = rec.cells;
    for (let c = 0; c < rec.nc; c++) {
      const cell = own[c]!;
      const recs = cell.recs;
      const n = cell.n;
      let i = recs.indexOf(rec);
      if (i < 0 || i >= n) continue;
      for (; i < n - 1; i++) recs[i] = recs[i + 1]!;
      cell.n = n - 1;
      if (n === 1) this.liveCells--;
    }
  }
}
