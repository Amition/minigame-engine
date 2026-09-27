import { parseColor, toCss, type Color } from '../core/color';
import { parsePathData, type SvgPathCmd } from './svgpath';

/** Affine matrix [a, b, c, d, e, f] (same order as ctx.transform). */
export type SvgMatrix = [number, number, number, number, number, number];

export interface SvgElement {
  tag: string;
  id: string;
  /** Attributes merged with matching <style> rules and the inline style attribute (later wins). */
  props: Record<string, string>;
  children: SvgElement[];
  /** Text content (for <text>, including nested <tspan> text). */
  text: string;
  transform: SvgMatrix | null;
  /** Geometry of shape elements (path, rect, circle, ellipse, line, polyline, polygon) in user units. */
  path: SvgPathCmd[] | null;
}

export interface SvgGradientStop {
  offset: number;
  /** Colour with stop-opacity folded in. */
  color: Color;
}

export interface SvgGradient {
  id: string;
  type: 'linear' | 'radial';
  units: 'objectBoundingBox' | 'userSpaceOnUse';
  transform: SvgMatrix | null;
  stops: SvgGradientStop[];
  /** Linear: x1, y1, x2, y2. Fractions of the bbox for objectBoundingBox units, user units otherwise. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Radial: centre, radius, focal point, focal radius. */
  cx: number;
  cy: number;
  r: number;
  fx: number;
  fy: number;
  fr: number;
}

export interface SvgDocument {
  root: SvgElement;
  /** Intrinsic size (width/height attributes, else the viewBox size). */
  width: number;
  height: number;
  viewBox: { x: number; y: number; w: number; h: number };
  /** preserveAspectRatio of the root, e.g. 'xMidYMid meet' (default) or 'none'. */
  aspect: string;
  ids: Map<string, SvgElement>;
  gradients: Map<string, SvgGradient>;
  /** Unsupported features that were ignored (e.g. 'mask', 'pattern'). Useful when reviewing AI-written SVG. */
  warnings: string[];
}

// ---------------------------------------------------------------- XML

interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00a0' };

function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const stripNs = (name: string) => {
  const i = name.indexOf(':');
  return i >= 0 && name.slice(0, i) === 'svg' ? name.slice(i + 1) : name;
};

function parseXml(src: string): XNode {
  const top: XNode = { tag: '#document', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [top];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const cur = stack[stack.length - 1]!;
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      cur.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) cur.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      cur.text += src.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src[lt + 1] === '?') {
      const e = src.indexOf('?>', lt + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (src[lt + 1] === '!') {
      let j = lt + 2;
      let depth = 0;
      while (j < n) {
        const c = src[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt);
      const name = stripNs(src.slice(lt + 2, e < 0 ? n : e).trim());
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.tag === name) {
          stack.length = k;
          break;
        }
      }
      i = e < 0 ? n : e + 1;
      continue;
    }
    let j = lt + 1;
    while (j < n && !/[\s/>]/.test(src[j]!)) j++;
    const el: XNode = { tag: stripNs(src.slice(lt + 1, j)), attrs: {}, children: [], text: '' };
    let selfClose = false;
    while (j < n) {
      while (j < n && /\s/.test(src[j]!)) j++;
      if (src[j] === '/' && src[j + 1] === '>') {
        selfClose = true;
        j += 2;
        break;
      }
      if (src[j] === '>') {
        j++;
        break;
      }
      const ns = j;
      while (j < n && !/[\s=/>]/.test(src[j]!)) j++;
      const name = src.slice(ns, j);
      while (j < n && /\s/.test(src[j]!)) j++;
      let value = '';
      if (src[j] === '=') {
        j++;
        while (j < n && /\s/.test(src[j]!)) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const e = src.indexOf(q, j + 1);
          value = src.slice(j + 1, e < 0 ? n : e);
          j = e < 0 ? n : e + 1;
        } else {
          const vs = j;
          while (j < n && !/[\s>]/.test(src[j]!)) j++;
          value = src.slice(vs, j);
        }
      }
      if (name) el.attrs[name] = decodeEntities(value);
      else j++;
    }
    cur.children.push(el);
    if (!selfClose) stack.push(el);
    i = j;
  }
  const svg = findSvg(top);
  if (!svg) throw new Error('parseSvg: no <svg> element found');
  return svg;
}

function findSvg(n: XNode): XNode | null {
  for (const c of n.children) {
    if (c.tag === 'svg') return c;
    const deep = findSvg(c);
    if (deep) return deep;
  }
  return null;
}

