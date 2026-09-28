import type { Node } from '../scene/node';
import { cancelTimersOf } from './timers';
import { killTweensOf } from './tween';

export interface PoolOptions<T> {
  create: () => T;
  /** Called on release to clean an item for reuse. */
  reset?: (item: T) => void;
  /** Max free items kept (default Infinity); extra releases are dropped. */
  max?: number;
  /** Items created up front. */
  prewarm?: number;
  /** Free items failing this check are discarded on get(). */
  valid?: (item: T) => boolean;
}

export interface PoolStats {
  /** Items ever created. */
  created: number;
  /** Items handed out and not released. */
  active: number;
  /** Items waiting for reuse. */
  free: number;
}

/** Object pool: `const bullets = new Pool({ create: () => ({ x: 0, y: 0 }) }); const b = bullets.get(); bullets.release(b);`. */
export class Pool<T> {
  private readonly free: T[] = [];
  // Handed-out items in get() order, order[0..end). An entry is live while slot.get(item) is its index; released
  // items keep their map entry (-1) so get/release only overwrite values instead of adding and deleting keys, and
  // `order` never shrinks (no churn, no garbage in steady use).
  private readonly order: (T | undefined)[] = [];
  private end = 0;
  private readonly slot = new Map<T, number>();
  private live = 0;
  private created = 0;
  private readonly opts: PoolOptions<T>;

  constructor(opts: PoolOptions<T> | (() => T)) {
    this.opts = typeof opts === 'function' ? { create: opts } : opts;
    if (this.opts.prewarm) this.prewarm(this.opts.prewarm);
  }

  /** Takes a free item or creates one. */
  get(): T {
    let item: T | undefined;
    while ((item = this.free.pop()) !== undefined) {
      if (!this.opts.valid || this.opts.valid(item)) break;
      this.slot.delete(item);
    }
    if (item === undefined) {
      item = this.opts.create();
      this.created++;
    }
    const i = this.slot.get(item);
    if (i !== undefined && i >= 0) return item;
    this.slot.set(item, this.end);
    this.order[this.end++] = item;
    this.live++;
    return item;
  }

  /** Returns an item for reuse (ignored if it isn't active). */
  release(item: T): void {
    const i = this.slot.get(item);
    if (i === undefined || i < 0) return;
    this.slot.set(item, -1);
    this.live--;
    this.trim();
    this.opts.reset?.(item);
    if (this.free.length < (this.opts.max ?? Infinity)) this.free.push(item);
    else if (this.slot.get(item) === -1) this.slot.delete(item);
  }

  releaseAll(): void {
    for (const item of this.active()) this.release(item);
  }

  /** Items currently handed out, in the order they were taken. */
  active(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.end; i++) {
      const item = this.order[i]!;
      if (this.slot.get(item) === i) out.push(item);
    }
    return out;
  }

  prewarm(n: number): void {
    for (let i = 0; i < n; i++) {
      const item = this.opts.create();
      this.created++;
      this.slot.set(item, -1);
      this.free.push(item);
    }
  }

  /** Forgets free items (active ones stay tracked). */
  clear(): void {
    for (const item of this.free) if (this.slot.get(item) === -1) this.slot.delete(item);
    this.free.length = 0;
  }

  get stats(): PoolStats {
    return { created: this.created, active: this.live, free: this.free.length };
  }

  /** Drops stale entries from the end of `order`, and compacts it once most entries are stale. */
  private trim(): void {
    const order = this.order;
    const old = this.end;
    let n = old;
    while (n > 0 && this.slot.get(order[n - 1]!) !== n - 1) n--;
    if (n > 32 && this.live * 2 < n) {
      let w = 0;
      for (let r = 0; r < n; r++) {
        const item = order[r]!;
        if (this.slot.get(item) !== r) continue;
        this.slot.set(item, w);
        order[w++] = item;
      }
      n = w;
    }
    for (let i = n; i < old; i++) order[i] = undefined;
    this.end = n;
  }
}

interface NodeRest {
  alpha: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

/**
 * Pool of scene nodes (bullets, particles, popups). get() adds the node to a parent; release() detaches it,
 * kills its tweens and timers and restores the alpha/scale/rotation it was created with. Destroyed nodes are never reused.
 *
 *     const coins = new NodePool(() => new Sprite('coin', { anchor: 0.5 }));
 *     const c = coins.get(scene).setPosition(x, y);  ...  coins.release(c);
 */
export class NodePool<T extends Node> {
  private readonly pool: Pool<T>;
  private readonly rest = new WeakMap<T, NodeRest>();

  constructor(
    create: () => T,
    private readonly opts: { reset?: (node: T) => void; max?: number; parent?: Node; prewarm?: number } = {},
  ) {
    this.pool = new Pool<T>({
      create: () => {
        const n = create();
        this.rest.set(n, { alpha: n.alpha, scaleX: n.scaleX, scaleY: n.scaleY, rotation: n.rotation });
        return n;
      },
      reset: (n) => {
        killTweensOf(n);
        cancelTimersOf(n);
        n.removeFromParent();
        const r = this.rest.get(n);
        if (r) {
          n.alpha = r.alpha;
          n.scaleX = r.scaleX;
          n.scaleY = r.scaleY;
          n.rotation = r.rotation;
        }
        n.visible = true;
        n.paused = false;
        this.opts.reset?.(n);
      },
      valid: (n) => !n.destroyed,
      ...(opts.max !== undefined ? { max: opts.max } : {}),
      ...(opts.prewarm !== undefined ? { prewarm: opts.prewarm } : {}),
    });
  }

  /** Takes a node and adds it to `parent` (or the pool's default parent). */
  get(parent?: Node): T {
    const n = this.pool.get();
    const p = parent ?? this.opts.parent;
    if (p && n.parent !== p) p.add(n);
    return n;
  }

  release(node: T): void {
    this.pool.release(node);
  }

  releaseAll(): void {
    this.pool.releaseAll();
  }

  /** Nodes currently in use (destroyed ones included until released). */
  active(): T[] {
    return this.pool.active();
  }

  get stats(): PoolStats {
    return this.pool.stats;
  }
}
