import { Mat2D } from '../core/math';
import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from '../scene/node';
import type { Camera2D } from './camera';
import { visibleRectIn, World } from './world';

export interface ParallaxOptions extends NodeOptions {
  /** Repeat the content horizontally every this many units (0 = off). Content should span [0, repeatWidth). */
  repeatWidth?: number;
  /** Repeat vertically every this many units (0 = off). */
  repeatHeight?: number;
  /** Camera to follow; default: the nearest World ancestor's camera. */
  camera?: Camera2D;
}

/**
 * Background/foreground layer that scrolls at a fraction of the camera: factor 1 = normal world layer,
 * 0 = fixed to the camera (sky), 0.3 = far mountains, >1 = foreground. Put it inside a World.
 *
 *     world.addAt(new ParallaxLayer(0.2, 0, { repeatWidth: 1024 }), 0).add(mountains);
 */
export class ParallaxLayer extends Node {
  factorX: number;
  factorY: number;
  repeatWidth: number;
  repeatHeight: number;
  camera: Camera2D | null;

  constructor(factorX = 0.5, factorY = factorX, opts: ParallaxOptions = {}) {
    super();
    this.factorX = factorX;
    this.factorY = factorY;
    this.repeatWidth = opts.repeatWidth ?? 0;
    this.repeatHeight = opts.repeatHeight ?? 0;
    this.camera = opts.camera ?? null;
    this.set(opts);
  }

  override get kind(): string {
    return 'ParallaxLayer';
  }

  /** The camera this layer tracks (explicit or the nearest World's). */
  get activeCamera(): Camera2D | null {
    if (this.camera) return this.camera;
    for (let n = this.parent; n; n = n.parent) if (n instanceof World) return n.camera;
    return null;
  }

  override localMatrix(out: Mat2D = new Mat2D()): Mat2D {
    super.localMatrix(out);
    const cam = this.activeCamera;
    if (cam) {
      out.e += cam.x * (1 - this.factorX);
      out.f += cam.y * (1 - this.factorY);
    }
    return out;
  }

  protected override renderChildren(ctx: Ctx2D): void {
    const rw = this.repeatWidth;
    const rh = this.repeatHeight;
    if (rw <= 0 && rh <= 0) {
      super.renderChildren(ctx);
      return;
    }
    const vis = visibleRectIn(this);
    if (!vis || this.children.length === 0) {
      super.renderChildren(ctx);
      return;
    }
    const kx0 = rw > 0 ? Math.floor(vis.x / rw) - 1 : 0;
    const kx1 = rw > 0 ? Math.floor((vis.x + vis.w) / rw) + 1 : 0;
    const ky0 = rh > 0 ? Math.floor(vis.y / rh) - 1 : 0;
    const ky1 = rh > 0 ? Math.floor((vis.y + vis.h) / rh) + 1 : 0;
    for (let ky = ky0; ky <= ky1; ky++) {
      for (let kx = kx0; kx <= kx1; kx++) {
        ctx.save();
        ctx.translate(kx * rw, ky * rh);
        super.renderChildren(ctx);
        ctx.restore();
      }
    }
  }

  override describe() {
    return {
      ...super.describe(),
      factor: this.factorX === this.factorY ? this.factorX : `${this.factorX},${this.factorY}`,
      repeat: this.repeatWidth || this.repeatHeight ? `${this.repeatWidth}x${this.repeatHeight}` : undefined,
    };
  }
}