// ---------------------------------------------------------------- CSS

interface CssRule {
  tag: string;
  id: string;
  classes: string[];
  specificity: number;
  order: number;
  decls: Record<string, string>;
}

/** Parses `a: b; c: d` declarations. */
export function parseStyleDecls(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(';')) {
    const k = part.indexOf(':');
    if (k < 0) continue;
    const name = part.slice(0, k).trim().toLowerCase();
    const value = part.slice(k + 1).replace(/!important/i, '').trim();
    if (name && value) out[name] = value;
  }
  return out;
}

function parseCss(src: string, rules: CssRule[], warnings: Set<string>): void {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const selText = m[1]!.trim();
    if (selText.startsWith('@')) continue;
    const decls = parseStyleDecls(m[2]!);
    for (const raw of selText.split(',')) {
      const sel = raw.trim();
      if (!sel) continue;
      if (!/^[\w-]*(?:[.#][\w-]+)*$|^\*$/.test(sel)) {
        warnings.add(`css selector "${sel}"`);
        continue;
      }
      const tag = sel === '*' ? '' : (/^[\w-]+/.exec(sel)?.[0] ?? '');
      const id = /#([\w-]+)/.exec(sel)?.[1] ?? '';
      const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((x) => x[1]!);
      rules.push({
        tag,
        id,
        classes,
        specificity: (id ? 100 : 0) + classes.length * 10 + (tag ? 1 : 0),
        order: rules.length,
        decls,
      });
    }
  }
}

function collectStyleText(n: XNode, out: string[]): void {
  for (const c of n.children) {
    if (c.tag === 'style') out.push(c.text);
    else collectStyleText(c, out);
  }
}

// ---------------------------------------------------------------- values

const NAMED_SRC =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,' +
  'black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,' +
  'chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,' +
  'darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,' +
  'darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,' +
  'darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,' +
  'darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,' +
  'dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,' +
  'ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,' +
  'honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,' +
  'lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
  'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,' +
  'lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,' +
  'lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,' +
  'mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,' +
  'mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,' +
  'midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,' +
  'oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,' +
  'palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,' +
  'pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,' +
  'royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,' +
  'sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,' +
  'springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,' +
  'violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';

let named: Map<string, string> | null = null;

/**
 * Normalizes an SVG/CSS colour for the canvas: all 148 CSS names → hex, #rgba/#rrggbbaa → rgba().
 * Other syntaxes pass through unchanged.
 */
export function svgColor(v: string): Color {
  const s = v.trim().toLowerCase();
  if (!named) {
    named = new Map();
    for (const kv of NAMED_SRC.split(',')) {
      const [k, hex] = kv.split(':');
      named.set(k!, '#' + hex!);
    }
  }
  const hex = named.get(s);
  if (hex) return hex;
  if (s[0] === '#' && (s.length === 5 || s.length === 9)) return toCss(parseColor(s));
  return v.trim();
}

/** Colour with extra opacity multiplied in (for gradient stops). */
function colorWithOpacity(c: string, opacity: number): Color {
  const norm = svgColor(c);
  if (opacity >= 1) return norm;
  try {
    const p = parseColor(norm);
    return toCss({ ...p, a: p.a * opacity });
  } catch {
    return norm;
  }
}

/** Parses a length: '12', '12px', '50%' (of ref), '1.5em' (16px em), '3pt'. */
export function svgLength(v: string | undefined, ref = 0, fallback = 0): number {
  if (v === undefined || v === '') return fallback;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(%|px|em|ex|pt|pc|mm|cm|in)?\s*$/i.exec(v);
  if (!m) return fallback;
  const x = parseFloat(m[1]!);
  switch ((m[2] ?? '').toLowerCase()) {
    case '%':
      return (x / 100) * ref;
    case 'em':
      return x * 16;
    case 'ex':
      return x * 8;
    case 'pt':
      return (x * 4) / 3;
    case 'pc':
      return x * 16;
    case 'mm':
      return (x * 96) / 25.4;
    case 'cm':
      return (x * 96) / 2.54;
    case 'in':
      return x * 96;
    default:
      return x;
  }
}

export function numberList(v: string | undefined): number[] {
  if (!v) return [];
  const out: number[] = [];
  const re = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v))) out.push(parseFloat(m[0]));
  return out;
}

