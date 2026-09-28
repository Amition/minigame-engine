import type { Color } from '../core/color';
import type { Ctx2D } from '../gfx/types';
import { platform } from '../platform/current';
import type { Platform } from '../platform/types';
import { Node, type NodeOptions } from './node';

export interface TextStyle {
  /** CSS font-family; default: the platform's CJK-friendly stack. */
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold' | number;
  fontStyle: 'normal' | 'italic';
  color: Color;
  align: 'left' | 'center' | 'right';
  /** Line height as a multiple of fontSize. */
  lineHeight: number;
  /** Wrap width in local units; 0 = no wrapping (single line per '\n'). */
  wrapWidth: number;
  /** Max lines (0 = unlimited). Overflow is cut and ends with an ellipsis (U+2026). */
  maxLines: number;
  stroke: { color: Color; width: number } | null;
  shadow: { color: Color; blur: number; x?: number; y?: number } | null;
  /**
   * Auto-fit: when > 0 and wrapWidth > 0, the font shrinks from fontSize down to this size until the text fits
   * wrapWidth within maxLines (1 line when maxLines is 0). Default 0 (off).
   */
  minFontSize?: number;
}

export const defaultTextStyle: Omit<TextStyle, 'fontFamily'> = {
  fontSize: 28,
  fontWeight: 'normal',
  fontStyle: 'normal',
  color: '#ffffff',
  align: 'left',
  lineHeight: 1.3,
  wrapWidth: 0,
  maxLines: 0,
  stroke: null,
  shadow: null,
};

const measureCtxs = new WeakMap<Platform, Ctx2D>();

/** Shared 2D context for text measurement on the current platform. */
export function measureContext(): Ctx2D {
  const p = platform();
  let ctx = measureCtxs.get(p);
  if (!ctx) {
    ctx = p.createCanvas(4, 4).getContext('2d');
    measureCtxs.set(p, ctx);
  }
  return ctx;
}

export function fontString(s: Pick<TextStyle, 'fontStyle' | 'fontWeight' | 'fontSize' | 'fontFamily'>): string {
  return `${s.fontStyle === 'italic' ? 'italic ' : ''}${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`;
}

const widthCache = new WeakMap<Ctx2D, Map<string, Map<string, number>>>();

/** Cached string-width function for a CSS font string (uses the shared measurement context). */
export function textMeasurer(font: string): (s: string) => number {
  const ctx = measureContext();
  let fonts = widthCache.get(ctx);
  if (!fonts) widthCache.set(ctx, (fonts = new Map()));
  let map = fonts.get(font);
  if (!map) {
    if (fonts.size > 96) fonts.clear();
    fonts.set(font, (map = new Map()));
  }
  const m = map;
  return (s: string) => {
    let w = m.get(s);
    if (w === undefined) {
      ctx.font = font;
      w = ctx.measureText(s).width;
      if (m.size > 4000) m.clear();
      m.set(s, w);
    }
    return w;
  };
}

