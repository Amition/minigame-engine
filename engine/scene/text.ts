import type { Color } from '../core/color';
import { Game } from '../core/game';
import type { Mat2D } from '../core/math';
import type { Ctx2D } from '../gfx/types';
import { platform } from '../platform/current';
import type { Platform } from '../platform/types';
import { Node, type NodeOptions } from './node';
import { acquireTextBitmap, releaseTextBitmap, type TextBitmap } from './text-bitmap';

export { clearTextBitmaps, setTextBitmapBudget, textBitmapStats, type TextBitmapStats } from './text-bitmap';

/**
 * How a Text node draws: 'bitmap' rasterizes its lines once into an offscreen canvas at screen resolution and
 * blits it; 'none' calls fillText/strokeText every frame; 'auto' picks the bitmap for stroked/shadowed text
 * and for text unchanged for ~30 frames, and draws text that changes often (counters) directly.
 */
export type TextCacheMode = 'auto' | 'bitmap' | 'none';

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
  /** Bitmap cache mode (default 'auto'), see TextCacheMode. */
  cache?: TextCacheMode;
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

type FontFields = Pick<TextStyle, 'fontStyle' | 'fontWeight' | 'fontSize' | 'fontFamily'>;
interface FontMemo {
  fontStyle: TextStyle['fontStyle'];
  fontWeight: TextStyle['fontWeight'];
  fontFamily: string;
  size: number;
  font: string;
}
const fontMemos = new WeakMap<object, FontMemo>();

/** fontString(style) at `size` (default style.fontSize), cached per style object: no allocation on a hit. */
export function textStyleFont(st: FontFields, size = st.fontSize): string {
  const m = fontMemos.get(st);
  if (m && m.size === size && m.fontFamily === st.fontFamily && m.fontWeight === st.fontWeight && m.fontStyle === st.fontStyle) {
    return m.font;
  }
  const font = `${st.fontStyle === 'italic' ? 'italic ' : ''}${st.fontWeight} ${size}px ${st.fontFamily}`;
  if (m) {
    m.fontStyle = st.fontStyle;
    m.fontWeight = st.fontWeight;
    m.fontFamily = st.fontFamily;
    m.size = size;
    m.font = font;
  } else {
    fontMemos.set(st, { fontStyle: st.fontStyle, fontWeight: st.fontWeight, fontFamily: st.fontFamily, size, font });
  }
  return font;
}

interface MeasurerSet {
  /** Private context, so its font only changes here. */
  ctx: Ctx2D;
  font: string;
  byFont: Map<string, (s: string) => number>;
}
const measurerSets = new WeakMap<Platform, MeasurerSet>();

/** Cached string-width function for a CSS font string (same function for the same font until the cache rolls over). */
export function textMeasurer(font: string): (s: string) => number {
  const p = platform();
  let set = measurerSets.get(p);
  if (!set) measurerSets.set(p, (set = { ctx: p.createCanvas(4, 4).getContext('2d'), font: '', byFont: new Map() }));
  let fn = set.byFont.get(font);
  if (fn) return fn;
  if (set.byFont.size > 96) set.byFont.clear();
  const s0 = set;
  const widths = new Map<string, number>();
  fn = (s: string) => {
    let w = widths.get(s);
    if (w === undefined) {
      if (s0.font !== font) {
        s0.ctx.font = font;
        s0.font = font;
      }
      w = s0.ctx.measureText(s).width;
      if (widths.size > 4000) widths.clear();
      widths.set(s, w);
    }
    return w;
  };
  set.byFont.set(font, fn);
  return fn;
}

// Character classes for line breaking.
const K_WORD = 0;
const K_SPACE = 1;
/** CJK: a token on its own (break before and after). */
const K_SOLO = 2;
/** Must not start a line: sticks to the previous token. */
const K_NO_START = 3;
/** Must not end a line: sticks to the next token. */
const K_NO_END = 4;

