import { clamp } from '../core/math';
import type { Node } from '../scene/node';
import { Sprite } from '../scene/sprite';
import { Text } from '../scene/text';
import { uiSpace, type UISpace } from './theme';

/** Design units, a percentage of the parent's inner size ('50%'), or 'auto' (content size). */
export type UISize = number | `${number}%` | 'auto';
/** Offset for absolute children: design units or a percentage of the parent size. */
export type UIOffset = number | `${number}%`;
/** Padding / margin: all sides, [vertical, horizontal] or [top, right, bottom, left]. */
export type UISpacing = UISpace | [UISpace, UISpace] | [UISpace, UISpace, UISpace, UISpace];
export type UIAlign = 'start' | 'center' | 'end' | 'stretch';
export type UIJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
/** 'stack' overlays children on top of each other (aligned with `align`). */
export type UIDirection = 'row' | 'column' | 'stack';
/** 'flow' = laid out by the parent (default); 'absolute' = placed by left/top/right/bottom; 'manual' = untouched. */
export type UIPosition = 'flow' | 'absolute' | 'manual';

/** Layout props any node can have as a child of a UI container. */
export interface UIItemLayout {
  width?: UISize;
  height?: UISize;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  /** width / height. */
  aspectRatio?: number;
  /** Share of the free main-axis space (default 0). */
  grow?: number;
  /** Share of the overflow to give back (default 1). */
  shrink?: number;
  /** Main-axis size before grow/shrink (default: width/height or content size). */
  basis?: UISize;
  alignSelf?: UIAlign | 'auto';
  margin?: UISpacing;
  position?: UIPosition;
  left?: UIOffset;
  top?: UIOffset;
  right?: UIOffset;
  bottom?: UIOffset;
  /** Default for left/top/right/bottom (absolute only): `inset: 0` fills the parent. */
  inset?: UIOffset;
  /** Absolute only: center on both axes (true) or one axis when that axis has no offsets. */
  center?: boolean | 'x' | 'y';
}

/** Layout props of UI containers (View, Column, Row, Panel...). */
export interface UIContainerLayout {
  /** Default 'column'. */
  direction?: UIDirection;
  /** Space between children on the main axis (and between wrapped lines unless crossGap is set). */
  gap?: UISpace;
  crossGap?: UISpace;
  padding?: UISpacing;
  /** Cross-axis alignment of children (default 'stretch'; 'center' for stacks). */
  align?: UIAlign;
  /** Main-axis distribution of free space (default 'start'). */
  justify?: UIJustify;
  wrap?: boolean;
}

export interface UILayoutProps extends UIItemLayout, UIContainerLayout {}

export const UI_ITEM_LAYOUT_KEYS = [
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'aspectRatio', 'grow', 'shrink', 'basis',
  'alignSelf', 'margin', 'position', 'left', 'top', 'right', 'bottom', 'inset', 'center',
] as const satisfies readonly (keyof UIItemLayout)[];

export const UI_CONTAINER_LAYOUT_KEYS = [
  'direction', 'gap', 'crossGap', 'padding', 'align', 'justify', 'wrap',
] as const satisfies readonly (keyof UIContainerLayout)[];

export interface Size {
  w: number;
  h: number;
}

/**
 * Layout style of a node. Every setter marks the layout dirty, so `view.layout.gap = 24` re-lays out
 * the tree before the next render.
 */
export interface UILayoutStyle extends UILayoutProps {}
export class UILayoutStyle {
  /** Raw values (read-only use; write through the setters). */
  readonly values: UILayoutProps = {};

  constructor(readonly owner: Node) {}

  set(p: UILayoutProps): this {
    for (const k of Object.keys(p) as (keyof UILayoutProps)[]) (this as Record<string, unknown>)[k] = p[k];
    return this;
  }

  toJSON(): UILayoutProps {
    return { ...this.values };
  }
}