const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;
/** Characters that must not start a line (they stick to the previous token). */
const NO_LINE_START = /^[\uff0c\u3002\uff01\uff1f\u3001\uff1b\uff1a\uff09\u300d\u300f\u3011\u300b\u3009\u201d\u2019\u2026,.!?;:)\]}%]$/;
/** Characters that must not end a line (they stick to the next token). */
const NO_LINE_END = /^[\uff08\u300c\u300e\u3010\u300a\u3008\u201c\u2018(\[{]$/;

/** Splits a paragraph into breakable tokens: CJK chars individually, latin words, spaces. */
export function tokenize(text: string): string[] {
  const raw: string[] = [];
  let word = '';
  for (const ch of text) {
    if (ch === ' ' || ch === '\t') {
      if (word) raw.push(word);
      word = '';
      raw.push(ch);
    } else if (CJK.test(ch) || NO_LINE_START.test(ch) || NO_LINE_END.test(ch)) {
      if (word) raw.push(word);
      word = '';
      raw.push(ch);
    } else {
      word += ch;
    }
  }
  if (word) raw.push(word);
  const out: string[] = [];
  let carry = '';
  for (const t of raw) {
    if (NO_LINE_START.test(t) && out.length > 0 && !carry) {
      out[out.length - 1] += t;
    } else if (NO_LINE_END.test(t)) {
      carry += t;
    } else {
      out.push(carry + t);
      carry = '';
    }
  }
  if (carry) out.push(carry);
  return out;
}

/** Greedy line breaking; `measure` returns the width of a string. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (maxWidth <= 0) {
      lines.push(para);
      continue;
    }
    let line = '';
    for (const tok of tokenize(para)) {
      const candidate = line + tok;
      if (line === '' || measure(candidate) <= maxWidth) {
        if (line === '' && measure(tok) > maxWidth) {
          for (const ch of tok) {
            if (line !== '' && measure(line + ch) > maxWidth) {
              lines.push(line);
              line = '';
            }
            line += ch;
          }
        } else {
          line = candidate;
        }
      } else {
        lines.push(line.replace(/\s+$/, ''));
        line = tok.trim() === '' ? '' : tok;
      }
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

/** Result of laying out a string with a text style (see layoutText). */
export interface TextLayout {
  lines: string[];
  truncated: boolean;
  /** Font size actually used (smaller than style.fontSize when minFontSize auto-fit kicked in). */
  fontSize: number;
  /** Box size as a Text node would report it (width = wrapWidth when wrapping). */
  width: number;
  height: number;
  /** Width of the widest line. */
  contentWidth: number;
}

function layoutAtSize(text: string, st: TextStyle, wrapWidth: number, fontSize: number) {
  const measure = textMeasurer(fontString({ ...st, fontSize }));
  const raw = wrapText(text, wrapWidth, measure);
  let lines = raw;
  let truncated = false;
  if (st.maxLines > 0 && lines.length > st.maxLines) {
    lines = lines.slice(0, st.maxLines);
    const limit = wrapWidth > 0 ? wrapWidth : Infinity;
    let last = lines[st.maxLines - 1]!;
    while (last.length > 0 && measure(last + '\u2026') > limit) last = [...last].slice(0, -1).join('');
    lines[st.maxLines - 1] = last + '\u2026';
    truncated = true;
  }
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, measure(l));
  return { raw: raw.length, lines, truncated, maxW };
}

/**
 * Pure text layout: wraps `text` at `wrapWidth` (default style.wrapWidth) and applies maxLines and minFontSize
 * auto-fit, without touching any node. Text nodes use it internally; layout code uses it to measure.
 */
export function layoutText(text: string, style: TextStyle, wrapWidth = style.wrapWidth): TextLayout {
  let size = style.fontSize;
  let r = layoutAtSize(text, style, wrapWidth, size);
  const minSize = style.minFontSize ?? 0;
  if (minSize > 0 && minSize < size && wrapWidth > 0) {
    const maxLines = style.maxLines > 0 ? style.maxLines : 1;
    while (size > minSize && r.raw > maxLines) {
      size = Math.max(minSize, Math.floor(size - Math.max(1, size * 0.06)));
      r = layoutAtSize(text, style, wrapWidth, size);
    }
  }
  return {
    lines: r.lines,
    truncated: r.truncated,
    fontSize: size,
    width: wrapWidth > 0 ? wrapWidth : Math.ceil(r.maxW),
    height: Math.ceil(r.lines.length * size * style.lineHeight),
    contentWidth: r.maxW,
  };
}

/** Largest font size in [minSize, style.fontSize] at which `text` fits maxWidth within maxLines. */
export function fitFontSize(
  text: string,
  style: Partial<TextStyle> & { fontSize: number },
  maxWidth: number,
  maxLines = 1,
  minSize = 12,
): number {
  const st: TextStyle = { ...defaultTextStyle, fontFamily: platform().fontFamily, ...style };
  return layoutText(text, { ...st, maxLines, minFontSize: minSize }, maxWidth).fontSize;
}

/**
 * Text label. Size is automatic: height = lines * lineHeight; width = wrapWidth if set, else the widest line.
 * CJK text wraps per character with basic line-start/line-end punctuation rules.
 */
export class Text extends Node {
  private _text = '';
  private _style: TextStyle;
  private _lines: string[] = [];
  private _truncated = false;
  private _fontSize = 0;
  private dirty = true;

  constructor(text: string | number = '', style: Partial<TextStyle> = {}, opts?: NodeOptions) {
    super();
    this._style = { ...defaultTextStyle, fontFamily: platform().fontFamily, ...style };
    this._text = String(text);
    this.relayout();
    if (opts) this.set(opts);
  }

  override get kind(): string {
    return 'Text';
  }

  get text(): string {
    return this._text;
  }

  set text(v: string | number) {
    const s = String(v);
    if (s === this._text) return;
    this._text = s;
    this.dirty = true;
    this.relayout();
  }

  get style(): Readonly<TextStyle> {
    return this._style;
  }

  setStyle(s: Partial<TextStyle>): this {
    this._style = { ...this._style, ...s };
    this.dirty = true;
    this.relayout();
    return this;
  }

  get lines(): readonly string[] {
    return this._lines;
  }

  /** True when maxLines cut the text. */
  get truncated(): boolean {
    return this._truncated;
  }

  /** Font size used for rendering (below style.fontSize when minFontSize auto-fit shrank it). */
  get fontSize(): number {
    return this._fontSize;
  }

  get lineHeightPx(): number {
    return this._fontSize * this._style.lineHeight;
  }

  /** Recomputes lines and size. Called automatically when text or style changes. */
  relayout(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const r = layoutText(this._text, this._style);
    this._lines = r.lines;
    this._truncated = r.truncated;
    this._fontSize = r.fontSize;
    this.width = r.width;
    this.height = r.height;
  }

  /** Width of the widest rendered line (may be less than width when wrapWidth is set). */
  measureContentWidth(): number {
    const measure = textMeasurer(this.cssFont());
    let maxW = 0;
    for (const l of this._lines) maxW = Math.max(maxW, measure(l));
    return maxW;
  }

  /** Size this text would have without wrapping (explicit '\n' breaks still apply). */
  measureNatural(): { width: number; height: number } {
    const r = layoutText(this._text, this._style, 0);
    return { width: Math.ceil(r.contentWidth), height: r.height };
  }

  /** Size and line count this text would have when wrapped at `width` (maxLines and auto-fit applied). */
  measureWrapped(width: number): { width: number; height: number; lines: number; truncated: boolean; fontSize: number } {
    const r = layoutText(this._text, this._style, Math.max(1, width));
    return { width: r.width, height: r.height, lines: r.lines.length, truncated: r.truncated, fontSize: r.fontSize };
  }

  /** Width of the widest unbreakable token: the narrowest this text can wrap to without breaking words. */
  minContentWidth(): number {
    const st = this._style;
    const size = st.minFontSize && st.minFontSize > 0 ? Math.min(st.minFontSize, st.fontSize) : st.fontSize;
    const measure = textMeasurer(fontString({ ...st, fontSize: size }));
    let maxW = 0;
    for (const para of this._text.split('\n')) for (const tok of tokenize(para)) maxW = Math.max(maxW, measure(tok.trim()));
    return Math.ceil(maxW);
  }

  /** Shrinks the font (down to minSize) so the text fits maxWidth within maxLines. Sets wrapWidth = maxWidth. */
  autoFit(maxWidth: number, opts: { maxLines?: number; minSize?: number } = {}): this {
    return this.setStyle({ wrapWidth: maxWidth, maxLines: opts.maxLines ?? 1, minFontSize: opts.minSize ?? 16 });
  }

  private cssFont(): string {
    return fontString({ ...this._style, fontSize: this._fontSize });
  }

  override draw(ctx: Ctx2D): void {
    const st = this._style;
    if (this._lines.length === 0) return;
    ctx.font = this.cssFont();
    ctx.textBaseline = 'middle';
    ctx.textAlign = st.align;
    const lh = this.lineHeightPx;
    const x = st.align === 'left' ? 0 : st.align === 'center' ? this.width / 2 : this.width;
    if (st.shadow) {
      ctx.shadowColor = st.shadow.color;
      ctx.shadowBlur = st.shadow.blur;
      ctx.shadowOffsetX = st.shadow.x ?? 0;
      ctx.shadowOffsetY = st.shadow.y ?? 0;
    }
    if (st.stroke && st.stroke.width > 0) {
      ctx.strokeStyle = st.stroke.color;
      ctx.lineWidth = st.stroke.width;
      ctx.lineJoin = 'round';
      for (let i = 0; i < this._lines.length; i++) ctx.strokeText(this._lines[i]!, x, i * lh + lh / 2);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = st.color;
    for (let i = 0; i < this._lines.length; i++) ctx.fillText(this._lines[i]!, x, i * lh + lh / 2);
  }

  override describe() {
    return {
      ...super.describe(),
      text: this._text,
      size: this._fontSize,
      color: this._style.color,
      lines: this._lines.length > 1 ? this._lines.length : undefined,
      truncated: this._truncated || undefined,
    };
  }
}
