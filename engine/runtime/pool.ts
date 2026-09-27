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
  private readonly used = new Set<T>();
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
    }
    if (item === undefined) {
      item = this.opts.create();
      this.created++;
    }
    this.used.add(item);
    return item;
  }

  /** Returns an item for reuse (ignored if it isn't active). */
  release(item: T): void {
    if (!this.used.delete(item)) return;
    this.opts.reset?.(item);
    if (this.free.length < (this.opts.max ?? Infinity)) this.free.push(item);
  }

  releaseAll(): void {
    for (const item of [...this.used]) this.release(item);
  }

  /** Items currently handed out. */
  active(): T[] {
    return [...this.used];
  }

  prewarm(n: number): void {
    for (let i = 0; i < n; i++) {
      this.free.push(this.opts.create());
      this.created++;
    }
  }

  /** Forgets free items (active ones stay tracked). */
  clear(): void {
    this.free.length = 0;
  }

  get stats(): PoolStats {
    return { created: this.created, active: this.used.size, free: this.free.length };
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
