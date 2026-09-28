import type { Game } from '../core/game';
import { Node } from '../scene/node';
import { getTicker, ownerPaused, resolveGame, tickAll, type Tickable } from './ticker';

export interface SpringOptions {
  /** Current value (default 0). */
  value?: number;
  /** Rest position the spring pulls towards (default: value). */
  target?: number;
  velocity?: number;
  /** Pull per unit of displacement (default 180). Ignored when `frequency` is set. */
  stiffness?: number;
  /** Drag per unit of velocity (default 12: a couple of bounces). Ignored when `frequency` or `dampingRatio` is set. */
  damping?: number;
  /** Default 1. */
  mass?: number;
  /** Natural frequency in Hz: the friendlier alternative to stiffness (Godot / Unity style). */
  frequency?: number;
  /** 0 bounces forever, < 1 overshoots, 1 is the fastest without overshoot, > 1 is sluggish. Default 0.5. */
  dampingRatio?: number;
  /** Snaps to rest when |value - target| <= precision and |velocity| <= 10 * precision (default 0.001). */
  precision?: number;
}

/**
 * A damped spring value (Hooke + damping, semi-implicit Euler in sub-steps of at most 1/120 s, deterministic).
 * Pure math: call step(dt) yourself, or let springProp() drive a node property.
 *
 *     const s = createSpring({ frequency: 3, dampingRatio: 0.4, value: 0, target: 100 });
 *     node.onUpdate((dt) => (node.x = s.step(dt)));
 *     s.target = 300;   // follows with overshoot
 *     s.kick(-800);     // impulse: adds velocity
 */
export class Spring {
  value: number;
  target: number;
  velocity: number;
  stiffness: number;
  damping: number;
  mass: number;
  precision: number;

  constructor(opts: SpringOptions = {}) {
    this.value = opts.value ?? 0;
    this.target = opts.target ?? this.value;
    this.velocity = opts.velocity ?? 0;
    this.mass = Math.max(1e-6, opts.mass ?? 1);
    this.stiffness = Math.max(0, opts.stiffness ?? 180);
    this.damping = Math.max(0, opts.damping ?? 12);
    this.precision = opts.precision ?? 1e-3;
    if (opts.frequency !== undefined) this.tune(opts.frequency, opts.dampingRatio ?? 0.5);
    else if (opts.dampingRatio !== undefined) this.damping = 2 * Math.max(0, opts.dampingRatio) * Math.sqrt(this.stiffness * this.mass);
  }

  /** Sets stiffness and damping from a natural frequency (Hz) and a damping ratio. */
  tune(frequency: number, dampingRatio = 0.5): this {
    const w = 2 * Math.PI * Math.max(0, frequency);
    this.stiffness = this.mass * w * w;
    this.damping = 2 * Math.max(0, dampingRatio) * this.mass * w;
    return this;
  }

  /** Natural frequency in Hz. */
  get frequency(): number {
    return Math.sqrt(this.stiffness / this.mass) / (2 * Math.PI);
  }

  get dampingRatio(): number {
    const km = this.stiffness * this.mass;
    return km > 0 ? this.damping / (2 * Math.sqrt(km)) : 0;
  }

  get atRest(): boolean {
    return Math.abs(this.value - this.target) <= this.precision && Math.abs(this.velocity) <= this.precision * 10;
  }

  /** Advances `dt` seconds (capped at 1) and returns the new value. Snaps exactly onto the target once at rest. */
  step(dt: number): number {
    let left = Math.min(Math.max(dt, 0), 1);
    if (left <= 0) return this.value;
    if (this.value === this.target && this.velocity === 0) return this.value;
    const m = this.mass;
    const k = this.stiffness;
    const c = this.damping;
    let h = 1 / 120;
    if (k > 0) h = Math.min(h, 0.5 / Math.sqrt(k / m));
    if (c > 0) h = Math.min(h, m / c);
    for (let guard = 0; left > 1e-9 && guard < 10000; guard++) {
      const s = Math.min(h, left);
      this.velocity += ((-k * (this.value - this.target) - c * this.velocity) / m) * s;
      this.value += this.velocity * s;
      left -= s;
    }
    if (this.atRest) {
      this.value = this.target;
      this.velocity = 0;
    }
    return this.value;
  }