const ASCII_KIND = new Uint8Array(128);
ASCII_KIND[32] = ASCII_KIND[9] = K_SPACE;
for (const ch of ',.!?;:)]}%') ASCII_KIND[ch.charCodeAt(0)] = K_NO_START;
for (const ch of '([{') ASCII_KIND[ch.charCodeAt(0)] = K_NO_END;
const NO_START_CODES = new Set<number>();
for (const ch of '\uff0c\u3002\uff01\uff1f\u3001\uff1b\uff1a\uff09\u300d\u300f\u3011\u300b\u3009\u201d\u2019\u2026') NO_START_CODES.add(ch.charCodeAt(0));
const NO_END_CODES = new Set<number>();
for (const ch of '\uff08\u300c\u300e\u3010\u300a\u3008\u201c\u2018') NO_END_CODES.add(ch.charCodeAt(0));

function charKind(c: number): number {
  if (c < 128) return ASCII_KIND[c]!;
  if (NO_START_CODES.has(c)) return K_NO_START;
  if (NO_END_CODES.has(c)) return K_NO_END;
  if ((c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef)) {
    return K_SOLO;
  }
  return K_WORD;
}

/** Appends a raw token with the punctuation rules; returns the new carry (pending no-line-end prefix). */
function pushToken(out: string[], t: string, kind: number, carry: string): string {
  if (kind === K_NO_START && out.length > 0 && !carry) {
    out[out.length - 1] += t;
    return carry;
  }
  if (kind === K_NO_END) return carry + t;
  out.push(carry ? carry + t : t);
  return '';
}

/** Splits a paragraph into breakable tokens: CJK chars individually, latin words, spaces. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let carry = '';
  let wordStart = -1;
  for (let i = 0; i < text.length; i++) {
    const k = charKind(text.charCodeAt(i));
    if (k === K_WORD) {
      if (wordStart < 0) wordStart = i;
      continue;
    }
    if (wordStart >= 0) {
      carry = pushToken(out, text.slice(wordStart, i), K_WORD, carry);
      wordStart = -1;
    }
    carry = pushToken(out, text[i]!, k, carry);
  }
  if (wordStart >= 0) carry = pushToken(out, text.slice(wordStart), K_WORD, carry);
  if (carry) out.push(carry);
  return out;
}

/** Same set as the regex `\s`. */
function isSpaceCode(c: number): boolean {
  return (
    c === 32 || (c >= 9 && c <= 13) || c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 ||
    c === 8239 || c === 8287 || c === 12288 || c === 65279
  );
}

/** s.replace(/\s+$/, '') without a regex. */
function trimEndSpaces(s: string): string {
  let e = s.length;
  while (e > 0 && isSpaceCode(s.charCodeAt(e - 1))) e--;
  return e === s.length ? s : s.slice(0, e);
}

/** Greedy line breaking; `measure` returns the width of a string. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (maxWidth <= 0) return text.split('\n');
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    // Widths grow with every appended glyph, so a paragraph that fits as a whole is exactly one greedy line.
    if (measure(para) <= maxWidth) {
      lines.push(trimEndSpaces(para));
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
        lines.push(trimEndSpaces(line));
        line = tok.trim() === '' ? '' : tok;
      }
    }
    lines.push(trimEndSpaces(line));
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

/** s without its last code point. */
function dropLastChar(s: string): string {
  const n = s.length;
  if (n >= 2) {
    const lo = s.charCodeAt(n - 1);
    const hi = s.charCodeAt(n - 2);
    if (lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff) return s.slice(0, n - 2);
  }
  return s.slice(0, n - 1);
}

