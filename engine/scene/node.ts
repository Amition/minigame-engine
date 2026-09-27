import { Emitter } from '../core/emitter';
import { Mat2D, type Rect, type Vec2 } from '../core/math';
import type { Ctx2D } from '../gfx/types';
import { matchesSelector, parseSelector, type SelectorChain } from './selector';

export type PointerPhase = 'down' | 'move' | 'up' | 'cancel';

export interface PointerEvt {
  readonly pointerId: number;
  readonly phase: PointerPhase;
  /** Stage (design) coordinates. */
  readonly x: number;
  readonly y: number;
  /** Where this pointer went down, stage coordinates. */
  readonly startX: number;
  readonly startY: number;
  /** Deepest interactive node under the pointer at pointerdown (null for stage-level events with no hit). */
  readonly target: Node | null;
  /** Node currently handling the event while it bubbles. */
  currentTarget: Node | null;
  readonly propagationStopped: boolean;
  stopPropagation(): void;
  /** Pointer position in currentTarget's local space. */
  local(): Vec2;
}

export interface NodeEvents {
  pointerdown: PointerEvt;
  pointermove: PointerEvt;
  pointerup: PointerEvt;
  pointercancel: PointerEvt;
  /** Down and up on the same target without moving more than the tap slop. */
  tap: PointerEvt;
  /** Payload: the new parent. */
  added: Node;
  /** Payload: the old parent. */
  removed: Node;
  destroyed: Node;
}

export interface NodeOptions {
  id?: string;
  tags?: string[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Uniform scale. */
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  /** Radians. */
  rotation?: number;
  skewX?: number;
  skewY?: number;
  /** Anchor as a fraction of width/height; a number sets both axes. */
  anchor?: number | [number, number];
  anchorX?: number;
  anchorY?: number;
  alpha?: number;
  visible?: boolean;
  zIndex?: number;
  interactive?: boolean;
  interactiveChildren?: boolean;
  hitPadding?: number;
  clip?: boolean;
  blend?: GlobalCompositeOperation;
  data?: Record<string, unknown>;
}

let nextUid = 1;
const tmpMat = new Mat2D();

/**
 * Base scene-graph node.
 *
 * Coordinates: (x, y) is where the anchor point sits in the parent's local space. The node's own local space
 * (used by draw() and by children) has its origin at the top-left of its content box (0,0)-(width,height).
 * The anchor is also the pivot for rotation, scale and skew.
 *
 * Rendering: render() applies transform/alpha/clip, calls draw(ctx) for own content, then renders children
 * sorted by zIndex (stable), then drawOver(ctx). Subclasses usually only override draw().
 */
export class Node {
  /** Total render() calls that drew (visible nodes) since start; game.stats diffs it per frame. */
  static renderCount = 0;

  readonly uid = nextUid++;
  id = '';
  readonly tags = new Set<string>();
  parent: Node | null = null;
  readonly children: Node[] = [];

  x = 0;
  y = 0;
  scaleX = 1;
  scaleY = 1;
  rotation = 0;
  skewX = 0;
  skewY = 0;
  anchorX = 0;
  anchorY = 0;
  width = 0;
  height = 0;

  alpha = 1;
  visible = true;
  /** Receives pointer events itself. */
  interactive = false;
  /** When false, descendants are not hit-tested (they also don't receive events). */
  interactiveChildren = true;
  /** Extra hit-test margin in local units (bigger tap targets without changing visuals). */
  hitPadding = 0;
  /** Clip own content and children to the (0,0,width,height) rect. */
  clip = false;
  blend: GlobalCompositeOperation | null = null;
  /** Skip update() for this subtree. */
  paused = false;
  destroyed = false;
  /** Free-form user data. */
  data: Record<string, unknown> = {};

  private _zIndex = 0;
  private sortDirty = false;
  private events: Emitter<NodeEvents> | null = null;
  private updaters: ((dt: number) => void)[] | null = null;

  constructor(opts?: NodeOptions) {
    if (opts) this.set(opts);
  }

