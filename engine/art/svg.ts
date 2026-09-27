import type { Color } from '../core/color';
import type { Rect } from '../core/math';
import { hashString } from '../core/rng';
import { bakeTexture, type Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { Ctx2D } from '../gfx/types';
import { hasPlatform, platform } from '../platform/current';
import {
  hrefId,
  multiplyMatrix,
  numberList,
  parseSvg,
  svgColor,
  svgLength,
  type SvgDocument,
  type SvgElement,
  type SvgGradient,
  type SvgMatrix,
} from './svgdoc';
import { svgPathBounds, traceSvgPath, type SvgPathCmd } from './svgpath';

export interface SvgDrawOptions {
  /** Value of `currentColor` (default black). */
  color?: Color;
  /** Extra opacity for the whole drawing. */
  opacity?: number;
  /** Overrides the root preserveAspectRatio, e.g. 'none' to stretch. */
  aspect?: string;
  /** Clip to the viewport like browsers do (default true). */
  clip?: boolean;
  /** Device pixels per ctx unit; sizes approximated filter shadows (svgTexture passes its resolution). */
  pixelScale?: number;
}

interface Paint {
  fill: string;
  fillOpacity: number;
  fillRule: CanvasFillRule;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  dash: number[];
  dashOffset: number;
  color: string;
  visible: boolean;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  textAnchor: string;
  baseline: string;
  paintOrder: string;
}

interface RenderState {
  ctx: Ctx2D;
  doc: SvgDocument;
  depth: number;
  /** Approximate device pixels per current user unit. */
  scale: number;
  shadowPending: boolean;
}

type ResolvedPaint = { color: string; grad?: undefined } | { grad: SvgGradient; color?: undefined };

const NOT_RENDERED = new Set([
  'defs', 'linearGradient', 'radialGradient', 'clipPath', 'mask', 'symbol', 'style', 'title', 'desc', 'metadata',
  'pattern', 'filter', 'marker', 'stop', 'script', 'image', 'foreignObject',
]);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function opacityValue(v: string): number {
  const t = v.trim();
  const x = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
  return Number.isFinite(x) ? clamp01(x) : 1;
}

function defaultPaint(color: string): Paint {
  return {
    fill: 'black',
    fillOpacity: 1,
    fillRule: 'nonzero',
    stroke: 'none',
    strokeOpacity: 1,
    strokeWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 4,
    dash: [],
    dashOffset: 0,
    color,
    visible: true,
    fontSize: 16,
    fontFamily: hasPlatform() ? platform().fontFamily : 'sans-serif',
    fontWeight: 'normal',
    fontStyle: 'normal',
    textAnchor: 'start',
    baseline: 'alphabetic',
    paintOrder: 'normal',
  };
}

function inherit(parent: Paint, p: Record<string, string>, doc: SvgDocument): Paint {
  const out: Paint = { ...parent };
  const get = (k: string): string | undefined => {
    const x = p[k];
    if (x === undefined) return undefined;
    const t = x.trim();
    return t === 'inherit' || t === '' ? undefined : t;
  };
  const diag = Math.sqrt((doc.viewBox.w ** 2 + doc.viewBox.h ** 2) / 2);
  let v: string | undefined;
  if ((v = get('color')) !== undefined) out.color = v === 'currentColor' ? parent.color : svgColor(v);
  if ((v = get('fill')) !== undefined) out.fill = v;
  if ((v = get('fill-opacity')) !== undefined) out.fillOpacity = opacityValue(v);
  if ((v = get('fill-rule')) !== undefined) out.fillRule = v === 'evenodd' ? 'evenodd' : 'nonzero';
  if ((v = get('stroke')) !== undefined) out.stroke = v;
  if ((v = get('stroke-opacity')) !== undefined) out.strokeOpacity = opacityValue(v);
  if ((v = get('stroke-width')) !== undefined) out.strokeWidth = Math.max(0, svgLength(v, diag, 1));
  if ((v = get('stroke-linecap')) !== undefined) out.lineCap = v === 'round' || v === 'square' ? v : 'butt';
  if ((v = get('stroke-linejoin')) !== undefined) out.lineJoin = v === 'round' || v === 'bevel' ? v : 'miter';
  if ((v = get('stroke-miterlimit')) !== undefined) out.miterLimit = Math.max(1, parseFloat(v) || 4);
  if ((v = get('stroke-dasharray')) !== undefined) {
    const a = v === 'none' ? [] : numberList(v).map((x) => Math.max(0, x));
    out.dash = a.some((x) => x > 0) ? (a.length % 2 ? [...a, ...a] : a) : [];
  }
  if ((v = get('stroke-dashoffset')) !== undefined) out.dashOffset = svgLength(v, diag);
  if ((v = get('visibility')) !== undefined) out.visible = v === 'visible';
  if ((v = get('font-size')) !== undefined) out.fontSize = svgLength(v, parent.fontSize, parent.fontSize);
  if ((v = get('font-family')) !== undefined) out.fontFamily = v;
  if ((v = get('font-weight')) !== undefined) out.fontWeight = v;
  if ((v = get('font-style')) !== undefined) out.fontStyle = v;
  if ((v = get('text-anchor')) !== undefined) out.textAnchor = v;
  if ((v = get('dominant-baseline')) !== undefined) out.baseline = v;
  if ((v = get('paint-order')) !== undefined) out.paintOrder = v;
  return out;
}

/** Scale matrix mapping a viewBox into a w×h viewport according to preserveAspectRatio. */
export function viewBoxMatrix(
  vb: { x: number; y: number; w: number; h: number },
  w: number,
  h: number,
  aspect = 'xMidYMid meet',
): SvgMatrix {
  const sx = w / vb.w;
  const sy = h / vb.h;
  const parts = aspect.trim().split(/\s+/);
  const align = parts[0] === 'defer' ? (parts[1] ?? 'xMidYMid') : (parts[0] ?? 'xMidYMid');
  if (align === 'none') return [sx, 0, 0, sy, -vb.x * sx, -vb.y * sy];
  const s = parts.includes('slice') ? Math.max(sx, sy) : Math.min(sx, sy);
  const ax = align.includes('xMin') ? 0 : align.includes('xMax') ? 1 : 0.5;
  const ay = align.includes('YMin') ? 0 : align.includes('YMax') ? 1 : 0.5;
  return [s, 0, 0, s, (w - vb.w * s) * ax - vb.x * s, (h - vb.h * s) * ay - vb.y * s];
}

const matScale = (m: SvgMatrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

function urlId(v: string): string {
  return /url\(\s*['"]?#([^'")\s]+)/.exec(v)?.[1] ?? '';
}

function resolvePaint(rs: RenderState, value: string, paint: Paint): ResolvedPaint | null {
  let v = value.trim();
  if (!v || v === 'none') return null;
  if (v.startsWith('url(')) {
    const g = rs.doc.gradients.get(urlId(v));
    if (g) {
      if (g.stops.length === 0) return null;
      if (g.stops.length === 1) return { color: g.stops[0]!.color };
      return { grad: g };
    }
    const fallback = v.slice(v.indexOf(')') + 1).trim();
    if (!fallback) return null;
    v = fallback;
  }
  if (v === 'currentColor') return { color: paint.color };
  return { color: svgColor(v) };
}

function gradientMatrix(g: SvgGradient, bbox: () => Rect): SvgMatrix | null | false {
  let m: SvgMatrix | null = null;
  if (g.units === 'objectBoundingBox') {
    const b = bbox();
    if (b.w <= 0 || b.h <= 0) return false;
    m = [b.w, 0, 0, b.h, b.x, b.y];
  }
  if (g.transform) m = m ? multiplyMatrix(m, g.transform) : g.transform;
  return m;
}

function canvasGradient(ctx: Ctx2D, g: SvgGradient, m: SvgMatrix | null = null): CanvasGradient {
  const map = (x: number, y: number): [number, number] =>
    m ? [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] : [x, y];
  let grad: CanvasGradient;
  if (g.type === 'linear') {
    const [x1, y1] = map(g.x1, g.y1);
    const [x2, y2] = map(g.x2, g.y2);
    grad = ctx.createLinearGradient(x1, y1, x2, y2);
  } else {
    let fx = g.fx;
    let fy = g.fy;
    const dx = fx - g.cx;
    const dy = fy - g.cy;
    const d = Math.hypot(dx, dy);
    if (d > g.r * 0.99 && d > 0) {
      fx = g.cx + (dx / d) * g.r * 0.99;
      fy = g.cy + (dy / d) * g.r * 0.99;
    }
    const s = m ? matScale(m) : 1;
    const [cx, cy] = map(g.cx, g.cy);
    const [ffx, ffy] = map(fx, fy);
    grad = ctx.createRadialGradient(ffx, ffy, g.fr * s, cx, cy, g.r * s);
  }
  for (const st of g.stops) grad.addColorStop(st.offset, st.color);
  return grad;
}

function clearShadow(ctx: Ctx2D): void {
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function paintPath(rs: RenderState, cmds: readonly SvgPathCmd[], paint: Paint): void {
  if (!paint.visible || cmds.length === 0) return;
  const ctx = rs.ctx;
  const fill = resolvePaint(rs, paint.fill, paint);
  const stroke = paint.strokeWidth > 0 ? resolvePaint(rs, paint.stroke, paint) : null;
  if (!fill && !stroke) return;
  ctx.beginPath();
  traceSvgPath(ctx, cmds);
  let bb: Rect | null = null;
  const bbox = () => (bb ??= svgPathBounds(cmds));
  const alpha = ctx.globalAlpha;
  const order = paint.paintOrder.startsWith('stroke') ? ['stroke', 'fill'] : ['fill', 'stroke'];
  let painted = false;
  for (const what of order) {
    if (what === 'fill' && fill) {
      if (painted && rs.shadowPending) clearShadow(ctx);
      ctx.globalAlpha = alpha * paint.fillOpacity;
      if (fill.grad) {
        const m = gradientMatrix(fill.grad, bbox);
        if (m !== false) {
          ctx.save();
          if (m) ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
          ctx.fillStyle = canvasGradient(ctx, fill.grad);
          ctx.fill(paint.fillRule);
          ctx.restore();
        }
      } else {
        ctx.fillStyle = fill.color;
        ctx.fill(paint.fillRule);
      }
      painted = true;
    } else if (what === 'stroke' && stroke) {
      if (painted && rs.shadowPending) clearShadow(ctx);
      ctx.globalAlpha = alpha * paint.strokeOpacity;
      ctx.lineWidth = paint.strokeWidth;
      ctx.lineCap = paint.lineCap;
      ctx.lineJoin = paint.lineJoin;
      ctx.miterLimit = paint.miterLimit;
      ctx.setLineDash(paint.dash);
      ctx.lineDashOffset = paint.dashOffset;
      if (stroke.grad) {
        const m = gradientMatrix(stroke.grad, bbox);
        if (m !== false) {
          ctx.strokeStyle = canvasGradient(ctx, stroke.grad, m);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = stroke.color;
        ctx.stroke();
      }
      painted = true;
    }
  }
  ctx.globalAlpha = alpha;
}

function drawText(rs: RenderState, el: SvgElement, paint: Paint): void {
  if (!el.text || !paint.visible) return;
  const ctx = rs.ctx;
  const p = el.props;
  const vb = rs.doc.viewBox;
  const x = svgLength(p.x?.trim().split(/[\s,]+/)[0], vb.w) + svgLength(p.dx?.trim().split(/[\s,]+/)[0], vb.w);
  const y = svgLength(p.y?.trim().split(/[\s,]+/)[0], vb.h) + svgLength(p.dy?.trim().split(/[\s,]+/)[0], vb.h);
  const weight = paint.fontWeight === 'bolder' ? 'bold' : paint.fontWeight === 'lighter' ? 'normal' : paint.fontWeight;
  ctx.font = `${paint.fontStyle === 'italic' ? 'italic ' : ''}${weight} ${paint.fontSize}px ${paint.fontFamily}`;
  ctx.textAlign = paint.textAnchor === 'middle' ? 'center' : paint.textAnchor === 'end' ? 'right' : 'left';
  const b = paint.baseline;
  ctx.textBaseline =
    b === 'middle' || b === 'central' ? 'middle' : b === 'hanging' || b === 'text-before-edge' ? 'top' : 'alphabetic';
  const fill = resolvePaint(rs, paint.fill, paint);
  const stroke = paint.strokeWidth > 0 ? resolvePaint(rs, paint.stroke, paint) : null;
  const w = ctx.measureText(el.text).width;
  const x0 = ctx.textAlign === 'center' ? x - w / 2 : ctx.textAlign === 'right' ? x - w : x;
  const bbox = () => ({ x: x0, y: y - paint.fontSize * 0.8, w, h: paint.fontSize });
  const style = (rp: ResolvedPaint): string | CanvasGradient | null => {
    if (!rp.grad) return rp.color;
    const m = gradientMatrix(rp.grad, bbox);
    return m === false ? null : canvasGradient(ctx, rp.grad, m);
  };
  const alpha = ctx.globalAlpha;
  const order = paint.paintOrder.startsWith('stroke') ? ['stroke', 'fill'] : ['fill', 'stroke'];
  for (const what of order) {
    if (what === 'fill' && fill) {
      const s = style(fill);
      if (!s) continue;
      ctx.globalAlpha = alpha * paint.fillOpacity;
      ctx.fillStyle = s;
      ctx.fillText(el.text, x, y);
    } else if (what === 'stroke' && stroke) {
      const s = style(stroke);
      if (!s) continue;
      ctx.globalAlpha = alpha * paint.strokeOpacity;
      ctx.strokeStyle = s;
      ctx.lineWidth = paint.strokeWidth;
      ctx.lineJoin = paint.lineJoin;
      ctx.strokeText(el.text, x, y);
    }
  }
  ctx.globalAlpha = alpha;
}

function transformRect(m: SvgMatrix, r: Rect): Rect {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ] as const) {
    xs.push(m[0] * px + m[2] * py + m[4]);
    ys.push(m[1] * px + m[3] * py + m[5]);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Bounds of an element's geometry in its own user space (transforms of descendants applied). */
function elementBounds(doc: SvgDocument, el: SvgElement, depth = 0): Rect | null {
  if (depth > 16) return null;
  if (el.path) return el.path.length ? svgPathBounds(el.path) : null;
  let src: SvgElement[] = el.children;
  let shift: SvgMatrix | null = null;
  if (el.tag === 'use') {
    const ref = doc.ids.get(hrefId(el.props));
    if (!ref) return null;
    src = [ref];
    shift = [1, 0, 0, 1, svgLength(el.props.x), svgLength(el.props.y)];
  }
  let acc: Rect | null = null;
  for (const c of src) {
    if (NOT_RENDERED.has(c.tag) && c.tag !== 'symbol') continue;
    let b = elementBounds(doc, c, depth + 1);
    if (!b) continue;
    if (c.transform) b = transformRect(c.transform, b);
    if (shift) b = transformRect(shift, b);
    if (!acc) acc = b;
    else {
      const x = Math.min(acc.x, b.x);
      const y = Math.min(acc.y, b.y);
      acc = { x, y, w: Math.max(acc.x + acc.w, b.x + b.w) - x, h: Math.max(acc.y + acc.h, b.y + b.h) - y };
    }
  }
  return acc;
}

function applyClip(rs: RenderState, el: SvgElement, value: string): void {
  const cp = rs.doc.ids.get(urlId(value));
  if (!cp || cp.tag !== 'clipPath') return;
  const ctx = rs.ctx;
  let bm: SvgMatrix | null = null;
  if (cp.props.clipPathUnits === 'objectBoundingBox') {
    const b = elementBounds(rs.doc, el);
    if (!b) return;
    bm = [b.w, 0, 0, b.h, b.x, b.y];
  }
  let rule: CanvasFillRule = 'nonzero';
  const add = (e: SvgElement, depth: number) => {
    if (depth > 8 || e.props.display === 'none') return;
    ctx.save();
    if (e.transform) ctx.transform(...e.transform);
    if (e.props['clip-rule'] === 'evenodd') rule = 'evenodd';
    if (e.path) traceSvgPath(ctx, e.path);
    else if (e.tag === 'use') {
      const ref = rs.doc.ids.get(hrefId(e.props));
      ctx.translate(svgLength(e.props.x), svgLength(e.props.y));
      if (ref) add(ref, depth + 1);
    } else for (const c of e.children) add(c, depth + 1);
    ctx.restore();
  };
  ctx.beginPath();
  ctx.save();
  if (bm) ctx.transform(...bm);
  if (cp.transform) ctx.transform(...cp.transform);
  for (const c of cp.children) add(c, 0);
  ctx.restore();
  ctx.clip(rule);
}

interface ShadowSpec {
  dx: number;
  dy: number;
  blur: number;
  color: string;
}

function filterShadow(rs: RenderState, value: string): ShadowSpec | null {
  const f = rs.doc.ids.get(urlId(value));
  if (!f || f.tag !== 'filter') return null;
  let dx = 0;
  let dy = 0;
  let blur = 0;
  let color = '';
  let opacity = -1;
  let offset = false;
  let alphaSource = false;
  for (const c of f.children) {
    const p = c.props;
    if (c.tag === 'feDropShadow') {
      const op = p['flood-opacity'] !== undefined ? opacityValue(p['flood-opacity']) : 1;
      return {
        dx: parseFloat(p.dx ?? '2') || 0,
        dy: parseFloat(p.dy ?? '2') || 0,
        blur: (parseFloat(p.stdDeviation ?? '2') || 0) * 2,
        color: colorAlpha(svgColor(p['flood-color'] ?? 'black'), op),
      };
    }
    if (c.tag === 'feOffset') {
      offset = true;
      dx = parseFloat(p.dx ?? '0') || 0;
      dy = parseFloat(p.dy ?? '0') || 0;
    } else if (c.tag === 'feGaussianBlur') {
      blur = (parseFloat(p.stdDeviation ?? '0') || 0) * 2;
      if (p.in === 'SourceAlpha') alphaSource = true;
    } else if (c.tag === 'feFlood') {
      color = svgColor(p['flood-color'] ?? 'black');
      if (p['flood-opacity'] !== undefined) opacity = opacityValue(p['flood-opacity']);
    } else if (c.tag === 'feComponentTransfer') {
      const a = c.children.find((x) => x.tag === 'feFuncA');
      if (a?.props.slope !== undefined) opacity = opacityValue(a.props.slope);
    }
  }
  if (!offset && !alphaSource) return null;
  return { dx, dy, blur, color: colorAlpha(color || 'black', opacity < 0 ? 0.5 : opacity) };
}

function colorAlpha(c: string, a: number): string {
  if (a >= 1) return c;
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (!hex) return c;
  const n = parseInt(hex[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function renderChildren(rs: RenderState, list: readonly SvgElement[], paint: Paint): void {
  for (const c of list) renderEl(rs, c, paint);
}

function renderUse(rs: RenderState, el: SvgElement, paint: Paint): void {
  const ref = rs.doc.ids.get(hrefId(el.props));
  if (!ref || rs.depth > 24) return;
  const ctx = rs.ctx;
  const vb = rs.doc.viewBox;
  const x = svgLength(el.props.x, vb.w);
  const y = svgLength(el.props.y, vb.h);
  if (x || y) ctx.translate(x, y);
  if (ref.tag === 'symbol' || ref.tag === 'svg') {
    ctx.save();
    if (ref.transform) ctx.transform(...ref.transform);
    const box = numberList(ref.props.viewBox);
    const w = svgLength(el.props.width ?? ref.props.width ?? '100%', vb.w);
    const h = svgLength(el.props.height ?? ref.props.height ?? '100%', vb.h);
    if (box.length === 4 && box[2]! > 0 && box[3]! > 0 && w > 0 && h > 0) {
      const m = viewBoxMatrix({ x: box[0]!, y: box[1]!, w: box[2]!, h: box[3]! }, w, h, ref.props.preserveAspectRatio);
      ctx.transform(...m);
    }
    renderChildren(rs, ref.children, inherit(paint, ref.props, rs.doc));
    ctx.restore();
  } else {
    renderEl(rs, ref, paint);
  }
}

function renderEl(rs: RenderState, el: SvgElement, parent: Paint): void {
  if (NOT_RENDERED.has(el.tag) || rs.depth > 48) return;
  const p = el.props;
  if (p.display === 'none') return;
  const op = p.opacity !== undefined ? opacityValue(p.opacity) : 1;
  if (op <= 0) return;
  const paint = inherit(parent, p, rs.doc);
  const ctx = rs.ctx;
  const prevScale = rs.scale;
  const prevShadow = rs.shadowPending;
  ctx.save();
  if (el.transform) {
    ctx.transform(...el.transform);
    rs.scale *= matScale(el.transform);
  }
  if (op < 1) ctx.globalAlpha *= op;
  if (p['clip-path'] && p['clip-path'] !== 'none') applyClip(rs, el, p['clip-path']);
  if (p.filter && p.filter !== 'none') {
    const sh = filterShadow(rs, p.filter);
    if (sh) {
      ctx.shadowColor = sh.color;
      ctx.shadowBlur = sh.blur * rs.scale;
      ctx.shadowOffsetX = sh.dx * rs.scale;
      ctx.shadowOffsetY = sh.dy * rs.scale;
      rs.shadowPending = true;
    }
  }
  rs.depth++;
  switch (el.tag) {
    case 'svg':
      if (el !== rs.doc.root) {
        const vb = rs.doc.viewBox;
        ctx.translate(svgLength(p.x, vb.w), svgLength(p.y, vb.h));
        const box = numberList(p.viewBox);
        const w = svgLength(p.width ?? '100%', vb.w);
        const h = svgLength(p.height ?? '100%', vb.h);
        if (box.length === 4 && box[2]! > 0 && box[3]! > 0 && w > 0 && h > 0) {
          ctx.transform(...viewBoxMatrix({ x: box[0]!, y: box[1]!, w: box[2]!, h: box[3]! }, w, h, p.preserveAspectRatio));
        }
      }
      renderChildren(rs, el.children, paint);
      break;
    case 'use':
      renderUse(rs, el, paint);
      break;
    case 'text':
      drawText(rs, el, paint);
      break;
    default:
      if (el.path) paintPath(rs, el.path, paint);
      else renderChildren(rs, el.children, paint);
  }
  rs.depth--;
  rs.scale = prevScale;
  rs.shadowPending = prevShadow;
  ctx.restore();
}

const docCache = new Map<string, SvgDocument>();

/** parseSvg with a bounded cache keyed by markup. */
export function cachedSvg(markup: string): SvgDocument {
  let doc = docCache.get(markup);
  if (!doc) {
    if (docCache.size > 128) docCache.clear();
    doc = parseSvg(markup);
    docCache.set(markup, doc);
  }
  return doc;
}

/**
 * Draws SVG markup (or a parsed document) into the box (x, y, w, h); w/h default to the intrinsic size.
 * The viewBox is fitted with preserveAspectRatio (default 'xMidYMid meet').
 */
export function drawSvg(
  ctx: Ctx2D,
  svg: string | SvgDocument,
  x = 0,
  y = 0,
  w?: number,
  h?: number,
  opts: SvgDrawOptions = {},
): void {
  const doc = typeof svg === 'string' ? cachedSvg(svg) : svg;
  const W = w ?? doc.width;
  const H = h ?? doc.height;
  if (W <= 0 || H <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  if (opts.clip !== false) {
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
  }
  const m = viewBoxMatrix(doc.viewBox, W, H, opts.aspect ?? doc.aspect);
  ctx.transform(...m);
  if (opts.opacity !== undefined) ctx.globalAlpha *= clamp01(opts.opacity);
  const rs: RenderState = { ctx, doc, depth: 0, scale: (opts.pixelScale ?? 1) * matScale(m), shadowPending: false };
  renderEl(rs, doc.root, defaultPaint(svgColor(opts.color ?? '#000000')));
  ctx.restore();
}

/** Intrinsic size, or the size for a requested width and/or height keeping the aspect ratio. */
export function svgSize(svg: string | SvgDocument, width?: number, height?: number): { width: number; height: number } {
  const doc = typeof svg === 'string' ? cachedSvg(svg) : svg;
  if (width !== undefined && height !== undefined) return { width, height };
  if (width !== undefined) return { width, height: (width * doc.height) / doc.width };
  if (height !== undefined) return { width: (height * doc.width) / doc.height, height };
  return { width: doc.width, height: doc.height };
}

export interface SvgTextureOptions extends Pick<SvgDrawOptions, 'color' | 'aspect'> {
  /** Logical size; one of them keeps the aspect ratio. Default: the SVG's intrinsic size. */
  width?: number;
  height?: number;
  /** Backing-store multiplier (2 = crisp on high-DPI). Default 1. */
  resolution?: number;
  /** Also register the texture under this key in the `textures` registry. */
  key?: string;
}

const texCache = new Map<string, Texture>();

/**
 * Bakes SVG markup into a texture (cached by markup + size + resolution + colour).
 *
 *     const tex = svgTexture('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="gold"/></svg>', { width: 64 });
 */
export function svgTexture(markup: string, opts: SvgTextureOptions = {}): Texture {
  const doc = cachedSvg(markup);
  const { width, height } = svgSize(doc, opts.width, opts.height);
  const res = opts.resolution ?? 1;
  const ck = `${hashString(markup)}:${markup.length}|${width}x${height}@${res}|${opts.color ?? ''}|${opts.aspect ?? ''}`;
  let tex = texCache.get(ck);
  if (!tex) {
    tex = bakeTexture(
      width,
      height,
      (ctx) => {
        const o: SvgDrawOptions = { pixelScale: res };
        if (opts.color !== undefined) o.color = opts.color;
        if (opts.aspect !== undefined) o.aspect = opts.aspect;
        drawSvg(ctx, doc, 0, 0, width, height, o);
      },
      { resolution: res },
    );
    texCache.set(ck, tex);
  }
  if (opts.key) textures.set(opts.key, tex);
  return tex;
}

/** Drops cached parsed documents and baked SVG textures. */
export function clearSvgCache(): void {
  docCache.clear();
  texCache.clear();
}
