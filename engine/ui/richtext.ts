import type { ShadowStyle } from '../scene/box';
import { fontString, textMeasurer, tokenize } from '../scene/text';
import type { Ctx2D } from '../gfx/types';
import { platform } from '../platform/current';
import { drawUIIcon } from './icon';
import type { Size } from './layout';
import { uiColor, uiFontFamily, uiTheme, type UIColor, type UITextVariant } from './theme';
import { UIView, type UINodeProps } from './view';

interface RichStyle {
  color: UIColor;
  bold: boolean;
  italic: boolean;
  size: number;
}

/** A styled run of a RichText string (text or an inline icon). */
export type RichTextRun = { text: string; icon?: undefined; style: RichStyle } | { icon: string; text?: undefined; style: RichStyle };

const TAG = /\[(\/?)(color|b|i|size|icon)(?:=([^\]]*))?\]/g;

/**
 * Parses RichText markup into runs: `[color=#f55]red[/color]` (also theme tokens: `[color=gold]`), `[b]bold[/b]`,
 * `[i]italic[/i]`, `[size=40]big[/size]`, `[icon=coin]` (inline icon, sized to the text). Unknown tags stay literal.
 */
export function parseRichText(src: string, base: RichStyle): RichTextRun[] {
  const out: RichTextRun[] = [];
  const stack: RichStyle[] = [base];
  const top = () => stack[stack.length - 1]!;
  let last = 0;
  const pushText = (t: string) => {
    if (t) out.push({ text: t, style: top() });
  };
  for (const m of src.matchAll(TAG)) {
    pushText(src.slice(last, m.index));
    last = m.index! + m[0].length;
    const [, close, tag, arg] = m;
    if (tag === 'icon') {
      if (!close && arg) out.push({ icon: arg, style: top() });
      continue;
    }
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const s = { ...top() };
    if (tag === 'color' && arg) s.color = arg;
    else if (tag === 'b') s.bold = true;
    else if (tag === 'i') s.italic = true;
    else if (tag === 'size' && arg && !isNaN(parseFloat(arg))) s.size = parseFloat(arg);
    stack.push(s);
  }
  pushText(src.slice(last));
  return out;
}

/** Markup with tags removed (icons become their name in braces, e.g. `{coin}`). */
export function stripRichText(src: string): string {
  return src.replace(TAG, (_m, close: string, tag: string, arg: string | undefined) => (tag === 'icon' && !close && arg ? `{${arg}}` : ''));
}

interface Item {
  text: string;
  icon: string | null;
  style: RichStyle;
  w: number;
  br: boolean;
}

interface Line {
  items: { item: Item; x: number }[];
  w: number;
  size: number;
}

export interface RichTextProps extends UINodeProps {
  variant?: UITextVariant;
  color?: UIColor;
  size?: number;
  weight?: 'normal' | 'bold';
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  maxLines?: number;
  stroke?: { color: UIColor; width: number } | null;
  shadow?: ShadowStyle | null;
}

/**
 * Text with inline styling and icons (see parseRichText for the markup); wraps to the width its container gives
 * it, like Label. `text` in dumps/selectors is the plain text.
 */
export class RichText extends UIView {
  private _markup: string;
  private props: RichTextProps;
  private runs: RichTextRun[] = [];
  private lines: Line[] = [];
  private _truncated = false;

  constructor(markup: string, props: RichTextProps = {}) {
    const { variant, color, size, weight, align, lineHeight, maxLines, stroke, shadow, ...node } = props;
    super(node, 'RichText');
    this.props = { ...props };
    this._markup = markup;
    this.parse();
  }

  get markup(): string {
    return this._markup;
  }

  set markup(v: string) {
    if (v === this._markup) return;
    this._markup = v;
    this.parse();
    this.markLayoutDirty();
  }

  /** Plain text (tags stripped). */
  get text(): string {
    return stripRichText(this._markup);
  }

  get truncated(): boolean {
    return this._truncated;
  }

  get lineCount(): number {
    return this.lines.length;
  }

