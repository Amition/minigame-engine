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
  /** Pass whose measurements start at arena entry `mh` (0 = none). */
  mp: number;
  mh: number;
  /** Pass of the last layoutUINode() (0 = outside a pass). */
  lp: number;
  /** Change watch list while this node is a layout root. */
  watch: RootWatch | null;
  /** Text only: what its last pass asked and got. */
  text: TextRecord | null;
}

/**
 * Everything the measurements of a Text in one pass read from its content, kept after the pass: a new text that
 * reads the same gives the same measurements, so Label can apply it in place.
 */
interface TextRecord {
  pass: number;
  /** measureNatural() size (NaN = not read). */
  natW: number;
  natH: number;
  /** measureWrapped(width).height reads as [width, height] pairs. */
  wraps: number[];
  wn: number;
  /** minContentWidth() (NaN = not read). */
  mcw: number;
  /** Width given by layoutUINode() in the pass. */
  lw: number;
}

const states = new WeakMap<Node, ItemState>();

function state(n: Node): ItemState {
  let s = states.get(n);
  if (!s) {
    s = { w: n.width, h: n.height, iw: n.width, ih: n.height, visible: n.visible, mp: 0, mh: -1, lp: 0, watch: null, text: null };
    states.set(n, s);
  }
  return s;
}

/** State with `iw`/`ih` refreshed when the leaf was resized from outside since the last layout. */
function intrinsic(n: Node): ItemState {
  const s = state(n);
  if (n.width !== s.w || n.height !== s.h) {
    s.iw = s.w = n.width;
    s.ih = s.h = n.height;
  }
  return s;
}

/** Id of the running layout pass (0 = none): measurements are cached per node within a pass. */
let passId = 0;
let passSeq = 0;
let passDepth = 0;

/**
 * Measurement cache of the running pass: entry e has 6 keys at `arenaKeys[e * 6]`, its result and the index of the
 * same node's previous entry (-1 = none). The number arrays are reused by later passes (up to ARENA_KEEP entries).
 */
const arenaKeys: number[] = [];
const arenaRes: Size[] = [];
const arenaNext: number[] = [];
let arenaTop = 0;
const ARENA_KEEP = 1024;

function beginPass(): void {
  if (passDepth++ === 0) {
    passId = ++passSeq;
    arenaTop = 0;
  }
}

function endPass(): void {
  if (--passDepth > 0) return;
  passId = 0;
  arenaRes.length = 0;
  if (arenaTop > ARENA_KEEP) {
    arenaKeys.length = 0;
    arenaNext.length = 0;
  }
  arenaTop = 0;
}

/** Starts the node's measurements for the running pass. */
function claimMeasures(n: Node, s: ItemState): void {
  if (s.mp === passId) return;
  s.mp = passId;
  s.mh = -1;
  if (n instanceof Text) {
    const t = (s.text ??= { pass: 0, natW: NaN, natH: NaN, wraps: [0, 0], wn: 0, mcw: NaN, lw: 0 });
    t.pass = passId;
    t.natW = t.natH = NaN;
    t.wn = 0;
    t.mcw = NaN;
  }
}

// ---------------------------------------------------------------- helpers

function res(v: UISize | UIOffset | undefined, base: number): number {
  if (v === undefined || v === 'auto') return NaN;
  if (typeof v === 'number') return v;
  const n = parseFloat(v);
  return isNaN(base) || !isFinite(base) ? NaN : (n / 100) * base;
}

/** Writes padding/margin as [top, right, bottom, left] into `out`. */
function edgesInto(v: UISpacing | undefined, out: number[]): number[] {
  if (v === undefined) {
    out[0] = out[1] = out[2] = out[3] = 0;
  } else if (!Array.isArray(v)) {
    out[0] = out[1] = out[2] = out[3] = uiSpace(v);
  } else if (v.length === 2) {
    out[0] = out[2] = uiSpace(v[0]);
    out[1] = out[3] = uiSpace(v[1]);
  } else {
    out[0] = uiSpace(v[0]);
    out[1] = uiSpace(v[1]);
    out[2] = uiSpace(v[2]);
    out[3] = uiSpace(v[3]);
  }
  return out;
}

/** Scratch edges: read the four values right away, before anything that may lay out again. */
const E: number[] = [0, 0, 0, 0];

