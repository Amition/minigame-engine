import { parseColor, toCss, type Color, type RGBA } from '../core/color';
import { Game } from '../core/game';
import { Node } from '../scene/node';
import { Scene } from '../scene/scene';
import { getEase, type Ease, type EaseFn } from './ease';
import { getTicker, invalidatePauseCache, isThenable, ownerPaused, resolveGame, TIME_EPS, type Tickable } from './ticker';
import { after, type Timer } from './timers';

/** A target value: a number, a relative string ('+=50', '-=10', '*=2'), a color string, or a nested object of those. */
export type TweenValue = number | string | { [key: string]: TweenValue };

/** Properties to animate. `scale` is a shorthand for scaleX + scaleY on nodes. */
export type TweenProps<T> = { [K in keyof T]?: TweenValue } & { scale?: number | string };

export interface TweenOptions {
  /** Easing of the first step and default for chained .to() steps (default 'quadOut'). */
  ease?: Ease;
  /** Seconds to wait before starting. */
  delay?: number;
  /** Extra plays after the first; Infinity = forever. */
  repeat?: number;
  /** Play backwards on every other play (implies repeat >= 1). */
  yoyo?: boolean;
  /** Unscaled time that keeps running while game.paused (pause menus). Default: game time. */
  realtime?: boolean;
  /** Killed when this node is destroyed, frozen while its subtree is paused. Default: the target if it is a Node. */
  owner?: Node | null;
  /** Defaults to Game.current. */
  game?: Game;
  /** Called every frame with the progress of the current play (0..1). */
  onUpdate?: (progress: number) => void;
  onComplete?: () => void;
  /** Called when the tween is killed before completing (cleanup). */
  onKill?: () => void;
}

/** Common surface of Tween and TweenGroup: awaitable and killable. */
export interface TweenLike extends PromiseLike<void> {
  readonly done: Promise<void>;
  readonly finished: boolean;
  kill(): void;
}

interface Track {
  obj: Record<string, unknown>;
  key: string;
  from: number;
  to: number;
  c0: RGBA | null;
  c1: RGBA | null;
}

interface Step {
  kind: 'to' | 'wait' | 'call';
  start: number;
  dur: number;
  props: Record<string, TweenValue> | null;
  ease: EaseFn;
  fn: (() => void) | null;
  tracks: Track[] | null;
}

const registry = new WeakMap<object, Set<Tween<any>>>();

function register(key: object, tw: Tween<any>): void {
  let set = registry.get(key);
  if (!set) registry.set(key, (set = new Set()));
  set.add(tw);
}

function unregister(key: object, tw: Tween<any>): void {
  registry.get(key)?.delete(tw);
}

const noop = () => {};

/**
 * Animates properties of a target over time. Starts immediately; awaitable; chainable:
 *
 *     await tween(box, { x: 400, alpha: 0.5 }, 0.3, { ease: 'backOut' });
 *     tween(coin, { y: '-=40' }, 0.2).to({ y: '+=40' }, 0.2, 'bounceOut').repeat(Infinity);
 *     tween(panel, { fill: '#ff0000', scale: 1.2 }, 0.5).yoyo();
 *
 * Start values are captured when each step begins, so chained steps continue from where the previous one ended.
 */
export class Tween<T extends object = object> implements Tickable, TweenLike {
  /** Multiplies dt for this tween. */
  timeScale = 1;
  onUpdate: ((progress: number) => void) | null;
  onComplete: (() => void) | null;
  onKill: (() => void) | null;
  readonly owner: Node | null;
  private readonly steps: Step[] = [];
  private total = 0;
  private time: number;
  /** Play position handed to runForward / runReverse (a field: numbers passed to non-inlined calls get boxed). */
  private playhead = 0;
  private iteration = 0;
  private cursor = 0;
  private repeats: number;
  private yoyoOn = false;
  private readonly defaultEase: EaseFn;
  private state: 'running' | 'done' | 'killed' = 'running';
  private _paused = false;
  private _done: Promise<void> | null = null;
  private resolveDone: (() => void) | null = null;

