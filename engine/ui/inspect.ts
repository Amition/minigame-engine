import { contrastRatio, parseColor, toCss, type RGBA } from '../core/color';
import { Game } from '../core/game';
import type { Rect } from '../core/math';
import type { Ctx2D } from '../gfx/types';
import { Box } from '../scene/box';
import type { Node } from '../scene/node';
import { Sprite } from '../scene/sprite';
import { Text } from '../scene/text';
import { Button, UI_MIN_TAP } from './button';
import { UIIcon, uiIconName } from './icon';
import { UIImage } from './image';
import { flushUILayout, isUIHost, uiLayout, type UILayoutProps } from './layout';
import { UIView, type UILintRole } from './view';

// ---------------------------------------------------------------- shared helpers

const R = (v: number) => Math.round(v);

function fmtRect(r: Rect): string {
  return `[${R(r.x)},${R(r.y)} ${R(r.w)}x${R(r.h)}]`;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bt = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bt > y ? { x, y, w: r - x, h: bt - y } : null;
}

function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
}

function worldScale(n: Node): number {
  const m = n.worldMatrix();
  return Math.hypot(m.a, m.b);
}

function quoteAttr(v: string): string {
  const one = v.replace(/\n/g, ' ');
  const cut = one.length > 40 ? one.slice(0, 37) + '...' : one;
  return /[\s\]"'>#.]/.test(cut) || cut === '' ? `"${cut.replace(/"/g, "'")}"` : cut;
}

/** Selector-like name of a node for reports: `Button#play`, `Button[text=Play]`, `IconButton[label=Close]`. */
export function uiNodeName(n: Node): string {
  let s = n.kind;
  if (n.id) return s + '#' + n.id;
  const d = n.describe();
  for (const k of ['text', 'label', 'title', 'icon']) {
    const v = d[k];
    if (typeof v === 'string' && v.trim()) return `${s}[${k}=${quoteAttr(v)}]`;
  }
  for (const t of n.tags) s += '.' + t;
  return s;
}

// ---------------------------------------------------------------- inspectUI

/** JSON snapshot of one node (see inspectUI). */
export interface UIInspectNode {
  kind: string;
  id?: string;
  tags?: string[];
  /** Stage-space bounds [x, y, w, h], rounded. */
  rect: [number, number, number, number];
  /** Tap area when hitPadding > 0. */
  hit?: [number, number, number, number];
  flags?: string[];
  /** describe() values (text, variant, value...). */
  props?: Record<string, string | number | boolean>;
  /** Requested layout props (UI nodes and nodes given layout props). */
  layout?: UILayoutProps;
  children?: UIInspectNode[];
}

export interface UIInspectOptions {
  /** Include children of hidden nodes (default false). */
  includeHidden?: boolean;
  maxDepth?: number;
  /** Include requested layout props (default true). */
  layout?: boolean;
}

/**
 * Structured snapshot of a UI tree (layout flushed first): kinds, ids, stage rects, tap areas, widget state and
 * requested layout. `JSON.stringify(inspectUI(root), null, 1)` is a compact machine-readable screen description.
 */
export function inspectUI(root: Node, opts: UIInspectOptions = {}): UIInspectNode {
  flushUILayout(root);
  const visit = (n: Node, depth: number): UIInspectNode => {
    const b = n.worldBounds();
    const out: UIInspectNode = { kind: n.kind, rect: [R(b.x), R(b.y), R(b.w), R(b.h)] };
    if (n.id) out.id = n.id;
    if (n.tags.size) out.tags = [...n.tags];
    if (n.hitPadding > 0 && n.interactive) {
      const p = n.hitPadding * worldScale(n);
      out.hit = [R(b.x - p), R(b.y - p), R(b.w + 2 * p), R(b.h + 2 * p)];
    }
    const flags: string[] = [];
    if (!n.visible) flags.push('hidden');
    if (n.alpha < 1) flags.push(`alpha=${+n.alpha.toFixed(2)}`);
    if (n.interactive) flags.push('interactive');
    if (n.clip) flags.push('clip');
    if (flags.length) out.flags = flags;
    const props: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(n.describe())) if (v !== undefined && v !== '') props[k] = v;
    if (Object.keys(props).length) out.props = props;
    if (opts.layout !== false) {
      const lp = uiLayout(n).toJSON();
      if (Object.keys(lp).length) out.layout = lp;
    }
    const descend = (n.visible || opts.includeHidden) && (opts.maxDepth === undefined || depth < opts.maxDepth);
    if (descend && n.children.length) {
      n.sortChildren();
      out.children = n.children.map((c) => visit(c, depth + 1));
    }
    return out;
  };
  return visit(root, 0);
}

// ---------------------------------------------------------------- lintUI

export type UILintSeverity = 'error' | 'warn' | 'info';

export type UILintRule =
  | 'interactive-overlap'
  | 'text-overlap'
  | 'outside-view'
  | 'outside-safe'
  | 'text-truncated'
  | 'text-overflow'
  | 'small-tap-target'
  | 'low-contrast'
  | 'small-font'
  | 'duplicate-id'
  | 'empty-label'
  | 'invisible-interactive'
  | 'zero-size-interactive'
  | 'missing-texture';

/** Default severity of each rule. */
export const UI_LINT_RULES: Record<UILintRule, UILintSeverity> = {
  'interactive-overlap': 'error',
  'text-overlap': 'error',
  'outside-view': 'error',
  'outside-safe': 'warn',
  'text-truncated': 'warn',
  'text-overflow': 'error',
  'small-tap-target': 'warn',
  'low-contrast': 'error',
  'small-font': 'warn',
  'duplicate-id': 'error',
  'empty-label': 'warn',
  'invisible-interactive': 'error',
  'zero-size-interactive': 'warn',
  'missing-texture': 'warn',
};

export interface UILintIssue {
  severity: UILintSeverity;
  rule: UILintRule;
  node: Node;
  /** Selector-like node name (`Button[text=Play]`). */
  name: string;
  /** Stage rect of the node (visible part). */
  rect: Rect;
  message: string;
  /** The other node for overlap / duplicate issues. */
  other?: Node;
}

export interface UILintOptions {
  /** Change severities or turn rules off: `{ 'outside-safe': 'off', 'small-font': 'error' }`. */
  rules?: Partial<Record<UILintRule, UILintSeverity | 'off'>>;
  /** Minimum tap area (default 88). */
  minTap?: number;
  /** Minimum font size in design units (default 20). */
  minFont?: number;
  /** Minimum text/background contrast ratio (default 3). */
  minContrast?: number;
  /** Skip these nodes and their subtrees. */
  ignore?: (n: Node) => boolean;
}

type Role = 'control' | 'surface' | 'blocker' | 'decor' | 'none';

interface TextInfo {
  text: string;
  size: number;
  colors: string[];
  stroke: { color: string; width: number } | null;
  truncated: boolean;
  overflow: boolean;
}

interface Bg {
  color: string | null;
  approx: boolean;
  /** Image content: color unknown. */
  unknown: boolean;
}

interface Item {
  n: Node;
  order: number;
  rect: Rect;
  vis: Rect | null;
  clipped: boolean;
  alpha: number;
  role: Role;
  text: TextInfo | null;
  bg: Bg | null;
  occluded: boolean;
  disabled: boolean;
  decor: boolean;
}

const LINT_ROLE_TAGS: Record<string, Role> = {
  'lint-blocker': 'blocker',
  'lint-surface': 'surface',
  'lint-decor': 'decor',
  'lint-control': 'control',
};

/** Plain nodes (Box, Sprite, ...) opt into a lint role with a tag, e.g. `tags: ['lint-blocker']` on a backdrop. */
function roleOf(n: Node): Role {
  const r: UILintRole = n instanceof UIView ? n.lintRole : 'auto';
  if (r !== 'auto') return r;
  for (const t of n.tags) {
    const tagged = LINT_ROLE_TAGS[t];
    if (tagged) return tagged;
  }
  return n.interactive ? 'control' : 'none';
}

function textInfo(n: Node): TextInfo | null {
  if (n instanceof Text) {
    const st = n.style;
    return {
      text: n.text,
      size: n.fontSize,
      colors: [st.color],
      stroke: st.stroke,
      truncated: n.truncated,
      overflow: n.measureContentWidth() > n.width + 1,
    };
  }
  const info = (n as { uiTextInfo?: () => Omit<TextInfo, 'truncated' | 'overflow'> }).uiTextInfo;
  if (typeof info === 'function') {
    const i = info.call(n);
    return { ...i, truncated: !!(n as { truncated?: boolean }).truncated, overflow: false };
  }
  return null;
}

function bgOf(n: Node): Bg | null {
  if (n instanceof UIImage) return n.missing ? null : { color: null, approx: true, unknown: true };
  if (n instanceof UIView) {
    const b = n.uiBackground();
    return b ? { color: b.color, approx: b.approx, unknown: false } : null;
  }
  if (n instanceof Box) return n.fill ? { color: n.fill, approx: n.radius !== 0, unknown: false } : null;
  if (n instanceof Sprite) return n.texture ? { color: null, approx: true, unknown: true } : null;
  return null;
}

function collect(root: Node, ignore?: (n: Node) => boolean): Item[] {
  const items: Item[] = [];
  const visit = (n: Node, clip: Rect | null, alpha: number, disabled: boolean, decor: boolean) => {
    if (!n.visible || n.destroyed || (ignore && n !== root && ignore(n))) return;
    const a = alpha * n.alpha;
    const rect = n.worldBounds();
    const vis = clip ? intersect(rect, clip) : rect;
    const role = roleOf(n);
    const dis = disabled || (n as { disabled?: unknown }).disabled === true;
    const dec = decor || role === 'decor';
    items.push({
      n,
      order: items.length,
      rect,
      vis,
      clipped: !!clip && (!vis || vis.w < rect.w - 0.5 || vis.h < rect.h - 0.5),
      alpha: a,
      role,
      text: textInfo(n),
      bg: bgOf(n),
      occluded: false,
      disabled: dis,
      decor: dec,
    });
    let cc = clip;
    if (n.clip) cc = clip ? (intersect(clip, rect) ?? { x: rect.x, y: rect.y, w: 0, h: 0 }) : rect;
    n.sortChildren();
    for (const c of n.children) visit(c, cc, a, dis, dec);
  };
  visit(root, null, 1, false, false);
  for (const b of items) {
    if (b.role !== 'blocker' || b.alpha <= 0.05 || !b.vis) continue;
    for (const it of items) {
      if (it.order >= b.order || !it.vis || b.n.isDescendantOf(it.n)) continue;
      if (intersect(it.vis, b.vis)) it.occluded = true;
    }
  }
  return items;
}

function blend(under: RGBA, over: RGBA, a: number): RGBA {
  const t = Math.max(0, Math.min(1, over.a * a));
  return { r: under.r + (over.r - under.r) * t, g: under.g + (over.g - under.g) * t, b: under.b + (over.b - under.b) * t, a: 1 };
}

/** Effective background color under a stage point, just below item `i` in paint order. */
function backgroundAt(items: Item[], i: number, x: number, y: number, base: string): { color: RGBA; approx: boolean; unknown: boolean } {
  let c: RGBA = { ...parseColor(base), a: 1 };
  let approx = false;
  let unknown = false;
  for (let j = 0; j < i; j++) {
    const it = items[j]!;
    if (!it.bg || it.alpha <= 0 || !it.vis || !contains(it.vis, x, y)) continue;
    const at = (it.n as { uiBackgroundAt?: (x: number, y: number) => { color: string; approx: boolean } | null }).uiBackgroundAt;
    const b = typeof at === 'function' ? at.call(it.n, x, y) : it.bg;
    if (!b) continue;
    if ('unknown' in b && b.unknown) {
      unknown = true;
      continue;
    }
    if (!b.color) continue;
    const col = parseColor(b.color);
    const k = col.a * it.alpha;
    c = blend(c, col, it.alpha);
    if (k >= 0.95) {
      unknown = false;
      approx = b.approx;
    } else approx = approx || b.approx;
  }
  return { color: c, approx, unknown };
}

const isAncestorPair = (a: Node, b: Node) => a.isDescendantOf(b) || b.isDescendantOf(a);

/**
 * Checks a UI tree for common mistakes and returns issues sorted by severity (layout is flushed first).
 * Lint the whole stage (`lintUI(game.stage, game)`) so modals/toasts in the overlay are included; nodes covered
 * by a modal backdrop are skipped. Print with formatLint().
 */
export function lintUI(root?: Node, game: Game | null = Game.current, opts: UILintOptions = {}): UILintIssue[] {
  const r = root ?? game?.stage;
  if (!r) return [];
  flushUILayout(r);
  const items = collect(r, opts.ignore);
  const out: UILintIssue[] = [];
  const minTap = opts.minTap ?? UI_MIN_TAP;
  const minFont = opts.minFont ?? 20;
  const minContrast = opts.minContrast ?? 3;
  const report = (rule: UILintRule, it: Item | Node, message: string, other?: Node) => {
    const sev = opts.rules?.[rule] ?? UI_LINT_RULES[rule];
    if (sev === 'off') return;
    const n = 'order' in it ? it.n : it;
    const rect = 'order' in it ? (it.vis ?? it.rect) : n.worldBounds();
    out.push({ severity: sev, rule, node: n, name: uiNodeName(n), rect, message, ...(other ? { other } : {}) });
  };
  const view: Rect = game ? { x: 0, y: 0, w: game.view.width, h: game.view.height } : { x: 0, y: 0, w: r.width, h: r.height };
  const safe: Rect | null = game ? game.safe : null;
  const live = items.filter((it) => it.n !== r && it.vis && it.alpha > 0.01 && !it.occluded);
  const controls = live.filter((it) => it.role === 'control');
  const texts = live.filter((it) => it.text && it.text.text.trim() !== '');

  // duplicate ids (whole tree, hidden included)
  const ids = new Map<string, Node>();
  r.walk((n) => {
    if (!n.id || n === r) return;
    const first = ids.get(n.id);
    if (first) report('duplicate-id', n, `id "${n.id}" also used by ${first.kind} ${fmtRect(first.worldBounds())}`, first);
    else ids.set(n.id, n);
  });

  for (const it of items) {
    if (it.n === r || it.role !== 'control' || it.occluded) continue;
    if (it.alpha <= 0.01) report('invisible-interactive', it, `interactive but alpha=${+it.alpha.toFixed(2)} (still receives taps)`);
    else if (it.rect.w * it.rect.h <= 0 && it.n.hitPadding <= 0) report('zero-size-interactive', it, 'interactive with zero size (cannot be tapped)');
  }

  // overlaps
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]!;
      const b = controls[j]!;
      if (a.decor || b.decor || isAncestorPair(a.n, b.n)) continue;
      const x = intersect(a.vis!, b.vis!);
      if (x && x.w > 2 && x.h > 2) report('interactive-overlap', b, `overlaps ${uiNodeName(a.n)} ${fmtRect(a.vis!)} by ${R(x.w)}x${R(x.h)}`, a.n);
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!;
      const b = texts[j]!;
      if (a.decor || b.decor || isAncestorPair(a.n, b.n)) continue;
      const x = intersect(a.vis!, b.vis!);
      if (x && x.w > 2 && x.h > 2) report('text-overlap', b, `overlaps ${uiNodeName(a.n)} ${fmtRect(a.vis!)} by ${R(x.w)}x${R(x.h)}`, a.n);
    }
  }

  // placement + size
  for (const it of live) {
    const isContent = it.role === 'control' || !!it.text || it.n instanceof UIIcon || it.n instanceof UIImage;
    if (!isContent || it.decor) continue;
    const v = it.vis!;
    if (v.w <= 0 && v.h <= 0) continue;
    if (v.x < view.x - 1 || v.y < view.y - 1 || v.x + v.w > view.x + view.w + 1 || v.y + v.h > view.y + view.h + 1) {
      report('outside-view', it, `outside the view [0,0 ${R(view.w)}x${R(view.h)}]`);
    } else if (safe && (v.x < safe.x - 1 || v.y < safe.y - 1 || v.x + v.w > safe.x + safe.w + 1 || v.y + v.h > safe.y + safe.h + 1)) {
      report('outside-safe', it, `outside the safe area ${fmtRect(safe)}`);
    }
    if ((it.n instanceof UIIcon || it.n instanceof UIImage) && it.n.missing) {
      report('missing-texture', it, `no texture or glyph for "${uiIconName(it.n.src)}"`);
    }
  }
  for (const it of controls) {
    if (it.decor || it.clipped) continue;
    const s = worldScale(it.n);
    const p = it.n.hitPadding * s;
    const w = it.rect.w + 2 * p;
    const h = it.rect.h + 2 * p;
    if (w < minTap - 0.5 || h < minTap - 0.5) report('small-tap-target', it, `${p > 0 ? `hit ${R(w)}x${R(h)} ` : ''}< ${minTap}x${minTap}`);
  }

  // empty labels
  for (const it of live) {
    if (it.text && it.text.text.trim() === '') {
      report('empty-label', it, 'text is empty');
    } else if (it.n instanceof Button && !it.n.text && !it.n.icon) report('empty-label', it, 'button has no text or icon');
  }

  // text checks
  const base = game?.background ?? '#000000';
  for (const it of texts) {
    const t = it.text!;
    const s = worldScale(it.n);
    const size = t.size * s;
    if (size < minFont - 0.01) report('small-font', it, `font ${+size.toFixed(1)} < ${minFont}`);
    if (t.truncated) report('text-truncated', it, 'text cut off (maxLines / autoFit could not fit it)');
    if (t.overflow) report('text-overflow', it, 'a word is wider than the text box');
    else {
      let p = it.n.parent;
      while (p && !(isUIHost(p) && p.width > 0 && p.height > 0)) p = isUIHost(p) ? p.parent : null;
      if (p && !it.clipped) {
        const pb = p.worldBounds();
        const b = it.rect;
        if (b.x < pb.x - 2 || b.y < pb.y - 2 || b.x + b.w > pb.x + pb.w + 2 || b.y + b.h > pb.y + pb.h + 2) {
          report('text-overflow', it, `extends outside ${uiNodeName(p)} ${fmtRect(pb)}`, p);
        }
      }
    }
    if (it.disabled) continue;
    const v = it.vis!;
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    const bg = backgroundAt(items, it.order, cx, cy, base);
    if (bg.unknown) continue;
    let worst = Infinity;
    let worstColor = '';
    for (const c of t.colors) {
      const fg = blend(bg.color, parseColor(c), it.alpha);
      let ratio = contrastRatio(toCss(fg), toCss(bg.color));
      if (t.stroke && t.stroke.width * s >= 2) {
        const sc = blend(bg.color, parseColor(t.stroke.color), it.alpha);
        ratio = Math.max(ratio, contrastRatio(toCss(fg), toCss(sc)));
      }
      if (ratio < worst) {
        worst = ratio;
        worstColor = c;
      }
    }
    if (worst < minContrast) {
      report('low-contrast', it, `contrast ${worst.toFixed(1)}:1 (${worstColor} on ${toCss(bg.color)}${bg.approx ? ', approx' : ''}) < ${minContrast}:1`);
    }
  }

  const rank: Record<UILintSeverity, number> = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * One line per issue plus a summary, e.g.
 * `WARN  small-tap-target IconButton[label=Close] [690,40 48x48] < 88x88`.
 */
