import type { Rect } from '../core/math';
import { ScaledTexture, Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { Ctx2D, Surface } from '../gfx/types';
import { platform } from '../platform/current';

export interface TextureAtlasOptions {
  /** Page size in logical px (default 1024×1024). */
  width?: number;
  height?: number;
  /** Gap between entries and around the page edge (default 2) so filtering never bleeds. */
  padding?: number;
  /** Backing-store multiplier (default 1). */
  resolution?: number;
  /** Put every entry in the `textures` registry under its key (default true). */
  register?: boolean;
}

export interface TextureAtlasEntry extends Rect {
  key: string;
  page: number;
}

interface Segment {
  x: number;
  y: number;
  w: number;
}

/**
 * Packs many small baked images onto shared canvases (skyline bottom-left packing, new pages on demand).
 * Fewer canvases = fewer texture uploads and draw state changes.
 *
 *     const atlas = new TextureAtlas({ width: 512, height: 512 });
 *     atlas.add('gem', 48, 48, (ctx, w, h) => drawArtShape(ctx, 'gem', 2, 2, w - 4, h - 4, { fill: '#4dabf7' }));
 *     new Sprite('gem');
 */
export class TextureAtlas {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
  readonly resolution: number;
  readonly pages: Surface[] = [];
  private readonly register: boolean;
  private readonly skylines: Segment[][] = [];
  private readonly entries = new Map<string, { entry: TextureAtlasEntry; tex: Texture }>();

  constructor(opts: TextureAtlasOptions = {}) {
    this.width = opts.width ?? 1024;
    this.height = opts.height ?? 1024;
    this.padding = opts.padding ?? 2;
    this.resolution = opts.resolution ?? 1;
    this.register = opts.register ?? true;
  }

  /** Allocates a w×h region, runs `draw` clipped to it (local coords 0..w, 0..h) and returns its sub-texture. */
  add(key: string, w: number, h: number, draw: (ctx: Ctx2D, w: number, h: number) => void): Texture {
    if (this.entries.has(key)) throw new Error(`TextureAtlas: key "${key}" already added`);
    const aw = Math.ceil(w);
    const ah = Math.ceil(h);
    const p = this.padding;
    if (aw + 2 * p > this.width || ah + 2 * p > this.height) {
      throw new Error(`TextureAtlas: ${key} (${aw}x${ah}) does not fit a ${this.width}x${this.height} page`);
    }
    let spot: { page: number; x: number; y: number; i: number } | null = null;
    for (let page = 0; page < this.skylines.length && !spot; page++) spot = this.find(page, aw + p, ah + p);
    if (!spot) {
      this.newPage();
      spot = this.find(this.pages.length - 1, aw + p, ah + p);
      if (!spot) throw new Error(`TextureAtlas: cannot place ${key}`);
    }
    this.place(spot.page, spot.i, spot.x, spot.y, aw + p, ah + p);
    const r = this.resolution;
    const ctx = this.pages[spot.page]!.getContext('2d');
    ctx.save();
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.translate(spot.x, spot.y);
    ctx.beginPath();
    ctx.rect(0, 0, aw, ah);
    ctx.clip();
    draw(ctx, w, h);
    ctx.restore();
    const src = this.pages[spot.page]!;
    const tex =
      r === 1
        ? new Texture(src, { x: spot.x, y: spot.y, w, h }, key)
        : new ScaledTexture(src, r, key, { x: spot.x * r, y: spot.y * r, w: w * r, h: h * r });
    const entry: TextureAtlasEntry = { key, page: spot.page, x: spot.x, y: spot.y, w: aw, h: ah };
    this.entries.set(key, { entry, tex });
    if (this.register) textures.set(key, tex);
    return tex;
  }

  /** Copies an existing texture into the atlas. */
  addTexture(key: string, tex: Texture): Texture {
    return this.add(key, tex.width, tex.height, (ctx) => tex.draw(ctx, 0, 0));
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): Texture {
    const e = this.entries.get(key);
    if (!e) throw new Error(`TextureAtlas: no entry "${key}"`);
    return e.tex;
  }

  /** Allocated regions in logical px (padding excluded). */
  list(): TextureAtlasEntry[] {
    return [...this.entries.values()].map((e) => ({ ...e.entry }));
  }

  /** Whole page as a texture (debug view). */
  pageTexture(i: number): Texture {
    const s = this.pages[i];
    if (!s) throw new Error(`TextureAtlas: no page ${i}`);
    return this.resolution === 1 ? new Texture(s) : new ScaledTexture(s, this.resolution);
  }

  /** Used area / total page area, 0..1. */
  get occupancy(): number {
    if (this.pages.length === 0) return 0;
    let used = 0;
    for (const { entry } of this.entries.values()) used += entry.w * entry.h;
    return used / (this.pages.length * this.width * this.height);
  }

  private newPage(): void {
    const r = this.resolution;
    this.pages.push(platform().createCanvas(Math.ceil(this.width * r), Math.ceil(this.height * r)));
    const p = this.padding;
    this.skylines.push([{ x: p, y: p, w: this.width - p }]);
  }

  private find(page: number, w: number, h: number): { page: number; x: number; y: number; i: number } | null {
    const sky = this.skylines[page]!;
    let best: { page: number; x: number; y: number; i: number } | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < sky.length; i++) {
      const x = sky[i]!.x;
      if (x + w > this.width) break;
      let y = 0;
      let remaining = w;
      for (let j = i; j < sky.length && remaining > 0; j++) {
        y = Math.max(y, sky[j]!.y);
        remaining -= sky[j]!.w;
      }
      if (remaining > 0 || y + h > this.height) continue;
      let waste = 0;
      remaining = w;
      for (let j = i; j < sky.length && remaining > 0; j++) {
        const sw = Math.min(sky[j]!.w, remaining);
        waste += (y - sky[j]!.y) * sw;
        remaining -= sw;
      }
      // Lowest bottom edge first; area trapped under the entry breaks near-ties.
      const score = (y + h) * w + waste * 2 + x * 1e-6;
      if (score < bestScore) {
        best = { page, x, y, i };
        bestScore = score;
      }
    }
    return best;
  }

  private place(page: number, i: number, x: number, y: number, w: number, h: number): void {
    const sky = this.skylines[page]!;
    sky.splice(i, 0, { x, y: y + h, w });
    const end = x + w;
    for (let j = i + 1; j < sky.length; ) {
      const s = sky[j]!;
      if (s.x >= end) break;
      const cut = end - s.x;
      if (cut >= s.w) {
        sky.splice(j, 1);
      } else {
        s.x += cut;
        s.w -= cut;
        break;
      }
    }
    for (let j = 0; j < sky.length - 1; ) {
      if (sky[j]!.y === sky[j + 1]!.y) {
        sky[j]!.w += sky[j + 1]!.w;
        sky.splice(j + 1, 1);
      } else j++;
    }
  }
}
