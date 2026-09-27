import { clamp } from '../core/math';
import type { Ctx2D } from '../gfx/types';
import { Node, type PointerEvt } from '../scene/node';
import { uiTapSlop } from './button';
import {
  isUIHost,
  layoutUINode,
  measureUINode,
  uiEdges,
  uiLayout,
  type Size,
  type UIContainerLayout,
  type UISpacing,
} from './layout';
import { UIView, type UIViewProps } from './view';

export interface ScrollViewProps extends UIViewProps {
  /** Scroll horizontally instead of vertically. */
  horizontal?: boolean;
  /** Rubber-band past the ends (default true). */
  bounce?: boolean;
  /** Thin indicator while scrolling (default true). */
  scrollbar?: boolean;
  onScroll?: (offset: number) => void;
}

const rubber = (over: number, dim: number) => (1 - 1 / ((over * 0.55) / Math.max(1, dim) + 1)) * dim;

/** Scroll content: a flex container that skips rendering children outside the viewport. */
class ScrollContent extends UIView {
  constructor(
    props: UIViewProps,
    private readonly sv: ScrollView,
  ) {
    super(props, 'ScrollContent');
  }

  protected override renderChildren(ctx: Ctx2D): void {
    renderVisibleChildren(this, this.sv, ctx);
  }
}

const tmpRect = { x: 0, y: 0, w: 0, h: 0 };

function renderVisibleChildren(content: Node, sv: ScrollView, ctx: Ctx2D): void {
  content.sortChildren();
  const lo = sv.offset - 64;
  const hi = sv.offset + sv.viewport + 64;
  for (const c of content.children) {
    tmpRect.w = c.width;
    tmpRect.h = c.height;
    const b = c.localMatrix().applyRect(tmpRect);
    const a = sv.horizontal ? b.x : b.y;
    const len = sv.horizontal ? b.w : b.h;
    if (a + len < lo || a > hi) continue;
    c.render(ctx);
  }
}

/**
 * Clipped scrolling container. Children go into `content` (a flex column, or row when horizontal; padding/gap/
 * align props apply to it). Drag scrolls after the tap slop (so taps on children still work), with inertia and
 * bounce. Nested scroll views on the other axis and Sliders keep their own drags.
 */
export class ScrollView extends UIView {
  readonly content: Node;
  readonly horizontal: boolean;
  bounce: boolean;
  scrollbar: boolean;
  onScroll: ((offset: number) => void) | null;
  /** Current scroll offset (0 = start; may go outside [0, maxOffset] while bouncing). */
  offset = 0;
  /** Scroll range. */
  maxOffset = 0;
  /** Visible length along the scroll axis. */
  viewport = 0;
  velocity = 0;
  dragging = false;
  private pointerId: number | null = null;
  private start = { main: 0, cross: 0 };
  private dragFrom = 0;
  private dragOffset = 0;
  private ignoring = false;
  private clock = 0;
  private samples: { t: number; o: number }[] = [];
  private barAlpha = 0;
  private idle = 0;
  private target: number | null = null;

  constructor(props: ScrollViewProps = {}) {
    const horizontal = !!props.horizontal;
    const { padding, gap, crossGap, align, justify, wrap, direction: _d, ...rest } = props;
    super({ ...rest, clip: true }, 'ScrollView');
    this.horizontal = horizontal;
    this.bounce = props.bounce ?? true;
    this.scrollbar = props.scrollbar ?? true;
    this.onScroll = props.onScroll ?? null;
    const cl: UIContainerLayout = { direction: horizontal ? 'row' : 'column' };
    if (padding !== undefined) cl.padding = padding;
    if (gap !== undefined) cl.gap = gap;
    if (crossGap !== undefined) cl.crossGap = crossGap;
    if (align !== undefined) cl.align = align;
    if (justify !== undefined) cl.justify = justify;
    if (wrap !== undefined) cl.wrap = wrap;
    this.content = this.createContent(cl);
    super.addAt(this.content, 0);
    this.interactive = true;
    this.lintRole = props.lintRole ?? 'surface';
    this.on('pointerdown', (e: PointerEvt) => this.onDown(e));
    this.on('pointermove', (e: PointerEvt) => this.onMove(e));
    this.on('pointerup', (e: PointerEvt) => this.onUp(e));
    this.on('pointercancel', (e: PointerEvt) => this.onUp(e));
  }