  constructor(
    readonly target: T,
    opts: TweenOptions = {},
  ) {
    this.time = -Math.max(0, opts.delay ?? 0);
    this.repeats = Math.max(0, opts.repeat ?? 0);
    if (opts.yoyo) this.yoyo();
    this.defaultEase = getEase(opts.ease);
    this.owner = opts.owner !== undefined ? opts.owner : target instanceof Node ? target : null;
    this.onUpdate = opts.onUpdate ?? null;
    this.onComplete = opts.onComplete ?? null;
    this.onKill = opts.onKill ?? null;
    getTicker(resolveGame(opts.game), opts.realtime).add(this);
    register(target, this);
    if (this.owner && this.owner !== (target as object)) register(this.owner, this);
  }

  // ---------------------------------------------------------------- chain

  /** Appends a step animating `props` over `duration` seconds. */
  to(props: TweenProps<T>, duration: number, ease?: Ease): this {
    return this.push('to', duration, props as Record<string, TweenValue>, ease === undefined ? this.defaultEase : getEase(ease));
  }

  /** Appends a pause. */
  wait(seconds: number): this {
    return this.push('wait', seconds, null, this.defaultEase);
  }

  /** Appends a callback (runs on forward plays only). */
  call(fn: () => void): this {
    this.push('call', 0, null, this.defaultEase);
    this.steps[this.steps.length - 1]!.fn = fn;
    return this;
  }

  /** Extra plays after the first (default Infinity). */
  repeat(times = Infinity): this {
    this.repeats = Math.max(0, times);
    return this;
  }

  /** Plays backwards on every other play; sets repeat to at least 1. */
  yoyo(on = true): this {
    this.yoyoOn = on;
    if (on && this.repeats < 1) this.repeats = 1;
    return this;
  }

  // ---------------------------------------------------------------- control

  pause(): this {
    this._paused = true;
    return this;
  }

  resume(): this {
    this._paused = false;
    return this;
  }

  get paused(): boolean {
    return this._paused;
  }

  /** True once completed normally. */
  get finished(): boolean {
    return this.state === 'done';
  }

  get killed(): boolean {
    return this.state === 'killed';
  }

  /** Still running (possibly paused or delayed). */
  get active(): boolean {
    return this.state === 'running';
  }

  /** Length of one play in seconds. */
  get duration(): number {
    return this.total;
  }

  /**
   * Stops the tween. By default it stays where it is and `done` never resolves;
   * with `complete = true` it jumps to its final state, runs onComplete and resolves.
   */
  kill(complete = false): void {
    if (this.state !== 'running') return;
    if (complete) {
      if (!Number.isFinite(this.repeats)) this.repeats = this.iteration;
      this._paused = false;
      while (this.state === 'running') {
        this.time = this.total;
        this.evaluate();
      }
      return;
    }
    this.state = 'killed';
    this.unregisterAll();
    if (this.onKill) {
      this.onKill();
      invalidatePauseCache();
    }
  }

  /** Resolves when the tween completes (never if it is killed). */
  get done(): Promise<void> {
    if (!this._done) {
      this._done = this.state === 'done' ? Promise.resolve() : new Promise<void>((r) => (this.resolveDone = r));
    }
    return this._done;
  }

