import type { Color } from '../core/color';
import { roundRectPath } from '../gfx/draw';
import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from './node';

export interface ShadowStyle {
  color: Color;
  blur: number;
  x?: number;
  y?: number;
}

export interface BoxStyle {
  fill?: Color | null;
  stroke?: Color | null;
  lineWidth?: number;
  /** Corner radius, or [topLeft, topRight, bottomRight, bottomLeft]. */
  radius?: number | [number, number, number, number];
  shadow?: ShadowStyle | null;
}

/** A filled / stroked (rounded) rectangle of size (width, height). Handy for backgrounds, panels and debugging. */
export class Box extends Node {
  fill: Color | null = '#ffffff';
  stroke: Color | null = null;
  lineWidth = 2;
  radius: number | [number, number, number, number] = 0;
  shadow: ShadowStyle | null = null;

  constructor(width = 0, height = 0, style: BoxStyle = {}, opts?: NodeOptions) {
    super();
    this.width = width;
    this.height = height;
    this.setStyle(style);
    if (opts) this.set(opts);
  }

  override get kind(): string {
    return 'Box';
  }

  setStyle(s: BoxStyle): this {
    if (s.fill !== undefined) this.fill = s.fill;
    if (s.stroke !== undefined) this.stroke = s.stroke;
    if (s.lineWidth !== undefined) this.lineWidth = s.lineWidth;
    if (s.radius !== undefined) this.radius = s.radius;
    if (s.shadow !== undefined) this.shadow = s.shadow;
    return this;
  }

  override draw(ctx: Ctx2D): void {
    if (this.width <= 0 || this.height <= 0) return;
    ctx.beginPath();
    const r = this.radius;
    if (r === 0) ctx.rect(0, 0, this.width, this.height);
    else roundRectPath(ctx, 0, 0, this.width, this.height, r);
    if (this.fill) {
      if (this.shadow) {
        ctx.save();
        ctx.shadowColor = this.shadow.color;
        ctx.shadowBlur = this.shadow.blur;
        ctx.shadowOffsetX = this.shadow.x ?? 0;
        ctx.shadowOffsetY = this.shadow.y ?? 0;
      }
      ctx.fillStyle = this.fill;
      ctx.fill();
      if (this.shadow) ctx.restore();
    }
    if (this.stroke && this.lineWidth > 0) {
      ctx.strokeStyle = this.stroke;
      ctx.lineWidth = this.lineWidth;
      ctx.stroke();
    }
  }

  override describe() {
    return {
      ...super.describe(),
      fill: this.fill ?? undefined,
      stroke: this.stroke ?? undefined,
      radius: typeof this.radius === 'number' ? this.radius || undefined : this.radius.join('/'),
    };
  }
}
