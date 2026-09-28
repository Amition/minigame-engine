import type { Ctx2D } from './types';

/**
 * Portable rounded-rect path (ctx.roundRect is not available on every mini-game runtime). `r` is one radius or
 * [topLeft, topRight, bottomRight, bottomLeft]; each is clamped to half the width/height. Allocates nothing.
 */
export function roundRectPath(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | readonly [number, number, number, number],
): void {
  let tl: number;
  let tr: number;
  let br: number;
  let bl: number;
  if (typeof r === 'number') {
    tl = tr = br = bl = Math.max(0, Math.min(r, w / 2, h / 2));
  } else {
    tl = Math.max(0, Math.min(r[0], w / 2, h / 2));
    tr = Math.max(0, Math.min(r[1], w / 2, h / 2));
    br = Math.max(0, Math.min(r[2], w / 2, h / 2));
    bl = Math.max(0, Math.min(r[3], w / 2, h / 2));
  }
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl);
  else ctx.lineTo(x, y);
  ctx.closePath();
}