  /** Type label used by dumps and selectors. Subclasses override: `override get kind() { return 'Sprite'; }`. */
  get kind(): string {
    return 'Node';
  }

  set(o: NodeOptions): this {
    if (o.id !== undefined) this.id = o.id;
    if (o.tags) for (const t of o.tags) this.tags.add(t);
    if (o.x !== undefined) this.x = o.x;
    if (o.y !== undefined) this.y = o.y;
    if (o.width !== undefined) this.width = o.width;
    if (o.height !== undefined) this.height = o.height;
    if (o.scale !== undefined) this.scaleX = this.scaleY = o.scale;
    if (o.scaleX !== undefined) this.scaleX = o.scaleX;
    if (o.scaleY !== undefined) this.scaleY = o.scaleY;
    if (o.rotation !== undefined) this.rotation = o.rotation;
    if (o.skewX !== undefined) this.skewX = o.skewX;
    if (o.skewY !== undefined) this.skewY = o.skewY;
    if (o.anchor !== undefined) {
      if (typeof o.anchor === 'number') this.anchorX = this.anchorY = o.anchor;
      else [this.anchorX, this.anchorY] = o.anchor;
    }
    if (o.anchorX !== undefined) this.anchorX = o.anchorX;
    if (o.anchorY !== undefined) this.anchorY = o.anchorY;
    if (o.alpha !== undefined) this.alpha = o.alpha;
    if (o.visible !== undefined) this.visible = o.visible;
    if (o.zIndex !== undefined) this.zIndex = o.zIndex;
    if (o.interactive !== undefined) this.interactive = o.interactive;
    if (o.interactiveChildren !== undefined) this.interactiveChildren = o.interactiveChildren;
    if (o.hitPadding !== undefined) this.hitPadding = o.hitPadding;
    if (o.clip !== undefined) this.clip = o.clip;
    if (o.blend !== undefined) this.blend = o.blend;
    if (o.data) Object.assign(this.data, o.data);
    return this;
  }

  get zIndex(): number {
    return this._zIndex;
  }

  set zIndex(v: number) {
    if (v === this._zIndex) return;
    this._zIndex = v;
    if (this.parent) this.parent.sortDirty = true;
  }

  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  setSize(w: number, h: number): this {
    this.width = w;
    this.height = h;
    return this;
  }

  setScale(sx: number, sy = sx): this {
    this.scaleX = sx;
    this.scaleY = sy;
    return this;
  }

  setAnchor(ax: number, ay = ax): this {
    this.anchorX = ax;
    this.anchorY = ay;
    return this;
  }

  // ---------------------------------------------------------------- tree

  /** Adds a child and returns it: `const s = scene.add(new Sprite('hero'))`. */
  add<T extends Node>(child: T): T {
    return this.addAt(child, this.children.length);
  }

  /** Adds several children; returns this for chaining. */
  append(...children: Node[]): this {
    for (const c of children) this.add(c);
    return this;
  }

  addAt<T extends Node>(child: T, index: number): T {
    if (child === (this as Node)) throw new Error('cannot add a node to itself');
    if (child.parent) child.parent.remove(child);
    const i = Math.max(0, Math.min(index, this.children.length));
    this.children.splice(i, 0, child);
    child.parent = this;
    this.sortDirty = true;
    child.emit('added', this);
    return child;
  }

  remove(child: Node): void {
    const i = this.children.indexOf(child);
    if (i < 0) return;
    this.children.splice(i, 1);
    child.parent = null;
    child.emit('removed', this);
  }

  removeFromParent(): void {
    this.parent?.remove(this);
  }

  removeChildren(): Node[] {
    const list = this.children.slice();
    for (const c of list) this.remove(c);
    return list;
  }

  /** Destroys children first, removes from parent, emits 'destroyed' and drops listeners. */
  destroy(): void {
    if (this.destroyed) return;
    for (const c of this.children.slice()) c.destroy();
    this.onDestroy();
    this.removeFromParent();
    this.destroyed = true;
    this.emit('destroyed', this);
    this.events?.removeAllListeners();
    this.updaters = null;
  }