function layoutAtSize(text: string, st: TextStyle, wrapWidth: number, fontSize: number) {
  const measure = textMeasurer(textStyleFont(st, fontSize));
  const raw = wrapText(text, wrapWidth, measure);
  let lines = raw;
  let truncated = false;
  if (st.maxLines > 0 && lines.length > st.maxLines) {
    lines = lines.slice(0, st.maxLines);
    const limit = wrapWidth > 0 ? wrapWidth : Infinity;
    let last = lines[st.maxLines - 1]!;
    while (last.length > 0 && measure(last + '\u2026') > limit) last = dropLastChar(last);
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

/** Size of a text wrapped at some width (Text.measureWrapped). */
export interface TextWrappedSize {
  width: number;
  height: number;
  lines: number;
  truncated: boolean;
  fontSize: number;
}

interface LayoutMemo {
  wrap: number;
  layout: TextLayout;
  natural: { width: number; height: number } | null;
  wrapped: TextWrappedSize | null;
}

/** Style keys that only change how lines are painted (no relayout, no re-measure). */
const PAINT_KEYS: Record<string, true> = { color: true, align: true, stroke: true, shadow: true, cache: true };
const MEMO_SIZE = 4;

/** Equal style values; stroke / shadow objects compare field by field. */
function sameStyleValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const k in x) if (x[k] !== y[k]) return false;
  for (const k in y) if (x[k] !== y[k]) return false;
  return true;
}

// 'auto' cache heuristics, in frames (Game.time.frame).
/** Text unchanged this long is drawn from a bitmap. */
const AUTO_QUIET_FRAMES = 30;
/** Changes closer together than this count as one burst... */
const VOLATILE_WINDOW = 60;
/** ...and this many in a burst make stroked/shadowed text draw directly until it is quiet again. */
const VOLATILE_CHANGES = 2;
/** Bitmap resolution that differs by more than this factor re-bakes during scale animations... */
const REBAKE_RATIO = 1.25;
/** ...at most once per this many frames. */
const REBAKE_MIN_FRAMES = 6;
/** A new resolution / sub-pixel phase that holds this long re-bakes to match it exactly. */
const SETTLE_FRAMES = 6;
/** Frames to wait before trying again when a bake was refused (budget / per-frame limit). */
const RETRY_FRAMES = 10;
/** 'auto' draws directly above this zoom (backing px per local unit); 'bitmap' caps its resolution here. */
const MAX_AUTO_RES = 3;
const MAX_RES = 4;
/** Vertical ink half-extent around a line's middle, in em (accents, descenders, CJK). */
const INK_HALF_EM = 0.75;

let frameGame: Game | null = null;
let frameOffset = 0;
let frameMax = 0;

/**
 * Frame clock for the cache heuristics: the current game's frame number, kept increasing across games (tests make
 * many); -1 without a game (no frame-based heuristics or limits).
 */
function currentFrame(): number {
  const g = Game.current;
  if (!g) return -1;
  if (g !== frameGame) {
    frameGame = g;
    frameOffset = frameMax + 1 - g.time.frame;
  }
  const f = frameOffset + g.time.frame;
  if (f > frameMax) frameMax = f;
  return f;
}

/** Scratch: local -> backing-pixel mapping of the node being drawn (x' = sx * x + tx). */
const dev = { sx: 1, sy: 1, tx: 0, ty: 0, axis: true };

/**
 * Fills `dev` from the render-time matrix when there is one (exact: includes camera, cache and render-override
 * offsets), else by walking the parent chain (no allocation). `axis` = no rotation, skew or flip on the way.
 */
