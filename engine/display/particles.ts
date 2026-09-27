import type { Color } from '../core/color';
import { Mat2D, TAU, type Vec2 } from '../core/math';
import { Rng, rng as sharedRng } from '../core/rng';
import type { Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from '../scene/node';
import { Scene } from '../scene/scene';
import { gradientColorTable, type GradientStops } from './paint';

/** A fixed value or a uniform random range [min, max]. */
export type ParticleRange = number | readonly [number, number];

/** Built-in particle looks. 'spark' is a streak stretched along the velocity; 'coin' flips with its rotation. */
export type ParticleShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'star' | 'spark' | 'ring' | 'coin';

/** Where particles appear, relative to the emitter origin (or the `at` point of burst()). */
export type ParticleSpawnShape =
  | { type: 'point' }
  | { type: 'circle'; radius: number; /** Only on the circumference. */ edge?: boolean }
  | { type: 'ring'; radius: number; inner: number }
  | { type: 'rect'; width: number; height: number; /** Only on the border. */ edge?: boolean }
  | { type: 'line'; length: number; /** Degrees, 0 = horizontal. */ angle?: number };

export interface ParticleBurst {
  /** Seconds after start() (default 0). */
  time?: number;
  count: ParticleRange;
  /** Extra repetitions after the first (default 0; -1 = forever). */
  repeat?: number;
  /** Seconds between repetitions (default 1). */
  interval?: number;
}

/**
 * Declarative particle effect. Angles are degrees (0 = right, 90 = down), distances local units,
 * speeds units/second. Over-life curves use t = age / lifetime in 0..1.
 */
export interface ParticleConfig {
  /** Particles per second while emitting (default 20 when no bursts are given, else 0). */
  rate?: number;
  bursts?: readonly ParticleBurst[];
  /** Seconds of emission after start() (default: forever for rate, until the last burst otherwise). */
  duration?: number;
  /** Pool size; spawns beyond it are dropped (default 200). */
  maxParticles?: number;
  /** Seconds (default 1). */
  lifetime?: ParticleRange;
  /** Initial speed (default 100). */
  speed?: ParticleRange;
  /** Launch direction in degrees (default [0, 360]). */
  angle?: ParticleRange;
  /** Launch outward from the spawn shape's center instead of using `angle` (point spawns still use angle). */
  radial?: boolean;
  /** Acceleration, units/s²: a number is +y (down), or { x, y }. */
  gravity?: number | Vec2;
  /** Velocity damping per second (0 = none, 3 = strong). */
  drag?: number;
  /** Initial rotation, degrees. */
  rotation?: ParticleRange;
  /** Spin, degrees per second. */
  spin?: ParticleRange;
  /** Rotate to face the velocity (plus `rotation`). */
  alignToVelocity?: boolean;
  /** Base size of built-in shapes in local units (diameter; streak thickness for 'spark'). Default 8. */
  size?: ParticleRange;
  /** Scale at birth (default 1). */
  scale?: ParticleRange;
  /** Scale at death (default: same as birth). */
  scaleEnd?: ParticleRange;
  /** Constant alpha or keyframes [[t, alpha], ...] (default: fade out over the last 30%). */
  alpha?: number | readonly (readonly [number, number])[];
  /** Constant color or color keyframes over life [[t, color], ...] (default white). Ignored for textures. */
  color?: Color | GradientStops;
  /** Random color per particle (constant over life); overrides `color`. */
  colors?: readonly Color[];
  shape?: ParticleShape;
  /** Texture (or registry key) instead of a built-in shape; drawn at texture size * scale. */
  texture?: Texture | string;
  /** 'spark' streak length in seconds of velocity (default 0.04). */
  stretch?: number;
  spawn?: ParticleSpawnShape;
  /**
   * 'local' (default): particles move with the emitter. 'world': particles stay where they were born while the
   * emitter moves (trails); they live in the space of `emitter.spaceNode` (default: the enclosing Scene).
   */
  space?: 'local' | 'world';
  blend?: GlobalCompositeOperation;
  /** Simulate this many seconds on the first update so continuous effects start "full". */
  prewarm?: number;
  /** Destroy the emitter once emission ended and every particle died. */
  autoDestroy?: boolean;
  /** RNG seed for reproducible effects (default: forked from the shared rng). */
  seed?: number | string;
}

/** Read-only view of a live particle. */
export interface ParticleState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly age: number;
  readonly life: number;
  readonly rotation: number;
  readonly size: number;
}

