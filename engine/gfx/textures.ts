import { Texture } from './texture';

/**
 * Global texture registry keyed by string. Art generators and the asset loader put textures here;
 * `new Sprite('hero')` looks them up by key.
 */
class TextureRegistry {
  private map = new Map<string, Texture>();

  set(key: string, tex: Texture): Texture {
    tex.key = key;
    this.map.set(key, tex);
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
    this.map.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  clear(): void {
    this.map.clear();
  }

  /** Returns the cached texture or creates and registers it. */
  getOrCreate(key: string, create: () => Texture): Texture {
    return this.map.get(key) ?? this.set(key, create());
  }
}

export const textures = new TextureRegistry();