function mapToDevice(node: Node, m: Readonly<Mat2D> | null): void {
  if (m) {
    const axis = m.b === 0 && m.c === 0 && m.a > 0 && m.d > 0;
    dev.sx = axis ? m.a : Math.hypot(m.a, m.b);
    dev.sy = axis ? m.d : Math.hypot(m.c, m.d);
    dev.tx = m.e;
    dev.ty = m.f;
    dev.axis = axis;
    return;
  }
  let sx = 1;
  let sy = 1;
  let tx = 0;
  let ty = 0;
  let axis = true;
  for (let n: Node | null = node; n; n = n.parent) {
    if (n.rotation !== 0 || n.skewX !== 0 || n.skewY !== 0) axis = false;
    tx = n.x + n.scaleX * (tx - n.anchorX * n.width);
    ty = n.y + n.scaleY * (ty - n.anchorY * n.height);
    sx *= n.scaleX;
    sy *= n.scaleY;
  }
  const g = Game.current;
  const k = g ? g.pixelRatio * g.scale : 1;
  dev.sx = sx * k;
  dev.sy = sy * k;
  dev.tx = tx * k + (g ? g.offsetX * g.pixelRatio : 0);
  dev.ty = ty * k + (g ? g.offsetY * g.pixelRatio : 0);
  dev.axis = axis && sx > 0 && sy > 0;
}

/**
 * Fractional part of a device coordinate, rounded only to absorb float noise: rasterizers snap glyphs to their own
 * sub-pixel grid, so any coarser phase (or resolution) moves some glyphs by a whole grid step.
 */
function phaseOf(v: number): number {
  const q = Math.round((v - Math.floor(v)) * 1e6) / 1e6;
  return q >= 1 ? 0 : q;
}

/**
 * Text label. Size is automatic: height = lines * lineHeight; width = wrapWidth if set, else the widest line.
 * CJK text wraps per character with basic line-start/line-end punctuation rules.
 * Measurements are memoized per text + style; static labels are drawn from a shared bitmap (TextStyle.cache).
 */
export class Text extends Node {
  private _text = '';
  private _style: TextStyle;
  private _lines: string[] = [];
  private _truncated = false;
  private _fontSize = 0;
  private _font = '';
  private _contentWidth = 0;
  private dirty = true;
  private _memo: LayoutMemo[] = [];
  private _minContent = -1;
  // bitmap cache state
  private _bmp: TextBitmap | null = null;
  /** Content signature (font, paint, lines) the ink box was computed for; recomputed after a relayout. */
  private _content = '';
  private _contentStale = true;
  private _inkX0 = 0;
  private _inkX1 = 0;
  private _inkY0 = 0;
  private _inkY1 = 0;
  private _changedAt = -1;
  private _changes = 0;
  private _bakedAt = -1;
  private _retryAt = -1;
  private _seenRes = 0;
  private _seenPX = 0;
  private _seenPY = 0;
  private _seenAt = -1;
  private _drawnAt = -1;

  constructor(text: string | number = '', style: Partial<TextStyle> = {}, opts?: NodeOptions) {
    super();
    this._style = { ...defaultTextStyle, fontFamily: platform().fontFamily, ...style };
    this._text = String(text);
    this._changedAt = currentFrame();
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
    this._memo.length = 0;
    this._minContent = -1;
    this.contentChanged();
    this.dirty = true;
    this.relayout();
  }

  get style(): Readonly<TextStyle> {
    return this._style;
  }

  /** Merges style props. Unchanged values are free; paint-only props (color, stroke, shadow, align) skip relayout. */
  setStyle(s: Partial<TextStyle>): this {
    const cur = this._style as unknown as Record<string, unknown>;
    const next = s as Record<string, unknown>;
    let wrap = false;
    let measure = false;
    let paint = false;
    for (const k in next) {
      if (sameStyleValue(cur[k], next[k])) continue;
      if (k === 'wrapWidth') wrap = true;
      else if (PAINT_KEYS[k]) paint = true;
      else measure = true;
    }
    if (!wrap && !measure && !paint) return this;
    this._style = { ...this._style, ...s };
    if (measure) {
      this._memo.length = 0;
      this._minContent = -1;
    }
    if (measure || paint) this.contentChanged();
    if (measure || wrap) {
      this.dirty = true;
      this.relayout();
    }
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
    const r = this.layoutAt(this._style.wrapWidth).layout;
    this._lines = r.lines;
    this._truncated = r.truncated;
    this._fontSize = r.fontSize;
    this._contentWidth = r.contentWidth;
    this._font = textStyleFont(this._style, r.fontSize);
    this._contentStale = true;
    this.width = r.width;
    this.height = r.height;
  }