export interface ParticleEmitterOptions extends NodeOptions {
  /** Start emitting right away (default true). */
  autoStart?: boolean;
  /** Label shown in dumps (set by spawnParticles to the preset name). */
  preset?: string;
  /** Reference space for `space: 'world'` (default: the enclosing Scene, else the root). */
  spaceNode?: Node | null;
}

class Particle implements ParticleState {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  age = 0;
  life = 1;
  rotation = 0;
  spin = 0;
  size = 8;
  scale0 = 1;
  scale1 = 1;
  color = '';
}

interface CompiledBurst {
  time: number;
  count: ParticleRange;
  cycles: number;
  interval: number;
}

interface Compiled {
  rate: number;
  bursts: CompiledBurst[];
  duration: number;
  max: number;
  lifetime: ParticleRange;
  speed: ParticleRange;
  angle: ParticleRange;
  radial: boolean;
  gx: number;
  gy: number;
  drag: number;
  rotation: ParticleRange;
  spin: ParticleRange;
  align: boolean;
  size: ParticleRange;
  scale: ParticleRange;
  scaleEnd: ParticleRange | null;
  alphaConst: number;
  alphaLut: Float32Array | null;
  colorConst: string;
  colorLut: string[] | null;
  colors: readonly Color[] | null;
  shape: ParticleShape;
  texture: Texture | null;
  stretch: number;
  spawn: ParticleSpawnShape;
  world: boolean;
}

const ALPHA_N = 64;
const COLOR_N = 32;
const DEG = Math.PI / 180;
const DEFAULT_ALPHA: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.7, 1],
  [1, 0],
];

const UNIT_SQUARE = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
const UNIT_DIAMOND = new Float32Array([0, -1, 0.7, 0, 0, 1, -0.7, 0]);
const UNIT_TRIANGLE = new Float32Array([0, -1, 0.866, 0.5, -0.866, 0.5]);
const UNIT_STAR = (() => {
  const out = new Float32Array(20);
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    out[i * 2] = Math.cos(a) * r;
    out[i * 2 + 1] = Math.sin(a) * r;
  }
  return out;
})();

function alphaTable(keys: readonly (readonly [number, number])[]): Float32Array {
  const out = new Float32Array(ALPHA_N);
  for (let i = 0; i < ALPHA_N; i++) {
    const t = i / (ALPHA_N - 1);
    let v = keys.length ? keys[keys.length - 1]![1] : 1;
    if (keys.length && t <= keys[0]![0]) v = keys[0]![1];
    else {
      for (let k = 1; k < keys.length; k++) {
        const b = keys[k]!;
        if (t <= b[0]) {
          const a = keys[k - 1]!;
          v = b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
          break;
        }
      }
    }
    out[i] = Math.max(0, Math.min(1, v));
  }
  return out;
}

function compile(c: ParticleConfig): Compiled {
  const bursts = (c.bursts ?? []).map((b) => ({
    time: b.time ?? 0,
    count: b.count,
    cycles: (b.repeat ?? 0) < 0 ? Infinity : 1 + (b.repeat ?? 0),
    interval: Math.max(0.001, b.interval ?? 1),
  }));
  const g = c.gravity ?? 0;
  const alpha = c.alpha ?? DEFAULT_ALPHA;
  const color = c.color ?? '#ffffff';
  const tex = c.texture === undefined ? null : typeof c.texture === 'string' ? textures.get(c.texture) : c.texture;
  return {
    rate: c.rate ?? (bursts.length ? 0 : 20),
    bursts,
    duration: c.duration ?? Infinity,
    max: Math.max(1, Math.floor(c.maxParticles ?? 200)),
    lifetime: c.lifetime ?? 1,
    speed: c.speed ?? 100,
    angle: c.angle ?? [0, 360],
    radial: c.radial ?? false,
    gx: typeof g === 'number' ? 0 : g.x,
    gy: typeof g === 'number' ? g : g.y,
    drag: c.drag ?? 0,
    rotation: c.rotation ?? 0,
    spin: c.spin ?? 0,
    align: c.alignToVelocity ?? false,
    size: c.size ?? 8,
    scale: c.scale ?? 1,
    scaleEnd: c.scaleEnd ?? null,
    alphaConst: typeof alpha === 'number' ? alpha : 1,
    alphaLut: typeof alpha === 'number' ? null : alphaTable(alpha),
    colorConst: typeof color === 'string' ? color : '#ffffff',
    colorLut: typeof color === 'string' ? null : gradientColorTable(color, COLOR_N),
    colors: c.colors && c.colors.length ? c.colors : null,
    shape: c.shape ?? 'circle',
    texture: tex,
    stretch: c.stretch ?? 0.04,
    spawn: c.spawn ?? { type: 'point' },
    world: c.space === 'world',
  };
}

