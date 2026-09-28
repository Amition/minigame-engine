import { mix, type Color } from '../core/color';
import type { Mat2D } from '../core/math';
import { roundRectPath } from '../gfx/draw';
import type { Ctx2D } from '../gfx/types';
import { Node, type PointerEvt } from '../scene/node';
import { uiEvents } from './events';
import {
  flexArrange,
  flexLayout,
  flexMinContentWidth,
  isUIHost,
  layoutUIRoot,
  markUIHost,
  markUILayoutDirty,
  UI_CONTAINER_LAYOUT_KEYS,
  UI_ITEM_LAYOUT_KEYS,
  uiLayout,
  uiLayoutNeeded,
  UILayoutStyle,
  type Size,
  type UIContainerLayout,
  type UIItemLayout,
  type UILayoutProps,
} from './layout';
import { UIGradientCache } from './paint';
import { uiColor, uiRadius, uiShadow, type UIColor, type UIRadius, type UIShadow } from './theme';

/** Linear gradient: colors top→bottom, or `{ colors, dir }`. */
export type UIGradient = UIColor[] | { colors: UIColor[]; dir?: 'down' | 'right' | 'diagonal' };
/** Border color (3 units wide) or `{ color, width }`. Drawn inside the box. */
export type UIBorder = UIColor | { color: UIColor; width?: number };
/**
 * How lint treats a node: 'control' (tappable widget: tap size, overlap), 'surface' (drag/touch area such as
 * ScrollView or a dialog panel), 'blocker' (modal backdrop: hides everything painted before it), 'decor'.
 * 'auto' = control when interactive.
 */
export type UILintRole = 'auto' | 'control' | 'surface' | 'blocker' | 'decor';

/** Props shared by every UI node (widgets, Labels, and any Node passed to setUILayout/ui.node). */
export interface UINodeProps extends UIItemLayout {
  id?: string;
  tags?: string[];
  alpha?: number;
  visible?: boolean;
  zIndex?: number;
  scale?: number;
  rotation?: number;
  anchor?: number | [number, number];
  hitPadding?: number;
  interactive?: boolean;
  clip?: boolean;
  /** Tap handler, or an action name emitted as uiEvents 'action' (handy in JSON specs). */
  onTap?: ((e: PointerEvt) => void) | string;
  data?: Record<string, unknown>;
}

export interface UIBoxProps {
  fill?: UIColor | null;
  gradient?: UIGradient | null;
  radius?: UIRadius;
  border?: UIBorder | null;
  shadow?: UIShadow | null;
}

export interface UIViewProps extends UINodeProps, UIContainerLayout, UIBoxProps {
  /** Kind shown in dumps and selectors (default 'View'). */
  kind?: string;
  lintRole?: UILintRole;
}

/** Applies id/tags/visual/interaction props and item layout props to any node. */
export function applyUINodeProps(n: Node, p: UINodeProps): void {
  if (p.id !== undefined) n.id = p.id;
  if (p.tags) for (const t of p.tags) n.tags.add(t);
  if (p.alpha !== undefined) n.alpha = p.alpha;
  if (p.visible !== undefined) n.visible = p.visible;
  if (p.zIndex !== undefined) n.zIndex = p.zIndex;
  if (p.scale !== undefined) n.scaleX = n.scaleY = p.scale;
  if (p.rotation !== undefined) n.rotation = p.rotation;
  if (p.anchor !== undefined) {
    if (typeof p.anchor === 'number') n.anchorX = n.anchorY = p.anchor;
    else [n.anchorX, n.anchorY] = p.anchor;
  }
  if (p.hitPadding !== undefined) n.hitPadding = p.hitPadding;
  if (p.interactive !== undefined) n.interactive = p.interactive;
  if (p.clip !== undefined) n.clip = p.clip;
  if (p.data) Object.assign(n.data, p.data);
  let lp: Record<string, unknown> | null = null;
  for (const k of UI_ITEM_LAYOUT_KEYS) if (p[k] !== undefined) (lp ??= {})[k] = p[k];
  if (lp) uiLayout(n).set(lp as UILayoutProps);
  const tap = p.onTap;
  if (tap !== undefined) n.onTap(typeof tap === 'string' ? () => uiEvents.emit('action', { name: tap, node: n }) : tap);
}

export function gradientColors(g: UIGradient): UIColor[] {
  return Array.isArray(g) ? g : g.colors;
}

/** Canvas gradient for a UIGradient over the rect (x, y, w, h). */
export function makeUIGradient(ctx: Ctx2D, g: UIGradient, w: number, h: number, x = 0, y = 0): CanvasGradient {
  const dir = Array.isArray(g) ? 'down' : (g.dir ?? 'down');
  const cols = gradientColors(g);
  const grad =
    dir === 'right'
      ? ctx.createLinearGradient(x, y, x + w, y)
      : dir === 'diagonal'
        ? ctx.createLinearGradient(x, y, x + w, y + h)
        : ctx.createLinearGradient(x, y, x, y + h);
  cols.forEach((c, i) => grad.addColorStop(cols.length === 1 ? 0 : i / (cols.length - 1), uiColor(c)));
  return grad;
}