export function multiplyMatrix(m: SvgMatrix, n: SvgMatrix): SvgMatrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Parses an SVG transform list: matrix, translate, scale, rotate(a [cx cy]), skewX, skewY. Null if identity/empty. */
export function parseSvgTransform(v: string | undefined): SvgMatrix | null {
  if (!v) return null;
  let m: SvgMatrix = [1, 0, 0, 1, 0, 0];
  let any = false;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(v))) {
    const a = numberList(t[2]);
    let n: SvgMatrix | null = null;
    const rad = ((a[0] ?? 0) * Math.PI) / 180;
    switch (t[1]) {
      case 'matrix':
        if (a.length >= 6) n = [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!];
        break;
      case 'translate':
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        n = [c, s, -s, c, 0, 0];
        if (a.length >= 3) {
          const cx = a[1]!;
          const cy = a[2]!;
          n = multiplyMatrix(multiplyMatrix([1, 0, 0, 1, cx, cy], n), [1, 0, 0, 1, -cx, -cy]);
        }
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan(rad), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan(rad), 0, 1, 0, 0];
        break;
    }
    if (n) {
      m = multiplyMatrix(m, n);
      any = true;
    }
  }
  return any ? m : null;
}

// ---------------------------------------------------------------- shapes

const K = 0.5522847498;

function ellipseCmds(cx: number, cy: number, rx: number, ry: number): SvgPathCmd[] {
  const kx = rx * K;
  const ky = ry * K;
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ['Z'],
  ];
}

function rectCmds(x: number, y: number, w: number, h: number, rx: number, ry: number): SvgPathCmd[] {
  if (rx <= 0 || ry <= 0) {
    return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  }
  const kx = rx * K;
  const ky = ry * K;
  const r = x + w;
  const b = y + h;
  return [
    ['M', x + rx, y],
    ['L', r - rx, y],
    ['C', r - rx + kx, y, r, y + ry - ky, r, y + ry],
    ['L', r, b - ry],
    ['C', r, b - ry + ky, r - rx + kx, b, r - rx, b],
    ['L', x + rx, b],
    ['C', x + rx - kx, b, x, b - ry + ky, x, b - ry],
    ['L', x, y + ry],
    ['C', x, y + ry - ky, x + rx - kx, y, x + rx, y],
    ['Z'],
  ];
}

function pointsCmds(v: string | undefined, close: boolean): SvgPathCmd[] {
  const a = numberList(v);
  const out: SvgPathCmd[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) out.push([i === 0 ? 'M' : 'L', a[i]!, a[i + 1]!] as SvgPathCmd);
  if (close && out.length) out.push(['Z']);
  return out;
}

// ---------------------------------------------------------------- document

const UNSUPPORTED = new Set(['mask', 'pattern', 'image', 'marker', 'foreignObject', 'textPath', 'animate', 'animateTransform', 'animateMotion', 'set']);

interface BuildCtx {
  vbW: number;
  vbH: number;
  diag: number;
  rules: CssRule[];
  ids: Map<string, SvgElement>;
  gradientNodes: Map<string, { node: XNode; props: Record<string, string> }>;
  filters: Set<string>;
  warnings: Set<string>;
}

const SHADOW_PRIMITIVES = new Set([
  'feDropShadow', 'feOffset', 'feGaussianBlur', 'feFlood', 'feComposite', 'feMerge', 'feMergeNode', 'feBlend',
  'feComponentTransfer', 'feFuncA',
]);