  /** Updates text props (color, size, align...) and re-lays out. */
  restyle(p: Partial<Omit<RichTextProps, keyof UINodeProps>>): this {
    Object.assign(this.props, p);
    this.parse();
    this.markLayoutDirty();
    return this;
  }

  private base(): RichStyle {
    const ty = uiTheme().typography[this.props.variant ?? 'body'];
    return {
      color: this.props.color ?? ty.color,
      bold: (this.props.weight ?? ty.weight) === 'bold',
      italic: false,
      size: this.props.size ?? ty.size,
    };
  }

  private get lh(): number {
    return this.props.lineHeight ?? uiTheme().typography[this.props.variant ?? 'body'].lineHeight ?? 1.35;
  }

  private parse(): void {
    this.runs = parseRichText(this._markup, this.base());
  }

  private font(s: RichStyle): string {
    return fontString({
      fontStyle: s.italic ? 'italic' : 'normal',
      fontWeight: s.bold ? 'bold' : 'normal',
      fontSize: s.size,
      fontFamily: uiFontFamily() ?? platform().fontFamily,
    });
  }

  private items(): Item[] {
    const out: Item[] = [];
    for (const r of this.runs) {
      if (r.icon !== undefined) {
        out.push({ text: '', icon: r.icon, style: r.style, w: Math.round(r.style.size * 1.15), br: false });
        continue;
      }
      const m = textMeasurer(this.font(r.style));
      r.text.split('\n').forEach((para, i) => {
        if (i > 0) out.push({ text: '', icon: null, style: r.style, w: 0, br: true });
        for (const t of tokenize(para)) out.push({ text: t, icon: null, style: r.style, w: m(t), br: false });
      });
    }
    return out;
  }

  /** Wraps the runs at maxW (Infinity = no wrapping). */
  private breakLines(maxW: number): { lines: Line[]; truncated: boolean } {
    const lines: Line[] = [];
    const baseSize = this.base().size;
    let cur: Line = { items: [], w: 0, size: 0 };
    const flush = () => {
      while (cur.items.length && cur.items[cur.items.length - 1]!.item.text.trim() === '' && !cur.items[cur.items.length - 1]!.item.icon) {
        cur.items.pop();
      }
      const lastIt = cur.items[cur.items.length - 1];
      cur.w = lastIt ? lastIt.x + lastIt.item.w : 0;
      if (!cur.size) cur.size = baseSize;
      lines.push(cur);
      cur = { items: [], w: 0, size: 0 };
    };
    const place = (it: Item) => {
      cur.items.push({ item: it, x: cur.w });
      cur.w += it.w;
      cur.size = Math.max(cur.size, it.style.size);
    };
    for (const it of this.items()) {
      if (it.br) {
        cur.size = Math.max(cur.size, it.style.size);
        flush();
        continue;
      }
      const blank = !it.icon && it.text.trim() === '';
      if (blank && cur.items.length === 0 && lines.length > 0) continue;
      if (cur.w + it.w <= maxW + 0.5 || cur.items.length === 0) {
        if (it.w > maxW && !it.icon && [...it.text].length > 1) {
          const m = textMeasurer(this.font(it.style));
          let part = '';
          for (const ch of it.text) {
            if (part && cur.w + m(part + ch) > maxW) {
              place({ ...it, text: part, w: m(part) });
              flush();
              part = '';
            }
            part += ch;
          }
          if (part) place({ ...it, text: part, w: m(part) });
        } else place(it);
        continue;
      }
      if (blank) continue;
      flush();
      place(it);
    }
    if (cur.items.length || lines.length === 0) flush();
    const maxLines = this.props.maxLines ?? 0;
    let truncated = false;
    if (maxLines > 0 && lines.length > maxLines) {
      lines.length = maxLines;
      const ln = lines[maxLines - 1]!;
      const style = ln.items[ln.items.length - 1]?.item.style ?? this.base();
      const ell = textMeasurer(this.font(style))('\u2026');
      while (ln.items.length && ln.w + ell > maxW) {
        ln.items.pop();
        const l = ln.items[ln.items.length - 1];
        ln.w = l ? l.x + l.item.w : 0;
      }
      ln.items.push({ item: { text: '\u2026', icon: null, style, w: ell, br: false }, x: ln.w });
      ln.w += ell;
      truncated = true;
    }
    return { lines, truncated };
  }