  /** Adds velocity (an impulse), e.g. a hit. */
  kick(velocity: number): this {
    this.velocity += velocity;
    return this;
  }

  /** Jumps to `value` (default: the target), makes it the target and stops. */
  snap(value = this.target): this {
    this.value = this.target = value;
    this.velocity = 0;
    return this;
  }
}

/** A new Spring: `createSpring({ frequency: 4, dampingRatio: 0.3, value: 1 })`. */
export function createSpring(opts?: SpringOptions): Spring {
  return new Spring(opts);
}

// ---------------------------------------------------------------- driving

const lateLists = new WeakMap<Game, Tickable[]>();

/** Ticks `it` every frame after tweens, timers and fixedUpdate (priority 100 system), or on 'frame' when realtime. */
function driveLate(game: Game, it: Tickable, realtime = false): void {
  if (realtime) {
    getTicker(game, true).add(it);
    return;
  }
  let list = lateLists.get(game);
  if (!list) {
    const items: Tickable[] = [];
    list = items;
    lateLists.set(game, items);
    game.addSystem({ update: (dt) => tickAll(items, dt) }, 100);
  }
  list.push(it);
}

export interface SpringDriveOptions {
  /** Stops when this node is destroyed, freezes while its subtree is paused. Default: the target if it is a Node. */
  owner?: Node | null;
  /** Unscaled time that keeps running while game.paused. Default: game time. */
  realtime?: boolean;
  /** Defaults to Game.current. */
  game?: Game;
}

export interface SpringPropOptions extends SpringOptions, SpringDriveOptions {}

/** A Spring that writes its value into `object[key]` every frame it moves. Created by springProp(). */
export class SpringProp extends Spring implements Tickable {
  readonly owner: Node | null;
  private live = true;
  /** Last value written into the property (NaN before the first write). */
  private written = NaN;

  constructor(
    readonly object: object,
    readonly key: string,
    opts: SpringPropOptions = {},
  ) {
    const cur = (object as Record<string, unknown>)[key];
    if (opts.value === undefined && typeof cur !== 'number') throw new Error(`springProp: "${key}" is not a number on the target`);
    super({ ...opts, value: opts.value ?? (cur as number) });
    this.owner = opts.owner !== undefined ? opts.owner : object instanceof Node ? object : null;
    driveLate(resolveGame(opts.game), this, opts.realtime);
  }

  /** False once stopped or the owner was destroyed. */
  get active(): boolean {
    return this.live;
  }

  /** Stops driving the property (it keeps its current value). */
  stop(): void {
    this.live = false;
  }

  tick(dt: number): boolean {
    if (!this.live) return false;
    const o = this.owner;
    if (o) {
      if (o.destroyed) {
        this.live = false;
        return false;
      }
      if (ownerPaused(o)) return true;
    }
    if (this.velocity === 0 && this.value === this.target && this.value === this.written) return true;
    const v = this.step(dt);
    if (v !== this.written) {
      (this.object as Record<string, unknown>)[this.key] = v;
      this.written = v;
    }
    return true;
  }
}

/**
 * Drives a numeric property with a spring; set `.target` and it follows (the spring owns the property: don't also
 * tween it). Stops with its owner (default: the object if it is a Node). Spring follower:
 *
 *     const fx = springProp(dot, 'x', { frequency: 2, dampingRatio: 0.45 });
 *     const fy = springProp(dot, 'y', { frequency: 2, dampingRatio: 0.45 });
 *     game.on('pointermove', (e) => { fx.target = e.x; fy.target = e.y; });
 */