function checkFilters(bc: BuildCtx): void {
  for (const ref of bc.filters) {
    const f = bc.ids.get(/url\(\s*['"]?#([^'")\s]+)/.exec(ref)?.[1] ?? '');
    const prims: string[] = [];
    const walk = (e: SvgElement) => e.children.forEach((c) => (prims.push(c.tag), walk(c)));
    if (f?.tag === 'filter') walk(f);
    const ok = f?.tag === 'filter' && prims.some((t) => t === 'feDropShadow' || t === 'feOffset' || t === 'feGaussianBlur');
    if (!ok || prims.some((t) => !SHADOW_PRIMITIVES.has(t))) {
      bc.warnings.add(`filter ${ref} (only drop shadows are approximated)`);
    }
  }
}

function computeProps(node: XNode, bc: BuildCtx): Record<string, string> {
  const props: Record<string, string> = { ...node.attrs };
  const style = node.attrs.style;
  delete props.style;
  if (bc.rules.length) {
    const classes = (node.attrs.class ?? '').split(/\s+/).filter(Boolean);
    const matching = bc.rules.filter(
      (r) =>
        (!r.tag || r.tag === node.tag) &&
        (!r.id || r.id === node.attrs.id) &&
        r.classes.every((c) => classes.includes(c)),
    );
    matching.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
    for (const r of matching) Object.assign(props, r.decls);
  }
  if (style) Object.assign(props, parseStyleDecls(style));
  return props;
}

function gatherText(n: XNode): string {
  let s = n.text;
  for (const c of n.children) s += gatherText(c);
  return s;
}

function build(node: XNode, bc: BuildCtx): SvgElement {
  const props = computeProps(node, bc);
  const tag = node.tag;
  if (UNSUPPORTED.has(tag)) bc.warnings.add(`<${tag}>`);
  if (props.mask) bc.warnings.add('mask attribute');
  if (props.filter && props.filter !== 'none') bc.filters.add(props.filter.trim());
  const el: SvgElement = {
    tag,
    id: node.attrs.id ?? '',
    props,
    children: [],
    text: tag === 'text' ? gatherText(node).replace(/\s+/g, ' ').trim() : '',
    transform: parseSvgTransform(props[tag === 'linearGradient' || tag === 'radialGradient' ? 'gradientTransform' : 'transform']),
    path: null,
  };
  const L = (k: string, ref: number, fb = 0) => svgLength(props[k], ref, fb);
  switch (tag) {
    case 'path':
      el.path = parsePathData(props.d ?? '');
      break;
    case 'rect': {
      const w = L('width', bc.vbW);
      const h = L('height', bc.vbH);
      let rx = props.rx !== undefined && props.rx !== 'auto' ? L('rx', bc.vbW) : -1;
      let ry = props.ry !== undefined && props.ry !== 'auto' ? L('ry', bc.vbH) : -1;
      if (rx < 0) rx = ry < 0 ? 0 : ry;
      if (ry < 0) ry = rx;
      if (w > 0 && h > 0) el.path = rectCmds(L('x', bc.vbW), L('y', bc.vbH), w, h, Math.min(rx, w / 2), Math.min(ry, h / 2));
      else el.path = [];
      break;
    }
    case 'circle': {
      const r = L('r', bc.diag);
      el.path = r > 0 ? ellipseCmds(L('cx', bc.vbW), L('cy', bc.vbH), r, r) : [];
      break;
    }
    case 'ellipse': {
      let rx = props.rx !== undefined && props.rx !== 'auto' ? L('rx', bc.vbW) : -1;
      let ry = props.ry !== undefined && props.ry !== 'auto' ? L('ry', bc.vbH) : -1;
      if (rx < 0) rx = ry;
      if (ry < 0) ry = rx;
      el.path = rx > 0 && ry > 0 ? ellipseCmds(L('cx', bc.vbW), L('cy', bc.vbH), rx, ry) : [];
      break;
    }
    case 'line':
      el.path = [
        ['M', L('x1', bc.vbW), L('y1', bc.vbH)],
        ['L', L('x2', bc.vbW), L('y2', bc.vbH)],
      ];
      break;
    case 'polyline':
      el.path = pointsCmds(props.points, false);
      break;
    case 'polygon':
      el.path = pointsCmds(props.points, true);
      break;
    case 'linearGradient':
    case 'radialGradient':
      if (el.id) bc.gradientNodes.set(el.id, { node, props });
      break;
  }
  if (tag !== 'text' && tag !== 'style') {
    for (const c of node.children) el.children.push(build(c, bc));
  }
  if (el.id && !bc.ids.has(el.id)) bc.ids.set(el.id, el);
  return el;
}

export function hrefId(props: Record<string, string>): string {
  const h = props.href ?? props['xlink:href'] ?? '';
  return h.startsWith('#') ? h.slice(1) : '';
}

function resolveGradients(bc: BuildCtx): Map<string, SvgGradient> {
  const out = new Map<string, SvgGradient>();
  const chain = (id: string): { node: XNode; props: Record<string, string> }[] => {
    const list: { node: XNode; props: Record<string, string> }[] = [];
    const seen = new Set<string>();
    let cur = bc.gradientNodes.get(id);
    while (cur && !seen.has(cur.props.id ?? '') && list.length < 8) {
      seen.add(cur.props.id ?? '');
      list.push(cur);
      const next = hrefId(cur.props);
      cur = next ? bc.gradientNodes.get(next) : undefined;
    }
    return list;
  };
  for (const [id, g] of bc.gradientNodes) {
    const links = chain(id);
    const attr = (k: string): string | undefined => {
      for (const l of links) if (l.props[k] !== undefined) return l.props[k];
      return undefined;
    };
    const stopsNode = links.find((l) => l.node.children.some((c) => c.tag === 'stop'))?.node;
    const units = attr('gradientUnits') === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox';
    const bboxUnits = units === 'objectBoundingBox';
    const coord = (k: string, def: string, ref: number) => {
      const v = attr(k) ?? def;
      if (bboxUnits) return v.trim().endsWith('%') ? parseFloat(v) / 100 : svgLength(v, 1);
      return svgLength(v, ref);
    };
    const spread = attr('spreadMethod');
    if (spread && spread !== 'pad') bc.warnings.add(`spreadMethod="${spread}" (rendered as pad)`);
    const stops: SvgGradientStop[] = [];
    let last = 0;
    for (const s of stopsNode?.children ?? []) {
      if (s.tag !== 'stop') continue;
      const sp = computeProps(s, bc);
      const off = sp.offset ?? '0';
      let o = off.trim().endsWith('%') ? parseFloat(off) / 100 : parseFloat(off);
      if (!Number.isFinite(o)) o = 0;
      o = Math.max(last, Math.min(1, Math.max(0, o)));
      last = o;
      const op = parseFloat(sp['stop-opacity'] ?? '1');
      stops.push({ offset: o, color: colorWithOpacity(sp['stop-color'] ?? 'black', Number.isFinite(op) ? op : 1) });
    }
    const type = g.node.tag === 'radialGradient' ? 'radial' : 'linear';
    const cx = coord('cx', '50%', bc.vbW);
    const cy = coord('cy', '50%', bc.vbH);
    out.set(id, {
      id,
      type,
      units,
      transform: parseSvgTransform(attr('gradientTransform')),
      stops,
      x1: coord('x1', '0%', bc.vbW),
      y1: coord('y1', '0%', bc.vbH),
      x2: coord('x2', '100%', bc.vbW),
      y2: coord('y2', '0%', bc.vbH),
      cx,
      cy,
      r: coord('r', '50%', bc.diag),
      fx: attr('fx') !== undefined ? coord('fx', '50%', bc.vbW) : cx,
      fy: attr('fy') !== undefined ? coord('fy', '50%', bc.vbH) : cy,
      fr: coord('fr', '0', bc.diag),
    });
  }
  return out;
}

/** Parses SVG markup into a render-ready document (see drawSvg / svgTexture). Throws if there is no <svg>. */
export function parseSvg(markup: string): SvgDocument {
  const x = parseXml(markup);
  const warnings = new Set<string>();
  const rules: CssRule[] = [];
  const styles: string[] = [];
  collectStyleText(x, styles);
  if (styles.length) parseCss(styles.join('\n'), rules, warnings);
  const vb = numberList(x.attrs.viewBox);
  const hasVb = vb.length === 4 && vb[2]! > 0 && vb[3]! > 0;
  const wAttr = x.attrs.width;
  const hAttr = x.attrs.height;
  const isPct = (v?: string) => !!v && v.trim().endsWith('%');
  let width = wAttr && !isPct(wAttr) ? svgLength(wAttr) : 0;
  let height = hAttr && !isPct(hAttr) ? svgLength(hAttr) : 0;
  const viewBox = hasVb
    ? { x: vb[0]!, y: vb[1]!, w: vb[2]!, h: vb[3]! }
    : { x: 0, y: 0, w: width || 300, h: height || 150 };
  if (!width && !height) {
    width = viewBox.w;
    height = viewBox.h;
  } else if (!width) {
    width = (height * viewBox.w) / viewBox.h;
  } else if (!height) {
    height = (width * viewBox.h) / viewBox.w;
  }
  const bc: BuildCtx = {
    vbW: viewBox.w,
    vbH: viewBox.h,
    diag: Math.sqrt((viewBox.w * viewBox.w + viewBox.h * viewBox.h) / 2),
    rules,
    ids: new Map(),
    gradientNodes: new Map(),
    filters: new Set(),
    warnings,
  };
  const root = build(x, bc);
  checkFilters(bc);
  return {
    root,
    width,
    height,
    viewBox,
    aspect: x.attrs.preserveAspectRatio ?? 'xMidYMid meet',
    ids: bc.ids,
    gradients: resolveGradients(bc),
    warnings: [...warnings],
  };
}
