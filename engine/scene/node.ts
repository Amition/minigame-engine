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
  /** Wrap this node's rendering in ctx.save()/restore() (for draw() code that leaves canvas state behind). */
  isolate?: boolean;
  data?: Record<string, unknown>;
}

let nextUid = 1;
const tmpMat = new Mat2D();
const tmpLocal = new Mat2D();
const tmpWorld = new Mat2D();
const tmpRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
const identityRoot = new Mat2D();
const byZ = (a: Node, b: Node) => a.zIndex - b.zIndex;

/**
 * Renderer state (rendering is single-threaded and depth-first). While a node renders, `m` / `alpha` are its
 * parent's world matrix and effective alpha; `applied` / `ctxAlpha` mirror what the canvas currently holds so
 * unchanged state is not set again. `ctxAlphaRead` is ctx.globalAlpha read back after setting it: runtimes may
 * quantise alpha (@napi-rs/canvas keeps 1/255 steps), so leaks from draw() are detected against that value.
 */
const rs = {
  inPass: false,
  m: identityRoot,
  alpha: 1,
  applied: null as Mat2D | null,
  ctxAlpha: NaN,
  ctxAlphaRead: NaN,
  savedTop: 0,
};
const savedAlpha: number[] = [];
const savedAlphaRead: number[] = [];

interface PassState {
  inPass: boolean;
  m: Mat2D;
  alpha: number;
  savedTop: number;
}
const passes: PassState[] = [];
let passTop = 0;

function beginPass(root: Mat2D): void {
  const s = (passes[passTop++] ??= { inPass: false, m: identityRoot, alpha: 1, savedTop: 0 });
  s.inPass = rs.inPass;
  s.m = rs.m;
  s.alpha = rs.alpha;
  s.savedTop = rs.savedTop;
  rs.inPass = true;
  rs.m = root;
  rs.alpha = 1;
  rs.applied = null;
  rs.ctxAlpha = NaN;
  rs.ctxAlphaRead = NaN;
}

/** Ends a pass. The canvas state is unknown afterwards (a nested pass may have drawn into the same context). */
function endPass(): void {
  const s = passes[--passTop]!;
  rs.inPass = s.inPass;
  rs.m = s.m;
  rs.alpha = s.alpha;
  rs.savedTop = s.savedTop;
  rs.applied = null;
  rs.ctxAlpha = NaN;
  rs.ctxAlphaRead = NaN;
}

function setAlpha(ctx: Ctx2D, a: number): void {
  ctx.globalAlpha = a;
  rs.ctxAlpha = a;
  rs.ctxAlphaRead = ctx.globalAlpha;
}

// ---------------------------------------------------------------- draw state leak check (dev / tests)

const checkedProps = [
  'globalCompositeOperation',
  'shadowBlur',
  'shadowOffsetX',
  'shadowOffsetY',
  'lineCap',
  'lineJoin',
  'miterLimit',
  'imageSmoothingEnabled',
] as const;
const reportedLeaks = new Set<string>();

function drawStateSnapshot(ctx: Ctx2D): unknown[] {
  const s: unknown[] = checkedProps.map((p) => ctx[p]);
  const dash = typeof ctx.getLineDash === 'function' ? ctx.getLineDash() : null;
  s.push(dash ? dash.length : 0);
  return s;
}

function nodePath(n: Node): string {
  const parts: string[] = [];
  for (let p: Node | null = n; p; p = p.parent) parts.push(p.id ? `${p.kind}#${p.id}` : p.kind);
  return parts.reverse().join(' > ');
}

function reportDrawLeaks(node: Node, ctx: Ctx2D, phase: string, before: unknown[]): void {
  const after = drawStateSnapshot(ctx);
  for (let i = 0; i < after.length; i++) {
    const v = after[i];
    if (v === before[i] || typeof v === 'function') continue;
    const prop = i < checkedProps.length ? checkedProps[i]! : 'lineDash.length';
    const key = `${node.kind}.${phase}.${prop}`;
    if (reportedLeaks.has(key)) continue;
    reportedLeaks.add(key);
    console.warn(
      `[render] ${nodePath(node)}: ${phase}() leaves ctx.${prop} = ${String(v)} (was ${String(before[i])}); ` +
        'reset what draw() sets, or set isolate: true',
    );
  }
}

