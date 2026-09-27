import type { Ctx2D } from '../gfx/types';
import { Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import { Node, type NodeOptions } from './node';

/** Draws a texture stretched to (width, height). Pass a Texture or a registry key. */
export class Sprite extends Node {
  flipX = false;
  flipY = false;
  private _texture: Texture | null = null;

  constructor(texture?: Texture | string | null, opts?: NodeOptions) {
    super();
    if (texture) this.setTexture(texture);
    if (opts) this.set(opts);
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
      t.draw(ctx, 0, 0, this.width, this.height);
      ctx.restore();
    } else {
      t.draw(ctx, 0, 0, this.width, this.height);
    }
  }

  override describe() {
    return { ...super.describe(), tex: this._texture?.key || (this._texture ? '(anon)' : '(none)') };
  }
}