for (const k of [...UI_ITEM_LAYOUT_KEYS, ...UI_CONTAINER_LAYOUT_KEYS]) {
  Object.defineProperty(UILayoutStyle.prototype, k, {
    get(this: UILayoutStyle) {
      return this.values[k];
    },
    set(this: UILayoutStyle, v: unknown) {
      const vals = this.values as Record<string, unknown>;
      if (vals[k] === v) return;
      if (v === undefined) delete vals[k];
      else vals[k] = v;
      markUILayoutDirty(this.owner);
    },
    configurable: true,
    enumerable: true,
  });
}

/** A node that lays out its children (UIView and all widgets). */
export interface UILayoutHost extends Node {
  readonly layout: UILayoutStyle;
  layoutDirty: boolean;
  /** Content size (padding excluded) for the given available inner size. */
  measureContent(availW: number, availH: number, fixedW: boolean, fixedH: boolean): Size;
  /** Sizes and positions children inside the final inner box (padding excluded). */
  arrangeContent(innerW: number, innerH: number): void;
  /** Narrowest content width (padding excluded) before content would overflow. */
  minContentWidth(): number;
  /** Called after this node was sized and its children arranged. */
  onLayout(): void;
}

const HOST = Symbol.for('engine.ui.layoutHost');

/** Marks a class prototype as a layout host (done by UIView). */
export function markUIHost(proto: object): void {
  (proto as Record<symbol, unknown>)[HOST] = true;
}

export function isUIHost(n: Node | null | undefined): n is UILayoutHost {
  return !!n && (n as unknown as Record<symbol, unknown>)[HOST] === true;
}

const styles = new WeakMap<Node, UILayoutStyle>();
const EMPTY: UILayoutProps = Object.freeze({}) as UILayoutProps;

/** The layout style of any node (created on demand for Sprite/Box/Text children). */
export function uiLayout(n: Node): UILayoutStyle {
  if (isUIHost(n)) return n.layout;
  let s = styles.get(n);
  if (!s) styles.set(n, (s = new UILayoutStyle(n)));
  return s;
}

/** Sets layout props on any node and returns it: `setUILayout(new Sprite('logo'), { width: 300 })`. */
export function setUILayout<T extends Node>(n: T, p: UILayoutProps): T {
  uiLayout(n).set(p);
  return n;
}

function props(n: Node): UILayoutProps {
  return isUIHost(n) ? n.layout.values : (styles.get(n)?.values ?? EMPTY);
}

/** Marks the layout of the container(s) holding `n` dirty; they re-layout before the next render. */
export function markUILayoutDirty(n: Node | null | undefined): void {
  let h: Node | null = isUIHost(n) ? n : (n?.parent ?? null);
  while (isUIHost(h)) {
    h.layoutDirty = true;
    h = h.parent;
  }
}

// ---------------------------------------------------------------- per-node bookkeeping

interface ItemState {
  /** Size after the last layout (used to detect outside changes). */
  w: number;
  h: number;
  /** Intrinsic size of leaves (Sprite/Box/Node), captured before layout resized them. */
  iw: number;
  ih: number;
  visible: boolean;
}

const states = new WeakMap<Node, ItemState>();

function state(n: Node): ItemState {
  let s = states.get(n);
  if (!s) {
    s = { w: n.width, h: n.height, iw: n.width, ih: n.height, visible: n.visible };
    states.set(n, s);
  }
  return s;
}

function intrinsic(n: Node): Size {
  const s = state(n);
  if (n.width !== s.w || n.height !== s.h) {
    s.iw = s.w = n.width;
    s.ih = s.h = n.height;
  }
  return { w: s.iw, h: s.ih };
}

let cache: Map<Node, { k: number[]; r: Size }[]> | null = null;
let passDepth = 0;

function beginPass(): void {
  if (passDepth++ === 0) cache = new Map();
}

function endPass(): void {
  if (--passDepth === 0) cache = null;
}

// ---------------------------------------------------------------- helpers

function res(v: UISize | UIOffset | undefined, base: number): number {
  if (v === undefined || v === 'auto') return NaN;
  if (typeof v === 'number') return v;
  const n = parseFloat(v);
  return isNaN(base) || !isFinite(base) ? NaN : (n / 100) * base;
}

