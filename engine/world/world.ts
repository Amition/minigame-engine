import { Mat2D, type Rect, type Vec2 } from '../core/math';
import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from '../scene/node';
import { Camera2D } from './camera';

/** Nodes with custom bounds for culling (e.g. zero-size containers). Rect is in the parent's space. */
export interface Cullable {
  cullBounds(): Rect | null;
}

export interface WorldOptions extends NodeOptions {
  camera?: Camera2D;
  /** Skip rendering children whose bounds are outside the view. Default true. */
  cull?: boolean;
  /** Extra world units around the view kept when culling. Default 32. */
  cullMargin?: number;
  /** Clip rendering to the viewport rect. Default true. */
  clipViewport?: boolean;
}

const tmpA = new Mat2D();
const tmpB = new Mat2D();
const tmpC = new Mat2D();
const rectOf = (n: Node): Rect => ({ x: 0, y: 0, w: n.width, h: n.height });

/**
 * World-space container: children live in world coordinates; the node's transform is its viewport placement
 * (x, y, width, height in the parent) followed by `camera`. Width/height default to the parent's size
 * (tracked each frame) and become the camera viewport. The camera updates after the children ticked.
 *
 *     const world = scene.add(new World());
 *     world.add(map);
 *     world.camera.follow(hero, { lerp: 8, deadzoneWidth: 120 });
 *     world.camera.bounds = { x: 0, y: 0, w: map.width, h: map.height };
 *
 * Children are hit-tested only inside the viewport (when `clipViewport` is on); keep UI above the World in z-order.
 */
export class World extends Node {
  readonly camera: Camera2D;
  cull: boolean;
  cullMargin: number;
  clipViewport: boolean;
  /** Children skipped / drawn in the last render. */
  culledCount = 0;
  drawnCount = 0;
  private readonly autoSize: boolean;

  constructor(opts: WorldOptions = {}) {
    super();
    this.camera = opts.camera ?? new Camera2D();
    this.cull = opts.cull ?? true;
    this.cullMargin = opts.cullMargin ?? 32;
    this.clipViewport = opts.clipViewport ?? true;
    this.autoSize = !opts.width && !opts.height;
    this.tags.add('lint-ignore');
    this.set(opts);
    this.syncViewport();
  }

  override get kind(): string {
    return 'World';
  }

  /** Copies the viewport size to the camera (and follows the parent size when auto-sized). */
  syncViewport(): void {
    if (this.autoSize && this.parent) this.setSize(this.parent.width, this.parent.height);
    this.camera.setViewport(this.width, this.height);
  }

  /** Viewport placement in the parent (without the camera). */
  viewportMatrix(out: Mat2D = new Mat2D()): Mat2D {
    return super.localMatrix(out);
  }

  override localMatrix(out: Mat2D = new Mat2D()): Mat2D {
    super.localMatrix(out);
    return out.multiply(this.camera.viewMatrix(tmpA));
  }

  /** Stage point → world point. */
  stageToWorld(x: number, y: number, out?: Vec2): Vec2 {
    return this.toLocal(x, y, out);
  }

  /** World point → stage point. */
  worldToStage(x: number, y: number, out?: Vec2): Vec2 {
    return this.toWorld(x, y, out);
  }

  /** Stage bounds of the viewport. */
  override worldBounds(): Rect {
    const m = this.parent ? this.parent.worldMatrix(tmpB) : tmpB.identity();
    return m.multiply(super.localMatrix(tmpC)).applyRect(rectOf(this));
  }

  override worldCenter(): Vec2 {
    const m = this.parent ? this.parent.worldMatrix(tmpB) : tmpB.identity();
    return m.multiply(super.localMatrix(tmpC)).apply(this.width / 2, this.height / 2);
  }