const tmpA = new Mat2D();
const tmpInv = new Mat2D();

/**
 * Pooled, config-driven particle emitter. The node itself is a point (size 0); particles are drawn around it.
 *
 *     scene.add(new ParticleEmitter(particlePresets.fire(), { x: 375, y: 900 }));
 *     const fx = new ParticleEmitter({ bursts: [{ count: 30 }], speed: [100, 300], autoDestroy: true });
 *
 * Events: 'complete' once emission ended and all particles died (then autoDestroy kicks in).
 */
export class ParticleEmitter extends Node {
  /** Reference space for `space: 'world'` (default: the enclosing Scene, else the root). */
  spaceNode: Node | null = null;
  /** Label for dumps (preset name). */
  preset = '';
  autoDestroy = false;
  private _config: ParticleConfig;
  private cfg: Compiled;
  private rand: Rng;
  private readonly pool: Particle[] = [];
  private count = 0;
  private _emitting = false;
  private completed = true;
  private elapsed = 0;
  private emitAcc = 0;
  private burstNext: number[] = [];
  private burstFired: number[] = [];
  private pendingPrewarm = 0;
  private pendingBursts: { n: number; at: Vec2 | undefined }[] | null = null;
  private readonly spaceMat = new Mat2D();
  private prevX = 0;
  private prevY = 0;
  private hasPrev = false;

  constructor(config: ParticleConfig, opts: ParticleEmitterOptions = {}) {
    super();
    this._config = { ...config };
    this.cfg = compile(this._config);
    this.rand = config.seed !== undefined ? new Rng(config.seed) : sharedRng.fork();
    this.autoDestroy = config.autoDestroy ?? false;
    if (config.blend) this.blend = config.blend;
    if (opts.preset) this.preset = opts.preset;
    if (opts.spaceNode) this.spaceNode = opts.spaceNode;
    this.set(opts);
    if (opts.autoStart !== false) this.start();
  }

  override get kind(): string {
    return 'ParticleEmitter';
  }

  get config(): Readonly<ParticleConfig> {
    return this._config;
  }

  /** Replaces the configuration (live particles keep going). */
  setConfig(config: ParticleConfig): this {
    this._config = { ...config };
    this.cfg = compile(this._config);
    if (config.seed !== undefined) this.rand = new Rng(config.seed);
    this.autoDestroy = config.autoDestroy ?? this.autoDestroy;
    if (config.blend) this.blend = config.blend;
    this.resetBursts();
    return this;
  }

  /** Merges changes into the configuration, e.g. `updateConfig({ rate: 80 })`. */
  updateConfig(patch: Partial<ParticleConfig>): this {
    return this.setConfig({ ...this._config, ...patch });
  }

  /** Live particle count. */
  get particleCount(): number {
    return this.count;
  }

  get emitting(): boolean {
    return this._emitting;
  }

  /** Emission ended and no particles are alive. */
  get finished(): boolean {
    return !this._emitting && this.count === 0 && this.pendingPrewarm === 0 && !this.pendingBursts;
  }

  /** Live particle i (0 <= i < particleCount); positions are in emitter space (or spaceNode space for 'world'). */
  particleAt(i: number): ParticleState | undefined {
    return i >= 0 && i < this.count ? this.pool[i] : undefined;
  }

