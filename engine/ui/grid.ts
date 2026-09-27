import { clamp } from '../core/math';
import type { Ctx2D } from '../gfx/types';
import { Text } from '../scene/text';
import type { Node } from '../scene/node';
import { animateUI } from './anim';
import { uiEvents } from './events';
import { Label } from './label';
import { isUIHost, measureUINode, minContentWidthOf, placeUINode, uiEdges, arrangeOutOfFlow, uiLayout, type Size } from './layout';
import { uiColor, uiSpace, type UIColor, type UISpace } from './theme';
import { UIView, type UIViewProps } from './view';

export interface GridProps extends UIViewProps {
  /** Number of equal-width columns. */
  columns: number;
  /** Fixed row height (default: tallest cell of the row). */
  cellHeight?: number;
  /** Cell width / height ratio (e.g. 1 = square cells). */
  cellAspect?: number;
  /** Row gap (default: gap). */
  rowGap?: UISpace;
}

/** Equal-column grid (level select, inventories). Containers and text fill their cell; other nodes are centered. */
export class UIGrid extends UIView {
  columns: number;
  cellHeight: number;
  cellAspect: number;
  rowGap: UISpace | undefined;

  constructor(props: GridProps) {
    super({ gap: 'md', ...props }, 'Grid');
    this.columns = Math.max(1, Math.floor(props.columns));
    this.cellHeight = props.cellHeight ?? 0;
    this.cellAspect = props.cellAspect ?? 0;
    this.rowGap = props.rowGap;
  }

  private cells(): Node[] {
    return this.children.filter((c) => c.visible && (uiLayout(c).position ?? 'flow') === 'flow');
  }

  private grid(innerW: number, commit: boolean, x0 = 0, y0 = 0): Size {
    const cols = this.columns;
    const gap = uiSpace(this.layout.gap);
    const rgap = this.rowGap !== undefined ? uiSpace(this.rowGap) : gap;
    const cells = this.cells();
    const colW = Math.max(0, (innerW - gap * (cols - 1)) / cols);
    let y = 0;
    for (let r = 0; r * cols < cells.length; r++) {
      const row = cells.slice(r * cols, r * cols + cols);
      let h = this.cellHeight || (this.cellAspect ? colW / this.cellAspect : 0);
      const sizes = row.map((c) => measureUINode(c, colW, Infinity, colW, NaN, isUIHost(c) || c instanceof Text ? colW : NaN, NaN));
      if (!h) for (const s of sizes) h = Math.max(h, s.h);
      if (commit) {
        row.forEach((c, i) => {
          const x = x0 + i * (colW + gap);
          const fill = isUIHost(c) || c instanceof Text;
          const s = sizes[i]!;
          const w = fill ? colW : Math.min(colW, s.w);
          const ch = fill && isUIHost(c) ? h : Math.min(h, s.h);
          placeUINode(c, x + (colW - w) / 2, y0 + y + (h - ch) / 2, w, ch);
        });
      }
      y += h + rgap;
    }
    return { w: innerW, h: Math.max(0, y - rgap) };
  }

  override measureContent(availW: number, _h: number, fixedW: boolean): Size {
    let w = availW;
    if (!fixedW || !isFinite(w)) {
      let cell = 0;
      for (const c of this.cells()) cell = Math.max(cell, measureUINode(c, Infinity, Infinity).w);
      const natural = cell * this.columns + uiSpace(this.layout.gap) * (this.columns - 1);
      w = isFinite(availW) ? Math.min(availW, natural) : natural;
    }
    return this.grid(w, false);
  }

  override minContentWidth(): number {
    let cell = 0;
    for (const c of this.cells()) cell = Math.max(cell, minContentWidthOf(c));
    return cell * this.columns + uiSpace(this.layout.gap) * (this.columns - 1);
  }

  override arrangeContent(innerW: number): void {
    const [pt, , , pl] = uiEdges(this.layout.padding);
    this.grid(innerW, true, pl, pt);
    arrangeOutOfFlow(this);
  }

  override describe() {
    return { ...super.describe(), columns: this.columns };
  }
}

/** One tab header (tap target) of Tabs. */
export class Tab extends UIView {
  readonly label: Label;
  selected = false;

  constructor(text: string, readonly index: number) {
    super({ direction: 'row', align: 'center', justify: 'center', grow: 1, basis: 0, minHeight: 80, padding: [0, 16, 6, 16] }, 'Tab');
    this.label = this.add(new Label(text, { size: 30, weight: 'bold', color: 'textDim', align: 'center', autoFit: 22 }));
    this.interactive = true;
  }