  /** Local points are world points here; hits are tested against the viewport rect. */
  override hitTest(lx: number, ly: number): boolean {
    const p = this.camera.worldToScreen(lx, ly);
    const pad = this.hitPadding;
    return p.x >= -pad && p.y >= -pad && p.x < this.width + pad && p.y < this.height + pad;
  }

  override hitClip(lx: number, ly: number): boolean {
    if (!this.clipViewport && !this.clip) return true;
    const p = this.camera.worldToScreen(lx, ly);
    return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
  }

  override tick(dt: number): void {
    if (this.paused || this.destroyed) return;
    super.tick(dt);
    this.syncViewport();
    this.camera.update(dt);
  }

  protected override renderContent(ctx: Ctx2D): void {
    this.syncViewport();
    if (this.clipViewport && this.width > 0 && this.height > 0) {
      const inv = this.camera.viewMatrix(tmpA).invert();
      const w = this.width;
      const h = this.height;
      ctx.beginPath();
      const p = inv.apply(0, 0);
      ctx.moveTo(p.x, p.y);
      inv.apply(w, 0, p);
      ctx.lineTo(p.x, p.y);
      inv.apply(w, h, p);
      ctx.lineTo(p.x, p.y);
      inv.apply(0, h, p);
      ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.clip();
    }
    this.draw(ctx);
    this.renderChildren(ctx);
    this.drawOver(ctx);
  }

  protected override renderChildren(ctx: Ctx2D): void {
    this.culledCount = 0;
    this.drawnCount = 0;
    if (this.children.length === 0) return;
    this.sortChildren();
    const vis = this.cull ? this.camera.visibleRect(this.cullMargin) : null;
    for (const c of this.children) {
      if (!c.visible || c.alpha <= 0) continue;
      if (vis && !isChildVisible(c, vis)) {
        this.culledCount++;
        continue;
      }
      this.drawnCount++;
      c.render(ctx);
    }
  }

  override describe() {
    return { ...super.describe(), camera: this.camera.describe(), culled: this.culledCount };
  }
}

/** Bounds of a child in its parent's space: cullBounds() if provided, else its content box; null = unknown. */
export function childBounds(c: Node): Rect | null {
  const cb = (c as Partial<Cullable>).cullBounds;
  if (typeof cb === 'function') return cb.call(c);
  if (c.width <= 0 && c.height <= 0) return null;
  return c.localMatrix(tmpC).applyRect(rectOf(c));
}

/** True when the child's bounds intersect `rect` (children with unknown bounds count as visible). */
export function isChildVisible(c: Node, rect: Rect): boolean {
  const b = childBounds(c);
  if (!b) return true;
  return b.x < rect.x + rect.w && b.x + b.w > rect.x && b.y < rect.y + rect.h && b.y + b.h > rect.y;
}

/**
 * The part of `node`'s local space that is on screen: the nearest World ancestor's visible rect mapped into the
 * node, or the stage rect when there is no World. Null when unknown (detached tree with zero-size root).
 */
export function visibleRectIn(node: Node, margin = 0): Rect | null {
  let world: World | null = null;
  const chain: Node[] = [];
  for (let n: Node | null = node; n; n = n.parent) {
    if (n instanceof World && n !== node) {
      world = n;
      break;
    }
    chain.push(n);
  }
  const m = tmpB.identity();
  const step = new Mat2D();
  let area: Rect;
  if (world) {
    for (let i = chain.length - 1; i >= 0; i--) m.multiply(chain[i]!.localMatrix(step));
    area = world.camera.visibleRect(margin);
  } else {
    const root = chain[chain.length - 1]!;
    if (root.width <= 0 || root.height <= 0) return null;
    for (let i = chain.length - 1; i >= 0; i--) m.multiply(chain[i]!.localMatrix(step));
    area = root.localMatrix(step).applyRect({
      x: -margin,
      y: -margin,
      w: root.width + margin * 2,
      h: root.height + margin * 2,
    });
  }
  return m.invert().applyRect(area);
}
