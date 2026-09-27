import { darken, lighten, withAlpha, type Color } from '../core/color';
import { damp, type Vec2 } from '../core/math';
import type { Ctx2D } from '../gfx/types';
import { Node, type PointerEvt } from '../scene/node';
import { parseAsciiGrid, type AsciiGrid } from './ascii';
import { GroundObject, type GroundObjectOptions } from './ground';
import { findGridPath, type GridPathOptions, type GridPoint, type PathGrid } from './path';
import { visibleRectIn } from './world';

/** A terrain type: one base color shaded into top / left / right faces. */
export interface IsoTerrain {
  name?: string;
  color: Color;
  /** Face color overrides (default: derived from color). */
  top?: Color;
  left?: Color;
  right?: Color;
  /** Default true. */
  walkable?: boolean;
  /** Path cost multiplier (default 1). */
  cost?: number;
  /** Extra drawing on the top face, centered at (cx, cy) in map-local units. */
  decorate?: (ctx: Ctx2D, cx: number, cy: number, tile: IsoTileInfo) => void;
}

export interface IsoTileInfo {
  tx: number;
  ty: number;
  height: number;
  terrain: IsoTerrain;
  map: IsoMap;
}

/** Result of height-aware picking. */
export interface IsoPick {
  tx: number;
  ty: number;
  height: number;
  face: 'top' | 'left' | 'right';
}

export interface IsoMapOptions {
  cols: number;
  rows: number;
  /** Diamond width. Default 96. */
  tileWidth?: number;
  /** Diamond height. Default tileWidth / 2 (2:1). */
  tileHeight?: number;
  /** Screen units per height level. Default tileHeight / 2. */
  heightStep?: number;
  /** Height levels (-1 = no tile), as rows or flat (cols × rows). Default 0. */
  heights?: ArrayLike<number> | readonly (readonly number[])[];
  /** Terrain type index per tile, as rows or flat. Default 0. */
  terrain?: ArrayLike<number> | readonly (readonly number[])[];
  types?: IsoTerrain[];
  /** Slab thickness drawn below level 0 at open edges. Default heightStep. */
  baseDepth?: number;
  /** Tallest level the content box reserves room for. Default: the max of heights. */
  maxHeight?: number;
  /** Largest height difference a path step may climb/descend. Default 1. */
  maxStep?: number;
  /** Extra path cost per level climbed. Default 0.5. */
  climbCost?: number;
  /** Top face edge line (null = none). */
  outline?: Color | null;
  x?: number;
  y?: number;
  id?: string;
  tags?: string[];
}

/** Iso legend entry: a terrain type plus an optional marker recorded at every occurrence. */
export interface IsoLegendEntry extends IsoTerrain {
  marker?: string;
}

export interface IsoAsciiOptions extends Omit<IsoMapOptions, 'cols' | 'rows' | 'heights' | 'terrain' | 'types'> {
  /** One char per tile: '0'-'9', 'a'-'z' (10-35) = height level; '-' or ' ' = no tile. */
  heights: string | readonly string[];
  /** One char per tile mapped through `legend` (same size as heights). */
  terrain?: string | readonly string[];
  legend?: Record<string, IsoLegendEntry>;
}

interface Shades {
  top: Color;
  left: Color;
  right: Color;
  rim: Color;
  lineL: Color;
  lineR: Color;
}

const DEFAULT_TERRAIN: IsoTerrain = { name: 'grass', color: '#7cb342' };

function toFlat(src: ArrayLike<number> | readonly (readonly number[])[] | undefined, cols: number, rows: number, fill: number, what: string): Int16Array {
  const out = new Int16Array(cols * rows).fill(fill);
  if (!src) return out;
  if (src.length > 0 && Array.isArray(src[0])) {
    (src as readonly (readonly number[])[]).forEach((row, y) => {
      if (y >= rows || row.length > cols) throw new Error(`IsoMap ${what}: row ${y} does not fit ${cols}x${rows}`);
      row.forEach((v, x) => (out[y * cols + x] = v));
    });
  } else {
    const flat = src as ArrayLike<number>;
    if (flat.length !== cols * rows) throw new Error(`IsoMap ${what}: expected ${cols * rows} values, got ${flat.length}`);
    for (let i = 0; i < flat.length; i++) out[i] = flat[i]!;
  }
  return out;
}