export function springProp<T extends object>(object: T, key: keyof T & string, opts?: SpringPropOptions): SpringProp {
  return new SpringProp(object, key, opts);
}

// ---------------------------------------------------------------- node effects

export interface SpringEffectOptions {
  /** Oscillation frequency in Hz. */
  frequency?: number;
  /** Damping ratio (lower = more bounces). */
  dampingRatio?: number;
  /** Velocity added per unit of strength. Accumulated velocity is capped at 2 kicks. */
  kick?: number;
  /** Largest offset shown (squash amount / radians). */
  max?: number;
  /** Keeps animating while game.paused (pause-menu widgets). Default: game time. Fixed when the effect starts. */
  realtime?: boolean;
  /** Defaults to Game.current. */
  game?: Game;
}

export interface SquashSpringOptions extends SpringEffectOptions {
  /** Axis a positive strength compresses: 'y' (default: wider and flatter, a landing) or 'x' (narrower and taller). */
  axis?: 'x' | 'y';
}

/** A running squashSpring() / wobble() on a node. Calling the function again on the node kicks the same effect. */
export interface SpringEffect {
  readonly node: Node;
  readonly spring: Spring;
  /** False once it came to rest, was stopped or the node was destroyed. */
  readonly active: boolean;
  /** Ends now, restoring the node's base scale / rotation exactly. */
  stop(): void;
}

interface FxDefaults {
  frequency: number;
  dampingRatio: number;
  kick: number;
  max: number;
}

abstract class NodeSpringFx implements SpringEffect, Tickable {
  readonly spring: Spring;
  protected kickSize: number;
  protected max: number;
  private live = true;

  constructor(
    readonly node: Node,
    private readonly registry: WeakMap<Node, NodeSpringFx>,
    d: FxDefaults,
  ) {
    this.spring = new Spring({ frequency: d.frequency, dampingRatio: d.dampingRatio });
    this.kickSize = d.kick;
    this.max = d.max;
  }

  get active(): boolean {
    return this.live;
  }

  configure(o: SpringEffectOptions, maxLimit: number): void {
    if (o.frequency !== undefined || o.dampingRatio !== undefined) {
      this.spring.tune(o.frequency ?? this.spring.frequency, o.dampingRatio ?? this.spring.dampingRatio);
    }
    if (o.kick !== undefined) this.kickSize = Math.max(0, o.kick);
    if (o.max !== undefined) this.max = Math.max(0, Math.min(maxLimit, o.max));
  }

  push(strength: number): void {
    const cap = this.kickSize * 2;
    const v = this.spring.velocity + this.kickSize * strength;
    this.spring.velocity = Math.max(-cap, Math.min(cap, v));
  }

  stop(): void {
    if (this.live) this.end();
  }

  tick(dt: number): boolean {
    if (!this.live) return false;
    if (this.node.destroyed) {
      this.end();
      return false;
    }
    if (ownerPaused(this.node)) return true;
    this.adopt();
    this.spring.step(dt);
    if (this.spring.atRest) {
      this.end();
      return false;
    }
    this.apply(Math.max(-this.max, Math.min(this.max, this.spring.value)));
    return true;
  }

  private end(): void {
    this.live = false;
    if (this.registry.get(this.node) === this) this.registry.delete(this.node);
    if (this.node.destroyed) return;
    this.adopt();
    this.restore();
  }

  /** Takes a value written by someone else since the last apply() (a tween, a layout) as the new base. */
  abstract adopt(): void;
  protected abstract apply(offset: number): void;
  protected abstract restore(): void;
}

class SquashFx extends NodeSpringFx {
  axis: 'x' | 'y' = 'y';
  bx: number;
  by: number;
  private wx: number;
  private wy: number;

  constructor(node: Node) {
    super(node, squashing, { frequency: 5, dampingRatio: 0.32, kick: 9, max: 0.35 });
    this.bx = this.wx = node.scaleX;
    this.by = this.wy = node.scaleY;
  }

