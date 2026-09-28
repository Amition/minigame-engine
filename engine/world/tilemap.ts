import { hsl, type Color } from '../core/color';
import type { Rect, Vec2 } from '../core/math';
import type { Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { Ctx2D, Surface } from '../gfx/types';
import { platform } from '../platform/current';
import { Node, type NodeOptions } from '../scene/node';
import { parseAsciiGrid } from './ascii';
import { raycastGrid, type GridRayHit } from './collide';
import { findGridPath, type GridPathOptions, type GridPoint, type PathGrid } from './path';
import { visibleRectIn } from './world';

/** Passed to tile draw callbacks. */
export interface TileInfo {
  id: number;
  tx: number;
  ty: number;
  layer: TileLayer;
  map: TileMap;
}

/** Draws one tile into the rect (x, y, w, h) in map-local units. */
export type TileDrawFn = (ctx: Ctx2D, x: number, y: number, w: number, h: number, info: TileInfo) => void;

/** How a tile id looks and behaves. Visual priority: draw → texture → color (→ an auto color per id). */
export interface TileDef {
  name?: string;
  /** Texture or texture registry key, stretched to the tile size. */
  texture?: Texture | string;
  draw?: TileDrawFn;
  color?: Color;
  /** Blocks bodies and paths. */
  solid?: boolean;
  /** Only blocks bodies falling onto it from above (platformer). */
  oneWay?: boolean;
  /** Path cost multiplier (default 1; Infinity = impassable). */
  cost?: number;
}

/** Legend entry: a TileDef plus the id to place and an optional marker name recorded at every occurrence. */
export interface TileLegendEntry extends TileDef {
  /** Tile id to place; auto-assigned when omitted. 0 = empty. */
  id?: number;
  /** Records the cell under this name: `map.markers('player')`. */
  marker?: string;
}

/** Char → tile id or entry. `' '` is not special: map it explicitly (usually to 0). */
export type TileLegend = Readonly<Record<string, number | TileLegendEntry>>;

export interface TileMapOptions extends NodeOptions {
  cols: number;
  rows: number;
  tileWidth: number;
  /** Default tileWidth. */
  tileHeight?: number;
  /** Tile definitions by id. */
  tiles?: Record<number, TileDef>;
  /** Frames for ids 1..n (frame i → id i + 1), e.g. `sheet.grid(32, 32)`. */
  tileset?: readonly (Texture | string)[];
  /** Tiles per chunk side for pre-rendering. Default: ~512 units worth. */
  chunkTiles?: number;
  /** Cache static tiles in offscreen chunk canvases. Default true. */
  prerender?: boolean;
  /** Chunk canvas pixels per map unit. Default 1. */
  resolution?: number;
  /** Treat cells outside the map as solid. Default false. */
  solidOutside?: boolean;
}

/** One grid of tile ids (0 = empty). */
export class TileLayer {
  visible = true;
  alpha = 1;
  /** Set by the owning map to refresh its solidity cache. */
  onCollidesChange: (() => void) | null = null;
  private _collides = true;

  constructor(
    readonly name: string,
    readonly cols: number,
    readonly rows: number,
    readonly data: Int32Array = new Int32Array(cols * rows),
  ) {}

  /** When false the layer is decoration only (ignored by isSolid/costs). */
  get collides(): boolean {
    return this._collides;
  }

  set collides(v: boolean) {
    if (v === this._collides) return;
    this._collides = v;
    this.onCollidesChange?.();
  }

  /** Tile id, or -1 outside the layer. */
  get(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return -1;
    return this.data[ty * this.cols + tx]!;
  }
}

interface Chunk {
  surface: Surface | null;
  dirty: boolean;
}

/** Tile flag bits returned by TileMap.tileFlags(). */
export const TILE_SOLID = 1;
export const TILE_ONE_WAY = 2;

/** Overlap drawn into each chunk from its right/bottom neighbours so chunk seams never show. */
const CHUNK_PAD = 2;

/**
 * Orthogonal tile map with layers, solidity, markers, pathfinding and chunked pre-rendering.
 * Map-local coordinates start at the node origin; world queries subtract the node's x/y (no scale/rotation).
 *
 *     const map = TileMap.fromAscii(`
 *       ##########
 *       #P...T...#
 *       #..~~....#
 *       ##########`, {
 *       '#': { id: 1, solid: true, color: '#4b5563' },
 *       '.': { id: 2, color: '#65a30d' },
 *       '~': { id: 3, solid: true, color: '#0ea5e9' },
 *       P: { id: 2, marker: 'player' },
 *       T: { id: 2, marker: 'tree' },
 *     }, 64);
 *     const spawn = map.markerWorld('player');
 */
export class TileMap extends Node implements PathGrid {
  readonly cols: number;
  readonly rows: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly layers: TileLayer[] = [];
  readonly defs = new Map<number, TileDef>();
  prerender: boolean;
  readonly chunkTiles: number;
  readonly resolution: number;
  solidOutside: boolean;
  /** Chunks (re)baked in total and drawn in the last frame; tiles drawn directly in the last frame. */
  bakedChunks = 0;
  drawnChunks = 0;
  drawnTiles = 0;

  private chunks: Chunk[][] = [];
  private flags: Uint8Array;
  private costs: Float32Array;
  private flagsDirty = true;
  private readonly markerMap = new Map<string, GridPoint[]>();
  private readonly charOf = new Map<number, string>();
  private readonly texCache = new Map<number, Texture | null>();
  private readonly info: TileInfo;

  constructor(opts: TileMapOptions) {
    super();
    this.cols = opts.cols;
    this.rows = opts.rows;
    this.tileWidth = opts.tileWidth;
    this.tileHeight = opts.tileHeight ?? opts.tileWidth;
    this.prerender = opts.prerender ?? true;
    this.chunkTiles = Math.max(1, opts.chunkTiles ?? Math.max(4, Math.floor(512 / Math.max(this.tileWidth, this.tileHeight))));
    this.resolution = opts.resolution ?? 1;
    this.solidOutside = opts.solidOutside ?? false;
    this.flags = new Uint8Array(this.cols * this.rows);
    this.costs = new Float32Array(this.cols * this.rows);
    this.info = { id: 0, tx: 0, ty: 0, layer: null as unknown as TileLayer, map: this };
    opts.tileset?.forEach((t, i) => this.defineTile(i + 1, { texture: t }));
    if (opts.tiles) for (const [id, def] of Object.entries(opts.tiles)) this.defineTile(+id, def);
    this.set(opts);
    this.width = this.cols * this.tileWidth;
    this.height = this.rows * this.tileHeight;
  }

  override get kind(): string {
    return 'TileMap';
  }

  /**
   * Builds a map from ASCII rows (or a multi-line string) and a legend; creates layer 'main'.
   * Short rows are padded with 0. Markers are recorded: `map.markers('tree')`.
   */
  static fromAscii(
    src: string | readonly string[],
    legend: TileLegend,
    tileSize: number | { width: number; height: number },
    opts: Partial<Omit<TileMapOptions, 'cols' | 'rows' | 'tileWidth' | 'tileHeight'>> = {},
  ): TileMap {
    const entries = resolveLegend(legend);
    const grid = parseAsciiGrid(src, entries.byChar, EMPTY_ENTRY);
    const tw = typeof tileSize === 'number' ? tileSize : tileSize.width;
    const th = typeof tileSize === 'number' ? tileSize : tileSize.height;
    const map = new TileMap({ ...opts, cols: grid.cols, rows: grid.rows, tileWidth: tw, tileHeight: th });
    map.applyLegend(entries);
    map.fillLayerFromEntries(map.addLayer('main'), grid.cells);
    return map;
  }

  // ---------------------------------------------------------------- layers & defs

  /** Adds a layer from rows of ids (`number[][]`), a flat array (cols × rows) or empty. */
  addLayer(name: string, data?: readonly (readonly number[])[] | ArrayLike<number>): TileLayer {
    const layer = new TileLayer(name, this.cols, this.rows);
    if (data) {
      if (data.length > 0 && Array.isArray(data[0])) {
        const rows = data as readonly (readonly number[])[];
        if (rows.length > this.rows) throw new Error(`layer "${name}": ${rows.length} rows > map rows ${this.rows}`);
        rows.forEach((row, y) => {
          if (row.length > this.cols) throw new Error(`layer "${name}": row ${y} has ${row.length} cols > ${this.cols}`);
          row.forEach((id, x) => (layer.data[y * this.cols + x] = id));
        });
      } else {
        const flat = data as ArrayLike<number>;
        if (flat.length !== this.cols * this.rows) {
          throw new Error(`layer "${name}": expected ${this.cols * this.rows} ids, got ${flat.length}`);
        }
        for (let i = 0; i < flat.length; i++) layer.data[i] = flat[i]!;
      }
    }
    layer.onCollidesChange = () => (this.flagsDirty = true);
    this.layers.push(layer);
    this.chunks.push([]);
    this.flagsDirty = true;
    return layer;
  }

  /** Adds a layer parsed from ASCII with its own legend (defs and markers are merged into the map). */
  addAsciiLayer(name: string, src: string | readonly string[], legend: TileLegend): TileLayer {
    const entries = resolveLegend(legend);
    const grid = parseAsciiGrid(src, entries.byChar, EMPTY_ENTRY);
    if (grid.cols > this.cols || grid.rows > this.rows) {
      throw new Error(`layer "${name}": ascii is ${grid.cols}x${grid.rows}, map is ${this.cols}x${this.rows}`);
    }
    this.applyLegend(entries);
    const layer = this.addLayer(name);
    const cells: LegendEntry[] = new Array(this.cols * this.rows).fill(EMPTY_ENTRY);
    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.cols; x++) cells[y * this.cols + x] = grid.cells[y * grid.cols + x]!;
    }
    this.fillLayerFromEntries(layer, cells);
    return layer;
  }

  /** Layer by name or index (default: the first layer). */
  layer(which: string | number = 0): TileLayer {
    const l = typeof which === 'number' ? this.layers[which] : this.layers.find((x) => x.name === which);
    if (!l) throw new Error(`TileMap: no layer ${JSON.stringify(which)} (have: ${this.layers.map((x) => x.name).join(', ')})`);
    return l;
  }

  /** Defines (or replaces) how a tile id looks/behaves. Invalidates cached chunks. */
  defineTile(id: number, def: TileDef): this {
    this.defs.set(id, { ...this.defs.get(id), ...def });
    this.texCache.delete(id);
    this.flagsDirty = true;
    this.invalidate();
    return this;
  }

  /** Marks every chunk for redraw (e.g. after changing a draw callback's inputs). */
  invalidate(): void {
    for (const list of this.chunks) for (const c of list) if (c) c.dirty = true;
  }

  // ---------------------------------------------------------------- cells

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }

  /** Tile id at a cell (-1 outside the map). */
  getTile(tx: number, ty: number, layer: string | number = 0): number {
    return this.layer(layer).get(tx, ty);
  }

  /** Sets a tile; redraws only the affected chunk(s). Returns false outside the map. */
  setTile(tx: number, ty: number, id: number, layer: string | number = 0): boolean {
    if (!this.inBounds(tx, ty)) return false;
    const l = this.layer(layer);
    const i = ty * this.cols + tx;
    if (l.data[i] === id) return true;
    l.data[i] = id;
    this.markDirty(this.layers.indexOf(l), tx, ty);
    if (!this.flagsDirty) this.updateCell(tx, ty);
    return true;
  }

  /** Fills a rect of cells with one id. */
  fill(id: number, tx: number, ty: number, w: number, h: number, layer: string | number = 0): void {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) this.setTile(x, y, id, layer);
  }

  /** World point → cell. */
  worldToTile(wx: number, wy: number, out: GridPoint = { x: 0, y: 0 }): GridPoint {
    out.x = Math.floor((wx - this.x) / this.tileWidth);
    out.y = Math.floor((wy - this.y) / this.tileHeight);
    return out;
  }

  /** Cell → world point (the cell center, or its top-left with center = false). */
  tileToWorld(tx: number, ty: number, center = true, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const k = center ? 0.5 : 0;
    out.x = this.x + (tx + k) * this.tileWidth;
    out.y = this.y + (ty + k) * this.tileHeight;
    return out;
  }

  /** World rect of a cell. */
  tileRect(tx: number, ty: number): Rect {
    return { x: this.x + tx * this.tileWidth, y: this.y + ty * this.tileHeight, w: this.tileWidth, h: this.tileHeight };
  }

  /** Tile id under a world point (-1 outside). */
  tileAt(wx: number, wy: number, layer: string | number = 0): number {
    const p = this.worldToTile(wx, wy);
    return this.getTile(p.x, p.y, layer);
  }

  /** TILE_SOLID / TILE_ONE_WAY bits of a cell, combined over colliding layers. */
  tileFlags(tx: number, ty: number): number {
    if (!this.inBounds(tx, ty)) return this.solidOutside ? TILE_SOLID : 0;
    if (this.flagsDirty) this.rebuildFlags();
    return this.flags[ty * this.cols + tx]!;
  }

  isSolid(tx: number, ty: number): boolean {
    return (this.tileFlags(tx, ty) & TILE_SOLID) !== 0;
  }

  isOneWay(tx: number, ty: number): boolean {
    return (this.tileFlags(tx, ty) & TILE_ONE_WAY) !== 0;
  }

  /** Solid tile under a world point. */
  solidAt(wx: number, wy: number): boolean {
    const p = this.worldToTile(wx, wy);
    return this.isSolid(p.x, p.y);
  }

  /** Path cost multiplier of a cell (max over colliding layers; Infinity when solid or outside). */
  tileCost(tx: number, ty: number): number {
    if (!this.inBounds(tx, ty)) return Infinity;
    if (this.flagsDirty) this.rebuildFlags();
    return this.costs[ty * this.cols + tx]!;
  }

  passable(tx: number, ty: number): boolean {
    return this.tileCost(tx, ty) < Infinity;
  }

  moveCost(_fx: number, _fy: number, tx: number, ty: number): number {
    return this.tileCost(tx, ty);
  }

  // ---------------------------------------------------------------- markers

  /** Cells recorded for a legend marker (empty when none). */
  markers(name: string): GridPoint[] {
    return (this.markerMap.get(name) ?? []).map((p) => ({ ...p }));
  }

  /** First cell of a marker; throws when the map has none. */
  marker(name: string): GridPoint {
    const p = this.markerMap.get(name)?.[0];
    if (!p) throw new Error(`TileMap: no marker "${name}" (have: ${[...this.markerMap.keys()].join(', ') || 'none'})`);
    return { ...p };
  }

  /** World center of the first cell of a marker. */
  markerWorld(name: string): Vec2 {
    const p = this.marker(name);
    return this.tileToWorld(p.x, p.y);
  }

  markerNames(): string[] {
    return [...this.markerMap.keys()];
  }

  /** Records a marker cell (also done by fromAscii / addAsciiLayer). */
  addMarker(name: string, tx: number, ty: number): void {
    let list = this.markerMap.get(name);
    if (!list) this.markerMap.set(name, (list = []));
    list.push({ x: tx, y: ty });
  }

  // ---------------------------------------------------------------- autotiling

  /**
   * 4-bit neighbour mask: 1 = up, 2 = right, 4 = down, 8 = left. `match` is an id or predicate
   * (default: same id as this cell). Cells outside the map count as matching when `outside` is true.
   */
  mask4(tx: number, ty: number, match?: number | ((id: number) => boolean), layer: string | number = 0, outside = true): number {
    const l = this.layer(layer);
    const m = matcher(match ?? l.get(tx, ty));
    const at = (x: number, y: number) => {
      const id = l.get(x, y);
      return id < 0 ? outside : m(id);
    };
    return (at(tx, ty - 1) ? 1 : 0) | (at(tx + 1, ty) ? 2 : 0) | (at(tx, ty + 1) ? 4 : 0) | (at(tx - 1, ty) ? 8 : 0);
  }

  /**
   * 8-bit mask: 1 N, 2 NE, 4 E, 8 SE, 16 S, 32 SW, 64 W, 128 NW. Corner bits are only set when both adjacent
   * edges are set (the usual 47-tile "blob" reduction).
   */
  mask8(tx: number, ty: number, match?: number | ((id: number) => boolean), layer: string | number = 0, outside = true): number {
    const l = this.layer(layer);
    const m = matcher(match ?? l.get(tx, ty));
    const at = (x: number, y: number) => {
      const id = l.get(x, y);
      return id < 0 ? outside : m(id);
    };
    const n = at(tx, ty - 1);
    const e = at(tx + 1, ty);
    const s = at(tx, ty + 1);
    const w = at(tx - 1, ty);
    let mask = (n ? 1 : 0) | (e ? 4 : 0) | (s ? 16 : 0) | (w ? 64 : 0);
    if (n && e && at(tx + 1, ty - 1)) mask |= 2;
    if (s && e && at(tx + 1, ty + 1)) mask |= 8;
    if (s && w && at(tx - 1, ty + 1)) mask |= 32;
    if (n && w && at(tx - 1, ty - 1)) mask |= 128;
    return mask;
  }

  /**
   * Replaces every tile matching `match` with `pick(mask, tx, ty)`, masks computed before any change.
   * Example (4-bit, 16 wall variants at ids 100..115): `map.autotile(1, (m) => 100 + m)`.
   */
  autotile(
    match: number | ((id: number) => boolean),
    pick: (mask: number, tx: number, ty: number) => number,
    opts: { layer?: string | number; bits?: 4 | 8 } = {},
  ): void {
    const layer = opts.layer ?? 0;
    const l = this.layer(layer);
    const m = matcher(match);
    const changes: [number, number, number][] = [];
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < this.cols; tx++) {
        if (!m(l.get(tx, ty))) continue;
        const mask = opts.bits === 8 ? this.mask8(tx, ty, m, layer) : this.mask4(tx, ty, m, layer);
        changes.push([tx, ty, pick(mask, tx, ty)]);
      }
    }
    for (const [tx, ty, id] of changes) this.setTile(tx, ty, id, layer);
  }

  // ---------------------------------------------------------------- paths & rays

  /** A* in cells (solid tiles block; tile costs apply). */
  findPath(sx: number, sy: number, gx: number, gy: number, opts?: GridPathOptions): GridPoint[] | null {
    return findGridPath(this, sx, sy, gx, gy, opts);
  }

  /** A* between world points; returns world-space cell centers (the start cell's center first). */
  findWorldPath(wx0: number, wy0: number, wx1: number, wy1: number, opts?: GridPathOptions): Vec2[] | null {
    const a = this.worldToTile(wx0, wy0);
    const b = this.worldToTile(wx1, wy1);
    const path = this.findPath(a.x, a.y, b.x, b.y, opts);
    return path ? this.pathToWorld(path) : null;
  }

  /** Cell path → world-space cell centers. */
  pathToWorld(path: readonly GridPoint[]): Vec2[] {
    return path.map((p) => this.tileToWorld(p.x, p.y));
  }

  /** First solid tile along a world-space segment. */
  raycast(x0: number, y0: number, x1: number, y1: number): GridRayHit | null {
    const ox = this.x;
    const oy = this.y;
    const hit = raycastGrid((tx, ty) => this.isSolid(tx, ty), x0 - ox, y0 - oy, x1 - ox, y1 - oy, this.tileWidth, this.tileHeight);
    if (hit) {
      hit.x += ox;
      hit.y += oy;
    }
    return hit;
  }

  /** No solid tile between two world points. */
  hasLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.raycast(x0, y0, x1, y1) === null;
  }

  // ---------------------------------------------------------------- text

  /** Layer as ASCII rows using the legend chars (fallback: 0 → '.', others → base-36 digit). */
  toAscii(layer: string | number = 0): string[] {
    const l = this.layer(layer);
    const out: string[] = [];
    for (let y = 0; y < this.rows; y++) {
      let row = '';
      for (let x = 0; x < this.cols; x++) {
        const id = l.data[y * this.cols + x]!;
        row += this.charOf.get(id) ?? (id === 0 ? '.' : id < 36 ? id.toString(36) : '?');
      }
      out.push(row);
    }
    return out;
  }

  // ---------------------------------------------------------------- render

  override draw(ctx: Ctx2D): void {
    this.drawnChunks = 0;
    this.drawnTiles = 0;
    if (this.layers.length === 0) return;
    const tw = this.tileWidth;
    const th = this.tileHeight;
    const vis = visibleRectIn(this) ?? { x: 0, y: 0, w: this.width, h: this.height };
    const c0 = Math.max(0, Math.floor(vis.x / tw));
    const r0 = Math.max(0, Math.floor(vis.y / th));
    const c1 = Math.min(this.cols - 1, Math.floor((vis.x + vis.w) / tw));
    const r1 = Math.min(this.rows - 1, Math.floor((vis.y + vis.h) / th));
    if (c0 > c1 || r0 > r1) return;
    const baseAlpha = ctx.globalAlpha;
    this.layers.forEach((layer, li) => {
      if (!layer.visible || layer.alpha <= 0) return;
      ctx.globalAlpha = baseAlpha * layer.alpha;
      if (!this.prerender) {
        this.drawTiles(ctx, layer, c0, r0, c1, r1);
        return;
      }
      const ct = this.chunkTiles;
      const chunkCols = Math.ceil(this.cols / ct);
      for (let cy = Math.floor(r0 / ct); cy <= Math.floor(r1 / ct); cy++) {
        for (let cx = Math.floor(c0 / ct); cx <= Math.floor(c1 / ct); cx++) {
          const list = this.chunks[li]!;
          const key = cy * chunkCols + cx;
          const chunk = (list[key] ??= { surface: null, dirty: true });
          if (chunk.dirty || !chunk.surface) this.bakeChunk(layer, cx, cy, chunk);
          const s = chunk.surface!;
          const res = this.resolution;
          ctx.drawImage(s as unknown as CanvasImageSource, 0, 0, s.width, s.height, cx * ct * tw, cy * ct * th, s.width / res, s.height / res);
          this.drawnChunks++;
        }
      }
    });
    ctx.globalAlpha = baseAlpha;
  }

  private bakeChunk(layer: TileLayer, cx: number, cy: number, chunk: Chunk): void {
    const ct = this.chunkTiles;
    const tw = this.tileWidth;
    const th = this.tileHeight;
    const res = this.resolution;
    const x0 = cx * ct;
    const y0 = cy * ct;
    const wUnits = Math.min(ct, this.cols - x0) * tw + CHUNK_PAD;
    const hUnits = Math.min(ct, this.rows - y0) * th + CHUNK_PAD;
    if (!chunk.surface) chunk.surface = platform().createCanvas(Math.ceil(wUnits * res), Math.ceil(hUnits * res));
    const s = chunk.surface;
    const ctx = s.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, s.width, s.height);
    ctx.setTransform(res, 0, 0, res, -x0 * tw * res, -y0 * th * res);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 * tw, y0 * th, wUnits, hUnits);
    ctx.clip();
    this.drawTiles(ctx, layer, x0, y0, Math.min(this.cols - 1, x0 + ct), Math.min(this.rows - 1, y0 + ct));
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    chunk.dirty = false;
    this.bakedChunks++;
  }

  /** Draws the tiles of a layer in a cell range (map-local units). */
  protected drawTiles(ctx: Ctx2D, layer: TileLayer, c0: number, r0: number, c1: number, r1: number): void {
    const tw = this.tileWidth;
    const th = this.tileHeight;
    const info = this.info;
    info.layer = layer;
    for (let ty = r0; ty <= r1; ty++) {
      for (let tx = c0; tx <= c1; tx++) {
        const id = layer.data[ty * this.cols + tx]!;
        if (id <= 0) continue;
        const x = tx * tw;
        const y = ty * th;
        const def = this.defs.get(id);
        this.drawnTiles++;
        if (def?.draw) {
          info.id = id;
          info.tx = tx;
          info.ty = ty;
          ctx.save();
          def.draw(ctx, x, y, tw, th, info);
          ctx.restore();
          continue;
        }
        const tex = this.textureFor(id, def);
        if (tex) {
          tex.draw(ctx, x, y, tw, th);
          continue;
        }
        ctx.fillStyle = def?.color ?? autoColor(id);
        ctx.fillRect(x, y, tw, th);
      }
    }
  }

  private textureFor(id: number, def: TileDef | undefined): Texture | null {
    if (!def?.texture) return null;
    let t = this.texCache.get(id);
    if (t === undefined) {
      t = typeof def.texture === 'string' ? textures.get(def.texture) : def.texture;
      this.texCache.set(id, t);
    }
    return t;
  }

  private markDirty(li: number, tx: number, ty: number): void {
    const ct = this.chunkTiles;
    const list = this.chunks[li];
    if (!list) return;
    const chunkCols = Math.ceil(this.cols / ct);
    const cx = Math.floor(tx / ct);
    const cy = Math.floor(ty / ct);
    const mark = (x: number, y: number) => {
      if (x < 0 || y < 0) return;
      const c = list[y * chunkCols + x];
      if (c) c.dirty = true;
    };
    mark(cx, cy);
    const left = tx % ct === 0;
    const top = ty % ct === 0;
    if (left) mark(cx - 1, cy);
    if (top) mark(cx, cy - 1);
    if (left && top) mark(cx - 1, cy - 1);
  }

  private rebuildFlags(): void {
    this.flagsDirty = false;
    for (let ty = 0; ty < this.rows; ty++) for (let tx = 0; tx < this.cols; tx++) this.updateCell(tx, ty);
  }

  private updateCell(tx: number, ty: number): void {
    const i = ty * this.cols + tx;
    let f = 0;
    let cost = 1;
    for (const l of this.layers) {
      if (!l.collides) continue;
      const id = l.data[i]!;
      if (id <= 0) continue;
      const d = this.defs.get(id);
      if (!d) continue;
      if (d.solid) f |= TILE_SOLID;
      if (d.oneWay) f |= TILE_ONE_WAY;
      if (d.cost !== undefined && d.cost > cost) cost = d.cost;
    }
    this.flags[i] = f;
    this.costs[i] = f & TILE_SOLID ? Infinity : cost;
  }

  private applyLegend(entries: ResolvedLegend): void {
    for (const [id, def] of entries.defs) this.defineTile(id, def);
    for (const [id, ch] of entries.charOf) if (!this.charOf.has(id)) this.charOf.set(id, ch);
  }

  private fillLayerFromEntries(layer: TileLayer, cells: readonly LegendEntry[]): void {
    cells.forEach((e, i) => {
      layer.data[i] = e.id;
      if (e.marker) this.addMarker(e.marker, i % this.cols, Math.floor(i / this.cols));
    });
    this.flagsDirty = true;
  }

  /**
   * Frees the pre-rendered chunk canvases now (shrunk to 1x1: mini-game canvases are slow to be collected); visible
   * chunks re-bake on the next draw. Called on destroy; call it for a map that stays hidden for long.
   */
  releaseChunks(): void {
    for (const list of this.chunks) {
      for (const c of list) {
        if (!c?.surface) continue;
        c.surface.width = 1;
        c.surface.height = 1;
        c.surface = null;
      }
    }
    this.chunks = this.chunks.map(() => []);
  }

  protected override onDestroy(): void {
    this.releaseChunks();
  }

  override describe() {
    const total = this.chunks.reduce((n, l) => n + l.filter(Boolean).length, 0);
    return {
      ...super.describe(),
      grid: `${this.cols}x${this.rows}`,
      tile: this.tileWidth === this.tileHeight ? this.tileWidth : `${this.tileWidth}x${this.tileHeight}`,
      layers: this.layers.map((l) => l.name).join(','),
      chunks: this.prerender ? `${this.drawnChunks}/${total}` : undefined,
    };
  }
}