/**
 * Isometric 2.5D map (2:1 diamonds) with per-tile height levels, rendered procedurally as shaded blocks
 * (voxel / diorama look). IsoObject children are depth-sorted together with the tiles (painter's order by
 * diagonal x + y, then z). Height-aware picking selects the front-most block under a point.
 *
 * Coordinates: iso (ix, iy) in tiles, tile (tx, ty) covers [tx, tx+1) × [ty, ty+1); z in height levels.
 * "Screen" = this node's local space (equal to world space when the map sits at 0,0 in a World).
 *
 *     const iso = IsoMap.fromAscii({
 *       heights: ['0012', '0122', '0011'],
 *       terrain: ['ggss', 'ggss', 'wwgg'],
 *       legend: { g: { color: '#7cb342' }, s: { color: '#a1887f' }, w: { color: '#29b6f6', walkable: false } },
 *     });
 *     iso.onTileTap((pick) => iso.select(pick.tx, pick.ty));
 */
export class IsoMap extends Node implements PathGrid {
  readonly cols: number;
  readonly rows: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly heightStep: number;
  readonly heights: Int16Array;
  readonly terrain: Int16Array;
  types: IsoTerrain[];
  baseDepth: number;
  maxStep: number;
  climbCost: number;
  outline: Color | null;
  /** Local position of iso (0, 0) at z = 0. */
  originX = 0;
  originY = 0;
  selected: GridPoint | null = null;
  selectColor: Color = '#fde047';
  /** Tiles drawn in the last frame. */
  tilesDrawn = 0;
  private maxLevel: number;
  private readonly blocked: Uint8Array;
  private readonly highlights = new Map<number, Color>();
  private readonly shadeCache = new Map<string, Shades>();
  private readonly markerMap = new Map<string, GridPoint[]>();
  private time = 0;
  private readonly info: IsoTileInfo;

  constructor(opts: IsoMapOptions) {
    super();
    this.cols = opts.cols;
    this.rows = opts.rows;
    this.tileWidth = opts.tileWidth ?? 96;
    this.tileHeight = opts.tileHeight ?? this.tileWidth / 2;
    this.heightStep = opts.heightStep ?? this.tileHeight / 2;
    this.heights = toFlat(opts.heights, this.cols, this.rows, 0, 'heights');
    this.terrain = toFlat(opts.terrain, this.cols, this.rows, 0, 'terrain');
    this.types = opts.types?.length ? opts.types : [DEFAULT_TERRAIN];
    this.baseDepth = opts.baseDepth ?? this.heightStep;
    this.maxStep = opts.maxStep ?? 1;
    this.climbCost = opts.climbCost ?? 0.5;
    this.outline = opts.outline === undefined ? 'rgba(0,0,0,0.12)' : opts.outline;
    this.blocked = new Uint8Array(this.cols * this.rows);
    let mx = 0;
    for (const h of this.heights) if (h > mx) mx = h;
    this.maxLevel = Math.max(opts.maxHeight ?? 0, mx);
    this.info = { tx: 0, ty: 0, height: 0, terrain: this.types[0]!, map: this };
    if (opts.id) this.id = opts.id;
    if (opts.tags) for (const t of opts.tags) this.tags.add(t);
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.layoutBox();
  }

  override get kind(): string {
    return 'IsoMap';
  }

  /** Builds a map from ASCII height digits and terrain chars (see IsoAsciiOptions). */
  static fromAscii(opts: IsoAsciiOptions): IsoMap {
    const hLegend: Record<string, number> = { '-': -1, ' ': -1 };
    for (let i = 0; i < 36; i++) hLegend[i.toString(36)] = i;
    const hg = parseAsciiGrid(opts.heights, hLegend, -1);
    const legend = opts.legend ?? {};
    const keys = Object.keys(legend);
    let terrain: number[] | undefined;
    let tg: AsciiGrid<number> | null = null;
    if (opts.terrain) {
      const tLegend: Record<string, number> = {};
      keys.forEach((k, i) => (tLegend[k] = i));
      tg = parseAsciiGrid(opts.terrain, tLegend, 0);
      if (tg.cols > hg.cols || tg.rows > hg.rows) {
        throw new Error(`IsoMap.fromAscii: terrain is ${tg.cols}x${tg.rows}, heights ${hg.cols}x${hg.rows}`);
      }
      terrain = new Array(hg.cols * hg.rows).fill(0);
      for (let y = 0; y < tg.rows; y++) for (let x = 0; x < tg.cols; x++) terrain[y * hg.cols + x] = tg.cells[y * tg.cols + x]!;
    }
    const map = new IsoMap({
      ...opts,
      cols: hg.cols,
      rows: hg.rows,
      heights: hg.cells,
      terrain,
      types: keys.map((k) => legend[k]!),
    });
    if (tg) {
      for (let y = 0; y < tg.rows; y++) {
        for (let x = 0; x < tg.cols; x++) {
          const m = legend[keys[tg.cells[y * tg.cols + x]!]!]?.marker;
          if (m) map.addMarker(m, x, y);
        }
      }
    }
    return map;
  }