/** Resolves padding/margin to [top, right, bottom, left]. */
export function uiEdges(v: UISpacing | undefined): [number, number, number, number] {
  if (v === undefined) return [0, 0, 0, 0];
  if (!Array.isArray(v)) {
    const s = uiSpace(v);
    return [s, s, s, s];
  }
  if (v.length === 2) {
    const a = uiSpace(v[0]);
    const b = uiSpace(v[1]);
    return [a, b, a, b];
  }
  return [uiSpace(v[0]), uiSpace(v[1]), uiSpace(v[2]), uiSpace(v[3])];
}

function padOf(n: Node): [number, number, number, number] {
  return isUIHost(n) ? uiEdges(n.layout.values.padding) : [0, 0, 0, 0];
}

const same = (a: number, b: number) => a === b || (isNaN(a) && isNaN(b));

function positionOf(n: Node): UIPosition {
  return props(n).position ?? 'flow';
}

// ---------------------------------------------------------------- measuring

/**
 * Preferred size of `n` (margins excluded) within the available space. `base*` are percentage bases (NaN when
 * indefinite); `force*` override the node's own width/height (used for stretch and flexed sizes).
 */
export function measureUINode(
  n: Node,
  availW: number,
  availH: number,
  baseW = NaN,
  baseH = NaN,
  forceW = NaN,
  forceH = NaN,
): Size {
  if (!cache) return measureRaw(n, availW, availH, baseW, baseH, forceW, forceH);
  const k = [availW, availH, baseW, baseH, forceW, forceH];
  let list = cache.get(n);
  if (list) {
    for (const e of list) {
      let ok = true;
      for (let i = 0; i < 6; i++) if (!same(e.k[i]!, k[i]!)) ok = false;
      if (ok) return e.r;
    }
  } else cache.set(n, (list = []));
  const r = measureRaw(n, availW, availH, baseW, baseH, forceW, forceH);
  list.push({ k, r });
  return r;
}

function measureRaw(n: Node, availW: number, availH: number, baseW: number, baseH: number, forceW: number, forceH: number): Size {
  const p = props(n);
  const minW = p.minWidth ?? 0;
  const maxW = p.maxWidth ?? Infinity;
  const minH = p.minHeight ?? 0;
  const maxH = p.maxHeight ?? Infinity;
  let w = isNaN(forceW) ? res(p.width, baseW) : forceW;
  let h = isNaN(forceH) ? res(p.height, baseH) : forceH;
  const ar = p.aspectRatio && p.aspectRatio > 0 ? p.aspectRatio : 0;
  if (ar) {
    if (!isNaN(w) && isNaN(h)) h = w / ar;
    else if (isNaN(w) && !isNaN(h)) w = h * ar;
  }
  if (!isNaN(w)) w = clamp(w, minW, Math.max(minW, maxW));
  if (!isNaN(h)) h = clamp(h, minH, Math.max(minH, maxH));
  if (!isNaN(w) && !isNaN(h)) return { w, h };
  const fixedW = !isNaN(w);
  const fixedH = !isNaN(h);
  const aw = fixedW ? w : Math.max(0, Math.min(availW, maxW));
  const ah = fixedH ? h : Math.max(0, Math.min(availH, maxH));
  let c = contentSize(n, aw, ah, fixedW, fixedH);
  const rw = fixedW ? w : clamp(c.w, minW, Math.max(minW, maxW));
  let rh: number;
  if (fixedH) rh = h;
  else {
    if (ar) rh = rw / ar;
    else {
      if (!fixedW && Math.abs(rw - c.w) > 0.01) c = contentSize(n, rw, ah, true, false);
      rh = c.h;
    }
    rh = clamp(rh, minH, Math.max(minH, maxH));
  }
  return { w: rw, h: rh };
}

