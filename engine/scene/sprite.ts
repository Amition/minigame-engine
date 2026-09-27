import type { Ctx2D } from '../gfx/types';
import { Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import { Node, type NodeOptions } from './node';

/**
 * How a Sprite maps its texture onto (width, height):
 * 'stretch' (default) fills the box; 'contain' fits inside keeping aspect (centered);
 * 'cover' fills keeping aspect and crops the overflow (centered); 'none' draws at natural size, centered.
 */
export type SpriteFit = 'stretch' | 'contain' | 'cover' | 'none';

/** Draws a texture stretched to (width, height). Pass a Texture or a registry key. */
export class Sprite extends Node {
  flipX = false;
  flipY = false;
  fit: SpriteFit = 'stretch';
  private _texture: Texture | null = null;

  constructor(texture?: Texture | string | null, opts?: NodeOptions & { fit?: SpriteFit }) {
    super();
    if (texture) this.setTexture(texture);
    if (opts) {
      this.set(opts);
      if (opts.fit) this.fit = opts.fit;
    }
  }

  override get kind(): string {
    return 'Sprite';
  }

  get texture(): Texture | null {
    return this._texture;
  }

  set texture(t: Texture | null) {
    this._texture = t;
  }

  /** Sets the texture; `resize` (default true) sets width/height to the texture's size. */
  setTexture(t: Texture | string | null, resize = true): this {
    this._texture = typeof t === 'string' ? textures.get(t) : t;
    if (resize && this._texture) {
      this.width = this._texture.width;
      this.height = this._texture.height;
    }
    return this;
  }

  override draw(ctx: Ctx2D): void {
    const t = this._texture;
    if (!t) return;
    if (this.flipX || this.flipY) {
      ctx.save();
      ctx.translate(this.flipX ? this.width : 0, this.flipY ? this.height : 0);
      ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
      this.drawTexture(ctx, t);
      ctx.restore();
    } else {
      this.drawTexture(ctx, t);
    }
  }

  private drawTexture(ctx: Ctx2D, t: Texture): void {
    const w = this.width;
    const h = this.height;
    if (this.fit === 'stretch' || t.width <= 0 || t.height <= 0) {
      t.draw(ctx, 0, 0, w, h);
      return;
    }
    if (this.fit === 'cover') {
      const s = Math.max(w / t.width, h / t.height);
      if (s <= 0) return;
      const f = t.frame;
      const kx = f.w / t.width;
      const ky = f.h / t.height;
      const sw = w / s;
      const sh = h / s;
      ctx.drawImage(
        t.source as unknown as CanvasImageSource,
        f.x + ((t.width - sw) / 2) * kx,
        f.y + ((t.height - sh) / 2) * ky,
        sw * kx,
        sh * ky,
        0,
        0,
        w,
        h,
      );
      return;
    }
    const s = this.fit === 'contain' ? Math.min(w / t.width, h / t.height) : 1;
    const dw = t.width * s;
    const dh = t.height * s;
    t.draw(ctx, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  override describe() {
    return {
      ...super.describe(),
      tex: this._texture?.key || (this._texture ? '(anon)' : '(none)'),
      fit: this.fit === 'stretch' ? undefined : this.fit,
    };
  }
}