  private layoutBox(): void {
    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;
    this.originX = this.rows * hw;
    this.originY = this.maxLevel * this.heightStep;
    this.width = (this.cols + this.rows) * hw;
    this.height = (this.cols + this.rows) * hh + this.maxLevel * this.heightStep + this.baseDepth;
  }

  // ---------------------------------------------------------------- tiles

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }

  /** Height level of a tile (-1 = no tile / outside). */
  heightAt(tx: number, ty: number): number {
    return this.inBounds(tx, ty) ? this.heights[ty * this.cols + tx]! : -1;
  }

  setHeight(tx: number, ty: number, h: number): void {
    if (!this.inBounds(tx, ty)) return;
    this.heights[ty * this.cols + tx] = h;
    if (h > this.maxLevel) {
      this.maxLevel = h;
      this.layoutBox();
    }
  }

  terrainAt(tx: number, ty: number): IsoTerrain | null {
    if (!this.inBounds(tx, ty)) return null;
    return this.types[this.terrain[ty * this.cols + tx]!] ?? this.types[0]!;
  }

  setTerrain(tx: number, ty: number, type: number): void {
    if (this.inBounds(tx, ty)) this.terrain[ty * this.cols + tx] = type;
  }

  /** Marks a tile as occupied (e.g. by a tree) so paths avoid it. */
  setBlocked(tx: number, ty: number, blocked = true): void {
    if (this.inBounds(tx, ty)) this.blocked[ty * this.cols + tx] = blocked ? 1 : 0;
  }

  isBlocked(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.blocked[ty * this.cols + tx] === 1;
  }

  // ---------------------------------------------------------------- projection

  /** Iso point (tiles) at height z (levels) → local screen point. */
  isoToScreen(ix: number, iy: number, z = 0, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = this.originX + (ix - iy) * (this.tileWidth / 2);
    out.y = this.originY + (ix + iy) * (this.tileHeight / 2) - z * this.heightStep;
    return out;
  }

  /** Local screen point → iso point on the plane at height z (levels). */
  screenToIso(sx: number, sy: number, z = 0, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const a = (sx - this.originX) / (this.tileWidth / 2);
    const b = (sy - this.originY + z * this.heightStep) / (this.tileHeight / 2);
    out.x = (a + b) / 2;
    out.y = (b - a) / 2;
    return out;
  }

  /** Local screen point at the center of a tile's top face. */
  tileTop(tx: number, ty: number, out?: Vec2): Vec2 {
    return this.isoToScreen(tx + 0.5, ty + 0.5, Math.max(0, this.heightAt(tx, ty)), out);
  }

  /**
   * Height-aware picking: the front-most block (top or side face) under a local screen point, or null.
   * Only the 2-3 tile diagonals that can cover the point are scanned, front to back.
   */
  pickTile(sx: number, sy: number): IsoPick | null {
    const u = (sx - this.originX) / (this.tileWidth / 2);
    let best: IsoPick | null = null;
    let bestSum = -Infinity;
    for (let d = Math.ceil(u - 1); d <= Math.floor(u + 1); d++) {
      const tyMin = Math.max(0, -d);
      const tyMax = Math.min(this.rows - 1, this.cols - 1 - d);
      for (let ty = tyMax; ty >= tyMin; ty--) {
        const tx = ty + d;
        if (tx + ty <= bestSum) break;
        const h = this.heights[ty * this.cols + tx]!;
        if (h < 0) continue;
        const face = this.hitBlock(tx, ty, h, sx, sy);
        if (face) {
          best = { tx, ty, height: h, face };
          bestSum = tx + ty;
          break;
        }
      }
    }
    return best;
  }

  private hitBlock(tx: number, ty: number, h: number, sx: number, sy: number): IsoPick['face'] | null {
    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;
    const cx = this.originX + (tx - ty) * hw;
    const dx = Math.abs(sx - cx) / hw;
    if (dx >= 1) return null;
    const groundCy = this.originY + (tx + ty + 1) * hh;
    const topCy = groundCy - h * this.heightStep;
    const k = hh * (1 - dx);
    if (sy >= topCy - k && sy <= topCy + k) return 'top';
    if (sy > topCy + k && sy <= groundCy + this.baseDepth + k) return sx < cx ? 'left' : 'right';
    return null;
  }

  /**
   * Calls fn with the picked tile whenever the map is tapped (makes the map interactive).
   * Returns a remover.
   */
  onTileTap(fn: (pick: IsoPick, e: PointerEvt) => void): () => void {
    this.interactive = true;
    return this.on('tap', (e: PointerEvt) => {
      const p = this.toLocal(e.x, e.y);
      const pick = this.pickTile(p.x, p.y);
      if (pick) fn(pick, e);
    });
  }

  override hitTest(lx: number, ly: number): boolean {
    return this.pickTile(lx, ly) !== null;
  }

  // ---------------------------------------------------------------- selection

  select(tx: number, ty: number): void {
    this.selected = this.inBounds(tx, ty) ? { x: tx, y: ty } : null;
  }

  /** Tints a tile's top face (e.g. path preview, reachable area). */
  highlight(tx: number, ty: number, color: Color = 'rgba(253,224,71,0.45)'): void {
    if (this.inBounds(tx, ty)) this.highlights.set(ty * this.cols + tx, color);
  }

  unhighlight(tx: number, ty: number): void {
    this.highlights.delete(ty * this.cols + tx);
  }

  clearHighlights(): void {
    this.highlights.clear();
  }

  get highlightCount(): number {
    return this.highlights.size;
  }

  // ---------------------------------------------------------------- markers

  markers(name: string): GridPoint[] {
    return (this.markerMap.get(name) ?? []).map((p) => ({ ...p }));
  }

  addMarker(name: string, tx: number, ty: number): void {
    let list = this.markerMap.get(name);
    if (!list) this.markerMap.set(name, (list = []));
    list.push({ x: tx, y: ty });
  }

  // ---------------------------------------------------------------- paths

  passable(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return false;
    const i = ty * this.cols + tx;
    if (this.heights[i]! < 0 || this.blocked[i]) return false;
    return (this.types[this.terrain[i]!] ?? this.types[0]!).walkable !== false;
  }

  moveCost(fx: number, fy: number, tx: number, ty: number): number {
    const dh = this.heightAt(tx, ty) - this.heightAt(fx, fy);
    if (Math.abs(dh) > this.maxStep) return Infinity;
    const t = this.terrainAt(tx, ty);
    return (t?.cost ?? 1) + Math.max(0, dh) * this.climbCost;
  }

  /** A* between tiles; steps may climb at most maxStep levels. */
  findPath(sx: number, sy: number, gx: number, gy: number, opts?: GridPathOptions): GridPoint[] | null {
    return findGridPath(this, sx, sy, gx, gy, opts);
  }

  /** Tile path → local screen points (top face centers). */
  pathToScreen(path: readonly GridPoint[]): Vec2[] {
    return path.map((p) => this.tileTop(p.x, p.y));
  }

  // ---------------------------------------------------------------- objects

  /** Adds an object standing on a tile. */
  addObject<T extends IsoObject>(obj: T, tx: number, ty: number): T {
    obj.setTile(tx, ty);
    this.add(obj);
    obj.elevation = Math.max(0, this.heightAt(tx, ty));
    this.placeObject(obj);
    return obj;
  }

  /** Positions an object's node from its iso coordinates and elevation. */
  placeObject(obj: IsoObject): void {
    const p = this.isoToScreen(obj.ix, obj.iy, obj.elevation);
    obj.x = p.x;
    obj.y = p.y;
  }

  /** Called by IsoObject.tick: eases the object's elevation toward the tile under it. */
  updateObject(obj: IsoObject, dt: number): void {
    const h = this.heightAt(obj.tileX, obj.tileY);
    if (h >= 0) {
      const k = obj.elevationLerp > 0 ? damp(obj.elevationLerp, dt) : 1;
      obj.elevation += (h - obj.elevation) * k;
      if (Math.abs(h - obj.elevation) < 0.001) obj.elevation = h;
    }
    this.placeObject(obj);
  }

  override update(dt: number): void {
    this.time += dt;
  }

  // ---------------------------------------------------------------- render

  protected override renderChildren(ctx: Ctx2D): void {
    this.tilesDrawn = 0;
    this.sortChildren();
    const objs: IsoObject[] = [];
    const others: Node[] = [];
    for (const c of this.children) {
      if (c instanceof IsoObject) {
        this.placeObject(c);
        objs.push(c);
      } else {
        others.push(c);
      }
    }
    objs.sort(
      (a, b) =>
        a.tileX + a.tileY - (b.tileX + b.tileY) || a.ix + a.iy - (b.ix + b.iy) || a.elevation - b.elevation || a.zIndex - b.zIndex,
    );
    const vis = visibleRectIn(this, this.tileWidth);
    let oi = 0;
    const maxDiag = this.cols + this.rows - 2;
    for (let s = 0; s <= maxDiag; s++) {
      while (oi < objs.length && objs[oi]!.tileX + objs[oi]!.tileY < s) objs[oi++]!.render(ctx);
      const tx0 = Math.max(0, s - (this.rows - 1));
      const tx1 = Math.min(this.cols - 1, s);
      for (let tx = tx0; tx <= tx1; tx++) this.drawTile(ctx, tx, s - tx, vis);
    }
    while (oi < objs.length) objs[oi++]!.render(ctx);
    for (const c of others) c.render(ctx);
  }

  private shades(type: number, h: number): Shades {
    const key = `${type}:${h}`;
    let s = this.shadeCache.get(key);
    if (!s) {
      const t = this.types[type] ?? this.types[0]!;
      const base = h > 0 ? lighten(t.color, Math.min(0.1, h * 0.018)) : t.color;
      const left = t.left ?? darken(base, 0.1);
      const right = t.right ?? darken(base, 0.2);
      s = {
        top: t.top ?? base,
        left,
        right,
        rim: withAlpha(lighten(base, 0.14), 0.9),
        lineL: darken(left, 0.06),
        lineR: darken(right, 0.06),
      };
      this.shadeCache.set(key, s);
    }
    return s;
  }

  private drawTile(ctx: Ctx2D, tx: number, ty: number, vis: { x: number; y: number; w: number; h: number } | null): void {
    const i = ty * this.cols + tx;
    const h = this.heights[i]!;
    if (h < 0) return;
    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;
    const Z = this.heightStep;
    const cx = this.originX + (tx - ty) * hw;
    const gTop = this.originY + (tx + ty) * hh;
    const e = h * Z;
    const top = gTop - e;
    if (vis && (cx + hw < vis.x || cx - hw > vis.x + vis.w || top > vis.y + vis.h || gTop + 2 * hh + this.baseDepth < vis.y)) return;
    this.tilesDrawn++;
    const type = this.terrain[i]!;
    const sh = this.shades(type, h);
    const lh = this.heightAt(tx, ty + 1);
    const rh = this.heightAt(tx + 1, ty);
    const leftBottom = lh >= 0 ? lh * Z : -this.baseDepth;
    const rightBottom = rh >= 0 ? rh * Z : -this.baseDepth;
    const Lx = cx - hw;
    const Rx = cx + hw;
    const midY = top + hh;
    const botY = top + 2 * hh;
    if (leftBottom < e) {
      const dz = e - leftBottom;
      ctx.fillStyle = sh.left;
      ctx.beginPath();
      ctx.moveTo(Lx, midY);
      ctx.lineTo(cx, botY);
      ctx.lineTo(cx, botY + dz);
      ctx.lineTo(Lx, midY + dz);
      ctx.closePath();
      ctx.fill();
      this.strata(ctx, Lx, midY, cx, botY, e, leftBottom, sh.lineL);
    }
    if (rightBottom < e) {
      const dz = e - rightBottom;
      ctx.fillStyle = sh.right;
      ctx.beginPath();
      ctx.moveTo(cx, botY);
      ctx.lineTo(Rx, midY);
      ctx.lineTo(Rx, midY + dz);
      ctx.lineTo(cx, botY + dz);
      ctx.closePath();
      ctx.fill();
      this.strata(ctx, cx, botY, Rx, midY, e, rightBottom, sh.lineR);
    }
    ctx.fillStyle = sh.top;
    this.diamond(ctx, cx, top, hw, hh);
    ctx.fill();
    ctx.strokeStyle = sh.rim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(Lx + 1, midY);
    ctx.lineTo(cx, top + 0.75);
    ctx.lineTo(Rx - 1, midY);
    ctx.stroke();
    if (this.outline) {
      ctx.strokeStyle = this.outline;
      ctx.lineWidth = 1;
      this.diamond(ctx, cx, top, hw, hh);
      ctx.stroke();
    }
    const t = this.types[type] ?? this.types[0]!;
    if (t.decorate) {
      const info = this.info;
      info.tx = tx;
      info.ty = ty;
      info.height = h;
      info.terrain = t;
      ctx.save();
      t.decorate(ctx, cx, midY, info);
      ctx.restore();
    }
    const hl = this.highlights.get(i);
    if (hl) {
      ctx.fillStyle = hl;
      this.diamond(ctx, cx, top, hw * 0.92, hh * 0.92, hh * 0.08);
      ctx.fill();
    }
    const sel = this.selected;
    if (sel && sel.x === tx && sel.y === ty) {
      const pulse = 0.65 + 0.35 * Math.sin(this.time * 6);
      ctx.strokeStyle = withAlpha(this.selectColor, pulse);
      ctx.lineWidth = 3;
      this.diamond(ctx, cx, top, hw * 0.86, hh * 0.86, hh * 0.14);
      ctx.stroke();
    }
  }

  /** Thin lines at each level boundary on a side face (voxel strata). */
  private strata(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, e: number, bottom: number, color: Color): void {
    const Z = this.heightStep;
    const levels = Math.floor((e - Math.max(0, bottom)) / Z);
    if (levels < 1 && bottom >= 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k <= levels; k++) {
      const dy = k * Z;
      if (e - dy <= bottom) break;
      ctx.moveTo(x0, y0 + dy);
      ctx.lineTo(x1, y1 + dy);
    }
    ctx.stroke();
  }

  private diamond(ctx: Ctx2D, cx: number, top: number, hw: number, hh: number, inset = 0): void {
    const t = top + inset;
    ctx.beginPath();
    ctx.moveTo(cx, t);
    ctx.lineTo(cx + hw, t + hh);
    ctx.lineTo(cx, t + 2 * hh);
    ctx.lineTo(cx - hw, t + hh);
    ctx.closePath();
  }

  override describe() {
    return {
      ...super.describe(),
      grid: `${this.cols}x${this.rows}`,
      tile: `${this.tileWidth}x${this.tileHeight}`,
      selected: this.selected ? `${this.selected.x},${this.selected.y}` : undefined,
      highlights: this.highlights.size || undefined,
    };
  }
}