function contentSize(n: Node, aw: number, ah: number, fixedW: boolean, fixedH: boolean): Size {
  if (isUIHost(n)) {
    const [t, r, b, l] = padOf(n);
    const c = n.measureContent(Math.max(0, aw - l - r), Math.max(0, ah - t - b), fixedW, fixedH);
    return { w: c.w + l + r, h: c.h + t + b };
  }
  if (n instanceof Text) {
    if (fixedW) return { w: aw, h: n.measureWrapped(aw).height };
    const nat = n.measureNatural();
    if (nat.width <= aw + 0.5) return { w: nat.width, h: nat.height };
    return { w: aw, h: n.measureWrapped(aw).height };
  }
  const s = intrinsic(n);
  if (n instanceof Sprite) {
    if (fixedW && !fixedH && s.w > 0) return { w: aw, h: (aw * s.h) / s.w };
    if (fixedH && !fixedW && s.h > 0) return { w: (ah * s.w) / s.h, h: ah };
  }
  return { w: fixedW ? aw : s.w, h: fixedH ? ah : s.h };
}

/** Narrowest width of `n` (margins excluded) before its content overflows. */
export function minContentWidthOf(n: Node, baseW = NaN): number {
  const p = props(n);
  const lo = p.minWidth ?? 0;
  const hi = Math.max(lo, p.maxWidth ?? Infinity);
  const ew = res(p.width, baseW);
  if (!isNaN(ew)) return clamp(ew, lo, hi);
  let m: number;
  if (isUIHost(n)) {
    const [, r, , l] = padOf(n);
    m = n.minContentWidth() + l + r;
  } else if (n instanceof Text) m = n.minContentWidth();
  else m = intrinsic(n).w;
  return clamp(m, lo, hi);
}

/** Default minContentWidth of a flex container (padding excluded). */
export function flexMinContentWidth(host: UILayoutHost): number {
  if (host.clip) return 0;
  const p = host.layout.values;
  const dir = p.direction ?? 'column';
  let sum = 0;
  let max = 0;
  let count = 0;
  for (const c of host.children) {
    if (!c.visible || positionOf(c) !== 'flow') continue;
    const [, mr, , ml] = uiEdges(props(c).margin);
    const v = minContentWidthOf(c) + ml + mr;
    sum += v;
    max = Math.max(max, v);
    count++;
  }
  if (dir === 'row' && !p.wrap) return sum + uiSpace(p.gap) * Math.max(0, count - 1);
  return max;
}

// ---------------------------------------------------------------- flex

interface FlexItem {
  n: Node;
  mMain: number;
  mCross: number;
  mMainStart: number;
  mCrossStart: number;
  basis: number;
  min: number;
  max: number;
  hypo: number;
  main: number;
  cross: number;
  crossFix: number;
  minCross: number;
  maxCross: number;
  stretch: boolean;
  align: UIAlign;
  grow: number;
  shrink: number;
  frozen: boolean;
  viol: number;
}

function resolveFlexible(line: FlexItem[], space: number): void {
  let sumHypo = 0;
  for (const it of line) sumHypo += it.hypo + it.mMain;
  const growing = sumHypo < space;
  for (const it of line) {
    it.main = it.hypo;
    it.frozen = (growing ? it.grow : it.shrink) <= 0 || (growing ? it.basis > it.hypo : it.basis < it.hypo);
  }
  if (Math.abs(space - sumHypo) < 0.01) return;
  for (let guard = 0; guard <= line.length; guard++) {
    let free = space;
    let total = 0;
    for (const it of line) {
      free -= it.mMain + (it.frozen ? it.main : it.basis);
      if (!it.frozen) total += growing ? it.grow : it.shrink * it.basis;
    }
    let any = false;
    let violation = 0;
    for (const it of line) {
      if (it.frozen) continue;
      any = true;
      const f = growing ? it.grow : it.shrink * it.basis;
      const target = total > 0 ? it.basis + free * (f / total) : it.basis;
      const c = clamp(target, it.min, Math.max(it.min, it.max));
      it.main = c;
      it.viol = c - target;
      violation += it.viol;
    }
    if (!any || Math.abs(violation) < 0.01) break;
    for (const it of line) if (!it.frozen && (violation > 0 ? it.viol > 0 : it.viol < 0)) it.frozen = true;
  }
}

/**
 * Flexbox (subset) over the host's in-flow children. Returns the content size (padding excluded).
 * With `commit` the children are sized and positioned (inner size must then be final).
 */
