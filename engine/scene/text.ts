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
  /** Max lines (0 = unlimited). Overflow is cut and ends with '…'. */
  maxLines: number;
  stroke: { color: Color; width: number } | null;
  shadow: { color: Color; blur: number; x?: number; y?: number } | null;
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

const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;
/** Characters that must not start a line (they stick to the previous token). */
const NO_LINE_START = /^[，。！？、；：）」』】》〉”’…,.!?;:)\]}%]$/;
/** Characters that must not end a line (they stick to the next token). */
const NO_LINE_END = /^[（「『【《〈“‘(\[{]$/;

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

/**
 * Text label. Size is automatic: height = lines * lineHeight; width = wrapWidth if set, else the widest line.
 * CJK text wraps per character with basic line-start/line-end punctuation rules.
 */
export class Text extends Node {
  private _text = '';
  private _style: TextStyle;
  private _lines: string[] = [];
  private _truncated = false;
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

  get lineHeightPx(): number {
    return this._style.fontSize * this._style.lineHeight;
  }

  /** Recomputes lines and size. Called automatically when text or style changes. */
  relayout(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const st = this._style;
    const ctx = measureContext();
    ctx.font = fontString(st);
    const measure = (s: string) => ctx.measureText(s).width;
    let lines = wrapText(this._text, st.wrapWidth, measure);
    this._truncated = false;
    if (st.maxLines > 0 && lines.length > st.maxLines) {
      lines = lines.slice(0, st.maxLines);
      const limit = st.wrapWidth > 0 ? st.wrapWidth : Infinity;
      let last = lines[st.maxLines - 1]!;
      while (last.length > 0 && measure(last + '…') > limit) last = [...last].slice(0, -1).join('');
      lines[st.maxLines - 1] = last + '…';
      this._truncated = true;
    }
    this._lines = lines;
    let maxW = 0;
    for (const l of lines) maxW = Math.max(maxW, measure(l));
    this.width = st.wrapWidth > 0 ? st.wrapWidth : Math.ceil(maxW);
    this.height = Math.ceil(lines.length * this.lineHeightPx);
  }

  /** Width of the widest rendered line (may be less than width when wrapWidth is set). */
  measureContentWidth(): number {
    const ctx = measureContext();
    ctx.font = fontString(this._style);
    let maxW = 0;
    for (const l of this._lines) maxW = Math.max(maxW, ctx.measureText(l).width);
    return maxW;
  }

  override draw(ctx: Ctx2D): void {
    const st = this._style;
    if (this._lines.length === 0) return;
    ctx.font = fontString(st);
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
      size: this._style.fontSize,
      color: this._style.color,
      lines: this._lines.length > 1 ? this._lines.length : undefined,
      truncated: this._truncated || undefined,
    };
  }
}