  then<A = void, B = never>(
    onfulfilled?: ((value: void) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.done.then(onfulfilled, onrejected);
  }

  // ---------------------------------------------------------------- internals

  tick(dt: number): boolean {
    if (this.state !== 'running') return false;
    const o = this.owner;
    if (o) {
      if (o.destroyed) {
        this.kill();
        return false;
      }
      if (ownerPaused(o)) return true;
    }
    if (this._paused) return true;
    this.time += dt * this.timeScale;
    this.evaluate();
    return this.state === 'running';
  }

  private push(kind: Step['kind'], dur: number, props: Step['props'], ease: EaseFn): this {
    const d = Math.max(0, dur);
    this.steps.push({ kind, start: this.total, dur: d, props, ease, fn: null, tracks: null });
    this.total += d;
    return this;
  }

  private get forward(): boolean {
    return !(this.yoyoOn && this.iteration % 2 === 1);
  }

  private evaluate(): void {
    for (let guard = 0; this.state === 'running' && this.time >= -TIME_EPS; guard++) {
      const t = Math.max(0, Math.min(this.time, this.total));
      if (this.forward) {
        this.playhead = t;
        this.runForward();
      } else {
        this.playhead = this.total - t;
        this.runReverse();
      }
      if (this.state !== 'running') return;
      if (this.onUpdate) {
        this.onUpdate(this.total > 0 ? t / this.total : 1);
        invalidatePauseCache();
      }
      if (this.time < this.total - TIME_EPS) return;
      if (this.iteration >= this.repeats) {
        this.finish();
        return;
      }
      this.iteration++;
      this.time = Math.max(0, this.time - this.total);
      this.cursor = this.forward ? 0 : this.steps.length - 1;
      if (this.total <= TIME_EPS || guard > 1000) return;
    }
  }

  private runForward(): void {
    const t = this.playhead;
    const steps = this.steps;
    while (this.cursor < steps.length) {
      const s = steps[this.cursor]!;
      if (t < s.start - TIME_EPS) return;
      const complete = t >= s.start + s.dur - TIME_EPS;
      if (s.kind === 'to') {
        s.tracks ??= buildTracks(this.target, s.props!, []);
        applyTracks(s.tracks, s.ease(complete ? 1 : (t - s.start) / s.dur));
      } else if (s.kind === 'call') {
        s.fn!();
        invalidatePauseCache();
        if (this.state !== 'running') return;
      }
      if (!complete) return;
      this.cursor++;
    }
  }

  private runReverse(): void {
    const t = this.playhead;
    const steps = this.steps;
    while (this.cursor >= 0) {
      const s = steps[this.cursor]!;
      if (t > s.start + s.dur + TIME_EPS) return;
      const atStart = t <= s.start + TIME_EPS;
      if (s.kind === 'to' && s.tracks) applyTracks(s.tracks, s.ease(atStart ? 0 : (t - s.start) / s.dur));
      if (!atStart) return;
      this.cursor--;
    }
  }

  private finish(): void {
    this.state = 'done';
    this.unregisterAll();
    if (this.onComplete) {
      this.onComplete();
      invalidatePauseCache();
    }
    this.resolveDone?.();
  }

  private unregisterAll(): void {
    unregister(this.target, this);
    if (this.owner) unregister(this.owner, this);
  }
}

const REL = /^([+\-*])=\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i;

function buildTracks(target: object, props: Record<string, TweenValue>, out: Track[]): Track[] {
  const obj = target as Record<string, unknown>;
  for (const key of Object.keys(props)) {
    const v = props[key]!;
    if (key === 'scale' && !('scale' in obj) && 'scaleX' in obj && 'scaleY' in obj) {
      if (typeof v === 'object') throw new Error('tween: "scale" must be a number or relative string');
      out.push(makeTrack(obj, 'scaleX', v), makeTrack(obj, 'scaleY', v));
    } else if (typeof v === 'object' && v !== null) {
      const sub = obj[key];
      if (!sub || typeof sub !== 'object') throw new Error(`tween: "${key}" is not an object on the target`);
      buildTracks(sub, v, out);
    } else {
      out.push(makeTrack(obj, key, v));
    }
  }
  return out;
}

function makeTrack(obj: Record<string, unknown>, key: string, v: number | string): Track {
  const cur = obj[key];
  const numeric = (): number => {
    if (typeof cur === 'number') return cur;
    throw new Error(`tween: "${key}" is ${cur === undefined ? 'undefined' : `not a number (${typeof cur})`} on the target`);
  };
  if (typeof v === 'number') return { obj, key, from: numeric(), to: v, c0: null, c1: null };
  const m = REL.exec(v.trim());
  if (m) {
    const from = numeric();
    const n = parseFloat(m[2]!);
    const to = m[1] === '+' ? from + n : m[1] === '-' ? from - n : from * n;
    return { obj, key, from, to, c0: null, c1: null };
  }
  if (typeof cur === 'number') {
    const n = Number(v);
    if (Number.isNaN(n)) throw new Error(`tween: "${key}" is a number, can't animate to "${v}"`);
    return { obj, key, from: cur, to: n, c0: null, c1: null };
  }
  if (typeof cur === 'string' || cur === null || cur === undefined) {
    const c1 = parseColor(v);
    const c0 = typeof cur === 'string' ? parseColor(cur) : { ...c1, a: 0 };
    return { obj, key, from: 0, to: 1, c0, c1 };
  }
  throw new Error(`tween: can't animate "${key}" (${typeof cur}) to "${v}"`);
}

const mixed: RGBA = { r: 0, g: 0, b: 0, a: 1 };

function applyTracks(tracks: Track[], e: number): void {
  for (let i = 0; i < tracks.length; i++) {
    const tr = tracks[i]!;
    const a = tr.c0;
    if (a) {
      const b = tr.c1!;
      mixed.r = a.r + (b.r - a.r) * e;
      mixed.g = a.g + (b.g - a.g) * e;
      mixed.b = a.b + (b.b - a.b) * e;
      mixed.a = a.a + (b.a - a.a) * e;
      tr.obj[tr.key] = toCss(mixed);
    } else {
      tr.obj[tr.key] = tr.from + (tr.to - tr.from) * e;
    }
  }
}

// ---------------------------------------------------------------- functions

/** Starts a tween: `await tween(node, { x: 300, alpha: 0 }, 0.4, { ease: 'cubicOut' })`. */
export function tween<T extends object>(target: T, props: TweenProps<T>, duration: number, opts?: TweenOptions): Tween<T> {
  return new Tween(target, opts).to(props, duration);
}

/**
 * Tweens a plain value and reports it every frame:
 * `tweenValue(0, 100, 1, (v) => (label.text = String(Math.round(v))))`, or colors:
 * `tweenValue('#ffffff', '#ff0000', 0.3, (c) => text.setStyle({ color: c }))`.
 */
export function tweenValue(from: number, to: number, duration: number, onValue: (v: number) => void, opts?: TweenOptions): Tween<{ value: number }>;
export function tweenValue(from: Color, to: Color, duration: number, onValue: (v: Color) => void, opts?: TweenOptions): Tween<{ value: Color }>;
export function tweenValue(
  from: number | Color,
  to: number | Color,
  duration: number,
  onValue: (v: any) => void,
  opts: TweenOptions = {},
): Tween<{ value: number | Color }> {
  const proxy = { value: from };
  const user = opts.onUpdate;
  return new Tween(proxy, {
    ...opts,
    onUpdate: (p) => {
      onValue(proxy.value);
      user?.(p);
    },
  }).to({ value: to }, duration);
}

/** Kills every tween animating `target` or owned by it. Returns how many were killed. */
export function killTweensOf(target: object, complete = false): number {
  const set = registry.get(target);
  if (!set || set.size === 0) return 0;
  const list = [...set];
  for (const tw of list) tw.kill(complete);
  return list.length;
}

/** Live tweens animating `target` or owned by it. */
export function tweensOf(target: object): Tween<any>[] {
  return [...(registry.get(target) ?? [])];
}

export function isTweening(target: object): boolean {
  return (registry.get(target)?.size ?? 0) > 0;
}

// ---------------------------------------------------------------- groups

/**
 * Items for sequence()/parallel(): a Tween (held until its turn), a TweenGroup, a number (seconds to wait),
 * or a function started at its turn that may return a Tween / promise to wait for.
 */
export type TweenItem = Tween<any> | TweenGroup | number | (() => unknown);

export interface TweenGroupOptions {
  game?: Game;
  /** Waits (number items) use unscaled time. */
  realtime?: boolean;
  /**
   * Killed (no further items, waits or callbacks) when this node is destroyed; waits freeze while its subtree is
   * paused. Default: the scene of the first node its tweens animate (that node itself when it is in no scene), else
   * the top scene when the group is created. `null`: app-level, keeps running across scene changes until it finishes
   * or is killed.
   */
  owner?: Node | null;
}

function sceneOf(node: Node): Scene | null {
  for (let n: Node | null = node; n; n = n.parent) if (n instanceof Scene) return n;
  return null;
}

function defaultGroupOwner(items: TweenItem[], game: Game | undefined): Node | null {
  for (const it of items) {
    const n = it instanceof Tween || it instanceof TweenGroup ? it.owner : null;
    if (n) return sceneOf(n) ?? n;
  }
  return (game ?? Game.current)?.scenes.top ?? null;
}

/** A sequence or parallel set of tweens; awaitable and killable. Created by sequence() / parallel(). */
export class TweenGroup implements TweenLike {
  readonly done: Promise<void>;
  /** The group is killed when this node is destroyed (see TweenGroupOptions.owner). */
  readonly owner: Node | null;
  private state: 'idle' | 'running' | 'done' | 'killed' = 'idle';
  private held = false;
  private live = new Set<Tween<any> | TweenGroup | Timer>();
  private resolveDone!: () => void;
  private offOwner: (() => void) | null = null;