  /** Subclass hook for releasing resources. */
  protected onDestroy(): void {}

  get root(): Node {
    let n: Node = this;
    while (n.parent) n = n.parent;
    return n;
  }

  isDescendantOf(ancestor: Node): boolean {
    for (let n = this.parent; n; n = n.parent) if (n === ancestor) return true;
    return false;
  }

  /** True if this node and all its ancestors are visible. */
  get worldVisible(): boolean {
    for (let n: Node | null = this; n; n = n.parent) if (!n.visible || n.alpha <= 0) return false;
    return true;
  }

  sortChildren(): void {
    if (!this.sortDirty) return;
    this.sortDirty = false;
    this.children.sort((a, b) => a._zIndex - b._zIndex);
  }

  // ---------------------------------------------------------------- transform

  localMatrix(out: Mat2D = new Mat2D()): Mat2D {
    out.set(1, 0, 0, 1, this.x, this.y);
    out.rotate(this.rotation);
    if (this.skewX !== 0 || this.skewY !== 0) {
      tmpMat.set(1, Math.tan(this.skewY), Math.tan(this.skewX), 1, 0, 0);
      out.multiply(tmpMat);
    }
    out.scale(this.scaleX, this.scaleY);
    if (this.anchorX !== 0 || this.anchorY !== 0) out.translate(-this.anchorX * this.width, -this.anchorY * this.height);
    return out;
  }