export function flexLayout(host: UILayoutHost, innerW: number, innerH: number, fixedW: boolean, fixedH: boolean, commit: boolean): Size {
  const p = host.layout.values;
  const dir = p.direction ?? 'column';
  if (dir === 'stack') return stackLayout(host, innerW, innerH, fixedW, fixedH, commit);
  const row = dir === 'row';
  const gap = uiSpace(p.gap);
  const crossGap = p.crossGap !== undefined ? uiSpace(p.crossGap) : gap;
  const alignItems = p.align ?? 'stretch';
  const wrap = !!p.wrap;
  const mainAvail = row ? innerW : innerH;
  const mainFixed = row ? fixedW : fixedH;
  const crossAvail = row ? innerH : innerW;
  const crossFixed = row ? fixedH : fixedW;
  const baseW = fixedW ? innerW : NaN;
  const baseH = fixedH ? innerH : NaN;

  const items: FlexItem[] = [];
  for (const n of host.children) {
    if (!n.visible) continue;
    const ip = props(n);
    if ((ip.position ?? 'flow') !== 'flow') continue;
    const [mt, mr, mb, ml] = uiEdges(ip.margin);
    const mMain = row ? ml + mr : mt + mb;
    const mCross = row ? mt + mb : ml + mr;
    let align: UIAlign = ip.alignSelf && ip.alignSelf !== 'auto' ? ip.alignSelf : alignItems;
    const minCross = (row ? ip.minHeight : ip.minWidth) ?? 0;
    const maxCross = (row ? ip.maxHeight : ip.maxWidth) ?? Infinity;
    const explicitCross = res(row ? ip.height : ip.width, row ? baseH : baseW);
    const stretchable = isUIHost(n) || (n instanceof Text && !row);
    const stretch = align === 'stretch' && isNaN(explicitCross) && stretchable && !ip.aspectRatio;
    if (align === 'stretch' && !stretch) align = 'start';
    let crossFix = NaN;
    if (!isNaN(explicitCross)) crossFix = clamp(explicitCross, minCross, Math.max(minCross, maxCross));
    else if (stretch && crossFixed && !wrap) crossFix = clamp(Math.max(0, crossAvail - mCross), minCross, Math.max(minCross, maxCross));
    const crossRoom = Math.max(0, crossAvail - mCross);

    const explicitMain = res(row ? ip.width : ip.height, row ? baseW : baseH);
    const basisProp = res(ip.basis, mainFixed ? mainAvail : NaN);
    const measureMain = () =>
      row
        ? measureUINode(n, Infinity, crossRoom, baseW, baseH, NaN, crossFix).w
        : measureUINode(n, crossRoom, Infinity, baseW, baseH, crossFix, NaN).h;
    let basis: number;
    let contentMain = NaN;
    if (!isNaN(basisProp)) basis = basisProp;
    else {
      basis = measureMain();
      if (isNaN(explicitMain)) contentMain = basis;
    }
    const minProp = row ? ip.minWidth : ip.minHeight;
    const max = (row ? ip.maxWidth : ip.maxHeight) ?? Infinity;
    let min: number;
    if (minProp !== undefined) min = minProp;
    else if (n.clip) min = 0;
    else if (row) min = isNaN(explicitMain) ? minContentWidthOf(n, baseW) : Math.min(minContentWidthOf(n, baseW), explicitMain);
    else if (!isNaN(explicitMain)) min = explicitMain;
    else if (isUIHost(n)) min = measureUINode(n, crossRoom, 0, baseW, baseH, crossFix, NaN).h;
    else min = isNaN(contentMain) ? measureMain() : contentMain;
    items.push({
      n,
      mMain,
      mCross,
      mMainStart: row ? ml : mt,
      mCrossStart: row ? mt : ml,
      basis,
      min,
      max,
      hypo: clamp(basis, min, Math.max(min, max)),
      main: 0,
      cross: 0,
      crossFix,
      minCross,
      maxCross,
      stretch,
      align,
      grow: ip.grow ?? 0,
      shrink: ip.shrink ?? 1,
      frozen: false,
      viol: 0,
    });
  }

  const lines: FlexItem[][] = [];
  if (wrap && isFinite(mainAvail)) {
    let cur: FlexItem[] = [];
    let used = 0;
    for (const it of items) {
      const outer = it.hypo + it.mMain;
      if (cur.length > 0 && used + gap + outer > mainAvail + 0.01) {
        lines.push(cur);
        cur = [];
        used = 0;
      }
      used += (cur.length ? gap : 0) + outer;
      cur.push(it);
    }
    if (cur.length) lines.push(cur);
  } else lines.push(items);

  for (const line of lines) {
    const gaps = gap * Math.max(0, line.length - 1);
    let sum = gaps;
    for (const it of line) sum += it.hypo + it.mMain;
    let lineMain = mainFixed ? mainAvail : Math.min(sum, mainAvail);
    if (!isFinite(lineMain)) lineMain = sum;
    resolveFlexible(line, lineMain - gaps);
  }

  const crossRoomAll = Math.max(0, crossAvail);
  const lineCross: number[] = [];
  for (const line of lines) {
    let lc = 0;
    for (const it of line) {
      if (!isNaN(it.crossFix)) it.cross = it.crossFix;
      else {
        const room = Math.max(0, crossRoomAll - it.mCross);
        const s = row
          ? measureUINode(it.n, it.main, room, baseW, baseH, it.main, NaN)
          : measureUINode(it.n, room, it.main, baseW, baseH, NaN, it.main);
        it.cross = row ? s.h : s.w;
      }
      lc = Math.max(lc, it.cross + it.mCross);
    }
    if (lines.length === 1 && crossFixed) lc = crossAvail;
    for (const it of line) {
      if (it.stretch && isNaN(it.crossFix)) it.cross = clamp(lc - it.mCross, it.minCross, Math.max(it.minCross, it.maxCross));
    }
    lineCross.push(lc);
  }

  let contentMain = 0;
  let contentCross = 0;
  lines.forEach((line, i) => {
    let used = gap * Math.max(0, line.length - 1);
    for (const it of line) used += it.main + it.mMain;
    contentMain = Math.max(contentMain, used);
    contentCross += lineCross[i]! + (i > 0 ? crossGap : 0);
  });
  const size = row ? { w: contentMain, h: contentCross } : { w: contentCross, h: contentMain };
  if (!commit) return size;

  const [pt, , , pl] = padOf(host);
  const mainStart = row ? pl : pt;
  const crossStart = row ? pt : pl;
  const justify = p.justify ?? 'start';
  let crossPos = 0;
  lines.forEach((line, li) => {
    const lc = lineCross[li]!;
    let used = gap * Math.max(0, line.length - 1);
    for (const it of line) used += it.main + it.mMain;
    const free = mainAvail - used;
    const count = line.length;
    let lead = 0;
    let between = 0;
    if (justify === 'center') lead = free / 2;
    else if (justify === 'end') lead = free;
    else if (free > 0) {
      if (justify === 'between' && count > 1) between = free / (count - 1);
      else if (justify === 'around') {
        between = free / count;
        lead = between / 2;
      } else if (justify === 'evenly') {
        between = free / (count + 1);
        lead = between;
      }
    }
    let pos = lead;
    for (const it of line) {
      pos += it.mMainStart;
      const outerCross = it.cross + it.mCross;
      const off = it.align === 'center' ? (lc - outerCross) / 2 : it.align === 'end' ? lc - outerCross : 0;
      const c = crossPos + off + it.mCrossStart;
      if (row) placeUINode(it.n, mainStart + pos, crossStart + c, it.main, it.cross);
      else placeUINode(it.n, crossStart + c, mainStart + pos, it.cross, it.main);
      pos += it.main + (it.mMain - it.mMainStart) + gap + between;
    }
    crossPos += lc + crossGap;
  });
  return size;
}

