import type { Rect } from '../core/math';

const OFF = 32768;
const cellKey = (cx: number, cy: number) =>
  (Math.max(-OFF, Math.min(OFF - 1, cx)) + OFF) * 65536 + (Math.max(-OFF, Math.min(OFF - 1, cy)) + OFF);

/**
 * Uniform-grid broadphase: items are bucketed by the cells their rect covers. Query results are in a
 * deterministic order (cells scanned row by row, items in insertion order) without duplicates.
 *
 *     const hash = new SpatialHash<Enemy>(128);
 *     hash.insert(e, e.bounds());
 *     for (const other of hash.query({ x: 0, y: 0, w: 200, h: 200 })) ...
 */
export class SpatialHash<T> {
  readonly cellSize: number;
  private cells = new Map<number, T[]>();
  private itemCells = new Map<T, number[]>();
  private seen = new Set<T>();

  constructor(cellSize = 128) {
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.itemCells.size;
  }

  has(item: T): boolean {
    return this.itemCells.has(item);
  }

  insert(item: T, r: Rect): void {
    if (this.itemCells.has(item)) this.remove(item);
    const cs = this.cellSize;
    const x0 = Math.floor(r.x / cs);
    const y0 = Math.floor(r.y / cs);
    const x1 = Math.floor((r.x + r.w) / cs);
    const y1 = Math.floor((r.y + r.h) / cs);
    const keys: number[] = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = cellKey(cx, cy);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
        keys.push(k);
      }
    }
    this.itemCells.set(item, keys);
  }

  /** Same as insert (re-buckets an existing item). */
  update(item: T, r: Rect): void {
    this.insert(item, r);
  }

  remove(item: T): void {
    const keys = this.itemCells.get(item);
    if (!keys) return;
    for (const k of keys) {
      const list = this.cells.get(k);
      if (!list) continue;
      const i = list.indexOf(item);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) this.cells.delete(k);
    }
    this.itemCells.delete(item);
  }

  clear(): void {
    this.cells.clear();
    this.itemCells.clear();
  }

  /** Items whose cells touch the rect (a superset of true overlaps: do an exact test afterwards). */
  query(r: Rect, out: T[] = []): T[] {
    const cs = this.cellSize;
    const x0 = Math.floor(r.x / cs);
    const y0 = Math.floor(r.y / cs);
    const x1 = Math.floor((r.x + r.w) / cs);
    const y1 = Math.floor((r.y + r.h) / cs);
    const seen = this.seen;
    seen.clear();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.cells.get(cellKey(cx, cy));
        if (!list) continue;
        for (const it of list) {
          if (seen.has(it)) continue;
          seen.add(it);
          out.push(it);
        }
      }
    }
    seen.clear();
    return out;
  }

  queryPoint(x: number, y: number, out: T[] = []): T[] {
    return this.query({ x, y, w: 0, h: 0 }, out);
  }

  /** Number of non-empty cells (for debugging/perf). */
  get cellCount(): number {
    return this.cells.size;
  }
}
