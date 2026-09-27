import { clamp, damp, lerp, Mat2D, type Rect, type Vec2 } from '../core/math';

/** Anything with a position; `vx`/`vy` (e.g. an ArcadeBody) are used for look-ahead when present. */
export interface CameraTarget {
  x: number;
  y: number;
}

export interface CameraFollowOptions {
  /** Smoothing rate (higher = snappier, frame-rate independent); 0 snaps. Default 6. */
  lerp?: number;
  /** Deadzone size in world units, centered on the camera. The target moves freely inside it. */
  deadzoneWidth?: number;
  deadzoneHeight?: number;
  /** Leads the target by its velocity × this many seconds. Default 0. */
  lookAhead?: number;
  /** Max look-ahead distance in world units. Default 200. */
  maxLookAhead?: number;
  /** Offset added to the target position (e.g. look slightly above a platformer hero). */
  offsetX?: number;
  offsetY?: number;
  /** Jump to the target immediately. Default false. */
  snap?: boolean;
}

export interface Camera2DOptions {
  x?: number;
  y?: number;
  zoom?: number;
  rotation?: number;
  /** World-space rectangle the view is kept inside. */
  bounds?: Rect | null;
  /** Seed for the shake noise (deterministic). */
  seed?: number;
}

const tmpM = new Mat2D();

/**
 * 2D camera: (x, y) is the world point shown at the viewport anchor (center by default).
 * "Screen" coordinates in this API are viewport coordinates: (0,0) = the viewport's top-left, i.e. the local
 * space of the World node before the camera transform. Update it once per frame (World does this).
 */
export class Camera2D {
  x = 0;
  y = 0;
  zoom = 1;
  /** Radians; the world appears rotated by -rotation. */
  rotation = 0;
  viewportWidth = 0;
  viewportHeight = 0;
  /** Where (x, y) sits inside the viewport, as a fraction (0.5 = center). */
  anchorX = 0.5;
  anchorY = 0.5;
  bounds: Rect | null = null;

  target: CameraTarget | null = null;
  followLerp = 6;
  deadzoneWidth = 0;
  deadzoneHeight = 0;
  lookAhead = 0;
  maxLookAhead = 200;
  offsetX = 0;
  offsetY = 0;

  /** 0..1; shake strength is trauma². Decays by traumaDecay per second. */
  trauma = 0;
  traumaDecay = 1.2;
  /** Max shake offset in world units at trauma 1. */
  shakeOffset = 28;
  /** Max shake rotation in radians at trauma 1. */
  shakeAngle = 0.05;
  /** Noise frequency (Hz). */
  shakeFrequency = 22;
  seed: number;

  private shakeX = 0;
  private shakeY = 0;
  private shakeRot = 0;
  private time = 0;
  private lookX = 0;
  private lookY = 0;
  private lastTX = NaN;
  private lastTY = NaN;

  constructor(opts: Camera2DOptions = {}) {
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.zoom = opts.zoom ?? 1;
    this.rotation = opts.rotation ?? 0;
    this.bounds = opts.bounds ?? null;
    this.seed = opts.seed ?? 1337;
  }

  setViewport(width: number, height: number): this {
    this.viewportWidth = width;
    this.viewportHeight = height;
    return this;
  }

  lookAt(x: number, y: number): this {
    this.x = x;
    this.y = y;
    this.clampToBounds();
    return this;
  }

  /** Follows a target every update (lerp, deadzone, look-ahead). */
  follow(target: CameraTarget, opts: CameraFollowOptions = {}): this {
    this.target = target;
    if (opts.lerp !== undefined) this.followLerp = opts.lerp;
    if (opts.deadzoneWidth !== undefined) this.deadzoneWidth = opts.deadzoneWidth;
    if (opts.deadzoneHeight !== undefined) this.deadzoneHeight = opts.deadzoneHeight;
    if (opts.lookAhead !== undefined) this.lookAhead = opts.lookAhead;
    if (opts.maxLookAhead !== undefined) this.maxLookAhead = opts.maxLookAhead;
    if (opts.offsetX !== undefined) this.offsetX = opts.offsetX;
    if (opts.offsetY !== undefined) this.offsetY = opts.offsetY;
    this.lastTX = NaN;
    this.lastTY = NaN;
    this.lookX = this.lookY = 0;
    if (opts.snap) this.snapToTarget();
    return this;
  }

  stopFollow(): this {
    this.target = null;
    return this;
  }

  /** Centers on the target now (ignores lerp and deadzone). */
  snapToTarget(): this {
    const t = this.target;
    if (!t) return this;
    this.x = t.x + this.offsetX;
    this.y = t.y + this.offsetY;
    this.clampToBounds();
    return this;
  }

  /** Adds trauma (0..1). Typical: 0.2 small bump, 0.5 landing, 1 explosion. */
  shake(amount: number): this {
    this.trauma = clamp(this.trauma + amount, 0, 1);
    return this;
  }