  /** (Re)starts emission from time 0: rate emission and bursts. */
  start(): this {
    this._emitting = true;
    this.completed = false;
    this.elapsed = 0;
    this.emitAcc = 0;
    this.hasPrev = false;
    this.resetBursts();
    if (this._config.prewarm) this.pendingPrewarm = this._config.prewarm;
    return this;
  }

  /** Stops emitting; existing particles live out their lifetime unless `clear`. */
  stop(clear = false): this {
    this._emitting = false;
    if (clear) this.clear();
    return this;
  }

  /** Kills every particle immediately. */
  clear(): this {
    this.count = 0;
    return this;
  }

  /** Spawns n particles now, around `at` (emitter-local point, default the origin). */
  burst(n: number, at?: Vec2): this {
    this.completed = false;
    if (this.cfg.world && !this.computeSpace()) {
      (this.pendingBursts ??= []).push({ n, at: at ? { x: at.x, y: at.y } : undefined });
      return this;
    }
    this.spawnMany(n, at?.x ?? 0, at?.y ?? 0, this.cfg.world);
    return this;
  }

  override update(dt: number): void {
    if (this.pendingPrewarm > 0) {
      const total = this.pendingPrewarm;
      this.pendingPrewarm = 0;
      const step = 1 / 30;
      for (let t = 0; t < total; t += step) this.simulate(step);
      this.hasPrev = false;
    }
    this.simulate(dt);
  }