  protected createContent(cl: UIContainerLayout): Node {
    return new ScrollContent(cl, this);
  }

  /** Children added to a ScrollView go into its content. */
  override addAt<T extends Node>(child: T, index: number): T {
    if (!this.content || child === this.content) return super.addAt(child, index);
    return this.content.addAt(child, index >= this.children.length ? this.content.children.length : index);
  }

  private main(p: { x: number; y: number }): number {
    return this.horizontal ? p.x : p.y;
  }

  private cross(p: { x: number; y: number }): number {
    return this.horizontal ? p.y : p.x;
  }

  private onDown(e: PointerEvt): void {
    if (this.pointerId !== null) return;
    const p = this.toLocal(e.x, e.y);
    this.pointerId = e.pointerId;
    this.start = { main: this.main(p), cross: this.cross(p) };
    this.dragging = false;
    this.ignoring = false;
    this.velocity = 0;
    this.target = null;
    this.samples = [];
  }

  private onMove(e: PointerEvt): void {
    if (e.pointerId !== this.pointerId || this.ignoring) return;
    const p = this.toLocal(e.x, e.y);
    const m = this.main(p);
    if (!this.dragging) {
      const dm = m - this.start.main;
      const dc = this.cross(p) - this.start.cross;
      if (Math.hypot(dm, dc) <= uiTapSlop()) return;
      if (Math.abs(dm) < Math.abs(dc)) {
        this.ignoring = true;
        return;
      }
      this.dragging = true;
      this.dragFrom = m;
      this.dragOffset = this.offset;
    }
    e.stopPropagation();
    let o = this.dragOffset - (m - this.dragFrom);
    if (o < 0) o = this.bounce ? -rubber(-o, this.viewport) : 0;
    else if (o > this.maxOffset) o = this.bounce ? this.maxOffset + rubber(o - this.maxOffset, this.viewport) : this.maxOffset;
    this.setOffset(o);
    this.samples.push({ t: this.clock, o: this.offset });
    if (this.samples.length > 12) this.samples.shift();
  }