function stackLayout(host: UILayoutHost, innerW: number, innerH: number, fixedW: boolean, fixedH: boolean, commit: boolean): Size {
  const p = host.layout.values;
  const alignItems = p.align ?? 'center';
  const baseW = fixedW ? innerW : NaN;
  const baseH = fixedH ? innerH : NaN;
  let cw = 0;
  let ch = 0;
  const items: { n: Node; s: Size; m: [number, number, number, number]; align: UIAlign }[] = [];
  for (const n of host.children) {
    if (!n.visible || positionOf(n) !== 'flow') continue;
    const ip = props(n);
    const m = uiEdges(ip.margin);
    const align = ip.alignSelf && ip.alignSelf !== 'auto' ? ip.alignSelf : alignItems;
    const stretch = align === 'stretch';
    const roomW = Math.max(0, innerW - m[1] - m[3]);
    const roomH = Math.max(0, innerH - m[0] - m[2]);
    const sw = stretch && fixedW && (isUIHost(n) || n instanceof Text) && isNaN(res(ip.width, baseW)) ? roomW : NaN;
    const sh = stretch && fixedH && isUIHost(n) && isNaN(res(ip.height, baseH)) ? roomH : NaN;
    const s = measureUINode(n, roomW, roomH, baseW, baseH, sw, sh);
    cw = Math.max(cw, s.w + m[1] + m[3]);
    ch = Math.max(ch, s.h + m[0] + m[2]);
    items.push({ n, s, m, align });
  }
  if (commit) {
    const [pt, , , pl] = padOf(host);
    for (const it of items) {
      const freeW = innerW - it.s.w - it.m[1] - it.m[3];
      const freeH = innerH - it.s.h - it.m[0] - it.m[2];
      const k = it.align === 'center' ? 0.5 : it.align === 'end' ? 1 : 0;
      placeUINode(it.n, pl + it.m[3] + freeW * k, pt + it.m[0] + freeH * k, it.s.w, it.s.h);
    }
  }
  return { w: cw, h: ch };
}

