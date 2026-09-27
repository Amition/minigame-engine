import type { Color } from '../core/color';
import { bakeTexture, type Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { Ctx2D } from '../gfx/types';
import { hueShade, paletteMap } from './palette';

/** Character → colour. '.' and ' ' are always transparent. */
export type PixelPalette = Record<string, Color>;

export interface PixelSpriteOptions {
  /** Logical pixels per grid cell (default 1). Bake big enough: scaling a baked sprite up may blur it. */
  scale?: number;
  /** Adds a 1-cell outline of this colour around opaque cells (grows the sprite by 1 cell per side). */
  outline?: Color | null;
  /** 'round' (default) outlines only edge neighbours; 'square' also fills diagonal corners. */
  outlineMode?: 'round' | 'square';
  /** Auto edge shading: highlight on top edges, hue-shifted shadow on bottom/right edges. */
  shade?: boolean;
  /** Rows hold the left half; true mirrors all columns, 'odd' shares the last column (odd widths). */
  mirrorX?: boolean | 'odd';
  /** Rows hold the top half; true mirrors all rows, 'odd' shares the last row. */
  mirrorY?: boolean | 'odd';
  /** Transparent cells added on every side (after the outline). */
  padding?: number;
  resolution?: number;
  /** Register in the textures registry (frames of pixelFrames get `${key}#${i}`). */
  key?: string;
}

/** Decoded grid: row-major colours, null = transparent. */
export interface PixelGrid {
  w: number;
  h: number;
  cells: (Color | null)[];
}

const DEFAULT_PALETTE = paletteMap('pico8');

/** Accepts a string[] or one multi-line template string (common indentation and blank edge lines removed). */
export function pixelRows(rows: string | readonly string[]): string[] {
  if (typeof rows !== 'string') return [...rows];
  const lines = rows.replace(/\r/g, '').split('\n');
  while (lines.length && lines[0]!.trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  let indent = Infinity;
  for (const l of lines) if (l.trim()) indent = Math.min(indent, /^ */.exec(l)![0].length);
  return lines.map((l) => l.slice(indent === Infinity ? 0 : indent).replace(/\s+$/, ''));
}

/** Mirrors rows horizontally ('x': each row is the left half) or vertically ('y': rows are the top half). */
export function mirrorRows(rows: string | readonly string[], axis: 'x' | 'y' = 'x', odd = false): string[] {
  const list = pixelRows(rows);
  if (axis === 'x') {
    const w = Math.max(0, ...list.map((r) => r.length));
    return list.map((r) => {
      const row = r.padEnd(w, '.');
      const rev = [...row].reverse().join('');
      return row + (odd ? rev.slice(1) : rev);
    });
  }
  const rev = [...list].reverse();
  return [...list, ...(odd ? rev.slice(1) : rev)];
}

/** Decodes rows into a colour grid, applying mirroring, shading and outline. Throws on unknown characters. */
export function pixelGrid(
  rows: string | readonly string[],
  palette: PixelPalette = DEFAULT_PALETTE,
  opts: PixelSpriteOptions = {},
): PixelGrid {
  let list = pixelRows(rows);
  if (opts.mirrorX) list = mirrorRows(list, 'x', opts.mirrorX === 'odd');
  if (opts.mirrorY) list = mirrorRows(list, 'y', opts.mirrorY === 'odd');
  const w = Math.max(0, ...list.map((r) => r.length));
  const h = list.length;
  let cells: (Color | null)[] = new Array<Color | null>(w * h).fill(null);
  for (let y = 0; y < h; y++) {
    const row = list[y]!;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === '.' || ch === ' ') continue;
      const c = palette[ch];
      if (c === undefined) {
        throw new Error(
          `pixelSprite: character "${ch}" (row ${y}, col ${x}) is not in the palette (keys: ${Object.keys(palette).join('')})`,
        );
      }
      cells[y * w + x] = c;
    }
  }
  let grid: PixelGrid = { w, h, cells };
  if (opts.shade) grid = shadeGrid(grid);
  if (opts.outline) grid = outlineGrid(grid, opts.outline, opts.outlineMode ?? 'round');
  const pad = opts.padding ?? 0;
  if (pad > 0) {
    const pw = grid.w + pad * 2;
    const ph = grid.h + pad * 2;
    cells = new Array<Color | null>(pw * ph).fill(null);
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) cells[(y + pad) * pw + x + pad] = grid.cells[y * grid.w + x]!;
    }
    grid = { w: pw, h: ph, cells };
  }
  return grid;
}