  private heightOf(lines: Line[]): number {
    let h = 0;
    for (const l of lines) h += l.size * this.lh;
    return Math.ceil(h);
  }

  override measureContent(availW: number, _h: number, fixedW: boolean): Size {
    if (fixedW) return { w: availW, h: this.heightOf(this.breakLines(availW).lines) };
    const nat = this.breakLines(Infinity);
    let w = 0;
    for (const l of nat.lines) w = Math.max(w, l.w);
    if (w <= availW + 0.5) return { w: Math.ceil(w), h: this.heightOf(nat.lines) };
    return { w: availW, h: this.heightOf(this.breakLines(availW).lines) };
  }

  override minContentWidth(): number {
    let w = 0;
    for (const it of this.items()) w = Math.max(w, it.icon ? it.w : it.text.trim() ? it.w : 0);
    return Math.ceil(w);
  }

  override arrangeContent(innerW: number): void {
    const r = this.breakLines(Math.max(1, innerW));
    this.lines = r.lines;
    this._truncated = r.truncated;
  }

  /** Smallest font size and the distinct text colors (for lint). */
  uiTextInfo(): { text: string; size: number; colors: string[]; stroke: { color: string; width: number } | null } {
    let size = Infinity;
    const colors = new Set<string>();
    for (const r of this.runs) {
      if (r.icon !== undefined || !r.text.trim()) continue;
      size = Math.min(size, r.style.size);
      colors.add(uiColor(r.style.color));
    }
    const st = this.props.stroke;
    return {
      text: this.text,
      size: isFinite(size) ? size : this.base().size,
      colors: [...colors],
      stroke: st ? { color: uiColor(st.color), width: st.width } : null,
    };
  }

  override draw(ctx: Ctx2D): void {
    super.draw(ctx);
    const align = this.props.align ?? 'left';
    const lh = this.lh;
    const st = this.props.stroke;
    const sh = this.props.shadow;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let y = 0;
    for (const ln of this.lines) {
      const h = ln.size * lh;
      const baseline = y + (h - ln.size) / 2 + ln.size * 0.84;
      const x0 = align === 'center' ? (this.width - ln.w) / 2 : align === 'right' ? this.width - ln.w : 0;
      for (const { item, x } of ln.items) {
        const color = uiColor(item.style.color);
        if (item.icon) {
          const s = item.w;
          const cy = baseline - ln.size * 0.34;
          drawUIIcon(ctx, item.icon, x0 + x + s * 0.04, cy - s / 2, s * 0.92, s * 0.92, color);
          continue;
        }
        if (!item.text.trim()) continue;
        ctx.font = this.font(item.style);
        if (sh) {
          ctx.shadowColor = sh.color;
          ctx.shadowBlur = sh.blur;
          ctx.shadowOffsetX = sh.x ?? 0;
          ctx.shadowOffsetY = sh.y ?? 0;
        }
        if (st && st.width > 0) {
          ctx.strokeStyle = uiColor(st.color);
          ctx.lineWidth = st.width;
          ctx.lineJoin = 'round';
          ctx.strokeText(item.text, x0 + x, baseline);
          ctx.shadowColor = 'transparent';
        }
        ctx.fillStyle = color;
        ctx.fillText(item.text, x0 + x, baseline);
        ctx.shadowColor = 'transparent';
      }
      y += h;
    }
    if (sh) ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    if (st) ctx.lineJoin = 'miter';
  }

  override describe() {
    return {
      ...super.describe(),
      text: this.text,
      lines: this.lines.length > 1 ? this.lines.length : undefined,
      truncated: this._truncated || undefined,
    };
  }
}