  /** Width of the widest rendered line (may be less than width when wrapWidth is set). */
  measureContentWidth(): number {
    return this._contentWidth;
  }

  /** Size this text would have without wrapping (explicit '\n' breaks still apply). Memoized: don't mutate. */
  measureNatural(): Readonly<{ width: number; height: number }> {
    const e = this.layoutAt(0);
    return (e.natural ??= { width: Math.ceil(e.layout.contentWidth), height: e.layout.height });
  }

  /** Size and line count this text would have when wrapped at `width` (maxLines and auto-fit applied). Memoized. */
  measureWrapped(width: number): Readonly<TextWrappedSize> {
    const e = this.layoutAt(Math.max(1, width));
    if (!e.wrapped) {
      const r = e.layout;
      e.wrapped = { width: r.width, height: r.height, lines: r.lines.length, truncated: r.truncated, fontSize: r.fontSize };
    }
    return e.wrapped;
  }

  /** Width of the widest unbreakable token: the narrowest this text can wrap to without breaking words. */
  minContentWidth(): number {
    if (this._minContent >= 0) return this._minContent;
    const st = this._style;
    const size = st.minFontSize && st.minFontSize > 0 ? Math.min(st.minFontSize, st.fontSize) : st.fontSize;
    const measure = textMeasurer(textStyleFont(st, size));
    let maxW = 0;
    for (const para of this._text.split('\n')) for (const tok of tokenize(para)) maxW = Math.max(maxW, measure(tok.trim()));
    return (this._minContent = Math.ceil(maxW));
  }

  /** Shrinks the font (down to minSize) so the text fits maxWidth within maxLines. Sets wrapWidth = maxWidth. */
  autoFit(maxWidth: number, opts: { maxLines?: number; minSize?: number } = {}): this {
    return this.setStyle({ wrapWidth: maxWidth, maxLines: opts.maxLines ?? 1, minFontSize: opts.minSize ?? 16 });
  }

  /** Layout at a wrap width, memoized per text + measure-relevant style (a few widths per text). */
  private layoutAt(wrap: number): LayoutMemo {
    const memo = this._memo;
    for (let i = memo.length - 1; i >= 0; i--) if (memo[i]!.wrap === wrap) return memo[i]!;
    const e: LayoutMemo = { wrap, layout: layoutText(this._text, this._style, wrap), natural: null, wrapped: null };
    if (memo.length >= MEMO_SIZE) memo.shift();
    memo.push(e);
    return e;
  }

  override draw(ctx: Ctx2D): void {
    if (this._lines.length === 0 || this._text === '') return;
    const mode = this._style.cache ?? 'auto';
    if (mode !== 'none' && this.drawBitmap(ctx, mode)) return;
    this.paintLines(ctx, this.alignX());
  }

  protected override onDestroy(): void {
    this.dropBitmap();
    super.onDestroy();
  }

  private alignX(): number {
    const a = this._style.align;
    return a === 'left' ? 0 : a === 'center' ? this.width / 2 : this.width;
  }

  /** Draws the lines with fillText/strokeText, anchor at local x; leaves no shadow state behind. */
  private paintLines(ctx: Ctx2D, x: number): void {
    const st = this._style;
    const lines = this._lines;
    const lh = this.lineHeightPx;
    ctx.font = this._font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = st.align;
    const shadow = st.shadow;
    if (shadow) {
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = shadow.blur;
      ctx.shadowOffsetX = shadow.x ?? 0;
      ctx.shadowOffsetY = shadow.y ?? 0;
    }
    const stroke = st.stroke;
    if (stroke && stroke.width > 0) {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineJoin = 'round';
      for (let i = 0; i < lines.length; i++) ctx.strokeText(lines[i]!, x, i * lh + lh / 2);
      ctx.lineJoin = 'miter';
      if (shadow) ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = st.color;
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i]!, x, i * lh + lh / 2);
    if (shadow) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  // ---------------------------------------------------------------- bitmap cache