  /** Local → stage matrix. */
  worldMatrix(out: Mat2D = new Mat2D()): Mat2D {
    const chain: Node[] = [];
    for (let n: Node | null = this; n; n = n.parent) chain.push(n);
    out.identity();
    const m = new Mat2D();
    for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i]!.localMatrix(m));
    return out;
  }

  /** Stage point → this node's local space. */
  toLocal(x: number, y: number, out?: Vec2): Vec2 {
    return this.worldMatrix().invert().apply(x, y, out);
  }

  /** Local point → stage space. */
  toWorld(x: number, y: number, out?: Vec2): Vec2 {
    return this.worldMatrix().apply(x, y, out);
  }

  /** Axis-aligned bounds of the content box in stage space. */
  worldBounds(): Rect {
    return this.worldMatrix().applyRect({ x: 0, y: 0, w: this.width, h: this.height });
  }

  /** Stage-space center of the content box (useful for taps in tests). */
  worldCenter(): Vec2 {
    return this.toWorld(this.width / 2, this.height / 2);
  }

  /** Point in local space → true if it hits this node. Override for non-rectangular shapes. */
  hitTest(lx: number, ly: number): boolean {
    const p = this.hitPadding;
    return lx >= -p && ly >= -p && lx < this.width + p && ly < this.height + p;
  }

  /** Point in local space → false if this node's clipping hides its children there (no child hits). */
  hitClip(lx: number, ly: number): boolean {
    return !this.clip || (lx >= 0 && ly >= 0 && lx < this.width && ly < this.height);
  }

  // ---------------------------------------------------------------- update

  /** Per-frame logic. Override in subclasses; dt is in seconds (already time-scaled). */
  update(_dt: number): void {}

  /** Adds a per-frame callback without subclassing. Returns a remover. */
  onUpdate(fn: (dt: number) => void): () => void {
    (this.updaters ??= []).push(fn);
    return () => {
      const i = this.updaters?.indexOf(fn) ?? -1;
      if (i >= 0) this.updaters!.splice(i, 1);
    };
  }

  /** Called by the game each frame: update() self, updaters, then children. */
  tick(dt: number): void {
    if (this.paused || this.destroyed) return;
    this.update(dt);
    if (this.updaters) for (const fn of this.updaters.slice()) fn(dt);
    if (this.children.length === 0) return;
    for (const c of this.children.slice()) if (c.parent === this) c.tick(dt);
  }

  // ---------------------------------------------------------------- render

  /** Draws own content in local space. Override in subclasses. */
  draw(_ctx: Ctx2D): void {}

  /** Draws on top of children. Override when needed. */
  drawOver(_ctx: Ctx2D): void {}

  render(ctx: Ctx2D): void {
    if (!this.visible || this.alpha <= 0 || this.destroyed) return;
    Node.renderCount++;
    ctx.save();
    const m = this.localMatrix(tmpMat);
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    if (this.alpha < 1) ctx.globalAlpha *= this.alpha;
    if (this.blend) ctx.globalCompositeOperation = this.blend;
    this.renderContent(ctx);
    ctx.restore();
  }

  /** Clip → draw → children → drawOver. Override to customise (e.g. culling, custom child order). */
  protected renderContent(ctx: Ctx2D): void {
    if (this.clip) {
      ctx.beginPath();
      ctx.rect(0, 0, this.width, this.height);
      ctx.clip();
    }
    this.draw(ctx);
    this.renderChildren(ctx);
    this.drawOver(ctx);
  }

  protected renderChildren(ctx: Ctx2D): void {
    if (this.children.length === 0) return;
    this.sortChildren();
    for (const c of this.children) c.render(ctx);
  }

  // ---------------------------------------------------------------- events

  on<K extends keyof NodeEvents>(type: K, fn: (e: NodeEvents[K]) => void): () => void;
  on(type: string, fn: (e: any) => void): () => void;
  on(type: string, fn: (e: any) => void): () => void {
    return (this.events ??= new Emitter<NodeEvents>()).on(type, fn);
  }

  once<K extends keyof NodeEvents>(type: K, fn: (e: NodeEvents[K]) => void): () => void;
  once(type: string, fn: (e: any) => void): () => void;
  once(type: string, fn: (e: any) => void): () => void {
    return (this.events ??= new Emitter<NodeEvents>()).once(type, fn);
  }

  off(type: string, fn?: (e: any) => void): void {
    this.events?.off(type, fn);
  }

  emit<K extends keyof NodeEvents>(type: K, e: NodeEvents[K]): void;
  emit(type: string, e?: unknown): void;
  emit(type: string, e?: unknown): void {
    this.events?.emit(type, e);
  }

  hasListeners(type: string): boolean {
    return this.events?.hasListeners(type) ?? false;
  }

  /** Makes the node interactive and calls fn on tap. */
  onTap(fn: (e: PointerEvt) => void): () => void {
    this.interactive = true;
    return this.on('tap', fn);
  }

  // ---------------------------------------------------------------- query

  /** Depth-first walk including this node. Return false from fn to skip a subtree. */
  walk(fn: (n: Node, depth: number) => boolean | void, depth = 0): void {
    if (fn(this, depth) === false) return;
    for (const c of this.children.slice()) c.walk(fn, depth + 1);
  }

  /**
   * CSS-like selectors over descendants (not including this node):
   * `Kind`, `#id`, `.tag`, `[key=value]`, `[key*=substr]`, `[key]`, `*`; compound (`Text#title.big`),
   * descendant (`A B`) and child (`A > B`) combinators. Attributes read describe() plus id/kind/visible/interactive.
   * Example: `find('Button[text=开始]')`, `find('#menu Text.title')`.
   */
  find<T extends Node = Node>(selector: string): T | null {
    const chain = parseSelector(selector);
    let found: Node | null = null;
    for (const c of this.children) {
      c.walk((n) => {
        if (found) return false;
        if (matchesSelector(n, chain, this)) found = n;
        return !found;
      });
      if (found) break;
    }
    return found as T | null;
  }

  findAll<T extends Node = Node>(selector: string): T[] {
    const chain: SelectorChain = parseSelector(selector);
    const out: Node[] = [];
    for (const c of this.children) c.walk((n) => void (matchesSelector(n, chain, this) && out.push(n)));
    return out as T[];
  }

  matches(selector: string): boolean {
    return matchesSelector(this, parseSelector(selector), null);
  }

  /**
   * Properties shown in dumps and usable in selectors. Subclasses extend:
   * `override describe() { return { ...super.describe(), text: this.text }; }`.
   * Keep values short (strings, numbers, booleans).
   */
  describe(): Record<string, string | number | boolean | undefined> {
    return {};
  }
}