// ---------------------------------------------------------------- committing

/** Gives `n` its final size (recursing into containers) and puts its box's top-left at (x, y) in parent space. */
export function placeUINode(n: Node, x: number, y: number, w: number, h: number): void {
  layoutUINode(n, w, h);
  n.x = x + n.anchorX * n.width;
  n.y = y + n.anchorY * n.height;
}

/** Applies a final size to `n`: containers arrange their children, Text wraps to the width, leaves are resized. */
export function layoutUINode(n: Node, w: number, h: number): void {
  if (isUIHost(n)) {
    n.width = w;
    n.height = h;
    const [t, r, b, l] = padOf(n);
    n.arrangeContent(Math.max(0, w - l - r), Math.max(0, h - t - b));
    n.layoutDirty = false;
    for (const c of n.children) {
      const s = state(c);
      s.visible = c.visible;
      if (!isUIHost(c)) {
        intrinsic(c);
        s.w = c.width;
        s.h = c.height;
      }
    }
    n.onLayout();
  } else if (n instanceof Text) {
    const nat = n.measureNatural();
    const want = Math.abs(w - nat.width) > 0.5 ? Math.max(1, w) : 0;
    if (n.style.wrapWidth !== want) n.setStyle({ wrapWidth: want });
  } else {
    intrinsic(n);
    n.width = w;
    n.height = h;
  }
  const s = state(n);
  s.w = n.width;
  s.h = n.height;
  s.visible = n.visible;
}

/** Default arrangeContent: flex children, then absolute and manual children. */
export function flexArrange(host: UILayoutHost, innerW: number, innerH: number): void {
  flexLayout(host, innerW, innerH, true, true, true);
  arrangeOutOfFlow(host);
}

/** Places the host's absolute children (relative to its full box) and sizes its manual container children. */
export function arrangeOutOfFlow(host: UILayoutHost): void {
  for (const n of host.children) {
    if (!n.visible) continue;
    const pos = positionOf(n);
    if (pos === 'absolute') placeAbsolute(n, host.width, host.height);
    else if (pos === 'manual' && isUIHost(n)) {
      const s = measureUINode(n, host.width, host.height, host.width, host.height);
      layoutUINode(n, s.w, s.h);
    }
  }
}