  /** Text or paint changed: the bitmap is stale, and 'auto' counts the change. */
  private contentChanged(): void {
    this.dropBitmap();
    this._contentStale = true;
    const f = currentFrame();
    if (f !== this._changedAt) {
      this._changes = f - this._changedAt < VOLATILE_WINDOW ? Math.min(this._changes + 1, 99) : 1;
      this._changedAt = f;
    }
  }

  private dropBitmap(): void {
    if (!this._bmp) return;
    releaseTextBitmap(this._bmp);
    this._bmp = null;
  }

  /** Recomputes the content signature and the unpadded ink box (x relative to the align anchor). */
  private refreshContent(): void {
    this._contentStale = false;
    const st = this._style;
    const s = st.stroke && st.stroke.width > 0 ? st.stroke : null;
    const sh = st.shadow;
    const content =
      `${this._font}|${st.color}|${s ? `${s.color},${s.width}` : ''}|${sh ? `${sh.color},${sh.blur},${sh.x ?? 0},${sh.y ?? 0}` : ''}` +
      `|${st.lineHeight}|${st.align}|${this._lines.join('\n')}`;
    if (content === this._content) return;
    this._content = content;
    if (this._bmp) this.dropBitmap();
    const measure = textMeasurer(this._font);
    let x0 = 0;
    let x1 = 0;
    for (const l of this._lines) {
      const w = measure(l);
      const l0 = st.align === 'left' ? 0 : st.align === 'center' ? -w / 2 : -w;
      x0 = Math.min(x0, l0);
      x1 = Math.max(x1, l0 + w);
    }
    const lh = this.lineHeightPx;
    const ext = INK_HALF_EM * this._fontSize;
    const n = this._lines.length;
    this._inkX0 = x0;
    this._inkX1 = x1;
    this._inkY0 = Math.min(0, lh / 2 - ext);
    this._inkY1 = Math.max(n * lh, (n - 1) * lh + lh / 2 + ext);
  }