function shadeGrid(g: PixelGrid): PixelGrid {
  const light = new Map<Color, Color>();
  const dark = new Map<Color, Color>();
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? null : g.cells[y * g.w + x]!);
  const out = g.cells.slice();
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const c = at(x, y);
      if (!c) continue;
      const top = at(x, y - 1) === null;
      const bottom = at(x, y + 1) === null;
      const right = at(x + 1, y) === null;
      if (bottom || (right && !top)) {
        let d = dark.get(c);
        if (!d) dark.set(c, (d = hueShade(c, -0.45)));
        out[y * g.w + x] = d;
      } else if (top) {
        let l = light.get(c);
        if (!l) light.set(c, (l = hueShade(c, 0.4)));
        out[y * g.w + x] = l;
      }
    }
  }
  return { w: g.w, h: g.h, cells: out };
}

function outlineGrid(g: PixelGrid, color: Color, mode: 'round' | 'square'): PixelGrid {
  const w = g.w + 2;
  const h = g.h + 2;
  const src = (x: number, y: number) =>
    x < 0 || y < 0 || x >= g.w || y >= g.h ? null : g.cells[y * g.w + x]!;
  const cells = new Array<Color | null>(w * h).fill(null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = src(x - 1, y - 1);
      if (c) {
        cells[y * w + x] = c;
        continue;
      }
      const sx = x - 1;
      const sy = y - 1;
      let edge = !!(src(sx - 1, sy) || src(sx + 1, sy) || src(sx, sy - 1) || src(sx, sy + 1));
      if (!edge && mode === 'square') {
        edge = !!(src(sx - 1, sy - 1) || src(sx + 1, sy - 1) || src(sx - 1, sy + 1) || src(sx + 1, sy + 1));
      }
      if (edge) cells[y * w + x] = color;
    }
  }
  return { w, h, cells };
}

/** Fills a grid with crisp rects (horizontal runs merged) at (ox, oy), `scale` units per cell. */
export function drawPixelGrid(ctx: Ctx2D, g: PixelGrid, ox = 0, oy = 0, scale = 1): void {
  for (let y = 0; y < g.h; y++) {
    let x = 0;
    while (x < g.w) {
      const c = g.cells[y * g.w + x];
      if (!c) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < g.w && g.cells[y * g.w + x + run] === c) run++;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * scale, oy + y * scale, run * scale, scale);
      x += run;
    }
  }
}

/**
 * Pixel art from text. Each character is a palette key; '.' and ' ' are transparent.
 * Default palette: pico8 by hex digit ('0' black … '7' white, '8' red … 'f' peach).
 *
 *     const heart = pixelSprite([
 *       '.rr.rr.',
 *       'rrrrrrr',
 *       '.rrrrr.',
 *       '..rrr..',
 *       '...r...',
 *     ], { r: '#e43b44' }, { scale: 8, outline: '#2a1b3d', shade: true });
 */
export function pixelSprite(
  rows: string | readonly string[],
  palette: PixelPalette = DEFAULT_PALETTE,
  opts: PixelSpriteOptions = {},
): Texture {
  const g = pixelGrid(rows, palette, opts);
  const s = opts.scale ?? 1;
  const bakeOpts: { resolution?: number; key?: string } = {};
  if (opts.resolution !== undefined) bakeOpts.resolution = opts.resolution;
  const tex = bakeTexture(Math.max(1, g.w * s), Math.max(1, g.h * s), (ctx) => drawPixelGrid(ctx, g, 0, 0, s), bakeOpts);
  if (opts.key) textures.set(opts.key, tex);
  return tex;
}

/**
 * Several frames (same palette/options) baked side by side on one canvas; returns one sub-texture per frame,
 * all padded to the largest frame size (bottom-centred), ready for frame animation.
 */
export function pixelFrames(
  frames: readonly (string | readonly string[])[],
  palette: PixelPalette = DEFAULT_PALETTE,
  opts: PixelSpriteOptions = {},
): Texture[] {
  const grids = frames.map((f) => pixelGrid(f, palette, opts));
  const fw = Math.max(1, ...grids.map((g) => g.w));
  const fh = Math.max(1, ...grids.map((g) => g.h));
  const s = opts.scale ?? 1;
  const bakeOpts: { resolution?: number } = {};
  if (opts.resolution !== undefined) bakeOpts.resolution = opts.resolution;
  const strip = bakeTexture(
    fw * s * grids.length,
    fh * s,
    (ctx) => {
      grids.forEach((g, i) => {
        const ox = i * fw + Math.floor((fw - g.w) / 2);
        drawPixelGrid(ctx, g, ox * s, (fh - g.h) * s, s);
      });
    },
    bakeOpts,
  );
  const out = grids.map((_, i) => strip.sub(i * fw * s, 0, fw * s, fh * s));
  if (opts.key) {
    textures.set(opts.key, strip);
    out.forEach((t, i) => textures.set(`${opts.key}#${i}`, t));
  }
  return out;
}