const insetScratch: [number, number, number, number] = [0, 0, 0, 0];

/** Box outline inset by `d` (corner radii shrink with it). */
function boxPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number | [number, number, number, number], d: number): void {
  ctx.beginPath();
  if (r === 0) ctx.rect(x + d, y + d, w - 2 * d, h - 2 * d);
  else if (typeof r === 'number') roundRectPath(ctx, x + d, y + d, w - 2 * d, h - 2 * d, Math.max(0, r - d));
  else {
    insetScratch[0] = Math.max(0, r[0] - d);
    insetScratch[1] = Math.max(0, r[1] - d);
    insetScratch[2] = Math.max(0, r[2] - d);
    insetScratch[3] = Math.max(0, r[3] - d);
    roundRectPath(ctx, x + d, y + d, w - 2 * d, h - 2 * d, insetScratch);
  }
}

const boxGradients = new WeakMap<object, UIGradientCache>();
const gradientScratch: string[] = [];

/** The box's gradient from its cache (keyed on the props object): rebuilt only when ctx, rect or colours change. */
function boxGradient(ctx: Ctx2D, owner: object, g: UIGradient, w: number, h: number, x: number, y: number): CanvasGradient {
  const dir = Array.isArray(g) ? 'down' : (g.dir ?? 'down');
  const src = gradientColors(g);
  const n = src.length;
  for (let i = 0; i < n; i++) gradientScratch[i] = uiColor(src[i]!);
  let cache = boxGradients.get(owner);
  if (!cache) boxGradients.set(owner, (cache = new UIGradientCache()));
  return cache.getN(ctx, x, y, dir === 'down' ? x : x + w, dir === 'right' ? y : y + h, gradientScratch, n);
}

/**
 * Paints a box background (shadow, fill or gradient, inner border) in local space (0,0)-(w,h). Gradients are cached
 * per `s` object, so pass the same props object every frame (widgets pass themselves).
 */
export function drawUIBox(ctx: Ctx2D, w: number, h: number, s: UIBoxProps, x = 0, y = 0): void {
  if (w <= 0 || h <= 0) return;
  const fill = uiColor(s.fill);
  const grad = s.gradient && gradientColors(s.gradient).length ? s.gradient : null;
  const b = s.border;
  const borderColor = b ? (typeof b === 'string' ? b : b.color) : null;
  const borderWidth = b ? (typeof b === 'string' ? 3 : (b.width ?? 3)) : 0;
  if (!fill && !grad && !b) return;
  const r = uiRadius(s.radius, w, h);
  if (fill || grad) {
    boxPath(ctx, x, y, w, h, r, 0);
    const sh = uiShadow(s.shadow);
    if (sh) {
      ctx.save();
      ctx.shadowColor = sh.color;
      ctx.shadowBlur = sh.blur;
      ctx.shadowOffsetX = sh.x ?? 0;
      ctx.shadowOffsetY = sh.y ?? 0;
    }
    ctx.fillStyle = grad ? boxGradient(ctx, s, grad, w, h, x, y) : fill!;
    ctx.fill();
    if (sh) ctx.restore();
  }
  if (borderColor !== null && borderWidth > 0) {
    boxPath(ctx, x, y, w, h, r, borderWidth / 2);
    ctx.strokeStyle = uiColor(borderColor);
    ctx.lineWidth = borderWidth;
    ctx.stroke();
  }
}

/**
 * Base UI container: a Node that lays out its children with flexbox (see UIContainerLayout) and can paint a
 * background (fill / gradient / radius / border / shadow). Layout runs automatically before rendering whenever
 * something changed; `width`/`height` are the computed size, `layout.*` the requested one.
 */
export class UIView extends Node {
  readonly layout: UILayoutStyle = new UILayoutStyle(this);
  layoutDirty = true;
  fill: UIColor | null = null;
  gradient: UIGradient | null = null;
  radius: UIRadius = 0;
  border: UIBorder | null = null;
  shadow: UIShadow | null = null;
  /** Visual offset that does not affect layout (slide animations). Hit tests and bounds include it. */
  translateX = 0;
  translateY = 0;
  lintRole: UILintRole = 'auto';
  protected kindName: string;

  constructor(props: UIViewProps = {}, kind = 'View') {
    super();
    this.kindName = props.kind ?? kind;
    let cl: Record<string, unknown> | null = null;
    for (const k of UI_CONTAINER_LAYOUT_KEYS) if (props[k] !== undefined) (cl ??= {})[k] = props[k];
    if (cl) this.layout.set(cl as UILayoutProps);
    this.setBox(props);
    if (props.lintRole) this.lintRole = props.lintRole;
    applyUINodeProps(this, props);
  }