export function formatLint(issues: readonly UILintIssue[]): string {
  if (issues.length === 0) return 'UI lint: no issues';
  const lines = issues.map((i) => `${i.severity.toUpperCase().padEnd(5)} ${i.rule} ${i.name} ${fmtRect(i.rect)} ${i.message}`);
  const e = issues.filter((i) => i.severity === 'error').length;
  const w = issues.filter((i) => i.severity === 'warn').length;
  lines.push(`UI lint: ${e} error${e === 1 ? '' : 's'}, ${w} warning${w === 1 ? '' : 's'}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- drawUIBounds

export interface UIBoundsOptions {
  /** Game for lint (default Game.current). */
  game?: Game | null;
  /** Outline lint issues in red/orange with their rule (true = run lintUI; or pass issues). Default true. */
  lint?: boolean | readonly UILintIssue[];
  /** Draw tap areas (hitPadding) of controls (default true). */
  hit?: boolean;
  /** Label controls and texts with their kind (default false). */
  labels?: boolean;
  /** Outline containers too (default true). */
  containers?: boolean;
}

/**
 * Debug overlay in stage coordinates: containers (blue), controls (green, tap area lighter), text (yellow),
 * lint issues (red = error, orange = warn). Use as a screenshot overlay:
 * `t.screenshot(file, { overlay: (ctx, game) => drawUIBounds(ctx, game.stage, { game }) })`.
 */
export function drawUIBounds(ctx: Ctx2D, root: Node, opts: UIBoundsOptions = {}): void {
  const game = opts.game === undefined ? Game.current : opts.game;
  flushUILayout(root);
  const items = collect(root);
  ctx.save();
  ctx.lineWidth = 2;
  const stroke = (r: Rect, color: string, width = 2) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.rect(r.x + width / 2, r.y + width / 2, Math.max(0, r.w - width), Math.max(0, r.h - width));
    ctx.stroke();
  };
  const tag = (r: Rect, text: string, color: string) => {
    ctx.font = 'bold 16px sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const w = ctx.measureText(text).width + 8;
    const y = r.y >= 20 ? r.y - 20 : r.y;
    ctx.fillStyle = color;
    ctx.fillRect(r.x, y, w, 20);
    ctx.fillStyle = '#000000';
    ctx.fillText(text, r.x + 4, y + 2);
  };
  for (const it of items) {
    if (!it.vis || it.n === root || it.alpha <= 0.01 || it.occluded) continue;
    if (it.role === 'control') {
      if (opts.hit !== false && it.n.hitPadding > 0 && !it.clipped) {
        const p = it.n.hitPadding * worldScale(it.n);
        stroke({ x: it.rect.x - p, y: it.rect.y - p, w: it.rect.w + 2 * p, h: it.rect.h + 2 * p }, 'rgba(60,255,120,0.45)', 2);
      }
      stroke(it.vis, 'rgba(60,255,120,0.95)', 2);
      if (opts.labels) tag(it.vis, uiNodeName(it.n), 'rgba(60,255,120,0.9)');
    } else if (it.text) {
      stroke(it.vis, 'rgba(255,220,60,0.9)', 1.5);
      if (opts.labels) tag(it.vis, it.n.kind, 'rgba(255,220,60,0.9)');
    } else if (opts.containers !== false && isUIHost(it.n) && it.role !== 'blocker') {
      stroke(it.vis, 'rgba(80,160,255,0.6)', 1);
    }
  }
  const issues = opts.lint === false ? [] : Array.isArray(opts.lint) ? opts.lint : lintUI(root, game ?? null);
  for (const i of issues as readonly UILintIssue[]) {
    const color = i.severity === 'error' ? 'rgba(255,50,50,1)' : 'rgba(255,150,0,1)';
    stroke(i.rect, color, 4);
    tag(i.rect, i.rule, color);
  }
  if (game) stroke(game.safe, 'rgba(255,0,255,0.5)', 2);
  ctx.restore();
}