  private onUp(e: PointerEvt): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    if (!this.dragging) return;
    this.dragging = false;
    const s = this.samples;
    const last = s[s.length - 1];
    let first = last;
    for (let i = s.length - 1; i >= 0 && last && last.t - s[i]!.t <= 0.1; i--) first = s[i];
    const dt = last && first ? last.t - first.t : 0;
    this.velocity = dt > 0 && last && first && this.clock - last.t < 0.08 ? (last.o - first.o) / dt : 0;
    this.velocity = clamp(this.velocity, -8000, 8000);
  }

  /** Scrolls to an offset (clamped), animated by default. */
  scrollTo(offset: number, animated = true): void {
    const o = clamp(offset, 0, this.maxOffset);
    this.velocity = 0;
    if (animated) this.target = o;
    else {
      this.target = null;
      this.setOffset(o);
    }
  }

  /** Scrolls so that a descendant is visible. */
  scrollIntoView(node: Node, animated = true): void {
    const b = node.worldBounds();
    const me = this.worldBounds();
    const a = this.horizontal ? b.x - me.x : b.y - me.y;
    const len = this.horizontal ? b.w : b.h;
    if (a < 0) this.scrollTo(this.offset + a - 16, animated);
    else if (a + len > this.viewport) this.scrollTo(this.offset + a + len - this.viewport + 16, animated);
  }

  protected setOffset(o: number): void {
    if (o === this.offset) return;
    this.offset = o;
    this.positionContent();
    this.barAlpha = 1;
    this.idle = 0;
    this.onScroll?.(o);
  }

  protected positionContent(): void {
    if (this.horizontal) {
      this.content.x = -this.offset;
      this.content.y = 0;
    } else {
      this.content.x = 0;
      this.content.y = -this.offset;
    }
  }

  override update(dt: number): void {
    this.clock += dt;
    this.idle += dt;
    if (!this.dragging) {
      const lo = 0;
      const hi = this.maxOffset;
      if (this.target !== null) {
        const o = this.offset + (this.target - this.offset) * (1 - Math.exp(-dt * 14));
        if (Math.abs(this.target - o) < 0.5) {
          this.setOffset(this.target);
          this.target = null;
        } else this.setOffset(o);
      } else if (this.offset < lo || this.offset > hi) {
        const edge = this.offset < lo ? lo : hi;
        this.velocity *= Math.exp(-dt * 22);
        let o = this.offset + this.velocity * dt;
        o += (edge - o) * (1 - Math.exp(-dt * 12));
        if (Math.abs(edge - o) < 0.5 && Math.abs(this.velocity) < 30) {
          o = edge;
          this.velocity = 0;
        }
        this.setOffset(o);
      } else if (Math.abs(this.velocity) > 8) {
        let o = this.offset + this.velocity * dt;
        this.velocity *= Math.exp(-dt * 2.6);
        if (!this.bounce) {
          if (o < lo || o > hi) this.velocity = 0;
          o = clamp(o, lo, hi);
        }
        this.setOffset(o);
      } else this.velocity = 0;
    }
    if (this.idle > 0.5 && this.barAlpha > 0) this.barAlpha = Math.max(0, this.barAlpha - dt * 3);
  }

  override measureContent(availW: number, availH: number, fixedW: boolean, fixedH: boolean): Size {
    const s = this.horizontal
      ? measureUINode(this.content, Infinity, availH, NaN, fixedH ? availH : NaN, NaN, fixedH ? availH : NaN)
      : measureUINode(this.content, availW, Infinity, fixedW ? availW : NaN, NaN, fixedW ? availW : NaN, NaN);
    return { w: Math.min(s.w, availW), h: Math.min(s.h, availH) };
  }

  override minContentWidth(): number {
    return 0;
  }

  override arrangeContent(innerW: number, innerH: number): void {
    const c = this.content;
    if (this.horizontal) {
      const s = measureUINode(c, Infinity, innerH, NaN, innerH, NaN, innerH);
      const len = Math.max(s.w, innerW);
      layoutUINode(c, len, innerH);
      this.viewport = innerW;
      this.maxOffset = Math.max(0, s.w - innerW);
    } else {
      const s = measureUINode(c, innerW, Infinity, innerW, NaN, innerW, NaN);
      const len = Math.max(s.h, innerH);
      layoutUINode(c, innerW, len);
      this.viewport = innerH;
      this.maxOffset = Math.max(0, s.h - innerH);
    }
    if (!this.dragging && this.target === null && Math.abs(this.velocity) < 1) this.offset = clamp(this.offset, 0, this.maxOffset);
    this.positionContent();
  }

  override drawOver(ctx: Ctx2D): void {
    if (!this.scrollbar || this.barAlpha <= 0 || this.maxOffset <= 0) return;
    const total = this.viewport + this.maxOffset;
    const len = Math.max(40, (this.viewport * this.viewport) / total);
    const k = clamp(this.offset / this.maxOffset, 0, 1);
    const pos = (this.viewport - len) * k;
    ctx.save();
    ctx.globalAlpha *= this.barAlpha * 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    if (this.horizontal) ctx.rect(pos, this.height - 8, len, 5);
    else ctx.rect(this.width - 8, pos, 5, len);
    ctx.fill();
    ctx.restore();
  }

  override describe() {
    return {
      ...super.describe(),
      offset: Math.round(this.offset),
      max: Math.round(this.maxOffset),
      dir: this.horizontal ? 'horizontal' : undefined,
    };
  }
}

/** Plain (non-flex) content node of a ListView; rows are independent layout roots. */
class ListContent extends Node {
  constructor(private readonly sv: ScrollView) {
    super();
  }

  override get kind(): string {
    return 'ListContent';
  }

  protected override renderChildren(ctx: Ctx2D): void {
    renderVisibleChildren(this, this.sv, ctx);
  }
}

export interface ListViewProps extends Omit<ScrollViewProps, 'horizontal' | 'wrap' | 'align' | 'justify' | 'direction'> {
  /** Number of rows. */
  count: number;
  /** Fixed row height in design units. */
  itemHeight: number;
  /** Builds the node for row `index` (called when the row scrolls into view; rows are destroyed when out of view). */
  renderItem: (index: number) => Node;
  gap?: number;
  padding?: UISpacing;
  /** Extra rows kept alive above/below the viewport (default 2). */
  overscan?: number;
}