  adopt(): void {
    const n = this.node;
    if (n.scaleX === this.wx && n.scaleY === this.wy) return;
    this.bx = this.wx = n.scaleX;
    this.by = this.wy = n.scaleY;
  }

  protected apply(a: number): void {
    const n = this.node;
    const k = 1 + a;
    if (this.axis === 'y') {
      n.scaleX = this.bx * k;
      n.scaleY = this.by / k;
    } else {
      n.scaleX = this.bx / k;
      n.scaleY = this.by * k;
    }
    this.wx = n.scaleX;
    this.wy = n.scaleY;
  }

  protected restore(): void {
    this.node.scaleX = this.wx = this.bx;
    this.node.scaleY = this.wy = this.by;
  }
}

class WobbleFx extends NodeSpringFx {
  private base: number;
  private written: number;

  constructor(node: Node) {
    super(node, wobbling, { frequency: 4, dampingRatio: 0.25, kick: 8, max: 0.4 });
    this.base = this.written = node.rotation;
  }

  adopt(): void {
    if (this.node.rotation !== this.written) this.base = this.written = this.node.rotation;
  }

  protected apply(a: number): void {
    this.node.rotation = this.written = this.base + a;
  }

  protected restore(): void {
    this.node.rotation = this.written = this.base;
  }
}

const squashing = new WeakMap<Node, NodeSpringFx>();
const wobbling = new WeakMap<Node, NodeSpringFx>();

function kickFx<F extends NodeSpringFx>(
  registry: WeakMap<Node, NodeSpringFx>,
  node: Node,
  make: () => F,
  strength: number,
  opts: SpringEffectOptions,
  maxLimit: number,
): F {
  let fx = registry.get(node) as F | undefined;
  if (!fx || !fx.active) {
    fx = make();
    registry.set(node, fx);
    driveLate(resolveGame(opts.game), fx, opts.realtime);
  }
  fx.configure(opts, maxLimit);
  fx.push(strength);
  return fx;
}

/**
 * Volume-preserving squash & stretch on scaleX / scaleY driven by a spring (landings, impacts, merges, jelly
 * buttons). Strength 1 widens by up to ~19% and settles in ~0.5 s; negative strength stretches first. Repeated
 * kicks add up (capped); the node's base scale is restored exactly at rest, on stop() and never lost on destroy.
 * Composes with scale tweens (popIn, punch, pulse): it multiplies whatever scale they set this frame.
 * Scales along the node's own axes (they rotate with it); use anchor 0.5 (or 0.5, 1 to squash onto the floor).
 *
 *     squashSpring(fruit, impact / 1000);
 *     squashSpring(player, -0.6, { axis: 'y' }); // jump: stretch up
 */
export function squashSpring(node: Node, strength = 1, opts: SquashSpringOptions = {}): SpringEffect {
  const fx = kickFx(squashing, node, () => new SquashFx(node), strength, opts, 0.9);
  if (opts.axis) fx.axis = opts.axis;
  return fx;
}

/**
 * Springy rotation wobble around the node's base rotation (wrong answer, jelly button, hit reaction). Strength 1
 * swings about 12 degrees, first clockwise (negative strength: counter-clockwise), and settles in ~0.9 s; kicks add
 * up (capped at `max` radians). The base rotation is restored exactly.
 */
export function wobble(node: Node, strength = 1, opts: SpringEffectOptions = {}): SpringEffect {
  return kickFx(wobbling, node, () => new WobbleFx(node), strength, opts, Math.PI);
}

/** The node's scale without a running squashSpring() (its current scale when none runs). */
export function squashBaseScale(node: Node): { x: number; y: number } {
  const fx = squashing.get(node) as SquashFx | undefined;
  if (!fx || !fx.active) return { x: node.scaleX, y: node.scaleY };
  fx.adopt();
  return { x: fx.bx, y: fx.by };
}
