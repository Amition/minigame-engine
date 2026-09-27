import { Game } from '../core/game';
import type { Rect } from '../core/math';
import { Node } from '../scene/node';
import { Button, IconButton, type ButtonProps, type IconButtonProps } from './button';
import { Checkbox, ProgressBar, SegmentedControl, Slider, Toggle } from './controls';
import type { CheckboxProps, ProgressBarProps, SegmentedControlProps, SliderProps, ToggleProps } from './controls';
import { Badge, StarRating, type BadgeProps, type StarRatingProps } from './decor';
import { Tabs, UIGrid, type GridProps, type TabsProps } from './grid';
import { UIIcon, type IconProps, type UIIconSource } from './icon';
import { UIImage, type ImageProps } from './image';
import { Label, type LabelProps } from './label';
import { setUILayout, uiLayout, type UILayoutProps } from './layout';
import { Dialog, Modal, type DialogProps, type ModalProps } from './modal';
import { RichText, type RichTextProps } from './richtext';
import { ListView, ScrollView, type ListViewProps, type ScrollViewProps } from './scroll';
import { Divider, Panel, Spacer, UIView, applyUINodeProps, type UINodeProps, type UIViewProps } from './view';
import type { UIColor } from './theme';

/** Children lists accept falsy entries so conditional children read naturally: `[isVip && ui.badge(...)]`. */
export type UIChild = Node | null | undefined | false;

function addAll<T extends Node>(parent: T, children: readonly UIChild[] | undefined): T {
  if (children) for (const c of children) if (c) parent.add(c);
  return parent;
}

type PanelProps = UIViewProps & { variant?: 'surface' | 'raised' | 'inset' | 'glass' };

/**
 * Typed UI builders. Containers take `(props, children)`; leaves take their main value first.
 *
 *     ui.column({ padding: 'lg', gap: 'md', align: 'center' }, [
 *       ui.text('Level 3', { variant: 'h1' }),
 *       ui.button({ text: 'Play', size: 'lg', onTap: () => start() }),
 *       ui.row({ gap: 'sm' }, [ui.iconButton({ icon: 'settings', label: 'Settings' })]),
 *     ]);
 */
export const ui = {
  /** Flex container (column by default). */
  view: (props: UIViewProps = {}, children?: readonly UIChild[]) => addAll(new UIView(props), children),
  column: (props: UIViewProps = {}, children?: readonly UIChild[]) =>
    addAll(new UIView({ ...props, direction: 'column', kind: props.kind ?? 'Column' }), children),
  row: (props: UIViewProps = {}, children?: readonly UIChild[]) =>
    addAll(new UIView({ align: 'center', ...props, direction: 'row', kind: props.kind ?? 'Row' }), children),
  /** Children overlaid on top of each other (centered by default). */
  stack: (props: UIViewProps = {}, children?: readonly UIChild[]) =>
    addAll(new UIView({ align: 'center', ...props, direction: 'stack', kind: props.kind ?? 'Stack' }), children),
  panel: (props: PanelProps = {}, children?: readonly UIChild[]) => addAll(new Panel(props), children),
  text: (text: string | number, props: LabelProps = {}) => new Label(text, props),
  title: (text: string, props: LabelProps = {}) => new Label(text, { variant: 'title', align: 'center', ...props }),
  richText: (markup: string, props: RichTextProps = {}) => new RichText(markup, props),
  button: (textOrProps: string | ButtonProps = {}, props: ButtonProps = {}) =>
    new Button(typeof textOrProps === 'string' ? { ...props, text: textOrProps } : textOrProps),
  iconButton: (props: IconButtonProps) => new IconButton(props),
  icon: (src: UIIconSource, props: Omit<IconProps, 'src'> = {}) => new UIIcon({ ...props, src }),
  image: (src: UIIconSource | null, props: Omit<ImageProps, 'src'> = {}) => new UIImage({ ...props, src }),
  progress: (props: ProgressBarProps = {}) => new ProgressBar(props),
  slider: (props: SliderProps = {}) => new Slider(props),
  toggle: (props: ToggleProps = {}) => new Toggle(props),
  checkbox: (props: CheckboxProps = {}) => new Checkbox(props),
  segmented: (props: SegmentedControlProps) => new SegmentedControl(props),
  scroll: (props: ScrollViewProps = {}, children?: readonly UIChild[]) => addAll(new ScrollView(props), children),
  list: (props: ListViewProps) => new ListView(props),
  grid: (props: GridProps, children?: readonly UIChild[]) => addAll(new UIGrid(props), children),
  tabs: (props: TabsProps, pages: readonly UIChild[] = []) => new Tabs(props, pages.filter((p): p is Node => !!p)),
  badge: (props: BadgeProps = {}) => new Badge(props),
  stars: (props: StarRatingProps = {}) => new StarRating(props),
  /** Flexible space (no size) or a fixed gap along the main axis. */
  spacer: (size?: number, props: UINodeProps = {}) => new Spacer(size === undefined ? props : { ...props, size }),
  divider: (props: UINodeProps & { color?: UIColor; thickness?: number } = {}) => new Divider(props),
  /** Adds layout/id/tap props to any node (Sprite, Box, custom Node) so it can live in a UI container. */
  node: <T extends Node>(node: T, props: UINodeProps = {}) => {
    applyUINodeProps(node, props);
    return node;
  },
  /** A (closed) modal; call `.open()`. */
  modal: (props: ModalProps = {}, children?: readonly UIChild[]) => new Modal(props, (children ?? []).filter((c): c is Node => !!c)),
  dialog: (props: DialogProps = {}, children?: readonly UIChild[]) => new Dialog(props, (children ?? []).filter((c): c is Node => !!c)),
};

