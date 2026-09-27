import { roundRectPath } from '../gfx/draw';
import type { TintMode } from '../gfx/tint';
import type { Ctx2D } from '../gfx/types';
import { drawUIGlyph, resolveUITexture, uiDuotoneName, uiIconName, uiRecolorTexture, type UIIconSource } from './icon';
import type { Size } from './layout';
import { uiColor, uiRadius, type UIColor } from './theme';
import { UIView, type UIBoxProps, type UINodeProps } from './view';

export type UIImageFit = 'contain' | 'cover' | 'fill';

export interface ImageProps extends UINodeProps, UIBoxProps {
  src?: UIIconSource | null;
  /** How the texture fills the box (default 'contain'). */
  fit?: UIImageFit;
  /** Recolours the texture (tintTexture, cached): 'multiply' turns white into this colour, shading kept. */
  tint?: UIColor | null;
  /** Default 'multiply'; 'fill' paints a flat silhouette. */
  tintMode?: TintMode;
  /** [dark, light]: brightness black -> dark, white -> light (duotoneTexture); wins over `tint`. */
  duotone?: [UIColor, UIColor] | null;
}

/**
 * A texture in a box. Without width/height it takes the texture size (or keeps its aspect ratio when only one side
 * is set). Missing textures render a soft placeholder and show `missing` in dumps.
 */
export class UIImage extends UIView {
  src: UIIconSource | null;
  fit: UIImageFit;
  tint: UIColor | null;
  tintMode: TintMode;
  duotone: [UIColor, UIColor] | null;

  constructor(props: ImageProps = {}) {
    super(props, 'Image');
    this.src = props.src ?? null;
    this.fit = props.fit ?? 'contain';
    this.tint = props.tint ?? null;
    this.tintMode = props.tintMode ?? 'multiply';
    this.duotone = props.duotone ?? null;
  }

  get missing(): boolean {
    return !resolveUITexture(this.src);
  }

  override measureContent(availW: number, availH: number, fixedW: boolean, fixedH: boolean): Size {
    const tex = resolveUITexture(this.src);
    const tw = tex ? tex.width : 96;
    const th = tex ? tex.height : 96;
    if (fixedW && !fixedH) return { w: availW, h: (availW * th) / Math.max(1, tw) };
    if (fixedH && !fixedW) return { w: (availH * tw) / Math.max(1, th), h: availH };
    if (fixedW && fixedH) return { w: availW, h: availH };
    const k = Math.min(1, availW / tw);
    return { w: tw * k, h: th * k };
  }

  override minContentWidth(): number {
    return 0;
  }

  override draw(ctx: Ctx2D): void {
    super.draw(ctx);
    const w = this.width;
    const h = this.height;
    if (w <= 0 || h <= 0) return;
    const src = resolveUITexture(this.src);
    const r = uiRadius(this.radius, w, h);
    if (!src) {
      ctx.beginPath();
      roundRectPath(ctx, 0, 0, w, h, r === 0 ? Math.min(w, h) * 0.12 : r);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.stroke();
      const s = Math.min(w, h) * 0.45;
      drawUIGlyph(ctx, 'question', (w - s) / 2, (h - s) / 2, s, uiColor('textDim'));
      return;
    }
    const tex = uiRecolorTexture(src, this.tint, this.tintMode, this.duotone);
    const clip = this.fit === 'cover' || r !== 0;
    if (clip) {
      ctx.save();
      ctx.beginPath();
      if (r === 0) ctx.rect(0, 0, w, h);
      else roundRectPath(ctx, 0, 0, w, h, r);
      ctx.clip();
    }
    if (this.fit === 'fill') tex.draw(ctx, 0, 0, w, h);
    else {
      const sx = w / Math.max(1, tex.width);
      const sy = h / Math.max(1, tex.height);
      const k = this.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
      const dw = tex.width * k;
      const dh = tex.height * k;
      tex.draw(ctx, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    if (clip) ctx.restore();
  }

  override describe() {
    return {
      ...super.describe(),
      src: uiIconName(this.src) || undefined,
      fit: this.fit,
      tint: this.tint || undefined,
      tintMode: this.tint && this.tintMode !== 'multiply' ? this.tintMode : undefined,
      duotone: uiDuotoneName(this.duotone),
      missing: this.missing || undefined,
    };
  }
}