  setSelected(v: boolean): void {
    this.selected = v;
    this.label.restyle({ color: v ? 'text' : 'textDim' });
  }

  override onLayout(): void {
    this.hitPadding = Math.ceil(Math.max(0, 88 - Math.min(this.width, this.height)) / 2);
  }

  override describe() {
    return { ...super.describe(), text: this.label.text, selected: this.selected || undefined };
  }
}

export interface TabsProps extends UIViewProps {
  /** Tab titles; pages are the children, in the same order. */
  labels: string[];
  selected?: number;
  /** Underline / highlight color (default 'primary'). */
  color?: UIColor;
  onChange?: (index: number) => void;
}

/** Tab bar + pages; only the selected page is visible (hidden pages take no space). */
export class Tabs extends UIView {
  readonly bar: UIView;
  readonly pages: UIView;
  readonly tabs: Tab[] = [];
  color: UIColor;
  onChange: ((i: number) => void) | null;
  /** Animated underline position (tab index). */
  slide: number;
  private _selected: number;

  constructor(props: TabsProps, pages: Node[] = []) {
    const { padding, gap, align, justify, direction: _d, ...rest } = props;
    super({ gap: 0, ...rest, direction: 'column' }, 'Tabs');
    this.color = props.color ?? 'primary';
    this.onChange = props.onChange ?? null;
    this._selected = clamp(props.selected ?? 0, 0, Math.max(0, props.labels.length - 1));
    this.slide = this._selected;
    const bar = new TabBar(this);
    this.bar = super.addAt(bar, 0);
    this.pages = super.addAt(
      new UIView({
        kind: 'TabPages',
        grow: 1,
        padding: padding ?? 'lg',
        gap: gap ?? 'md',
        ...(align ? { align } : {}),
        ...(justify ? { justify } : {}),
        fill: 'surface',
        radius: [0, 0, 32, 32],
      }),
      1,
    );
    props.labels.forEach((l, i) => {
      const t = this.bar.add(new Tab(l, i));
      t.on('tap', () => this.select(i, true));
      this.tabs.push(t);
    });
    for (const p of pages) this.pages.add(p);
    this.sync();
  }

  /** Children added to Tabs become pages. */
  override addAt<T extends Node>(child: T, index: number): T {
    if (!this.pages) return super.addAt(child, index);
    const c = this.pages.addAt(child, index >= this.children.length ? this.pages.children.length : index);
    this.sync();
    return c;
  }

  get selected(): number {
    return this._selected;
  }

  select(i: number, notify = false): void {
    if (i < 0 || i >= this.tabs.length || i === this._selected) return;
    this._selected = i;
    animateUI(this, { slide: i }, { duration: 0.22, ease: 'outCubic' });
    this.sync();
    if (notify) {
      this.onChange?.(i);
      uiEvents.emit('change', { node: this, value: i });
      uiEvents.emit('tap', this);
    }
  }

  private sync(): void {
    if (!this.pages) return;
    this.tabs.forEach((t, i) => t.setSelected(i === this._selected));
    this.pages.children.forEach((p, i) => (p.visible = i === this._selected));
  }

  override describe() {
    return { ...super.describe(), selected: this.tabs[this._selected]?.label.text, index: this._selected };
  }
}

class TabBar extends UIView {
  constructor(private readonly tabs: Tabs) {
    super({ direction: 'row', align: 'stretch', fill: 'surfaceAlt', radius: [32, 32, 0, 0], padding: [0, 8] }, 'TabBar');
  }

  override draw(ctx: Ctx2D): void {
    super.draw(ctx);
    const tabs = this.tabs.tabs;
    const n = tabs.length;
    if (n === 0) return;
    const s = clamp(this.tabs.slide, 0, n - 1);
    const a = tabs[Math.floor(s)]!;
    const b = tabs[Math.ceil(s)]!;
    const t = s - Math.floor(s);
    const ax = a.x - a.anchorX * a.width;
    const bx = b.x - b.anchorX * b.width;
    const x = ax + (bx - ax) * t;
    const w = a.width + (b.width - a.width) * t;
    const barW = Math.min(w * 0.5, 120);
    ctx.fillStyle = uiColor(this.tabs.color);
    ctx.beginPath();
    ctx.rect(x + (w - barW) / 2, this.height - 8, barW, 6);
    ctx.fill();
  }
}