// ---------------------------------------------------------------- JSON specs

/** Declarative UI: `{ type: 'column', props: { gap: 'md' }, children: [{ type: 'text', props: { text: 'Hi' } }] }`. */
export interface UISpec {
  type: string;
  props?: Record<string, unknown>;
  children?: (UISpec | string)[];
}

/** Builds a node from a spec (props, already-built children, the raw spec). */
export type UISpecFactory = (props: Record<string, unknown>, children: Node[], spec: UISpec) => Node;

const factories = new Map<string, UISpecFactory>();
const norm = (t: string) => t.toLowerCase().replace(/[-_\s]/g, '');

/** Registers a spec type (e.g. a game-specific widget): `registerUIType('coinCounter', (p) => new CoinCounter(p))`. */
export function registerUIType(type: string, factory: UISpecFactory): void {
  factories.set(norm(type), factory);
}

/** Spec types known to buildUI. */
export function uiTypes(): string[] {
  return [...factories.keys()].sort();
}

type P = Record<string, unknown>;
const str = (v: unknown, d = '') => (v === undefined || v === null ? d : String(v));
const without = (p: P, ...keys: string[]) => {
  const o = { ...p };
  for (const k of keys) delete o[k];
  return o;
};

const reg = (names: string[], f: UISpecFactory) => names.forEach((n) => registerUIType(n, f));
reg(['view', 'box'], (p, c) => addAll(new UIView(p as UIViewProps), c));
reg(['column', 'col', 'vstack'], (p, c) => ui.column(p as UIViewProps, c));
reg(['row', 'hstack'], (p, c) => ui.row(p as UIViewProps, c));
reg(['stack', 'overlay', 'zstack'], (p, c) => ui.stack(p as UIViewProps, c));
reg(['panel', 'card'], (p, c) => ui.panel(p as PanelProps, c));
reg(['text', 'label'], (p, _c, s) => new Label(str(p.text, typeof s.children?.[0] === 'string' ? s.children[0] : ''), without(p, 'text') as LabelProps));
reg(['title'], (p) => ui.title(str(p.text), without(p, 'text') as LabelProps));
reg(['richtext', 'rich'], (p) => new RichText(str(p.text ?? p.markup), without(p, 'text', 'markup') as RichTextProps));
reg(['button'], (p) => new Button(p as ButtonProps));
reg(['iconbutton'], (p) => new IconButton(p as unknown as IconButtonProps));
reg(['icon'], (p) => new UIIcon(p as IconProps));
reg(['image', 'img'], (p) => new UIImage(p as ImageProps));
reg(['progress', 'progressbar', 'bar'], (p) => new ProgressBar(p as ProgressBarProps));
reg(['slider'], (p) => new Slider(p as SliderProps));
reg(['toggle', 'switch'], (p) => new Toggle(p as ToggleProps));
reg(['checkbox', 'check'], (p) => new Checkbox(p as CheckboxProps));
reg(['segmented', 'segmentedcontrol', 'segments'], (p) => new SegmentedControl(p as unknown as SegmentedControlProps));
reg(['scroll', 'scrollview'], (p, c) => addAll(new ScrollView(p as ScrollViewProps), c));
reg(['grid'], (p, c) => addAll(new UIGrid(p as unknown as GridProps), c));
reg(['tabs'], (p, c) => new Tabs(p as unknown as TabsProps, c));
reg(['badge'], (p) => new Badge(p as BadgeProps));
reg(['stars', 'starrating', 'rating'], (p) => new StarRating(p as StarRatingProps));
reg(['spacer'], (p) => new Spacer(p as UINodeProps & { size?: number }));
reg(['divider', 'separator'], (p) => new Divider(p as UINodeProps));
reg(['modal'], (p, c) => new Modal(p as ModalProps, c));
reg(['dialog'], (p, c) => new Dialog(p as DialogProps, c));
reg(['list', 'listview'], (p) => {
  const items = (p.items as (UISpec | string)[] | undefined) ?? [];
  return new ListView({
    itemHeight: 120,
    ...(without(p, 'items') as Partial<ListViewProps>),
    count: items.length,
    renderItem: (i) => buildUI(items[i]!),
  });
});