  override draw(ctx: Ctx2D): void {
    const n = this.count;
    if (n === 0) return;
    const c = this.cfg;
    ctx.save();
    if (c.world && this.computeSpace()) {
      const m = tmpInv.copyFrom(this.spaceMat).invert();
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    }
    const base = ctx.globalAlpha;
    const stroked = c.shape === 'spark' || c.shape === 'ring';
    if (c.shape === 'spark') ctx.lineCap = 'round';
    const tex = c.texture;
    const src = tex ? (tex.source as unknown as CanvasImageSource) : null;
    let lastColor = '';
    const pool = this.pool;
    for (let i = 0; i < n; i++) {
      const p = pool[i]!;
      const t = p.age / p.life;
      const a = c.alphaLut ? c.alphaLut[Math.min(ALPHA_N - 1, (t * (ALPHA_N - 1) + 0.5) | 0)]! : c.alphaConst;
      if (a <= 0.004) continue;
      const s = c.scaleEnd === null ? p.scale0 : p.scale0 + (p.scale1 - p.scale0) * t;
      if (s <= 0) continue;
      ctx.globalAlpha = base * a;
      const rot = c.align ? Math.atan2(p.vy, p.vx) + p.rotation : p.rotation;
      if (tex && src) {
        const f = tex.frame;
        const w = tex.width * s;
        const h = tex.height * s;
        if (rot === 0) {
          ctx.drawImage(src, f.x, f.y, f.w, f.h, p.x - w / 2, p.y - h / 2, w, h);
        } else {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(rot);
          ctx.drawImage(src, f.x, f.y, f.w, f.h, -w / 2, -h / 2, w, h);
          ctx.restore();
        }
        continue;
      }
      const color = c.colorLut
        ? c.colorLut[Math.min(COLOR_N - 1, (t * (COLOR_N - 1) + 0.5) | 0)]!
        : p.color || c.colorConst;
      if (color !== lastColor) {
        if (stroked) ctx.strokeStyle = color;
        else ctx.fillStyle = color;
        lastColor = color;
      }
      const size = p.size * s;
      switch (c.shape) {
        case 'circle':
          ctx.beginPath();
          ctx.arc(p.x, p.y, size / 2, 0, TAU);
          ctx.fill();
          break;
        case 'square':
          if (rot === 0) ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
          else polyPath(ctx, UNIT_SQUARE, p.x, p.y, size / 2, rot);
          break;
        case 'diamond':
          polyPath(ctx, UNIT_DIAMOND, p.x, p.y, size / 2, rot);
          break;
        case 'triangle':
          polyPath(ctx, UNIT_TRIANGLE, p.x, p.y, size / 2, rot);
          break;
        case 'star':
          polyPath(ctx, UNIT_STAR, p.x, p.y, size / 2, rot);
          break;
        case 'coin':
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, (size / 2) * (0.12 + 0.88 * Math.abs(Math.cos(p.rotation))), size / 2, 0, 0, TAU);
          ctx.fill();
          break;
        case 'ring':
          ctx.lineWidth = Math.max(1, size * 0.18);
          ctx.beginPath();
          ctx.arc(p.x, p.y, size / 2, 0, TAU);
          ctx.stroke();
          break;
        case 'spark': {
          const k = c.stretch * s;
          ctx.lineWidth = size;
          ctx.beginPath();
          ctx.moveTo(p.x - p.vx * k, p.y - p.vy * k);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          break;
        }
      }
    }
    ctx.restore();
  }

  override describe() {
    return {
      ...super.describe(),
      preset: this.preset || undefined,
      live: this.count,
      emitting: this._emitting,
      space: this.cfg.world ? 'world' : undefined,
    };
  }

  // ---------------------------------------------------------------- simulation

  private simulate(dt: number): void {
    if (dt <= 0) return;
    const world = this.cfg.world && this.computeSpace();
    if (this.pendingBursts && (world || !this.cfg.world)) {
      const list = this.pendingBursts;
      this.pendingBursts = null;
      for (const b of list) this.spawnMany(b.n, b.at?.x ?? 0, b.at?.y ?? 0, world);
    }
    this.integrate(dt);
    if (this._emitting) this.emitParticles(dt, world);
    if (world) {
      this.prevX = this.spaceMat.e;
      this.prevY = this.spaceMat.f;
      this.hasPrev = true;
    }
    if (!this.completed && this.finished) {
      this.completed = true;
      this.emit('complete', this);
      if (this.autoDestroy) this.destroy();
    }
  }

  private integrate(dt: number): void {
    const c = this.cfg;
    const gx = c.gx * dt;
    const gy = c.gy * dt;
    const df = c.drag > 0 ? Math.exp(-c.drag * dt) : 1;
    const pool = this.pool;
    const n = this.count;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const p = pool[i]!;
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vx = (p.vx + gx) * df;
      p.vy = (p.vy + gy) * df;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
      if (i !== j) {
        pool[i] = pool[j]!;
        pool[j] = p;
      }
      j++;
    }
    this.count = j;
  }

  private emitParticles(dt: number, world: boolean): void {
    const c = this.cfg;
    this.elapsed += dt;
    if (c.rate > 0) {
      this.emitAcc += c.rate * dt;
      const n = Math.floor(this.emitAcc);
      this.emitAcc -= n;
      for (let i = 0; i < n; i++) this.spawnOne(0, 0, world, (i + 1) / n, dt);
    }
    let burstsDone = true;
    for (let b = 0; b < c.bursts.length; b++) {
      const bu = c.bursts[b]!;
      while (this.burstFired[b]! < bu.cycles && this.burstNext[b]! <= this.elapsed) {
        this.spawnMany(Math.round(this.range(bu.count)), 0, 0, world);
        this.burstFired[b] = this.burstFired[b]! + 1;
        this.burstNext[b] = this.burstNext[b]! + bu.interval;
      }
      if (this.burstFired[b]! < bu.cycles) burstsDone = false;
    }
    if (this.elapsed >= c.duration || (c.rate <= 0 && burstsDone)) this._emitting = false;
  }

  private spawnMany(n: number, ox: number, oy: number, world: boolean): void {
    for (let i = 0; i < n; i++) this.spawnOne(ox, oy, world, 1, 0);
  }

  /** frac: position of this spawn within the frame (1 = now); dt: frame length for sub-frame smoothing. */
  private spawnOne(ox: number, oy: number, world: boolean, frac: number, dt: number): void {
    const c = this.cfg;
    if (this.count >= c.max) return;
    let p = this.pool[this.count];
    if (!p) {
      p = new Particle();
      this.pool[this.count] = p;
    }
    this.count++;
    const r = this.rand;
    let dx = 0;
    let dy = 0;
    const sp = c.spawn;
    switch (sp.type) {
      case 'circle': {
        const a = r.next() * TAU;
        const d = sp.edge ? sp.radius : sp.radius * Math.sqrt(r.next());
        dx = Math.cos(a) * d;
        dy = Math.sin(a) * d;
        break;
      }
      case 'ring': {
        const a = r.next() * TAU;
        const i2 = sp.inner * sp.inner;
        const d = Math.sqrt(i2 + (sp.radius * sp.radius - i2) * r.next());
        dx = Math.cos(a) * d;
        dy = Math.sin(a) * d;
        break;
      }
      case 'rect':
        if (sp.edge) {
          const per = 2 * (sp.width + sp.height);
          let u = r.next() * per;
          if (u < sp.width) {
            dx = u - sp.width / 2;
            dy = -sp.height / 2;
          } else if ((u -= sp.width) < sp.height) {
            dx = sp.width / 2;
            dy = u - sp.height / 2;
          } else if ((u -= sp.height) < sp.width) {
            dx = sp.width / 2 - u;
            dy = sp.height / 2;
          } else {
            dx = -sp.width / 2;
            dy = sp.height / 2 - (u - sp.width);
          }
        } else {
          dx = (r.next() - 0.5) * sp.width;
          dy = (r.next() - 0.5) * sp.height;
        }
        break;
      case 'line': {
        const a = (sp.angle ?? 0) * DEG;
        const u = (r.next() - 0.5) * sp.length;
        dx = Math.cos(a) * u;
        dy = Math.sin(a) * u;
        break;
      }
      case 'point':
        break;
    }
    const ang = c.radial && (dx !== 0 || dy !== 0) ? Math.atan2(dy, dx) : this.range(c.angle) * DEG;
    const speed = this.range(c.speed);
    let vx = Math.cos(ang) * speed;
    let vy = Math.sin(ang) * speed;
    let x = ox + dx;
    let y = oy + dy;
    let size = this.range(c.size);
    if (world) {
      const m = this.spaceMat;
      const wx = m.a * x + m.c * y + m.e;
      const wy = m.b * x + m.d * y + m.f;
      x = wx;
      y = wy;
      const wvx = m.a * vx + m.c * vy;
      const wvy = m.b * vx + m.d * vy;
      vx = wvx;
      vy = wvy;
      size *= Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
      if (this.hasPrev && frac < 1) {
        x += (this.prevX - m.e) * (1 - frac);
        y += (this.prevY - m.f) * (1 - frac);
      }
    }
    const pre = (1 - frac) * dt;
    p.x = x + vx * pre;
    p.y = y + vy * pre;
    p.vx = vx;
    p.vy = vy;
    p.age = pre;
    p.life = Math.max(0.001, this.range(c.lifetime));
    p.size = size;
    p.scale0 = this.range(c.scale);
    p.scale1 = c.scaleEnd === null ? p.scale0 : this.range(c.scaleEnd);
    p.rotation = this.range(c.rotation) * DEG;
    p.spin = this.range(c.spin) * DEG;
    p.color = c.colors ? c.colors[Math.floor(r.next() * c.colors.length)]! : '';
  }

  private range(v: ParticleRange): number {
    return typeof v === 'number' ? v : v[0] + (v[1] - v[0]) * this.rand.next();
  }

  private resetBursts(): void {
    const bursts = this.cfg.bursts;
    this.burstNext = bursts.map((b) => b.time);
    this.burstFired = bursts.map(() => 0);
  }

  private spaceRef(): Node | null {
    if (this.spaceNode) return this.spaceNode;
    let last: Node | null = null;
    for (let n = this.parent; n; n = n.parent) {
      if (n instanceof Scene) return n;
      last = n;
    }
    return last;
  }

  /** Computes emitter-local → reference-space matrix into spaceMat. False when detached. */
  private computeSpace(): boolean {
    const ref = this.spaceRef();
    if (!ref || ref === this) return false;
    const m = this.localMatrix(this.spaceMat);
    let n = this.parent;
    while (n && n !== ref) {
      n.localMatrix(tmpA).multiply(m);
      m.copyFrom(tmpA);
      n = n.parent;
    }
    return n === ref;
  }
}

function polyPath(ctx: Ctx2D, verts: Float32Array, x: number, y: number, r: number, rot: number): void {
  const cs = Math.cos(rot) * r;
  const sn = Math.sin(rot) * r;
  ctx.beginPath();
  for (let i = 0; i < verts.length; i += 2) {
    const vx = verts[i]!;
    const vy = verts[i + 1]!;
    const px = x + vx * cs - vy * sn;
    const py = y + vx * sn + vy * cs;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