  override get kind(): string {
    return this.kindName;
  }

  /** Sets layout props (marks layout dirty). */
  setLayout(p: UILayoutProps): this {
    this.layout.set(p);
    return this;
  }

  /** Sets background props. */
  setBox(p: UIBoxProps): this {
    if (p.fill !== undefined) this.fill = p.fill;
    if (p.gradient !== undefined) this.gradient = p.gradient;
    if (p.radius !== undefined) this.radius = p.radius;
    if (p.border !== undefined) this.border = p.border;
    if (p.shadow !== undefined) this.shadow = p.shadow;
    return this;
  }

  markLayoutDirty(): void {
    markUILayoutDirty(this);
  }

  override addAt<T extends Node>(child: T, index: number): T {
    const c = super.addAt(child, index);
    this.markLayoutDirty();
    return c;
  }

  override remove(child: Node): void {
    const had = child.parent === this;
    super.remove(child);
    if (had) this.markLayoutDirty();
  }

  override localMatrix(out?: Mat2D): Mat2D {
    const m = super.localMatrix(out);
    if (this.translateX !== 0 || this.translateY !== 0) {
      m.e += this.translateX;
      m.f += this.translateY;
    }
    return m;
  }

  override render(ctx: Ctx2D): void {
    if (this.visible && !this.destroyed && !isUIHost(this.parent) && uiLayoutNeeded(this)) layoutUIRoot(this);
    super.render(ctx);
  }

  measureContent(availW: number, availH: number, fixedW: boolean, fixedH: boolean): Size {
    return flexLayout(this, availW, availH, fixedW, fixedH, false);
  }

  arrangeContent(innerW: number, innerH: number): void {
    flexArrange(this, innerW, innerH);
  }

  minContentWidth(): number {
    return flexMinContentWidth(this);
  }

  onLayout(): void {}

  /** Effective background for lint contrast checks (gradients are averaged). */
  uiBackground(): { color: Color; approx: boolean } | null {
    if (this.gradient) {
      const cols = gradientColors(this.gradient).map((c) => uiColor(c));
      if (cols.length === 0) return null;
      let c = cols[0]!;
      for (let i = 1; i < cols.length; i++) c = mix(c, cols[i]!, 1 / (i + 1));
      return { color: c, approx: true };
    }
    const f = uiColor(this.fill);
    return f ? { color: f, approx: false } : null;
  }

  override draw(ctx: Ctx2D): void {
    drawUIBox(ctx, this.width, this.height, this);
  }
}
markUIHost(UIView.prototype);

/** A themed card/container: surface fill, large radius, padding and a soft shadow by default. */
export class Panel extends UIView {
  variant: 'surface' | 'raised' | 'inset' | 'glass';

  constructor(props: UIViewProps & { variant?: 'surface' | 'raised' | 'inset' | 'glass' } = {}) {
    const v = props.variant ?? 'surface';
    const base: UIViewProps =
      v === 'raised'
        ? { gradient: ['surfaceAlt', 'surface'], border: { color: 'border', width: 3 }, shadow: 'md' }
        : v === 'inset'
          ? { fill: 'track', border: null }
          : v === 'glass'
            ? { fill: 'rgba(255,255,255,0.1)', border: { color: 'rgba(255,255,255,0.18)', width: 2 } }
            : { fill: 'surface', shadow: 'md' };
    super({ radius: 'lg', padding: 'lg', gap: 'md', ...base, ...props }, 'Panel');
    this.variant = v;
  }

  override describe() {
    return { ...super.describe(), variant: this.variant };
  }
}

/** Flexible empty space (`ui.spacer()` grows) or a fixed gap along the parent's main axis (`ui.spacer(24)`). */
export class Spacer extends UIView {
  constructor(props: UINodeProps & { size?: number } = {}) {
    const fixed = props.size !== undefined;
    super({ grow: fixed ? 0 : 1, shrink: fixed ? 0 : 1, basis: props.size ?? 0, alignSelf: 'start', ...props }, 'Spacer');
  }
}

/** A thin line: horizontal inside a column, vertical inside a row. */
export class Divider extends UIView {
  color: UIColor;
  thickness: number;

  constructor(props: UINodeProps & { color?: UIColor; thickness?: number } = {}) {
    super({ alignSelf: 'stretch', shrink: 0, ...props }, 'Divider');
    this.color = props.color ?? 'border';
    this.thickness = props.thickness ?? 2;
  }

  override measureContent(): Size {
    return { w: this.thickness, h: this.thickness };
  }

  override minContentWidth(): number {
    return this.thickness;
  }

  override draw(ctx: Ctx2D): void {
    if (this.width <= 0 || this.height <= 0) return;
    ctx.fillStyle = uiColor(this.color);
    const r = Math.min(this.width, this.height) / 2;
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, this.width, this.height, r);
    ctx.fill();
  }
}