export interface IsoObjectOptions extends GroundObjectOptions {
  /** Tile to stand on (sets ix/iy to its center). */
  tx?: number;
  ty?: number;
  ix?: number;
  iy?: number;
}

/**
 * An object on an IsoMap (add it as a child or via `iso.addObject`). (ix, iy) is its iso position in tiles
 * (tile center = tx + 0.5); `elevation` (levels) eases toward the height of the tile under it; `z` (inherited
 * from GroundObject) is an extra jump height in screen units with a shadow on the ground.
 * Draw the visual with its feet at local (0, 0) (zero-size node) or use size + anchor [0.5, 1].
 */
export class IsoObject extends GroundObject {
  ix = 0.5;
  iy = 0.5;
  elevation = 0;
  /** Elevation smoothing rate (0 = snap). Default 16. */
  elevationLerp = 16;

  constructor(opts: IsoObjectOptions = {}) {
    super(opts);
    if (opts.tx !== undefined) this.ix = opts.tx + 0.5;
    if (opts.ty !== undefined) this.iy = opts.ty + 0.5;
    if (opts.ix !== undefined) this.ix = opts.ix;
    if (opts.iy !== undefined) this.iy = opts.iy;
  }

  override get kind(): string {
    return 'IsoObject';
  }

  get tileX(): number {
    return Math.floor(this.ix);
  }

  get tileY(): number {
    return Math.floor(this.iy);
  }

  setTile(tx: number, ty: number): this {
    this.ix = tx + 0.5;
    this.iy = ty + 0.5;
    return this;
  }

  override tick(dt: number): void {
    if (this.paused || this.destroyed) return;
    super.tick(dt);
    if (this.parent instanceof IsoMap) this.parent.updateObject(this, dt);
  }

  override describe() {
    return {
      ...super.describe(),
      tile: `${this.tileX},${this.tileY}`,
      elev: Math.round(this.elevation * 100) / 100,
    };
  }
}
