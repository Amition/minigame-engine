import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from '../scene/node';
import { isChildVisible, visibleRectIn } from './world';

export interface DepthSortOptions extends NodeOptions {
  /** Depth key per child; default `defaultDepth` (data.depth, else y). Larger = drawn later (in front). */
  depth?: (n: Node) => number;
  /** Skip children outside the view. Default true. */
  cull?: boolean;
  cullMargin?: number;
}

/** `node.data.depth` when it is a number, else `node.y` (the ground position for top-down 2.5D). */
export function defaultDepth(n: Node): number {
  const d = n.data.depth;
  return typeof d === 'number' ? d : n.y;
}

/**
 * Re-sorts its children every frame by depth (zIndex first, then the depth key; stable), so characters walk in
 * front of / behind trees in top-down 2.5D. Children order is updated in place, so hit testing also prefers
 * the front-most node.
 *
 *     const actors = world.add(new DepthSortLayer());
 *     actors.append(tree, hero, rock);   // sorted by y each frame
 */
export class DepthSortLayer extends Node {
  depthOf: (n: Node) => number;
  cull: boolean;
  cullMargin: number;
  culledCount = 0;
  private keys: number[] = [];

  constructor(opts: DepthSortOptions = {}) {
    super();
    this.depthOf = opts.depth ?? defaultDepth;
    this.cull = opts.cull ?? true;
    this.cullMargin = opts.cullMargin ?? 64;
    this.set(opts);
  }

  override get kind(): string {
    return 'DepthSortLayer';
  }

  /** Sorts children now (insertion sort: near-linear for the usual almost-sorted frame-to-frame case). */
  sortByDepth(): void {
    const ch = this.children;
    const n = ch.length;
    const keys = this.keys;
    keys.length = n;
    for (let i = 0; i < n; i++) keys[i] = this.depthOf(ch[i]!);
    for (let i = 1; i < n; i++) {
      const node = ch[i]!;
      const k = keys[i]!;
      const z = node.zIndex;
      let j = i - 1;
      while (j >= 0) {
        const o = ch[j]!;
        if (o.zIndex < z || (o.zIndex === z && keys[j]! <= k)) break;
        ch[j + 1] = o;
        keys[j + 1] = keys[j]!;
        j--;
      }
      ch[j + 1] = node;
      keys[j + 1] = k;
    }
  }

  protected override renderChildren(ctx: Ctx2D): void {
    this.culledCount = 0;
    if (this.children.length === 0) return;
    this.sortChildren();
    this.sortByDepth();
    const vis = this.cull ? visibleRectIn(this, this.cullMargin) : null;
    for (const c of this.children) {
      if (vis && c.visible && !isChildVisible(c, vis)) {
        this.culledCount++;
        continue;
      }
      c.render(ctx);
    }
  }

  override describe() {
    return { ...super.describe(), sorted: this.children.length, culled: this.culledCount || undefined };
  }
}