/** Resolves padding/margin to [top, right, bottom, left]. */
export function uiEdges(v: UISpacing | undefined): [number, number, number, number] {
  return edgesInto(v, [0, 0, 0, 0]) as [number, number, number, number];
}

function padInto(n: Node, out: number[]): number[] {
  if (isUIHost(n)) return edgesInto(n.layout.values.padding, out);
  out[0] = out[1] = out[2] = out[3] = 0;
  return out;
}

const same = (a: number, b: number) => a === b || (a !== a && b !== b);

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
  if (passId === 0) return measureRaw(n, availW, availH, baseW, baseH, forceW, forceH);
  const s = state(n);
  claimMeasures(n, s);
  const k = arenaKeys;
  for (let e = s.mh; e >= 0; e = arenaNext[e]!) {
    const o = e * 6;
    if (
      same(k[o]!, availW) &&
      same(k[o + 1]!, availH) &&
      same(k[o + 2]!, baseW) &&
      same(k[o + 3]!, baseH) &&
      same(k[o + 4]!, forceW) &&
      same(k[o + 5]!, forceH)
    ) {
      return arenaRes[e]!;
    }
  }
  const r = measureRaw(n, availW, availH, baseW, baseH, forceW, forceH, s.text);
  const e = arenaTop++;
  const o = e * 6;
  k[o] = availW;
  k[o + 1] = availH;
  k[o + 2] = baseW;
  k[o + 3] = baseH;
  k[o + 4] = forceW;
  k[o + 5] = forceH;
  arenaRes[e] = r;
  arenaNext[e] = s.mh;
  s.mh = e;
  return r;
}

function measureRaw(
  n: Node,
  availW: number,
  availH: number,
  baseW: number,
  baseH: number,
  forceW: number,
  forceH: number,
  rec: TextRecord | null = null,
): Size {
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
  let c = contentSize(n, aw, ah, fixedW, fixedH, rec);
  const rw = fixedW ? w : clamp(c.w, minW, Math.max(minW, maxW));
  let rh: number;
  if (fixedH) rh = h;
  else {
    if (ar) rh = rw / ar;
    else {
      if (!fixedW && Math.abs(rw - c.w) > 0.01) c = contentSize(n, rw, ah, true, false, rec);
      rh = c.h;
    }
    rh = clamp(rh, minH, Math.max(minH, maxH));
  }
  return { w: rw, h: rh };
}

/** Text height when wrapped at `w`, noted in `rec`. */
function wrappedHeight(n: Text, w: number, rec: TextRecord | null): number {
  const h = n.measureWrapped(w).height;
  if (rec) {
    const ws = rec.wraps;
    for (let i = 0; i < rec.wn; i++) if (ws[i * 2] === w) return h;
    ws[rec.wn * 2] = w;
    ws[rec.wn * 2 + 1] = h;
    rec.wn++;
  }
  return h;
}

function contentSize(n: Node, aw: number, ah: number, fixedW: boolean, fixedH: boolean, rec: TextRecord | null): Size {
  if (isUIHost(n)) {
    const pd = padInto(n, E);
    const t = pd[0]!;
    const r = pd[1]!;
    const b = pd[2]!;
    const l = pd[3]!;
    const c = n.measureContent(Math.max(0, aw - l - r), Math.max(0, ah - t - b), fixedW, fixedH);
    return { w: c.w + l + r, h: c.h + t + b };
  }
  if (n instanceof Text) {
    if (fixedW) return { w: aw, h: wrappedHeight(n, aw, rec) };
    const nat = n.measureNatural();
    if (rec) {
      rec.natW = nat.width;
      rec.natH = nat.height;
    }
    if (nat.width <= aw + 0.5) return { w: nat.width, h: nat.height };
    return { w: aw, h: wrappedHeight(n, aw, rec) };
  }
  const s = intrinsic(n);
  if (n instanceof Sprite) {
    if (fixedW && !fixedH && s.iw > 0) return { w: aw, h: (aw * s.ih) / s.iw };
    if (fixedH && !fixedW && s.ih > 0) return { w: (ah * s.iw) / s.ih, h: ah };
  }
  return { w: fixedW ? aw : s.iw, h: fixedH ? ah : s.ih };
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
    const pd = padInto(n, E);
    const r = pd[1]!;
    const l = pd[3]!;
    m = n.minContentWidth() + l + r;
  } else if (n instanceof Text) {
    m = n.minContentWidth();
    if (passId !== 0) {
      const s = state(n);
      claimMeasures(n, s);
      s.text!.mcw = m;
    }
  } else m = intrinsic(n).iw;
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
  const kids = host.children;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]!;
    if (!c.visible || positionOf(c) !== 'flow') continue;
    const m = edgesInto(props(c).margin, E);
    const mr = m[1]!;
    const ml = m[3]!;
    const v = minContentWidthOf(c) + ml + mr;
    sum += v;
    max = Math.max(max, v);
    count++;
  }
  if (dir === 'row' && !p.wrap) return sum + uiSpace(p.gap) * Math.max(0, count - 1);
  return max;
}