/**
 * Builds UI from a JSON-friendly spec (strings become Labels). String `onTap` values are emitted as
 * `uiEvents` 'action' events. Unknown types throw with the list of known types.
 */
export function buildUI(spec: UISpec | string): Node {
  if (typeof spec === 'string') return new Label(spec);
  const f = factories.get(norm(spec.type));
  if (!f) throw new Error(`buildUI: unknown type "${spec.type}". Known: ${uiTypes().join(', ')}`);
  const kids = (spec.children ?? []).filter((c) => typeof c !== 'string' || !['text', 'label'].includes(norm(spec.type)));
  return f(spec.props ?? {}, kids.map((c) => buildUI(c)), spec);
}

// ---------------------------------------------------------------- screens

export interface MountOptions {
  /** Area the screen fills: 'safe' (default; game.safe), 'view' (whole visible area), or a rect / rect getter. */
  area?: 'safe' | 'view' | Rect | (() => Rect);
  /** Deprecated alias: safeArea false = area 'view'. */
  safeArea?: boolean;
  /** Paint this color behind the whole view (outside the safe area too). */
  background?: UIColor;
  /** Replace UI mounted earlier with mountScreen on the same parent (default true). */
  replace?: boolean;
}

/**
 * Root of a mounted screen. Tracks the target area every frame (resize, safe-area changes) and lays out its
 * content (a column, stretched to fill).
 */
export class UIScreen extends UIView {
  area: 'safe' | 'view' | Rect | (() => Rect);
  private key = '';

  constructor(area: MountOptions['area'] = 'safe', background?: UIColor) {
    super({ position: 'absolute', direction: 'column', align: 'stretch' }, 'Screen');
    this.area = area;
    if (background) {
      super.addAt(new UIView({ kind: 'ScreenBg', position: 'manual', fill: background, lintRole: 'decor' }), 0);
    }
  }

  /** Current area in the parent's coordinates. */
  rect(): Rect {
    const a = this.area;
    if (typeof a === 'function') return a();
    if (typeof a === 'object') return a;
    const g = Game.current;
    const p = this.parent;
    if (!g) return { x: 0, y: 0, w: p?.width ?? 750, h: p?.height ?? 1334 };
    const r = a === 'view' ? { x: 0, y: 0, w: g.view.width, h: g.view.height } : g.safe;
    if (!p) return { ...r };
    const o = p.toLocal(r.x, r.y);
    return { x: o.x, y: o.y, w: r.w, h: r.h };
  }

  uiSync(): boolean {
    const r = this.rect();
    const key = `${r.x},${r.y},${r.w},${r.h}`;
    if (key === this.key) return false;
    this.key = key;
    this.layout.set({ left: r.x, top: r.y, width: r.w, height: r.h });
    const bg = this.children[0];
    if (bg instanceof UIView && bg.kind === 'ScreenBg') {
      const g = Game.current;
      bg.x = -r.x;
      bg.y = -r.y;
      bg.layout.set({ width: g ? g.view.width : r.w, height: g ? g.view.height : r.h });
    }
    return true;
  }
}

const mounted = new WeakMap<Node, UIScreen>();

/**
 * Mounts UI into a scene (or any node) so it fills the safe area and re-lays out on resize.
 * `content` is a node (e.g. from `ui.column(...)`) or a spec for buildUI. Returns the content node.
 *
 *     const menu = mountScreen(this, ui.column({ padding: 'lg', justify: 'between' }, [...]));
 */
export function mountScreen<T extends Node = Node>(parent: Node, content: T | UISpec, opts: MountOptions = {}): T {
  const node = (isSpec(content) ? buildUI(content) : content) as T;
  if (opts.replace !== false) mounted.get(parent)?.destroy();
  const area = opts.area ?? (opts.safeArea === false ? 'view' : 'safe');
  const screen = parent.add(new UIScreen(area, opts.background));
  const own = uiLayout(node);
  const lp: UILayoutProps = {};
  if (own.grow === undefined) lp.grow = 1;
  if (own.basis === undefined) lp.basis = 0;
  setUILayout(node, lp);
  screen.add(node);
  screen.uiSync();
  mounted.set(parent, screen);
  return node;
}

function isSpec(v: unknown): v is UISpec {
  return !(v instanceof Node) && !!v && typeof v === 'object' && typeof (v as UISpec).type === 'string';
}
