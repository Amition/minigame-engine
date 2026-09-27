import type { Game } from '../core/game';
import type { Node } from '../scene/node';
import { getTicker, isTreePaused, resolveGame, TIME_EPS, type Tickable } from './ticker';

export interface TimerOptions {
  /** Cancelled when this node is destroyed; frozen while its subtree is paused. */
  owner?: Node | null;
  /** Unscaled time that keeps running while game.paused. Default: game time (pause/timeScale aware). */
  realtime?: boolean;
  /** Defaults to Game.current. */
  game?: Game;
}

export interface EveryOptions extends TimerOptions {
  /** Stop after this many calls (default: forever). */
  count?: number;
  /** Also call once right away (counts as the first call). */
  immediate?: boolean;
}

const byOwner = new WeakMap<Node, Set<Timer>>();

/** A scheduled callback in game time. Created by after() / every(). */
export class Timer implements Tickable {
  /** Calls so far. */
  count = 0;
  readonly owner: Node | null;
  private elapsed = 0;
  private state: 'running' | 'done' | 'cancelled' = 'running';
  private _paused = false;

  constructor(
    readonly interval: number,
    private readonly fn: (count: number) => unknown,
    readonly maxCount: number,
    opts: TimerOptions = {},
  ) {
    this.owner = opts.owner ?? null;
    if (this.owner) {
      let set = byOwner.get(this.owner);
      if (!set) byOwner.set(this.owner, (set = new Set()));
      set.add(this);
    }
    getTicker(resolveGame(opts.game), opts.realtime).add(this);
  }

  /** True until it fired its last call or was cancelled. */
  get active(): boolean {
    return this.state === 'running';
  }

  get cancelled(): boolean {
    return this.state === 'cancelled';
  }

  /** Seconds until the next call. */
  get remaining(): number {
    return Math.max(0, this.interval - this.elapsed);
  }

  cancel(): void {
    if (this.state !== 'running') return;
    this.end('cancelled');
  }

  pause(): this {
    this._paused = true;
    return this;
  }

  resume(): this {
    this._paused = false;
    return this;
  }

  /** Called immediately by every({ immediate: true }). */
  fire(): void {
    if (this.state !== 'running') return;
    this.count++;
    const r = this.fn(this.count);
    if (this.state === 'running' && (r === false || this.count >= this.maxCount)) this.end('done');
  }

  tick(dt: number): boolean {
    if (this.state !== 'running') return false;
    const o = this.owner;
    if (o) {
      if (o.destroyed) {
        this.cancel();
        return false;
      }
      if (isTreePaused(o)) return true;
    }
    if (this._paused) return true;
    this.elapsed += dt;
    const step = Math.max(0, this.interval);
    while (this.state === 'running' && this.elapsed >= step - TIME_EPS) {
      this.elapsed -= step;
      this.fire();
      if (step <= TIME_EPS) {
        this.elapsed = 0;
        break;
      }
    }
    return this.state === 'running';
  }

  private end(state: 'done' | 'cancelled'): void {
    this.state = state;
    if (this.owner) byOwner.get(this.owner)?.delete(this);
  }
}

/** Calls `fn` once after `seconds` of game time. `after(1, () => spawn(), { owner: this })`. */
export function after(seconds: number, fn: () => void, opts?: TimerOptions): Timer {
  return new Timer(seconds, () => fn(), 1, opts);
}

/**
 * Calls `fn(count)` every `seconds` of game time. Return false from fn to stop.
 * `every(0.5, (n) => spawnEnemy(), { count: 10, owner: this })`.
 */
export function every(seconds: number, fn: (count: number) => void | boolean, opts: EveryOptions = {}): Timer {
  const t = new Timer(seconds, fn, opts.count ?? Infinity, opts);
  if (opts.immediate) t.fire();
  return t;
}

/** Resolves after `seconds` of game time (never, if the owner is destroyed first). `await wait(0.5)`. */
export function wait(seconds: number, opts?: TimerOptions): Promise<void> {
  return new Promise<void>((resolve) => void after(seconds, () => resolve(), opts));
}

/** Resolves on the first frame where `predicate()` is true (checked every frame in game time). */
export function waitUntil(predicate: () => boolean, opts?: TimerOptions): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    new Timer(0, () => {
      if (!predicate()) return;
      resolve();
      return false;
    }, Infinity, opts);
  });
}

/** Resolves at the start of the next frame (also while paused) with its unscaled dt. */
export function nextFrame(game?: Game): Promise<number> {
  const g = resolveGame(game);
  return new Promise<number>((resolve) => void g.once('frame', resolve));
}

/** Cancels every timer owned by `owner`. Returns how many were cancelled. */
export function cancelTimersOf(owner: Node): number {
  const set = byOwner.get(owner);
  if (!set) return 0;
  const list = [...set];
  for (const t of list) t.cancel();
  return list.length;
}