  /** Current shake displacement (world units / radians), for inspection. */
  get shakeState(): { x: number; y: number; rotation: number } {
    return { x: this.shakeX, y: this.shakeY, rotation: this.shakeRot };
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.target;
    if (t) {
      if (this.lookAhead > 0 && dt > 0) {
        const tv = t as { vx?: unknown; vy?: unknown };
        let vx = 0;
        let vy = 0;
        if (typeof tv.vx === 'number' && typeof tv.vy === 'number') {
          vx = tv.vx;
          vy = tv.vy;
        } else if (Number.isFinite(this.lastTX)) {
          vx = (t.x - this.lastTX) / dt;
          vy = (t.y - this.lastTY) / dt;
        }
        const m = this.maxLookAhead;
        const k = damp(3, dt);
        this.lookX = lerp(this.lookX, clamp(vx * this.lookAhead, -m, m), k);
        this.lookY = lerp(this.lookY, clamp(vy * this.lookAhead, -m, m), k);
      }
      this.lastTX = t.x;
      this.lastTY = t.y;
      const gx = t.x + this.offsetX + this.lookX;
      const gy = t.y + this.offsetY + this.lookY;
      const hw = this.deadzoneWidth / 2;
      const hh = this.deadzoneHeight / 2;
      let dx = this.x;
      let dy = this.y;
      if (gx > this.x + hw) dx = gx - hw;
      else if (gx < this.x - hw) dx = gx + hw;
      if (gy > this.y + hh) dy = gy - hh;
      else if (gy < this.y - hh) dy = gy + hh;
      const k = this.followLerp > 0 ? damp(this.followLerp, dt) : 1;
      this.x += (dx - this.x) * k;
      this.y += (dy - this.y) * k;
    }
    this.clampToBounds();
    this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
    const s = this.trauma * this.trauma;
    if (s > 0) {
      const ft = this.time * this.shakeFrequency;
      this.shakeX = this.shakeOffset * s * smoothNoise(this.seed, ft);
      this.shakeY = this.shakeOffset * s * smoothNoise(this.seed + 101, ft);
      this.shakeRot = this.shakeAngle * s * smoothNoise(this.seed + 202, ft);
    } else {
      this.shakeX = this.shakeY = this.shakeRot = 0;
    }
  }

  /** Keeps the visible rect inside `bounds` (centers when the bounds are smaller than the view). */
  clampToBounds(): void {
    const b = this.bounds;
    if (!b || this.viewportWidth <= 0 || this.viewportHeight <= 0) return;
    const v = this.visibleRect(0, false);
    const left = this.x - v.x;
    const right = v.x + v.w - this.x;
    const top = this.y - v.y;
    const bottom = v.y + v.h - this.y;
    if (v.w >= b.w) this.x = b.x + b.w / 2 - (right - left) / 2;
    else this.x = clamp(this.x, b.x + left, b.x + b.w - right);
    if (v.h >= b.h) this.y = b.y + b.h / 2 - (bottom - top) / 2;
    else this.y = clamp(this.y, b.y + top, b.y + b.h - bottom);
  }

  /** World → viewport matrix. */
  viewMatrix(out: Mat2D = new Mat2D(), withShake = true): Mat2D {
    const sx = withShake ? this.shakeX : 0;
    const sy = withShake ? this.shakeY : 0;
    const sr = withShake ? this.shakeRot : 0;
    out.set(1, 0, 0, 1, this.viewportWidth * this.anchorX, this.viewportHeight * this.anchorY);
    out.rotate(-(this.rotation + sr));
    out.scale(this.zoom, this.zoom);
    out.translate(-(this.x + sx), -(this.y + sy));
    return out;
  }

  /** Viewport point → world point. */
  screenToWorld(sx: number, sy: number, out?: Vec2): Vec2 {
    return this.viewMatrix(tmpM).invert().apply(sx, sy, out);
  }

  /** World point → viewport point. */
  worldToScreen(wx: number, wy: number, out?: Vec2): Vec2 {
    return this.viewMatrix(tmpM).apply(wx, wy, out);
  }

  /** World-space AABB of the viewport (grown by `margin` world units). */
  visibleRect(margin = 0, withShake = true): Rect {
    const r = this.viewMatrix(tmpM, withShake)
      .invert()
      .applyRect({ x: 0, y: 0, w: this.viewportWidth, h: this.viewportHeight });
    if (margin) {
      r.x -= margin;
      r.y -= margin;
      r.w += margin * 2;
      r.h += margin * 2;
    }
    return r;
  }

  /** One-line summary for dumps. */
  describe(): string {
    let s = `cam ${r1(this.x)},${r1(this.y)} zoom=${r2(this.zoom)}`;
    if (this.rotation) s += ` rot=${r2(this.rotation)}`;
    if (this.trauma > 0) s += ` trauma=${r2(this.trauma)}`;
    if (this.target) s += ' following';
    return s;
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function hashNoise(seed: number, i: number): number {
  let h = Math.imul(i ^ seed, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Deterministic smooth 1D value noise in [-1, 1]. */
function smoothNoise(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hashNoise(seed, i);
  return a + (hashNoise(seed, i + 1) - a) * u;
}
