import type { Rect } from '../core/math';
import { Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { ImageSource } from '../gfx/types';
import { platform } from '../platform/current';
import type { Platform } from '../platform/types';

export interface SheetDef {
  image: string;
  frameW: number;
  frameH: number;
  /** Number of frames (default: every full cell, row by row). */
  count?: number;
}

export interface AtlasDef {
  /** TexturePacker JSON (hash or array format). */
  json: string;
  /** Atlas image; default: meta.image next to the JSON. */
  image?: string;
  /** Prefix for frame keys (default `${key}/`); frame names lose their image extension: 'ui/button'. */
  prefix?: string;
}

/**
 * Files to load, paths relative to the app assets dir. Keys already loaded are skipped.
 * Textures go to the `textures` registry (sheet frames as `key#0`, `key#1`...), JSON/text to `assets`.
 */
export interface AssetManifest {
  images?: Record<string, string>;
  sheets?: Record<string, SheetDef>;
  atlases?: Record<string, AtlasDef>;
  json?: Record<string, string>;
  text?: Record<string, string>;
  /** Sounds for platform().audio, played by key. */
  sounds?: Record<string, string>;
}

export type AssetProgress = (progress: number, loaded: number, total: number) => void;

class AssetStore {
  private readonly jsonMap = new Map<string, unknown>();
  private readonly textMap = new Map<string, string>();

  /** Parsed JSON loaded under `key`. Throws if missing. */
  getJson<T = any>(key: string): T {
    if (!this.jsonMap.has(key)) throw new Error(`json "${key}" not loaded (have: ${[...this.jsonMap.keys()].join(', ')})`);
    return this.jsonMap.get(key) as T;
  }

  /** Text loaded under `key`. Throws if missing. */
  getText(key: string): string {
    const v = this.textMap.get(key);
    if (v === undefined) throw new Error(`text "${key}" not loaded (have: ${[...this.textMap.keys()].join(', ')})`);
    return v;
  }

  hasJson(key: string): boolean {
    return this.jsonMap.has(key);
  }

  hasText(key: string): boolean {
    return this.textMap.has(key);
  }

  setJson(key: string, value: unknown): void {
    this.jsonMap.set(key, value);
  }

  setText(key: string, value: string): void {
    this.textMap.set(key, value);
  }

  clear(): void {
    this.jsonMap.clear();
    this.textMap.clear();
  }
}

/** JSON and text loaded by loadAssets: `assets.getJson<Level[]>('levels')`. */
export const assets = new AssetStore();

const imageCache = new WeakMap<Platform, Map<string, Promise<ImageSource>>>();

/** Loads an image once per path (shared by images, sheets and atlases). */
export function loadImageCached(path: string): Promise<ImageSource> {
  const p = platform();
  let cache = imageCache.get(p);
  if (!cache) imageCache.set(p, (cache = new Map()));
  let img = cache.get(path);
  if (!img) {
    img = p.loadImage(path);
    cache.set(path, img);
    img.catch(() => cache!.delete(path));
  }
  return img;
}

const wrap = async <T>(what: string, job: Promise<T>): Promise<T> => {
  try {
    return await job;
  } catch (e) {
    throw new Error(`loadAssets: ${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/**
 * Loads a manifest in parallel, reporting progress 0..1 after each file:
 *
 *     await loadAssets({ images: { hero: 'img/hero.png' }, sheets: { coin: { image: 'img/coin.png', frameW: 32, frameH: 32 } },
 *       json: { levels: 'data/levels.json' } }, (p) => (bar.width = 400 * p));
 */
export async function loadAssets(manifest: AssetManifest, onProgress?: AssetProgress): Promise<void> {
  const p = platform();
  const jobs: (() => Promise<void>)[] = [];
  for (const [key, path] of Object.entries(manifest.images ?? {})) {
    if (textures.has(key)) continue;
    jobs.push(async () => {
      textures.set(key, new Texture(await wrap(`image "${key}" (${path})`, loadImageCached(path))));
    });
  }
  for (const [key, def] of Object.entries(manifest.sheets ?? {})) {
    if (textures.has(key)) continue;
    jobs.push(async () => {
      const tex = new Texture(await wrap(`sheet "${key}" (${def.image})`, loadImageCached(def.image)));
      for (const f of tex.grid(def.frameW, def.frameH, def.count, key)) textures.set(f.key, f);
      textures.set(key, tex);
    });
  }
  for (const [key, def] of Object.entries(manifest.atlases ?? {})) {
    if (textures.has(key)) continue;
    jobs.push(async () => {
      const raw = await wrap(`atlas "${key}" (${def.json})`, p.readText(def.json));
      const data = parseJson(raw, `atlas "${key}" (${def.json})`) as TexturePackerJson;
      const imagePath = def.image ?? (data.meta?.image ? dirOf(def.json) + data.meta.image : '');
      if (!imagePath) throw new Error(`loadAssets: atlas "${key}" has no image (set image or meta.image)`);
      const img = await wrap(`atlas "${key}" image (${imagePath})`, loadImageCached(imagePath));
      registerAtlas(key, img, data, def.prefix ?? `${key}/`);
    });
  }
  for (const [key, path] of Object.entries(manifest.json ?? {})) {
    if (assets.hasJson(key)) continue;
    jobs.push(async () => {
      assets.setJson(key, parseJson(await wrap(`json "${key}" (${path})`, p.readText(path)), `json "${key}" (${path})`));
    });
  }
  for (const [key, path] of Object.entries(manifest.text ?? {})) {
    if (assets.hasText(key)) continue;
    jobs.push(async () => {
      assets.setText(key, await wrap(`text "${key}" (${path})`, p.readText(path)));
    });
  }
  for (const [key, path] of Object.entries(manifest.sounds ?? {})) {
    if (p.audio.isLoaded(key)) continue;
    jobs.push(() => wrap(`sound "${key}" (${path})`, p.audio.load(key, path)));
  }
  const total = jobs.length;
  let loaded = 0;
  onProgress?.(total === 0 ? 1 : 0, 0, total);
  await Promise.all(
    jobs.map((job) =>
      job().then(() => {
        loaded++;
        onProgress?.(loaded / total, loaded, total);
      }),
    ),
  );
}

function parseJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`loadAssets: ${what}: invalid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
}

export interface TexturePackerFrame {
  filename?: string;
  frame: Rect;
  rotated?: boolean;
  trimmed?: boolean;
  spriteSourceSize?: Rect;
  sourceSize?: { w: number; h: number };
}

export interface TexturePackerJson {
  frames: Record<string, TexturePackerFrame> | TexturePackerFrame[];
  meta?: { image?: string };
}

/**
 * Registers the frames of a TexturePacker atlas (JSON hash or array) as `${prefix}${name}` (extension stripped).
 * Rotated or trimmed frames are baked into their own canvas at full source size.
 */
export function registerAtlas(key: string, image: ImageSource, data: TexturePackerJson, prefix = `${key}/`): string[] {
  const entries: [string, TexturePackerFrame][] = Array.isArray(data.frames)
    ? data.frames.map((f) => [f.filename ?? '', f])
    : Object.entries(data.frames);
  const keys: string[] = [];
  for (const [name, f] of entries) {
    const k = prefix + name.replace(/\.(png|jpe?g|webp|gif)$/i, '');
    textures.set(k, atlasFrameTexture(image, f));
    keys.push(k);
  }
  textures.set(key, new Texture(image));
  return keys;
}

function atlasFrameTexture(image: ImageSource, f: TexturePackerFrame): Texture {
  const { x, y, w, h } = f.frame;
  const src = f.sourceSize ?? { w, h };
  const off = f.spriteSourceSize ?? { x: 0, y: 0, w, h };
  const trimmed = !!f.trimmed && (src.w !== w || src.h !== h || off.x !== 0 || off.y !== 0);
  if (!f.rotated && !trimmed) return new Texture(image, { x, y, w, h });
  const surface = platform().createCanvas(trimmed ? src.w : w, trimmed ? src.h : h);
  const ctx = surface.getContext('2d');
  const img = image as unknown as CanvasImageSource;
  if (trimmed) ctx.translate(off.x, off.y);
  if (f.rotated) {
    ctx.translate(0, h);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, x, y, h, w, 0, 0, h, w);
  } else {
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  }
  return new Texture(surface);
}