/** Virtualised vertical list: only rows near the viewport exist, so 10 000 rows cost the same as 10. */
export class ListView extends ScrollView {
  count: number;
  itemHeight: number;
  renderItem: (index: number) => Node;
  overscan: number;
  private rowGap: number;
  private pad: [number, number, number, number];
  private rows = new Map<number, Node>();
  private rowW = 0;

  constructor(props: ListViewProps) {
    const { gap, padding, ...rest } = props;
    super({ ...rest, horizontal: false });
    this.kindName = 'ListView';
    this.count = props.count;
    this.itemHeight = props.itemHeight;
    this.renderItem = props.renderItem;
    this.overscan = props.overscan ?? 2;
    this.rowGap = typeof gap === 'number' ? gap : 0;
    this.pad = uiEdges(padding);
  }

  protected override createContent(): Node {
    return new ListContent(this);
  }

  /** First/last row index currently built. */
  get range(): [number, number] {
    const keys = [...this.rows.keys()];
    return keys.length ? [Math.min(...keys), Math.max(...keys)] : [-1, -1];
  }

  /** Row node for an index if it currently exists. */
  rowAt(index: number): Node | null {
    return this.rows.get(index) ?? null;
  }

  /** Changes the row count and rebuilds visible rows. */
  setCount(n: number): void {
    this.count = Math.max(0, n);
    this.refresh();
  }

  /** Destroys and rebuilds all visible rows (after the data changed). */
  refresh(): void {
    for (const r of this.rows.values()) r.destroy();
    this.rows.clear();
    this.markLayoutDirty();
  }

  scrollToIndex(i: number, animated = true): void {
    this.scrollTo(this.pad[0] + clamp(i, 0, this.count - 1) * (this.itemHeight + this.rowGap), animated);
  }

  private get total(): number {
    const n = this.count;
    return this.pad[0] + this.pad[2] + n * this.itemHeight + Math.max(0, n - 1) * this.rowGap;
  }

  override measureContent(availW: number, availH: number): Size {
    return { w: isFinite(availW) ? availW : 300, h: Math.min(this.total, availH) };
  }

  override arrangeContent(innerW: number, innerH: number): void {
    this.viewport = innerH;
    this.maxOffset = Math.max(0, this.total - innerH);
    this.content.width = innerW;
    this.content.height = Math.max(this.total, innerH);
    if (this.rowW !== innerW) {
      this.rowW = innerW;
      for (const [i, r] of this.rows) this.placeRow(r, i);
    }
    if (!this.dragging && Math.abs(this.velocity) < 1) this.offset = clamp(this.offset, 0, this.maxOffset);
    this.positionContent();
    this.updateRows();
  }

  protected override setOffset(o: number): void {
    super.setOffset(o);
    this.updateRows();
  }

  private placeRow(r: Node, i: number): void {
    const w = Math.max(0, this.rowW - this.pad[1] - this.pad[3]);
    const h = this.itemHeight;
    if (isUIHost(r)) uiLayout(r).set({ width: w, height: h });
    else {
      r.width = w;
      r.height = h;
    }
    r.x = this.pad[3] + r.anchorX * w;
    r.y = this.pad[0] + i * (h + this.rowGap) + r.anchorY * h;
  }

  private updateRows(): void {
    if (this.viewport <= 0) return;
    const step = this.itemHeight + this.rowGap;
    const first = Math.max(0, Math.floor((this.offset - this.pad[0]) / step) - this.overscan);
    const last = Math.min(this.count - 1, Math.ceil((this.offset + this.viewport - this.pad[0]) / step) + this.overscan);
    for (const [i, r] of this.rows) {
      if (i < first || i > last) {
        r.destroy();
        this.rows.delete(i);
      }
    }
    for (let i = first; i <= last; i++) {
      if (this.rows.has(i)) continue;
      const r = this.renderItem(i);
      this.placeRow(r, i);
      this.content.add(r);
      this.rows.set(i, r);
    }
  }

  override describe() {
    const [a, b] = this.range;
    return { ...super.describe(), count: this.count, rows: a >= 0 ? `${a}-${b}` : undefined };
  }
}
