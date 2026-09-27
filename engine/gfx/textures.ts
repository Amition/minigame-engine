import { Texture, trackTexture, untrackTexture } from './texture';
import type { ImageSource } from './types';

/**
 * Global texture registry keyed by string. Art generators and the asset loader put textures here;
 * `new Sprite('hero')` looks them up by key. Registered sources count in textureStats(); delete()/clear()
 * stop counting a source once no registered texture uses it.
 */
class TextureRegistry {
  private map = new Map<string, Texture>();

  set(key: string, tex: Texture): Texture {
    const old = this.map.get(key);
    tex.key = key;
    this.map.set(key, tex);
    if (old && old.source !== tex.source) this.release(old.source);
    const s = tex.source;
    const whole = tex.frame.x === 0 && tex.frame.y === 0 && tex.frame.w === s.width && tex.frame.h === s.height;
    const kind = typeof (s as { getContext?: unknown }).getContext === 'function' ? 'canvas' : 'image';
    trackTexture(s, whole ? key : `page(${key})`, kind);
    return tex;
  }

  get(key: string): Texture {
    const t = this.map.get(key);
    if (!t) throw new Error(`texture "${key}" not found (registered: ${[...this.map.keys()].slice(0, 20).join(', ')})`);
    return t;
  }

  tryGet(key: string): Texture | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): void {
    const t = this.map.get(key);
    if (!t) return;
    this.map.delete(key);
    this.release(t.source);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  clear(): void {
    for (const t of this.map.values()) untrackTexture(t.source);
    this.map.clear();
  }

  /** Returns the cached texture or creates and registers it. */
  getOrCreate(key: string, create: () => Texture): Texture {
    return this.map.get(key) ?? this.set(key, create());
  }

  private release(source: ImageSource): void {
    for (const t of this.map.values()) if (t.source === source) return;
    untrackTexture(source);
  }
}

export const textures = new TextureRegistry();