// ---------------------------------------------------------------- flex

/** Per-child working data of flexLayout / stackLayout, taken from a pool that nested layouts share as a stack. */
interface FlexItem {
  n: Node | null;
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
  /** stackLayout: measured size and margins. */
  sw: number;
  sh: number;
  mt: number;
  mr: number;
  mb: number;
  ml: number;
}

const pool: FlexItem[] = [];
let poolTop = 0;

function takeItem(n: Node): FlexItem {
  let it = pool[poolTop];
  if (it === undefined) {
    it = {
      n: null, mMain: 0, mCross: 0, mMainStart: 0, mCrossStart: 0, basis: 0, min: 0, max: 0, hypo: 0, main: 0, cross: 0,
      crossFix: NaN, minCross: 0, maxCross: 0, stretch: false, align: 'start', grow: 0, shrink: 1, frozen: false, viol: 0,
      sw: 0, sh: 0, mt: 0, mr: 0, mb: 0, ml: 0,
    };
    pool[poolTop] = it;
  }
  poolTop++;
  it.n = n;
  return it;
}

function releaseItems(from: number): void {
  for (let i = from; i < poolTop; i++) pool[i]!.n = null;
  poolTop = from;
}

/** Flex lines as a stack shared by nested layouts: [first item, end item, cross size] per line. */
const lineBuf: number[] = [];
let lineTop = 0;

function pushLine(a: number, b: number): void {
  lineBuf[lineTop++] = a;
  lineBuf[lineTop++] = b;
  lineBuf[lineTop++] = 0;
}