/**
 * Base scene-graph node.
 *
 * Coordinates: (x, y) is where the anchor point sits in the parent's local space. The node's own local space
 * (used by draw() and by children) has its origin at the top-left of its content box (0,0)-(width,height).
 * The anchor is also the pivot for rotation, scale and skew.
 *
 * Rendering: render() computes the world matrix (parent world x local) and effective alpha, applies them with
 * ctx.setTransform / globalAlpha, then renderContent() clips, calls draw(ctx) for own content, renders children
 * sorted by zIndex (stable), then drawOver(ctx) (again in this node's space). There is no ctx.save()/restore()
 * per node: only `clip`, `blend` and `isolate` nodes are wrapped in one, so draw() must reset any other canvas
 * state it changes (shadows, line dash, lineCap/lineJoin, composite op); globalAlpha is re-asserted after draw().
 * Subclasses usually only override draw().
 */
export class Node {
  /** Total render() calls that drew (visible nodes) since start; game.stats diffs it per frame. */
  static renderCount = 0;
  /**
   * Warn (once per node kind and property) when draw()/drawOver() leaves canvas state behind that would bleed into
   * the next nodes: composite op, shadows, lineCap/lineJoin/miterLimit, line dash, image smoothing. On in tests.
   */
  static checkDrawState = process.env.NODE_ENV === 'test';

  /** Renders `node` as the root of a render pass whose canvas transform is `m` (Game.render seeds pixel ratio x scale). */
  static renderRoot(ctx: Ctx2D, node: Node, m: Mat2D): void {
    beginPass(m);
    try {
      node.render(ctx);
    } finally {
      endPass();
    }
  }

  readonly uid = nextUid++;
  id = '';
  readonly tags = new Set<string>();
  parent: Node | null = null;

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
  /** When false, descendants are not hit-tested (they also don't receive events). */
  interactiveChildren = true;
  /** Extra hit-test margin in local units (bigger tap targets without changing visuals). */
  hitPadding = 0;
  /** Clip own content and children to the (0,0,width,height) rect. */
  clip = false;
  blend: GlobalCompositeOperation | null = null;
  /** Wrap rendering in ctx.save()/restore(), for draw() code that leaves canvas state (shadows, dash...) behind. */
  isolate = false;
  /** Skip update() for this subtree. */
  paused = false;
  destroyed = false;
  /** Free-form user data. */
  data: Record<string, unknown> = {};

