import type { Rect } from '../core/math';
import { platform } from '../platform/current';
import type { Ctx2D, ImageSource, Surface } from './types';

/** A rectangular region of an image source. Sub-textures share the source (atlas frames). */
export class Texture {
  readonly frame: Rect;

  constructor(
    readonly source: ImageSource,
    frame?: Rect,
    public key = '',
  ) {
    this.frame = frame ?? { x: 0, y: 0, w: source.width, h: source.height };
  }

  get width(): number {
    return this.frame.w;
  }

  get height(): number {
    return this.frame.h;
  }

  /** A sub-region relative to this texture's frame. */
  sub(x: number, y: number, w: number, h: number, key = ''): Texture {
    return new Texture(this.source, { x: this.frame.x + x, y: this.frame.y + y, w, h }, key);
  }

  /** Splits into a grid of equally sized frames, row by row. */
  grid(frameW: number, frameH: number, count?: number, keyPrefix = this.key): Texture[] {
    const cols = Math.floor(this.width / frameW);
    const rows = Math.floor(this.height / frameH);
    const n = Math.min(count ?? cols * rows, cols * rows);
    const out: Texture[] = [];
    for (let i = 0; i < n; i++) {
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      out.push(this.sub(cx * frameW, cy * frameH, frameW, frameH, keyPrefix ? `${keyPrefix}#${i}` : ''));
    }
    return out;
  }

  draw(ctx: Ctx2D, dx = 0, dy = 0, dw = this.width, dh = this.height): void {
    const f = this.frame;
    if (f.w <= 0 || f.h <= 0) return;
    ctx.drawImage(this.source as unknown as CanvasImageSource, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
  }
}

/**
 * Renders into a new offscreen canvas and wraps it as a texture. Draw in logical units;
 * `resolution` multiplies the backing size (use 2 for crisp art on high-DPI screens).
 */
export function bakeTexture(
  width: number,
  height: number,
  draw: (ctx: Ctx2D, w: number, h: number) => void,
  opts: { resolution?: number; key?: string } = {},
): Texture {
  const res = opts.resolution ?? 1;
  const w = Math.max(1, Math.ceil(width * res));
  const h = Math.max(1, Math.ceil(height * res));
  const surface: Surface = platform().createCanvas(w, h);
  const ctx = surface.getContext('2d');
  ctx.save();
  ctx.scale(res, res);
  draw(ctx, width, height);
  ctx.restore();
  return res === 1 ? new Texture(surface, undefined, opts.key ?? '') : new ScaledTexture(surface, res, opts.key ?? '');
}

/** A texture whose source is `resolution` times larger than its logical size. */
export class ScaledTexture extends Texture {
  constructor(
    source: ImageSource,
    readonly resolution: number,
    key = '',
    frame?: Rect,
  ) {
    super(source, frame, key);
  }

  override get width(): number {
    return this.frame.w / this.resolution;
  }

  override get height(): number {
    return this.frame.h / this.resolution;
  }

  override sub(x: number, y: number, w: number, h: number, key = ''): Texture {
    const r = this.resolution;
    return new ScaledTexture(
      this.source,
      r,
      key,
      { x: this.frame.x + x * r, y: this.frame.y + y * r, w: w * r, h: h * r },
    );
  }
}