interface LegendEntry {
  id: number;
  marker?: string;
}

interface ResolvedLegend {
  byChar: Record<string, LegendEntry>;
  defs: Map<number, TileDef>;
  charOf: Map<number, string>;
}

const EMPTY_ENTRY: LegendEntry = { id: 0 };
const DEF_KEYS = ['name', 'texture', 'draw', 'color', 'solid', 'oneWay', 'cost'] as const;

function resolveLegend(legend: TileLegend): ResolvedLegend {
  let next = 1;
  for (const v of Object.values(legend)) {
    const id = typeof v === 'number' ? v : v.id;
    if (id !== undefined && id >= next) next = id + 1;
  }
  const byChar: Record<string, LegendEntry> = {};
  const defs = new Map<number, TileDef>();
  const charOf = new Map<number, string>();
  const markerChars: [number, string][] = [];
  for (const [ch, v] of Object.entries(legend)) {
    if (typeof v === 'number') {
      byChar[ch] = { id: v };
      if (!charOf.has(v)) charOf.set(v, ch);
      continue;
    }
    const id = v.id ?? next++;
    byChar[ch] = v.marker ? { id, marker: v.marker } : { id };
    const def: TileDef = {};
    let hasDef = false;
    for (const k of DEF_KEYS) {
      if (v[k] !== undefined) {
        (def as Record<string, unknown>)[k] = v[k];
        hasDef = true;
      }
    }
    if (hasDef) defs.set(id, { ...defs.get(id), ...def });
    if (v.marker) markerChars.push([id, ch]);
    else if (!charOf.has(id)) charOf.set(id, ch);
  }
  for (const [id, ch] of markerChars) if (!charOf.has(id)) charOf.set(id, ch);
  return { byChar, defs, charOf };
}

function matcher(m: number | ((id: number) => boolean)): (id: number) => boolean {
  return typeof m === 'number' ? (id) => id === m : m;
}

const autoColors = new Map<number, Color>();

function autoColor(id: number): Color {
  let c = autoColors.get(id);
  if (!c) autoColors.set(id, (c = hsl((id * 137.5) % 360, 0.45, 0.5)));
  return c;
}
