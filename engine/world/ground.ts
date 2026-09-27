import { clamp01, lerp, Mat2D, type Rect } from '../core/math';
import { bakeTexture, type Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from '../scene/node';
import type { Cullable } from './world';

export interface GroundObjectOptions extends NodeOptions {
  /** Height above the ground in world units (drawn as an upward offset). */
  z?: number;
  /** Downward z acceleration, units/s². Default 1800. */
  gravity?: number;
  /** Fraction of the landing speed kept as a bounce (0..1). Default 0. */
  bounce?: number;
  shadow?: boolean;
  /** Shadow ellipse x radius at z = 0. Default 22. */
  shadowRadius?: number;
  /** Shadow height / width. Default 0.42. */
  shadowRatio?: number;
  shadowAlpha?: number;
  /** Height at which the shadow is smallest/faintest. Default 260. */
  shadowFadeHeight?: number;
}

const tmpA = new Mat2D();
const tmpB = new Mat2D();

/** A soft black ellipse texture shared by all shadows (baked lazily). */
export function softShadowTexture(): Texture {
  return textures.getOrCreate('world:soft-shadow', () =>
    bakeTexture(64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.75)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }),
  );
}

/** Draws a soft elliptical shadow centered at (x, y) with radii (rx, ry). */
export function drawSoftShadow(ctx: Ctx2D, x: number, y: number, rx: number, ry: number, alpha = 0.3): void {
  if (rx <= 0 || ry <= 0 || alpha <= 0) return;
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * alpha;
  softShadowTexture().draw(ctx, x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = a;
}

/**
 * 2.5D object on a ground plane: (x, y) is the ground position (use it for depth sorting), z the height above
 * it. The node and its children render lifted by z; a soft shadow stays on the ground and shrinks/fades with
 * height. Simple z-gravity: `jump(speed)`, emits 'land' (payload: impact speed) when touching down.
 * Give it a size + anchor [0.5, 1] ("feet at x, y") or add visuals as children positioned around (0, 0).
 */
export class GroundObject extends Node implements Cullable {
  z = 0;
  vz = 0;
  gravity = 1800;
  bounce = 0;
  shadow = true;
  shadowRadius = 22;
  shadowRatio = 0.42;
  shadowAlpha = 0.32;
  shadowFadeHeight = 260;
  /** Impact speed of the last landing. */
  lastImpact = 0;

  constructor(opts: GroundObjectOptions = {}) {
    super();
    if (opts.z !== undefined) this.z = opts.z;
    if (opts.gravity !== undefined) this.gravity = opts.gravity;
    if (opts.bounce !== undefined) this.bounce = opts.bounce;
    if (opts.shadow !== undefined) this.shadow = opts.shadow;
    if (opts.shadowRadius !== undefined) this.shadowRadius = opts.shadowRadius;
    if (opts.shadowRatio !== undefined) this.shadowRatio = opts.shadowRatio;
    if (opts.shadowAlpha !== undefined) this.shadowAlpha = opts.shadowAlpha;
    if (opts.shadowFadeHeight !== undefined) this.shadowFadeHeight = opts.shadowFadeHeight;
    this.set(opts);
  }

  override get kind(): string {
    return 'GroundObject';
  }

  /** On the ground and not moving up. */
  get grounded(): boolean {
    return this.z <= 0 && this.vz <= 0;
  }

  /** Starts a jump with upward speed (units/s) when grounded. Returns whether it jumped. */
  jump(speed: number): boolean {
    if (!this.grounded) return false;
    this.vz = speed;
    return true;
  }

  /** Integrates z (called from tick before update()). */
  stepZ(dt: number): void {
    if (this.z <= 0 && this.vz <= 0) {
      this.z = 0;
      this.vz = 0;
      return;
    }
    this.vz -= this.gravity * dt;
    this.z += this.vz * dt;
    if (this.z <= 0) {
      this.z = 0;
      const impact = -this.vz;
      this.lastImpact = impact;
      this.vz = this.bounce > 0 && impact > 60 ? impact * this.bounce : 0;
      this.emit('land', impact);
    }
  }

  override tick(dt: number): void {
    if (this.paused || this.destroyed) return;
    this.stepZ(dt);
    super.tick(dt);
  }

  override localMatrix(out: Mat2D = new Mat2D()): Mat2D {
    super.localMatrix(out);
    if (this.z !== 0) out.f -= this.z;
    return out;
  }

  /** Where the ground point (x, y) lies in local space (ignores rotation). */
  groundLocal(): { x: number; y: number } {
    return {
      x: this.anchorX * this.width,
      y: this.anchorY * this.height + (this.scaleY !== 0 ? this.z / this.scaleY : 0),
    };
  }

  /** Shadow size factor (1 on the ground → smaller with height). */
  get shadowScale(): number {
    return lerp(1, 0.5, clamp01(this.z / this.shadowFadeHeight));
  }

  protected drawShadow(ctx: Ctx2D): void {
    const g = this.groundLocal();
    const t = clamp01(this.z / this.shadowFadeHeight);
    const rx = this.shadowRadius * lerp(1, 0.5, t);
    drawSoftShadow(ctx, g.x, g.y, rx, rx * this.shadowRatio, this.shadowAlpha * lerp(1, 0.35, t));
  }

  protected override renderContent(ctx: Ctx2D): void {
    if (this.shadow && this.shadowRadius > 0) this.drawShadow(ctx);
    super.renderContent(ctx);
  }

  /** Parent-space bounds of the visual (own box + sized children) and the shadow; null when unknown. */
  cullBounds(): Rect | null {
    const m = this.localMatrix(tmpA);
    let minX = this.x - this.shadowRadius;
    let minY = this.y - this.shadowRadius;
    let maxX = this.x + this.shadowRadius;
    let maxY = this.y + this.shadowRadius;
    const add = (r: Rect) => {
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
    };
    if (this.width > 0 || this.height > 0) add(m.applyRect({ x: 0, y: 0, w: this.width, h: this.height }));
    else if (this.children.length === 0) return null;
    for (const c of this.children) {
      if (c.width <= 0 && c.height <= 0) return null;
      const r = c.localMatrix(tmpB).applyRect({ x: 0, y: 0, w: c.width, h: c.height });
      add(m.applyRect(r));
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  override describe() {
    return {
      ...super.describe(),
      z: this.z ? Math.round(this.z * 10) / 10 : undefined,
      grounded: this.grounded,
    };
  }
}