function resolveFlexible(a: number, b: number, space: number): void {
  let sumHypo = 0;
  for (let i = a; i < b; i++) sumHypo += pool[i]!.hypo + pool[i]!.mMain;
  const growing = sumHypo < space;
  for (let i = a; i < b; i++) {
    const it = pool[i]!;
    it.main = it.hypo;
    it.frozen = (growing ? it.grow : it.shrink) <= 0 || (growing ? it.basis > it.hypo : it.basis < it.hypo);
  }
  if (Math.abs(space - sumHypo) < 0.01) return;
  for (let guard = 0; guard <= b - a; guard++) {
    let free = space;
    let total = 0;
    for (let i = a; i < b; i++) {
      const it = pool[i]!;
      free -= it.mMain + (it.frozen ? it.main : it.basis);
      if (!it.frozen) total += growing ? it.grow : it.shrink * it.basis;
    }
    let any = false;
    let violation = 0;
    for (let i = a; i < b; i++) {
      const it = pool[i]!;
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
    for (let i = a; i < b; i++) {
      const it = pool[i]!;
      if (!it.frozen && (violation > 0 ? it.viol > 0 : it.viol < 0)) it.frozen = true;
    }
  }
}

function measureMain(n: Node, row: boolean, crossRoom: number, baseW: number, baseH: number, crossFix: number): number {
  return row
    ? measureUINode(n, Infinity, crossRoom, baseW, baseH, NaN, crossFix).w
    : measureUINode(n, crossRoom, Infinity, baseW, baseH, crossFix, NaN).h;
}

/**
 * Flexbox (subset) over the host's in-flow children. Returns the content size (padding excluded).
 * With `commit` the children are sized and positioned (inner size must then be final).
 */
export function flexLayout(host: UILayoutHost, innerW: number, innerH: number, fixedW: boolean, fixedH: boolean, commit: boolean): Size {
  const dir = host.layout.values.direction ?? 'column';
  if (dir === 'stack') return stackLayout(host, innerW, innerH, fixedW, fixedH, commit);
  const itemBase = poolTop;
  const lineBase = lineTop;
  try {
    return flexRun(host, dir === 'row', innerW, innerH, fixedW, fixedH, commit);
  } finally {
    releaseItems(itemBase);
    lineTop = lineBase;
  }
}

function flexRun(host: UILayoutHost, row: boolean, innerW: number, innerH: number, fixedW: boolean, fixedH: boolean, commit: boolean): Size {
  const p = host.layout.values;
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

  const itemBase = poolTop;
  const kids = host.children;
  for (let ci = 0; ci < kids.length; ci++) {
    const n = kids[ci]!;
    if (!n.visible) continue;
    const ip = props(n);
    if ((ip.position ?? 'flow') !== 'flow') continue;
    const m = edgesInto(ip.margin, E);
    const mt = m[0]!;
    const mr = m[1]!;
    const mb = m[2]!;
    const ml = m[3]!;
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
    let basis: number;
    let contentMain = NaN;
    if (!isNaN(basisProp)) basis = basisProp;
    else {
      basis = measureMain(n, row, crossRoom, baseW, baseH, crossFix);
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
    else min = isNaN(contentMain) ? measureMain(n, row, crossRoom, baseW, baseH, crossFix) : contentMain;
    const it = takeItem(n);
    it.mMain = mMain;
    it.mCross = mCross;
    it.mMainStart = row ? ml : mt;
    it.mCrossStart = row ? mt : ml;
    it.basis = basis;
    it.min = min;
    it.max = max;
    it.hypo = clamp(basis, min, Math.max(min, max));
    it.main = 0;
    it.cross = 0;
    it.crossFix = crossFix;
    it.minCross = minCross;
    it.maxCross = maxCross;
    it.stretch = stretch;
    it.align = align;
    it.grow = ip.grow ?? 0;
    it.shrink = ip.shrink ?? 1;
    it.frozen = false;
    it.viol = 0;
  }
  const itemEnd = poolTop;

  const lineBase = lineTop;
  if (wrap && isFinite(mainAvail)) {
    let start = itemBase;
    let used = 0;
    for (let i = itemBase; i < itemEnd; i++) {
      const it = pool[i]!;
      const outer = it.hypo + it.mMain;
      if (i > start && used + gap + outer > mainAvail + 0.01) {
        pushLine(start, i);
        start = i;
        used = 0;
      }
      used += (i > start ? gap : 0) + outer;
    }
    if (itemEnd > start) pushLine(start, itemEnd);
  } else pushLine(itemBase, itemEnd);
  const lineEnd = lineTop;
  const lineCount = (lineEnd - lineBase) / 3;

  for (let L = lineBase; L < lineEnd; L += 3) {
    const a = lineBuf[L]!;
    const b = lineBuf[L + 1]!;
    const gaps = gap * Math.max(0, b - a - 1);
    let sum = gaps;
    for (let i = a; i < b; i++) sum += pool[i]!.hypo + pool[i]!.mMain;
    let lineMain = mainFixed ? mainAvail : Math.min(sum, mainAvail);
    if (!isFinite(lineMain)) lineMain = sum;
    resolveFlexible(a, b, lineMain - gaps);
  }

  const crossRoomAll = Math.max(0, crossAvail);
  for (let L = lineBase; L < lineEnd; L += 3) {
    const a = lineBuf[L]!;
    const b = lineBuf[L + 1]!;
    let lc = 0;
    for (let i = a; i < b; i++) {
      const it = pool[i]!;
      if (!isNaN(it.crossFix)) it.cross = it.crossFix;
      else {
        const room = Math.max(0, crossRoomAll - it.mCross);
        const s = row
          ? measureUINode(it.n!, it.main, room, baseW, baseH, it.main, NaN)
          : measureUINode(it.n!, room, it.main, baseW, baseH, NaN, it.main);
        it.cross = row ? s.h : s.w;
      }
      lc = Math.max(lc, it.cross + it.mCross);
    }
    if (lineCount === 1 && crossFixed) lc = crossAvail;
    for (let i = a; i < b; i++) {
      const it = pool[i]!;
      if (it.stretch && isNaN(it.crossFix)) it.cross = clamp(lc - it.mCross, it.minCross, Math.max(it.minCross, it.maxCross));
    }
    lineBuf[L + 2] = lc;
  }

  let contentMain = 0;
  let contentCross = 0;
  for (let L = lineBase; L < lineEnd; L += 3) {
    const a = lineBuf[L]!;
    const b = lineBuf[L + 1]!;
    let used = gap * Math.max(0, b - a - 1);
    for (let i = a; i < b; i++) used += pool[i]!.main + pool[i]!.mMain;
    contentMain = Math.max(contentMain, used);
    contentCross += lineBuf[L + 2]! + (L > lineBase ? crossGap : 0);
  }
  const size = row ? { w: contentMain, h: contentCross } : { w: contentCross, h: contentMain };
  if (!commit) return size;

  const pd = padInto(host, E);
  const pt = pd[0]!;
  const pl = pd[3]!;
  const mainStart = row ? pl : pt;
  const crossStart = row ? pt : pl;
  const justify = p.justify ?? 'start';
  let crossPos = 0;
  for (let L = lineBase; L < lineEnd; L += 3) {
    const a = lineBuf[L]!;
    const b = lineBuf[L + 1]!;
    const lc = lineBuf[L + 2]!;
    let used = gap * Math.max(0, b - a - 1);
    for (let i = a; i < b; i++) used += pool[i]!.main + pool[i]!.mMain;
    const free = mainAvail - used;
    const count = b - a;
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
    for (let i = a; i < b; i++) {
      const it = pool[i]!;
      pos += it.mMainStart;
      const outerCross = it.cross + it.mCross;
      const off = it.align === 'center' ? (lc - outerCross) / 2 : it.align === 'end' ? lc - outerCross : 0;
      const c = crossPos + off + it.mCrossStart;
      if (row) placeUINode(it.n!, mainStart + pos, crossStart + c, it.main, it.cross);
      else placeUINode(it.n!, crossStart + c, mainStart + pos, it.cross, it.main);
      pos += it.main + (it.mMain - it.mMainStart) + gap + between;
    }
    crossPos += lc + crossGap;
  }
  return size;
}

function stackLayout(host: UILayoutHost, innerW: number, innerH: number, fixedW: boolean, fixedH: boolean, commit: boolean): Size {
  const itemBase = poolTop;
  try {
    return stackRun(host, innerW, innerH, fixedW, fixedH, commit);
  } finally {
    releaseItems(itemBase);
  }
}

function stackRun(host: UILayoutHost, innerW: number, innerH: number, fixedW: boolean, fixedH: boolean, commit: boolean): Size {
  const p = host.layout.values;
  const alignItems = p.align ?? 'center';
  const baseW = fixedW ? innerW : NaN;
  const baseH = fixedH ? innerH : NaN;
  let cw = 0;
  let ch = 0;
  const itemBase = poolTop;
  const kids = host.children;
  for (let ci = 0; ci < kids.length; ci++) {
    const n = kids[ci]!;
    if (!n.visible || positionOf(n) !== 'flow') continue;
    const ip = props(n);
    const m = edgesInto(ip.margin, E);
    const mt = m[0]!;
    const mr = m[1]!;
    const mb = m[2]!;
    const ml = m[3]!;
    const align = ip.alignSelf && ip.alignSelf !== 'auto' ? ip.alignSelf : alignItems;
    const stretch = align === 'stretch';
    const roomW = Math.max(0, innerW - mr - ml);
    const roomH = Math.max(0, innerH - mt - mb);
    const sw = stretch && fixedW && (isUIHost(n) || n instanceof Text) && isNaN(res(ip.width, baseW)) ? roomW : NaN;
    const sh = stretch && fixedH && isUIHost(n) && isNaN(res(ip.height, baseH)) ? roomH : NaN;
    const s = measureUINode(n, roomW, roomH, baseW, baseH, sw, sh);
    cw = Math.max(cw, s.w + mr + ml);
    ch = Math.max(ch, s.h + mt + mb);
    const it = takeItem(n);
    it.sw = s.w;
    it.sh = s.h;
    it.mt = mt;
    it.mr = mr;
    it.mb = mb;
    it.ml = ml;
    it.align = align;
  }
  if (commit) {
    const pd = padInto(host, E);
    const pt = pd[0]!;
    const pl = pd[3]!;
    const itemEnd = poolTop;
    for (let i = itemBase; i < itemEnd; i++) {
      const it = pool[i]!;
      const freeW = innerW - it.sw - it.mr - it.ml;
      const freeH = innerH - it.sh - it.mt - it.mb;
      const k = it.align === 'center' ? 0.5 : it.align === 'end' ? 1 : 0;
      placeUINode(it.n!, pl + it.ml + freeW * k, pt + it.mt + freeH * k, it.sw, it.sh);
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

/** Text: wrap at `w`, or not at all when its natural width already matches. */
function fitText(n: Text, w: number): void {
  const nat = n.measureNatural();
  const want = Math.abs(w - nat.width) > 0.5 ? Math.max(1, w) : 0;
  if (n.style.wrapWidth !== want) n.setStyle({ wrapWidth: want });
}

/** Applies a final size to `n`: containers arrange their children, Text wraps to the width, leaves are resized. */
export function layoutUINode(n: Node, w: number, h: number): void {
  if (isUIHost(n)) {
    n.width = w;
    n.height = h;
    const pd = padInto(n, E);
    const t = pd[0]!;
    const r = pd[1]!;
    const b = pd[2]!;
    const l = pd[3]!;
    n.arrangeContent(Math.max(0, w - l - r), Math.max(0, h - t - b));
    n.layoutDirty = false;
    const kids = n.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i]!;
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
    fitText(n, w);
  } else {
    intrinsic(n);
    n.width = w;
    n.height = h;
  }
  const s = state(n);
  s.w = n.width;
  s.h = n.height;
  s.visible = n.visible;
  s.lp = passId;
  if (s.text) s.text.lw = w;
}

/** Default arrangeContent: flex children, then absolute and manual children. */
export function flexArrange(host: UILayoutHost, innerW: number, innerH: number): void {
  flexLayout(host, innerW, innerH, true, true, true);
  arrangeOutOfFlow(host);
}

/** Places the host's absolute children (relative to its full box) and sizes its manual container children. */
export function arrangeOutOfFlow(host: UILayoutHost): void {
  const kids = host.children;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i]!;
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

/**
 * What a layout root checks every frame, flattened in tree order when it is laid out: every child of every
 * laid-out container (visibility), their uiSync() hooks, containers' dirty flags and leaf sizes. A frame without
 * changes is one pass over these arrays instead of a recursive walk with map lookups per node. Structural changes
 * (add/remove, layout props, Label text) mark the root dirty, so the list is rebuilt with the next layout.
 */
interface RootWatch {
  /** Pass of the root layout that built the list. */
  pass: number;
  /** Parent size the root was laid out against. */
  pw: number;
  ph: number;
  /** A watched node was never laid out (a container skipped it): re-layout, like a node added later. */
  stale: boolean;
  count: number;
  nodes: Node[];
  st: ItemState[];
  flags: number[];
}

const WATCH_SYNC = 1;
const WATCH_HOST = 2;
const WATCH_SIZE = 4;

function parentW(root: Node): number {
  const p = root.parent;
  return p && p.width > 0 ? p.width : NaN;
}

function parentH(root: Node): number {
  const p = root.parent;
  return p && p.height > 0 ? p.height : NaN;
}

function buildWatch(root: Node, pw: number, ph: number): void {
  const rs = state(root);
  const w = (rs.watch ??= { pass: 0, pw: NaN, ph: NaN, stale: false, count: 0, nodes: [], st: [], flags: [] });
  w.pass = rs.lp;
  w.pw = pw;
  w.ph = ph;
  w.stale = false;
  w.count = 0;
  collectWatch(root, w);
  if (w.nodes.length > w.count) {
    w.nodes.length = w.count;
    w.st.length = w.count;
    w.flags.length = w.count;
  }
}

function collectWatch(host: Node, w: RootWatch): void {
  const kids = host.children;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]!;
    let s = states.get(c);
    if (!s) {
      w.stale = true;
      s = state(c);
    }
    const isHost = isUIHost(c);
    let f = typeof (c as { uiSync?: unknown }).uiSync === 'function' ? WATCH_SYNC : 0;
    if (isHost) f |= WATCH_HOST;
    else if (positionOf(c) !== 'manual') f |= WATCH_SIZE;
    const k = w.count++;
    w.nodes[k] = c;
    w.st[k] = s;
    w.flags[k] = f;
    if (isHost && s.visible) collectWatch(c, w);
  }
}

/** True when a layout root must be re-laid out (dirty flags, parent resize, child size/visibility changes). */
export function uiLayoutNeeded(root: UILayoutHost): boolean {
  if (root.layoutDirty) return true;
  const rs = states.get(root);
  const w = rs?.watch;
  if (!w || w.stale || rs!.lp !== w.pass) return true;
  if (!same(w.pw, parentW(root)) || !same(w.ph, parentH(root))) return true;
  const sync = (root as { uiSync?: () => boolean }).uiSync;
  if (typeof sync === 'function' && sync.call(root)) return true;
  const nodes = w.nodes;
  const st = w.st;
  const flags = w.flags;
  for (let i = 0; i < w.count; i++) {
    const n = nodes[i]!;
    const s = st[i]!;
    if (n.visible !== s.visible) return true;
    if (!s.visible) continue;
    const f = flags[i]!;
    if (f & WATCH_SYNC && (n as unknown as { uiSync(): boolean }).uiSync()) return true;
    if (f & WATCH_HOST) {
      if ((n as UILayoutHost).layoutDirty) return true;
    } else if (f & WATCH_SIZE && (n.width !== s.w || n.height !== s.h)) return true;
  }
  return false;
}

/**
 * Lays out a root container (a UI container whose parent is not one). Size: its width/height (percentages of the
 * parent), or its content. Absolute roots are also positioned inside the parent; others keep their x/y.
 */
export function layoutUIRoot(root: UILayoutHost): void {
  const pw = parentW(root);
  const ph = parentH(root);
  beginPass();
  try {
    if (positionOf(root) === 'absolute') placeAbsolute(root, pw, ph);
    else {
      const s = measureUINode(root, isNaN(pw) ? Infinity : pw, isNaN(ph) ? Infinity : ph, pw, ph);
      layoutUINode(root, s.w, s.h);
    }
    buildWatch(root, pw, ph);
  } finally {
    endPass();
  }
}

/**
 * @internal Called by Label after its text changed. True when the new text reads exactly like the old one wherever
 * the last layout pass of its root measured it (natural size, wrapped heights, min-content width), so every
 * measurement and position stays the same: the text is re-wrapped in place and nothing else lays out. False: mark
 * the layout dirty as usual.
 */
export function uiTextRelayoutInPlace(n: Text): boolean {
  if (passDepth > 0) return false;
  const s = states.get(n);
  const t = s?.text;
  if (!s || !t || s.lp === 0 || t.pass !== s.lp || !isUIHost(n.parent)) return false;
  let root: Node = n.parent;
  while (isUIHost(root.parent)) root = root.parent;
  const rs = states.get(root);
  if (!rs || rs.lp !== s.lp || !rs.watch || rs.watch.pass !== s.lp) return false;
  if (!isNaN(t.natW)) {
    const nat = n.measureNatural();
    if (nat.width !== t.natW || nat.height !== t.natH) return false;
  }
  const ws = t.wraps;
  for (let i = 0; i < t.wn; i++) if (n.measureWrapped(ws[i * 2]!).height !== ws[i * 2 + 1]) return false;
  if (!isNaN(t.mcw) && n.minContentWidth() !== t.mcw) return false;
  fitText(n, t.lw);
  return n.width === s.w && n.height === s.h;
}

function flushVisit(n: Node): void {
  if (isUIHost(n) && !isUIHost(n.parent) && uiLayoutNeeded(n)) layoutUIRoot(n);
  for (const c of n.children.slice()) flushVisit(c);
}

/**
 * Runs any pending layout in the tree containing `node` (normally done automatically before each render).
 * Call it after changing UI in code when you need fresh positions immediately (tests, inspectUI, lintUI).
 */
export function flushUILayout(node: Node): void {
  let top: Node = node;
  while (isUIHost(top) && isUIHost(top.parent)) top = top.parent;
  flushVisit(top);
}