  /** Draws from the shared bitmap; false = draw directly this frame. */
  private drawBitmap(ctx: Ctx2D, mode: TextCacheMode): boolean {
    const st = this._style;
    const f = currentFrame();
    let b = this._bmp;
    if (b && !b.surface) b = this._bmp = null;
    const auto = mode === 'auto';
    const decorated = (st.stroke !== null && st.stroke.width > 0) || st.shadow !== null;
    if (auto) {
      const quiet = f >= 0 && f - this._changedAt >= AUTO_QUIET_FRAMES;
      if (!quiet && !(decorated && this._changes < VOLATILE_CHANGES)) {
        if (b) this.dropBitmap();
        return false;
      }
    }
    mapToDevice(this, this.renderMatrix);
    const res = Math.max(Math.abs(dev.sx), Math.abs(dev.sy));
    if (!(res >= 0.05)) return false;
    // 'auto' keeps fillText where a blit would resample: zoomed in far, or rotated plain text
    if (auto && (res > MAX_AUTO_RES || (!dev.axis && !decorated))) return false;
    if (this._contentStale) {
      this.refreshContent();
      b = this._bmp;
    }
    if (this._inkX1 <= this._inkX0) return false;
    const need = Math.min(res, MAX_RES);
    const ax = this.alignX();
    const px = dev.axis ? phaseOf(dev.sx * ax + dev.tx) : 0;
    const py = dev.axis ? phaseOf(dev.ty) : 0;
    // Not drawn in the last frames (sparse rendering such as headless shots, or just shown again): nothing is
    // animating from the old bitmap's point of view, so a stale one would only be blitted misaligned.
    const sparse = f < 0 || f - this._drawnAt > 2;
    this._drawnAt = f;
    if (!b || Math.abs(b.res / need - 1) > 1e-6 || b.phaseX !== px || b.phaseY !== py) {
      if (need !== this._seenRes || px !== this._seenPX || py !== this._seenPY) {
        this._seenRes = need;
        this._seenPX = px;
        this._seenPY = py;
        this._seenAt = f;
      }
      const ratio = b ? Math.max(b.res / need, need / b.res) : Infinity;
      const settled = sparse || f - this._seenAt >= SETTLE_FRAMES;
      const wanted = !b || settled || (ratio > REBAKE_RATIO && f - this._bakedAt >= REBAKE_MIN_FRAMES);
      if (wanted && f >= this._retryAt) {
        const nb = this.bake(need, px, py, f);
        if (nb) {
          if (b) releaseTextBitmap(b);
          b = this._bmp = nb;
          this._bakedAt = f;
        } else {
          this._retryAt = f + RETRY_FRAMES;
          // keep drawing the old bitmap (scaled) while a re-bake is refused
          if (!b) return false;
        }
      }
      if (!b) return false;
    } else {
      this._seenAt = f;
    }
    b.lastUsed = f;
    const s = b.surface!;
    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (dev.axis && Math.abs(b.res / dev.sx - 1) < 2e-4 && Math.abs(b.res / dev.sy - 1) < 2e-4) {
      // 1:1 with the backing store: land on whole device pixels so the blit does not resample
      dx = ax - b.anchorX / dev.sx;
      dy = -b.anchorY / dev.sy;
      const X = dev.sx * dx + dev.tx;
      const Y = dev.sy * dy + dev.ty;
      const RX = Math.round(X);
      const RY = Math.round(Y);
      if (Math.abs(X - RX) < 0.2) dx = (RX - dev.tx) / dev.sx;
      if (Math.abs(Y - RY) < 0.2) dy = (RY - dev.ty) / dev.sy;
      dw = b.pw / dev.sx;
      dh = b.ph / dev.sy;
    } else {
      dx = ax - b.anchorX / b.res;
      dy = -b.anchorY / b.res;
      dw = b.pw / b.res;
      dh = b.ph / b.res;
    }
    ctx.drawImage(s as unknown as CanvasImageSource, 0, 0, b.pw, b.ph, dx, dy, dw, dh);
    return true;
  }

  /** Gets (shared) or rasterizes the bitmap for the current content at resolution `r` and phase (px, py). */
  private bake(r: number, px: number, py: number, f: number): TextBitmap | null {
    const st = this._style;
    const stroke = st.stroke && st.stroke.width > 0 ? st.stroke.width / 2 : 0;
    const sh = st.shadow;
    // shadows are in device pixels (not scaled by the transform) on most canvases: cover both readings
    const shadow = sh ? (sh.blur * 1.5 + Math.max(Math.abs(sh.x ?? 0), Math.abs(sh.y ?? 0))) / Math.min(r, 1) : 0;
    const aa = 2 / r;
    const hp = stroke + shadow + aa + this._fontSize * (st.fontStyle === 'italic' ? 0.3 : 0.12);
    const vp = stroke + shadow + aa;
    const anchorX = Math.ceil(-r * (this._inkX0 - hp)) + px;
    const anchorY = Math.ceil(-r * (this._inkY0 - vp)) + py;
    const pw = Math.ceil(anchorX + r * (this._inkX1 + hp));
    const ph = Math.ceil(anchorY + r * (this._inkY1 + vp));
    const key = `${r}|${px}|${py}|${this._content}`;
    return acquireTextBitmap(key, r, px, py, anchorX, anchorY, pw, ph, f, this._text.slice(0, 16), (c) => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, pw, ph);
      c.setTransform(r, 0, 0, r, anchorX, anchorY);
      this.paintLines(c, 0);
    });
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