function placeAbsolute(n: Node, W: number, H: number): void {
  const ip = props(n);
  const l = res(ip.left ?? ip.inset, W);
  const r = res(ip.right ?? ip.inset, W);
  const t = res(ip.top ?? ip.inset, H);
  const b = res(ip.bottom ?? ip.inset, H);
  const Wa = isNaN(W) ? Infinity : W;
  const Ha = isNaN(H) ? Infinity : H;
  const fw = isNaN(res(ip.width, W)) && !isNaN(l) && !isNaN(r) && isFinite(Wa) ? Math.max(0, Wa - l - r) : NaN;
  const fh = isNaN(res(ip.height, H)) && !isNaN(t) && !isNaN(b) && isFinite(Ha) ? Math.max(0, Ha - t - b) : NaN;
  const s = measureUINode(n, Math.max(0, Wa - (l || 0) - (r || 0)), Math.max(0, Ha - (t || 0) - (b || 0)), W, H, fw, fh);
  const cx = ip.center === true || ip.center === 'x';
  const cy = ip.center === true || ip.center === 'y';
  let x = !isNaN(l) ? l : !isNaN(r) ? Wa - r - s.w : cx ? (Wa - s.w) / 2 : 0;
  let y = !isNaN(t) ? t : !isNaN(b) ? Ha - b - s.h : cy ? (Ha - s.h) / 2 : 0;
  if (!isFinite(x)) x = 0;
  if (!isFinite(y)) y = 0;
  placeUINode(n, x, y, s.w, s.h);
}

// ---------------------------------------------------------------- roots

const rootParentSize = new WeakMap<Node, [number, number]>();

function parentSize(root: Node): [number, number] {
  const p = root.parent;
  return [p && p.width > 0 ? p.width : NaN, p && p.height > 0 ? p.height : NaN];
}

function subtreeChanged(host: Node): boolean {
  for (const n of host.children) {
    const s = states.get(n);
    if (!s || n.visible !== s.visible) return true;
    if (!n.visible) continue;
    const sync = (n as { uiSync?: () => boolean }).uiSync;
    if (typeof sync === 'function' && sync.call(n)) return true;
    if (isUIHost(n)) {
      if (n.layoutDirty || subtreeChanged(n)) return true;
    } else if (positionOf(n) !== 'manual' && (n.width !== s.w || n.height !== s.h)) return true;
  }
  return false;
}

/** True when a layout root must be re-laid out (dirty flags, parent resize, child size/visibility changes). */
export function uiLayoutNeeded(root: UILayoutHost): boolean {
  if (root.layoutDirty) return true;
  const last = rootParentSize.get(root);
  const [pw, ph] = parentSize(root);
  if (!last || !same(last[0], pw) || !same(last[1], ph)) return true;
  const sync = (root as { uiSync?: () => boolean }).uiSync;
  if (typeof sync === 'function' && sync.call(root)) return true;
  return subtreeChanged(root);
}

/**
 * Lays out a root container (a UI container whose parent is not one). Size: its width/height (percentages of the
 * parent), or its content. Absolute roots are also positioned inside the parent; others keep their x/y.
 */
export function layoutUIRoot(root: UILayoutHost): void {
  const [pw, ph] = parentSize(root);
  beginPass();
  try {
    if (positionOf(root) === 'absolute') placeAbsolute(root, pw, ph);
    else {
      const s = measureUINode(root, isNaN(pw) ? Infinity : pw, isNaN(ph) ? Infinity : ph, pw, ph);
      layoutUINode(root, s.w, s.h);
    }
  } finally {
    endPass();
  }
  rootParentSize.set(root, [pw, ph]);
}

/**
 * Runs any pending layout in the tree containing `node` (normally done automatically before each render).
 * Call it after changing UI in code when you need fresh positions immediately (tests, inspectUI, lintUI).
 */
export function flushUILayout(node: Node): void {
  let top: Node = node;
  while (isUIHost(top) && isUIHost(top.parent)) top = top.parent;
  const visit = (n: Node) => {
    if (isUIHost(n) && !isUIHost(n.parent) && uiLayoutNeeded(n)) layoutUIRoot(n);
    for (const c of n.children.slice()) visit(c);
  };
  visit(top);
}