  constructor(
    readonly mode: 'sequence' | 'parallel',
    private readonly items: TweenItem[],
    private readonly opts: TweenGroupOptions = {},
  ) {
    this.done = new Promise<void>((r) => (this.resolveDone = r));
    for (const it of items) {
      if (it instanceof Tween) it.pause();
      else if (it instanceof TweenGroup) it.held = true;
    }
    this.owner = opts.owner !== undefined ? opts.owner : defaultGroupOwner(items, opts.game);
    if (this.owner?.destroyed) this.kill();
    else if (this.owner) this.offOwner = this.owner.once('destroyed', () => this.kill());
    void Promise.resolve().then(() => {
      if (!this.held) this.start();
    });
  }

  get finished(): boolean {
    return this.state === 'done';
  }

  get killed(): boolean {
    return this.state === 'killed';
  }

  /** Kills running and pending items; `done` never resolves. */
  kill(): void {
    if (this.state === 'done' || this.state === 'killed') return;
    this.state = 'killed';
    this.releaseOwner();
    for (const it of this.items) if (it instanceof Tween || it instanceof TweenGroup) it.kill();
    for (const it of this.live) {
      if (it instanceof Tween || it instanceof TweenGroup) it.kill();
      else it.cancel();
    }
    this.live.clear();
  }