  private _children: Node[] = [];
  private _zIndex = 0;
  private sortDirty = false;
  private _interactive = false;
  private interactiveBelow = 0;
  private events: Emitter<NodeEvents> | null = null;
  private updaters: ((dt: number) => void)[] | null = null;
  /** tick()/walk() loops running over `_children` / `updaters`; while `*Shared`, changes copy the array first. */
  private childLoops = 0;
  private childShared = false;
  private updaterLoops = 0;
  private updaterShared = false;
  /** World matrix and effective alpha of the last render (valid while rendering this node's content). */
  private wm: Mat2D | null = null;
  private wa = 1;
  private childMat: Mat2D | null = null;

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
    if (o.isolate !== undefined) this.isolate = o.isolate;
    if (o.data) Object.assign(this.data, o.data);
    return this;
  }

  /** Children in render order after sortChildren(). Change them with add/addAt/remove, not by writing the array. */
  get children(): Node[] {
    return this._children;
  }

  /** Receives pointer events itself. */
  get interactive(): boolean {
    return this._interactive;
  }

  set interactive(v: boolean) {
    v = !!v;
    if (v === this._interactive) return;
    this._interactive = v;
    const d = v ? 1 : -1;
    for (let n = this.parent; n; n = n.parent) n.interactiveBelow += d;
  }

  /** Interactive nodes below this one; hit tests skip subtrees where it is 0. */
  get interactiveDescendants(): number {
    return this.interactiveBelow;
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
    return this.addAt(child, this._children.length);
  }

  /** Adds several children; returns this for chaining. */
  append(...children: Node[]): this {
    for (const c of children) this.add(c);
    return this;
  }

  addAt<T extends Node>(child: T, index: number): T {
    if (child === (this as Node)) throw new Error('cannot add a node to itself');
    if (child.parent) child.parent.remove(child);
    const n = this._children.length;
    const i = Math.max(0, Math.min(index, n));
    // A running tick/walk loop stops at the length it started with, so appends never need a copy.
    if (i === n) this._children.push(child);
    else this.writableChildren().splice(i, 0, child);
    child.parent = this;
    this.sortDirty = true;
    const k = child.interactiveBelow + (child._interactive ? 1 : 0);
    if (k !== 0) for (let p: Node | null = this; p; p = p.parent) p.interactiveBelow += k;
    child.emit('added', this);
    return child;
  }

  remove(child: Node): void {
    const i = this._children.indexOf(child);
    if (i < 0) return;
    this.writableChildren().splice(i, 1);
    child.parent = null;
    const k = child.interactiveBelow + (child._interactive ? 1 : 0);
    if (k !== 0) for (let p: Node | null = this; p; p = p.parent) p.interactiveBelow -= k;
    child.emit('removed', this);
  }

  removeFromParent(): void {
    this.parent?.remove(this);
  }

  removeChildren(): Node[] {
    const list = this._children.slice();
    for (const c of list) this.remove(c);
    return list;
  }

  /** Destroys children first, removes from parent, emits 'destroyed' and drops listeners. */
  destroy(): void {
    if (this.destroyed) return;
    for (const c of this._children.slice()) c.destroy();
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
    const ch = this._children;
    for (let i = 1; i < ch.length; i++) {
      if (ch[i - 1]!._zIndex > ch[i]!._zIndex) {
        this.writableChildren().sort(byZ);
        return;
      }
    }
  }

  /** The children array, copied first when a tick/walk loop is iterating it (copy-on-write). */
  private writableChildren(): Node[] {
    if (this.childShared) {
      this._children = this._children.slice();
      this.childShared = false;
    }
    return this._children;
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

  /** Local → stage matrix (into `out` when given; no other allocation). */
  worldMatrix(out: Mat2D = new Mat2D()): Mat2D {
    this.localMatrix(out);
    for (let n = this.parent; n; n = n.parent) out.premultiply(n.localMatrix(tmpLocal));
    return out;
  }

  /** Stage point → this node's local space. */
  toLocal(x: number, y: number, out?: Vec2): Vec2 {
    return this.worldMatrix(tmpWorld).invert().apply(x, y, out);
  }

  /** Local point → stage space. */
  toWorld(x: number, y: number, out?: Vec2): Vec2 {
    return this.worldMatrix(tmpWorld).apply(x, y, out);
  }

  /** Axis-aligned bounds of the content box in stage space (into `out` when given). */
  worldBounds(out?: Rect): Rect {
    tmpRect.x = 0;
    tmpRect.y = 0;
    tmpRect.w = this.width;
    tmpRect.h = this.height;
    return this.worldMatrix(tmpWorld).applyRect(tmpRect, out);
  }

  /** Stage-space center of the content box (useful for taps in tests). */
  worldCenter(out?: Vec2): Vec2 {
    return this.toWorld(this.width / 2, this.height / 2, out);
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
      const list = this.updaters;
      const i = list ? list.indexOf(fn) : -1;
      if (i < 0) return;
      if (this.updaterShared) {
        this.updaters = list!.slice();
        this.updaterShared = false;
      }
      this.updaters!.splice(i, 1);
    };
  }

  /**
   * Called by the game each frame: update() self, updaters, then children. Callbacks and children added during
   * the tick run from the next frame; removed ones still run this frame (callbacks) or are skipped (children).
   */
  tick(dt: number): void {
    if (this.paused || this.destroyed) return;
    this.update(dt);
    const ups = this.updaters;
    if (ups !== null && ups.length > 0) {
      if (ups.length === 1) ups[0]!(dt);
      else {
        this.updaterLoops++;
        this.updaterShared = true;
        for (let i = 0, n = ups.length; i < n; i++) ups[i]!(dt);
        if (--this.updaterLoops === 0) this.updaterShared = false;
      }
    }
    const ch = this._children;
    const n = ch.length;
    if (n === 0) return;
    this.childLoops++;
    this.childShared = true;
    for (let i = 0; i < n; i++) {
      const c = ch[i]!;
      if (c.parent === this) c.tick(dt);
    }
    if (--this.childLoops === 0) this.childShared = false;
  }

  // ---------------------------------------------------------------- render

  /** Draws own content in local space. Override in subclasses; reset any canvas state you change except alpha. */
  draw(_ctx: Ctx2D): void {}

  /** Draws on top of children, in this node's local space. Override when needed. */
  drawOver(_ctx: Ctx2D): void {}

  /**
   * Draws this node and its subtree. Outside a render pass (a direct call) the node renders from an identity
   * canvas transform; Game.render() starts the pass with Node.renderRoot().
   */
  render(ctx: Ctx2D): void {
    if (!this.visible || this.alpha <= 0 || this.destroyed) return;
    if (!rs.inPass) {
      Node.renderRoot(ctx, this, identityRoot);
      return;
    }
    Node.renderCount++;
    const pm = rs.m;
    const pa = rs.alpha;
    const m = (this.wm ??= new Mat2D());
    const lm = this.localMatrix(m);
    if (lm !== m) m.copyFrom(lm);
    m.premultiply(pm);
    const a = this.alpha < 1 ? pa * this.alpha : pa;
    this.wa = a;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    rs.applied = m;
    if (a !== rs.ctxAlpha) setAlpha(ctx, a);
    const isolated = this.clip || !!this.blend || this.isolate;
    if (isolated) {
      this.saveRenderState(ctx);
      if (this.blend) ctx.globalCompositeOperation = this.blend;
    }
    rs.m = m;
    rs.alpha = a;
    this.renderContent(ctx);
    rs.m = pm;
    rs.alpha = pa;
    if (isolated) this.restoreRenderState(ctx);
  }

  /**
   * Clip → draw → children → drawOver; ctx is in this node's local space when it starts. Override to customise
   * (culling, clip shape, child order); use renderDraw / renderChildren / renderDrawOver for the steps.
   */
  protected renderContent(ctx: Ctx2D): void {
    if (this.clip) {
      ctx.beginPath();
      ctx.rect(0, 0, this.width, this.height);
      ctx.clip();
    }
    this.renderDraw(ctx);
    this.renderChildren(ctx);
    this.renderDrawOver(ctx);
  }

  /** Renders the children in zIndex order; each sets its own transform, so ctx is left in the last child's space. */
  protected renderChildren(ctx: Ctx2D): void {
    if (this._children.length === 0) return;
    this.sortChildren();
    const ch = this._children;
    for (let i = 0; i < ch.length; i++) ch[i]!.render(ctx);
  }

  /** Renders the children (like the base renderChildren) as if `m` (in this node's local space) were applied first. */
  protected renderChildrenWith(ctx: Ctx2D, m: Mat2D): void {
    const wm = this.wm;
    if (!wm) return;
    const pm = rs.m;
    rs.m = (this.childMat ??= new Mat2D()).copyFrom(wm).multiply(m);
    Node.prototype.renderChildren.call(this, ctx);
    rs.m = pm;
  }

  /** renderChildrenWith for a translation, e.g. a pressed button's content or a repeated parallax copy. */
  protected renderChildrenOffset(ctx: Ctx2D, dx: number, dy: number): void {
    const wm = this.wm;
    if (!wm) return;
    const pm = rs.m;
    rs.m = (this.childMat ??= new Mat2D()).copyFrom(wm).translate(dx, dy);
    Node.prototype.renderChildren.call(this, ctx);
    rs.m = pm;
  }

  /** Calls draw() (when overridden), then puts back globalAlpha if draw() left it changed. */
  protected renderDraw(ctx: Ctx2D): void {
    if (this.draw === baseDraw) return;
    if (Node.checkDrawState && !this.isolate) {
      const before = drawStateSnapshot(ctx);
      this.draw(ctx);
      reportDrawLeaks(this, ctx, 'draw', before);
    } else this.draw(ctx);
    if (ctx.globalAlpha !== rs.ctxAlphaRead) setAlpha(ctx, this.wa);
  }

  /** Puts this node's transform and alpha back (children changed them) and calls drawOver() when overridden. */
  protected renderDrawOver(ctx: Ctx2D): void {
    if (this.drawOver === baseDrawOver) return;
    this.applyLocalTransform(ctx);
    if (Node.checkDrawState && !this.isolate) {
      const before = drawStateSnapshot(ctx);
      this.drawOver(ctx);
      reportDrawLeaks(this, ctx, 'drawOver', before);
    } else this.drawOver(ctx);
    if (ctx.globalAlpha !== rs.ctxAlphaRead) setAlpha(ctx, this.wa);
  }

  /** Sets ctx back to this node's local space and alpha, e.g. to draw own content between children. */
  protected applyLocalTransform(ctx: Ctx2D): void {
    const m = this.wm;
    if (!m) return;
    if (rs.applied !== m) {
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      rs.applied = m;
    }
    if (rs.ctxAlpha !== this.wa) setAlpha(ctx, this.wa);
  }

  /**
   * This node's local → canvas (backing pixel) matrix while it renders, i.e. what draw()/drawOver() draw with,
   * including camera, cache and render-override offsets; null outside a render pass. Do not mutate.
   */
  protected get renderMatrix(): Readonly<Mat2D> | null {
    return rs.inPass ? this.wm : null;
  }

  /** ctx.save() that keeps the renderer's state tracking valid; pair with restoreRenderState() (e.g. around a clip). */
  protected saveRenderState(ctx: Ctx2D): void {
    ctx.save();
    savedAlpha[rs.savedTop] = rs.ctxAlpha;
    savedAlphaRead[rs.savedTop] = rs.ctxAlphaRead;
    rs.savedTop++;
  }

  protected restoreRenderState(ctx: Ctx2D): void {
    ctx.restore();
    rs.savedTop--;
    rs.ctxAlpha = savedAlpha[rs.savedTop]!;
    rs.ctxAlphaRead = savedAlphaRead[rs.savedTop]!;
    rs.applied = null;
  }

  /**
   * Draws this node's own content (draw, children, drawOver; no clip) into `ctx` as a separate render pass, with
   * `m` as this node's local → canvas matrix and full alpha. For offscreen caches (see CacheContainer).
   */
  protected renderContentTo(ctx: Ctx2D, m: Mat2D): void {
    const wm = this.wm;
    const wa = this.wa;
    beginPass(m);
    try {
      this.wm = m;
      this.wa = 1;
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      rs.applied = m;
      setAlpha(ctx, 1);
      this.renderDraw(ctx);
      this.renderChildren(ctx);
      this.renderDrawOver(ctx);
    } finally {
      this.wm = wm;
      this.wa = wa;
      endPass();
    }
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
    const ch = this._children;
    const n = ch.length;
    if (n === 0) return;
    this.childLoops++;
    this.childShared = true;
    for (let i = 0; i < n; i++) ch[i]!.walk(fn, depth + 1);
    if (--this.childLoops === 0) this.childShared = false;
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
    for (const c of this._children) {
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
    for (const c of this._children) c.walk((n) => void (matchesSelector(n, chain, this) && out.push(n)));
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

const baseDraw = Node.prototype.draw;
const baseDrawOver = Node.prototype.drawOver;
