import type { Ctx2D } from '../gfx/types';
import type { Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import { roundRectPath } from '../gfx/draw';
import type { Size } from './layout';
import { uiColor, type UIColor } from './theme';
import { UIView, type UINodeProps } from './view';

/** A texture, or a texture registry key ('icon:settings'; bare names also try the 'icon:' prefix). */
export type UIIconSource = Texture | string;

/** Looks up a texture for an icon/image source; null when not registered. */
export function resolveUITexture(src: UIIconSource | null | undefined): Texture | null {
  if (!src) return null;
  if (typeof src !== 'string') return src;
  return textures.tryGet(src) ?? (src.startsWith('icon:') ? undefined : textures.tryGet('icon:' + src)) ?? null;
}

/** Key/name of an icon source for dumps. */
export function uiIconName(src: UIIconSource | null | undefined): string {
  if (!src) return '';
  return typeof src === 'string' ? src : src.key || '(texture)';
}

type GlyphFn = (ctx: Ctx2D, color: string) => void;

const line = (ctx: Ctx2D, pts: number[], w = 13) => {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
};

const poly = (ctx: Ctx2D, pts: number[]) => {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.closePath();
};

/** 5-point star path centered at (cx, cy). */
export function starPath(ctx: Ctx2D, cx: number, cy: number, outer: number, inner = outer * 0.48): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const glyphs: Record<string, GlyphFn> = {
  close: (c) => {
    line(c, [28, 28, 72, 72]);
    line(c, [72, 28, 28, 72]);
  },
  back: (c) => line(c, [62, 20, 34, 50, 62, 80]),
  next: (c) => line(c, [38, 20, 66, 50, 38, 80]),
  plus: (c) => {
    line(c, [50, 22, 50, 78]);
    line(c, [22, 50, 78, 50]);
  },
  minus: (c) => line(c, [22, 50, 78, 50]),
  check: (c) => line(c, [22, 52, 42, 72, 78, 30], 14),
  menu: (c) => [28, 50, 72].forEach((y) => line(c, [22, y, 78, y], 11)),
  pause: (c) => {
    c.beginPath();
    roundRectPath(c, 26, 22, 17, 56, 5);
    roundRectPath(c, 57, 22, 17, 56, 5);
    c.fill();
  },
  play: (c) => {
    poly(c, [34, 20, 80, 50, 34, 80]);
    c.lineJoin = 'round';
    c.lineWidth = 8;
    c.stroke();
    c.fill();
  },
  settings: (c) => {
    c.beginPath();
    c.arc(50, 50, 21, 0, Math.PI * 2);
    c.lineWidth = 14;
    c.stroke();
    for (let i = 0; i < 8; i++) {
      c.save();
      c.translate(50, 50);
      c.rotate((i * Math.PI) / 4);
      c.beginPath();
      roundRectPath(c, -7, -44, 14, 16, 4);
      c.fill();
      c.restore();
    }
  },
  star: (c) => {
    starPath(c, 50, 53, 44);
    c.fillStyle = '#ffc83d';
    c.fill();
    c.lineWidth = 6;
    c.lineJoin = 'round';
    c.strokeStyle = '#e08a00';
    c.stroke();
  },
  heart: (c) => {
    c.beginPath();
    c.moveTo(50, 84);
    c.bezierCurveTo(10, 58, 12, 20, 34, 20);
    c.bezierCurveTo(44, 20, 50, 28, 50, 34);
    c.bezierCurveTo(50, 28, 56, 20, 66, 20);
    c.bezierCurveTo(88, 20, 90, 58, 50, 84);
    c.fillStyle = '#ff4d6d';
    c.fill();
  },
  coin: (c) => {
    c.beginPath();
    c.arc(50, 50, 42, 0, Math.PI * 2);
    c.fillStyle = '#ffc83d';
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = '#e59400';
    c.stroke();
    c.beginPath();
    c.arc(50, 50, 28, 0, Math.PI * 2);
    c.strokeStyle = '#f2a900';
    c.stroke();
    c.fillStyle = '#e59400';
    c.beginPath();
    roundRectPath(c, 44, 32, 12, 36, 6);
    c.fill();
  },
  gem: (c) => {
    poly(c, [18, 38, 34, 18, 66, 18, 82, 38, 50, 84]);
    c.fillStyle = '#39c6f4';
    c.fill();
    poly(c, [18, 38, 82, 38, 66, 18, 34, 18]);
    c.fillStyle = '#9be7ff';
    c.fill();
    poly(c, [34, 38, 50, 84, 66, 38]);
    c.fillStyle = '#62d4fa';
    c.fill();
    poly(c, [18, 38, 34, 18, 66, 18, 82, 38, 50, 84]);
    c.lineWidth = 5;
    c.lineJoin = 'round';
    c.strokeStyle = '#1581c4';
    c.stroke();
  },
  energy: (c) => {
    poly(c, [58, 12, 22, 56, 46, 56, 40, 88, 78, 42, 54, 42]);
    c.fillStyle = '#ffd43b';
    c.fill();
    c.lineWidth = 5;
    c.lineJoin = 'round';
    c.strokeStyle = '#e08a00';
    c.stroke();
  },
  lock: (c) => {
    c.beginPath();
    c.arc(50, 44, 17, Math.PI, 0);
    c.lineWidth = 10;
    c.stroke();
    c.beginPath();
    roundRectPath(c, 24, 42, 52, 44, 10);
    c.fill();
  },
  home: (c) => {
    line(c, [14, 50, 50, 18, 86, 50], 11);
    c.beginPath();
    roundRectPath(c, 26, 46, 48, 40, 6);
    c.fill();
  },
  sound: (c) => {
    poly(c, [16, 38, 32, 38, 54, 20, 54, 80, 32, 62, 16, 62]);
    c.fill();
    c.lineWidth = 8;
    c.lineCap = 'round';
    for (const r of [14, 28]) {
      c.beginPath();
      c.arc(56, 50, r, -0.8, 0.8);
      c.stroke();
    }
  },
  mute: (c) => {
    poly(c, [12, 38, 28, 38, 50, 20, 50, 80, 28, 62, 12, 62]);
    c.fill();
    line(c, [62, 38, 86, 62], 9);
    line(c, [86, 38, 62, 62], 9);
  },
  music: (c) => {
    c.beginPath();
    c.arc(32, 72, 12, 0, Math.PI * 2);
    c.arc(70, 64, 12, 0, Math.PI * 2);
    c.fill();
    line(c, [42, 72, 42, 26, 80, 18, 80, 64], 8);
  },
  info: (c) => {
    c.beginPath();
    c.arc(50, 50, 38, 0, Math.PI * 2);
    c.lineWidth = 8;
    c.stroke();
    c.beginPath();
    c.arc(50, 32, 6, 0, Math.PI * 2);
    c.fill();
    line(c, [50, 48, 50, 70], 10);
  },
  trophy: (c) => {
    c.fillStyle = '#ffc83d';
    c.strokeStyle = '#e08a00';
    c.beginPath();
    c.moveTo(28, 18);
    c.lineTo(72, 18);
    c.lineTo(70, 44);
    c.quadraticCurveTo(66, 62, 50, 64);
    c.quadraticCurveTo(34, 62, 30, 44);
    c.closePath();
    c.fill();
    c.lineWidth = 7;
    for (const [x, d] of [[28, -1], [72, 1]] as const) {
      c.beginPath();
      c.arc(x + d * 2, 32, 12, d > 0 ? -Math.PI / 2 : Math.PI / 2, d > 0 ? Math.PI / 2 : (3 * Math.PI) / 2);
      c.stroke();
    }
    c.beginPath();
    roundRectPath(c, 42, 62, 16, 14, 2);
    roundRectPath(c, 30, 76, 40, 10, 4);
    c.fill();
  },
  gift: (c) => {
    c.fillStyle = '#ff5a6e';
    c.beginPath();
    roundRectPath(c, 16, 40, 68, 46, 6);
    c.fill();
    c.fillStyle = '#ffc83d';
    c.fillRect(44, 40, 12, 46);
    c.beginPath();
    roundRectPath(c, 12, 30, 76, 16, 5);
    c.fill();
    c.strokeStyle = '#ffc83d';
    c.lineWidth = 8;
    c.beginPath();
    c.ellipse(38, 22, 12, 8, 0.4, 0, Math.PI * 2);
    c.ellipse(62, 22, 12, 8, -0.4, 0, Math.PI * 2);
    c.stroke();
  },
  video: (c) => {
    c.beginPath();
    roundRectPath(c, 12, 26, 56, 48, 10);
    c.fill();
    poly(c, [70, 44, 90, 30, 90, 70, 70, 56]);
    c.fill();
  },
  shop: (c) => {
    line(c, [10, 22, 24, 22, 32, 64, 78, 64, 86, 34, 28, 34], 9);
    c.beginPath();
    c.arc(38, 80, 7, 0, Math.PI * 2);
    c.arc(72, 80, 7, 0, Math.PI * 2);
    c.fill();
  },
  user: (c) => {
    c.beginPath();
    c.arc(50, 34, 17, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(18, 86);
    c.quadraticCurveTo(18, 56, 50, 56);
    c.quadraticCurveTo(82, 56, 82, 86);
    c.closePath();
    c.fill();
  },
  mail: (c) => {
    c.beginPath();
    roundRectPath(c, 14, 24, 72, 52, 8);
    c.lineWidth = 8;
    c.stroke();
    line(c, [18, 30, 50, 54, 82, 30], 8);
  },
  refresh: (c) => {
    c.beginPath();
    c.arc(50, 50, 28, -0.3, Math.PI * 1.6);
    c.lineWidth = 11;
    c.lineCap = 'round';
    c.stroke();
    poly(c, [64, 12, 86, 34, 58, 40]);
    c.fill();
  },
  share: (c) => {
    line(c, [30, 50, 70, 26], 7);
    line(c, [30, 50, 70, 74], 7);
    for (const [x, y] of [[30, 50], [70, 26], [70, 74]] as const) {
      c.beginPath();
      c.arc(x, y, 12, 0, Math.PI * 2);
      c.fill();
    }
  },
  question: (c) => {
    c.beginPath();
    c.arc(50, 36, 17, Math.PI, Math.PI * 0.4);
    c.lineWidth = 11;
    c.lineCap = 'round';
    c.stroke();
    line(c, [55, 52, 50, 62], 11);
    c.beginPath();
    c.arc(50, 80, 6.5, 0, Math.PI * 2);
    c.fill();
  },
  rank: (c) => {
    c.beginPath();
    roundRectPath(c, 12, 46, 22, 38, 4);
    roundRectPath(c, 39, 22, 22, 62, 4);
    roundRectPath(c, 66, 56, 22, 28, 4);
    c.fill();
  },
  calendar: (c) => {
    c.beginPath();
    roundRectPath(c, 14, 22, 72, 62, 10);
    c.lineWidth = 8;
    c.stroke();
    c.fillRect(14, 22, 72, 16);
    line(c, [32, 14, 32, 26], 8);
    line(c, [68, 14, 68, 26], 8);
  },
};

const aliases: Record<string, string> = {
  x: 'close',
  cross: 'close',
  arrow_left: 'back',
  left: 'back',
  right: 'next',
  arrow_right: 'next',
  add: 'plus',
  ok: 'check',
  gear: 'settings',
  cog: 'settings',
  diamond: 'gem',
  bolt: 'energy',
  volume: 'sound',
  speaker: 'sound',
  ad: 'video',
  cart: 'shop',
  store: 'shop',
  profile: 'user',
  leaderboard: 'rank',
  ranking: 'rank',
  help: 'question',
};

function glyphKey(name: string): string | null {
  const n = name.replace(/^icon:/, '').replace(/-/g, '_').toLowerCase();
  const k = aliases[n] ?? n;
  return glyphs[k] ? k : null;
}

/** True if a built-in vector fallback exists for this icon name. */
export function hasUIGlyph(name: string): boolean {
  return glyphKey(name) !== null;
}

/** Built-in vector icon (used when no texture is registered). Returns false for unknown names. */
export function drawUIGlyph(ctx: Ctx2D, name: string, x: number, y: number, size: number, color: string): boolean {
  const k = glyphKey(name);
  if (!k) return false;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  glyphs[k]!(ctx, color);
  ctx.restore();
  return true;
}

/** Draws an icon source (texture, contain-fit, or glyph fallback) into the box (x, y, w, h). */
export function drawUIIcon(ctx: Ctx2D, src: UIIconSource | null, x: number, y: number, w: number, h: number, color: string): boolean {
  const tex = resolveUITexture(src);
  if (tex) {
    const k = Math.min(w / Math.max(1, tex.width), h / Math.max(1, tex.height));
    const dw = tex.width * k;
    const dh = tex.height * k;
    tex.draw(ctx, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return true;
  }
  if (typeof src !== 'string') return false;
  const s = Math.min(w, h);
  return drawUIGlyph(ctx, src, x + (w - s) / 2, y + (h - s) / 2, s, color);
}

export interface IconProps extends UINodeProps {
  src?: UIIconSource | null;
  /** Square size in design units (default 48). */
  size?: number;
  /** Tint for built-in glyphs (textures are drawn as-is). */
  color?: UIColor;
}

/** An icon: registered texture, else a built-in vector glyph, else nothing (lint reports missing-texture). */
export class UIIcon extends UIView {
  src: UIIconSource | null;
  size: number;
  color: UIColor;

  constructor(props: IconProps = {}) {
    super(props, 'Icon');
    this.src = props.src ?? null;
    this.size = props.size ?? 48;
    this.color = props.color ?? 'text';
  }

  /** True when neither a texture nor a glyph fallback is available. */
  get missing(): boolean {
    return !!this.src && !resolveUITexture(this.src) && !(typeof this.src === 'string' && hasUIGlyph(this.src));
  }

  override measureContent(): Size {
    return { w: this.size, h: this.size };
  }

  override minContentWidth(): number {
    return this.size;
  }

  override draw(ctx: Ctx2D): void {
    super.draw(ctx);
    drawUIIcon(ctx, this.src, 0, 0, this.width, this.height, uiColor(this.color));
  }

  override describe() {
    return { ...super.describe(), icon: uiIconName(this.src), missing: this.missing || undefined };
  }
}