  then<A = void, B = never>(
    onfulfilled?: ((value: void) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.done.then(onfulfilled, onrejected);
  }

  private start(): void {
    if (this.state !== 'idle') return;
    this.state = 'running';
    const run = this.mode === 'sequence' ? this.runSequence() : Promise.all(this.items.map((it) => this.runItem(it)));
    void run.then(() => {
      if (this.state !== 'running') return;
      this.state = 'done';
      this.releaseOwner();
      this.resolveDone();
    });
  }

  private releaseOwner(): void {
    this.offOwner?.();
    this.offOwner = null;
  }

  private async runSequence(): Promise<void> {
    for (const it of this.items) {
      if (this.state !== 'running') return;
      await this.runItem(it);
    }
  }

  private runItem(it: TweenItem): Promise<unknown> {
    if (this.state !== 'running') return new Promise(noop);
    if (typeof it === 'number') {
      return new Promise<void>((resolve) => {
        const tm = after(it, () => {
          this.live.delete(tm);
          resolve();
        }, { game: this.opts.game, realtime: this.opts.realtime, owner: this.owner });
        this.live.add(tm);
      });
    }
    if (it instanceof Tween) {
      it.resume();
      return this.follow(it);
    }
    if (it instanceof TweenGroup) {
      it.held = false;
      it.start();
      return this.follow(it);
    }
    const r = it();
    if (r instanceof Tween || r instanceof TweenGroup) return this.follow(r);
    return isThenable(r) ? Promise.resolve(r) : Promise.resolve();
  }

  private follow(it: Tween<any> | TweenGroup): Promise<void> {
    this.live.add(it);
    return it.done.then(() => void this.live.delete(it));
  }
}

/**
 * Runs items one after another: `await sequence([tween(a, {x: 100}, 0.3), 0.2, () => flash()])`.
 * Dies with its scene (see TweenGroupOptions.owner); pass `{ owner: null }` for groups that outlive scene changes.
 */
export function sequence(items: TweenItem[], opts?: TweenGroupOptions): TweenGroup {
  return new TweenGroup('sequence', items, opts);
}

/** Runs items at the same time; resolves when all finished. Owned like sequence(). */
export function parallel(items: TweenItem[], opts?: TweenGroupOptions): TweenGroup {
  return new TweenGroup('parallel', items, opts);
}
