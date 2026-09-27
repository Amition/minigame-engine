import type { Color } from '../core/color';
import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from '../scene/node';

export interface PerspectiveOptions {
  /** Screen x of the vanishing point. */
  centerX: number;
  /** Screen y of the horizon. */
  horizon: number;
  /** Focal length in screen units (bigger = narrower field of view). */
  focal: number;
  /** Camera height above the ground plane (world units). Default 1000. */
  cameraHeight?: number;
  /** Points closer than this are not visible. Default 1. */
  near?: number;
  /** Points farther than this are not visible. Default Infinity. */
  far?: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  /** Screen units per world unit at this depth. */
  scale: number;
  /** Distance in front of the camera. */
  depth: number;
  visible: boolean;
}

/**
 * Pinhole projection for fake 3D (racing / runner games): world (x, y = height, z = forward) → screen, with
 * the horizon at `horizon` and scale = focal / depth.
 *
 *     const p = new PerspectiveProjector({ centerX: 375, horizon: 500, focal: 600, cameraHeight: 1000 });
 *     const s = p.project(-800, 0, p.cameraZ + 3000);  // left road edge 3000 units ahead
 */
export class PerspectiveProjector {
  centerX: number;
  horizon: number;
  focal: number;
  cameraHeight: number;
  near: number;
  far: number;
  cameraX = 0;
  /** Added to cameraHeight (e.g. the terrain height under the camera). */
  cameraY = 0;
  cameraZ = 0;

  constructor(opts: PerspectiveOptions) {
    this.centerX = opts.centerX;
    this.horizon = opts.horizon;
    this.focal = opts.focal;
    this.cameraHeight = opts.cameraHeight ?? 1000;
    this.near = opts.near ?? 1;
    this.far = opts.far ?? Infinity;
  }

  project(x: number, y: number, z: number, out?: ProjectedPoint): ProjectedPoint {
    const depth = z - this.cameraZ;
    const d = Math.max(depth, 1e-6);
    const scale = this.focal / d;
    const o = out ?? { x: 0, y: 0, scale: 0, depth: 0, visible: false };
    o.x = this.centerX + (x - this.cameraX) * scale;
    o.y = this.horizon + (this.cameraHeight + this.cameraY - y) * scale;
    o.scale = scale;
    o.depth = depth;
    o.visible = depth > this.near && depth < this.far;
    return o;
  }

  scaleAt(depth: number): number {
    return this.focal / Math.max(depth, 1e-6);
  }

  /** Depth of the ground plane (y = 0) seen at a screen row; Infinity at or above the horizon. */
  groundDepthAt(screenY: number): number {
    const dy = screenY - this.horizon;
    if (dy <= 0) return Infinity;
    return (this.focal * (this.cameraHeight + this.cameraY)) / dy;
  }

  /** Screen point → world point on the ground plane, or null above the horizon. */
  unprojectGround(sx: number, sy: number): { x: number; z: number } | null {
    const depth = this.groundDepthAt(sy);
    if (!Number.isFinite(depth)) return null;
    return { x: this.cameraX + ((sx - this.centerX) * depth) / this.focal, z: this.cameraZ + depth };
  }
}

/** Something drawn beside/on the road; offset is in road half-widths (0 = center, ±1 = edges, -1.6 = left verge). */
export interface RoadSprite {
  offset: number;
  /** Draw with the base at (x, y); `scale` = screen units per world unit. */
  draw: (ctx: Ctx2D, x: number, y: number, scale: number) => void;
}

/** A road sprite at an exact world z (cars, pickups). */
export interface RoadObject extends RoadSprite {
  z: number;
}

export interface RoadColors {
  grass: [Color, Color];
  rumble: [Color, Color];
  road: [Color, Color];
  lane: Color | null;
}

export interface PerspectiveRoadOptions extends NodeOptions {
  /** Half width of the road (world units). Default 1000. */
  roadWidth?: number;
  segmentLength?: number;
  /** Segments per stripe. Default 3. */
  rumbleLength?: number;
  lanes?: number;
  /** Segments drawn ahead. Default 160. */
  drawDistance?: number;
  cameraHeight?: number;
  /** Default: 0.9 × width. */
  focal?: number;
  /** Horizon y in local units. Default 0.4 × height. */
  horizon?: number;
  /** Curvature per segment index (0 = straight; ±2..6 = gentle..sharp). */
  curve?: (segment: number) => number;
  /** Ground height at world z. */
  hill?: (z: number) => number;
  colors?: Partial<RoadColors>;
  /** Haze color distant segments and sprites fade into (null = none). Match the sky's horizon color. */
  fog?: Color | null;
  /** Fraction of the draw distance where the haze starts. Default 0.3. */
  fogStart?: number;
}

const DEFAULT_COLORS: RoadColors = {
  grass: ['#4d9a3a', '#468f34'],
  rumble: ['#f1f5f9', '#dc2626'],
  road: ['#5b6170', '#575c6a'],
  lane: '#f8fafc',
};

/**
 * Segment-based pseudo-3D road (OutRun style) with curves, hills, rumble strips, lane stripes, fog and
 * roadside sprites drawn in painter's order (far → near) so hill crests hide what is behind them.
 * Advance `position` (world z of the camera) every frame; steer with `playerX` (world units).
 */
export class PerspectiveRoad extends Node {
  readonly projector: PerspectiveProjector;
  position = 0;
  playerX = 0;
  roadWidth: number;
  segmentLength: number;
  rumbleLength: number;
  lanes: number;
  drawDistance: number;
  curve: (segment: number) => number;
  hill: (z: number) => number;
  colors: RoadColors;
  fog: Color | null;
  fogStart: number;
  /** Per-segment sprites (procedural scenery); return null for none. */
  roadside: ((segment: number) => readonly RoadSprite[] | null) | null = null;
  readonly objects: RoadObject[] = [];
  segmentsDrawn = 0;
  private bx: number[] = [];
  private by: number[] = [];
  private bs: number[] = [];
  private bd: number[] = [];

  constructor(opts: PerspectiveRoadOptions = {}) {
    super();
    this.set(opts);
    this.roadWidth = opts.roadWidth ?? 1000;
    this.segmentLength = opts.segmentLength ?? 200;
    this.rumbleLength = opts.rumbleLength ?? 3;
    this.lanes = opts.lanes ?? 3;
    this.drawDistance = opts.drawDistance ?? 160;
    this.curve = opts.curve ?? (() => 0);
    this.hill = opts.hill ?? (() => 0);
    this.colors = { ...DEFAULT_COLORS, ...opts.colors };
    this.fog = opts.fog === undefined ? '#cfe3f3' : opts.fog;
    this.fogStart = opts.fogStart ?? 0.3;
    this.projector = new PerspectiveProjector({
      centerX: this.width / 2,
      horizon: opts.horizon ?? this.height * 0.4,
      focal: opts.focal ?? this.width * 0.9,
      cameraHeight: opts.cameraHeight ?? 1000,
      near: 1,
    });
  }

  override get kind(): string {
    return 'PerspectiveRoad';
  }

  /** Curvature under the camera (use it to push the car outward / scroll the sky). */
  get curvature(): number {
    return this.curve(Math.floor(this.position / this.segmentLength));
  }

  override draw(ctx: Ctx2D): void {
    const P = this.projector;
    P.centerX = this.width / 2;
    const L = this.segmentLength;
    const pos = this.position;
    const base = Math.floor(pos / L);
    const frac = (pos - base * L) / L;
    P.cameraZ = pos;
    P.cameraX = 0;
    P.cameraY = this.hill(pos);
    const n = this.drawDistance;
    const { bx, by, bs, bd } = this;
    const near = Math.max(P.near, L * 0.25);
    let xoff = 0;
    let dx = -this.curve(base) * frac;
    const tmp: ProjectedPoint = { x: 0, y: 0, scale: 0, depth: 0, visible: false };
    for (let k = 0; k <= n; k++) {
      const z = (base + k) * L;
      const depth = Math.max(z - pos, near);
      P.project(xoff - this.playerX, this.hill(z), pos + depth, tmp);
      bx[k] = tmp.x;
      by[k] = tmp.y;
      bs[k] = tmp.scale;
      bd[k] = depth;
      xoff += dx;
      dx += this.curve(base + k);
    }
    const fog = this.fog;
    ctx.fillStyle = fog ?? this.colors.grass[0];
    ctx.fillRect(0, P.horizon, this.width, this.height - P.horizon);
    const alpha = ctx.globalAlpha;
    const buckets = new Map<number, RoadObject[]>();
    for (const o of this.objects) {
      const seg = Math.floor(o.z / L) - base;
      if (seg < 0 || seg >= n) continue;
      let list = buckets.get(seg);
      if (!list) buckets.set(seg, (list = []));
      list.push(o);
    }
    this.segmentsDrawn = 0;
    for (let k = n - 1; k >= 0; k--) {
      if (bd[k + 1]! <= near) continue;
      const i = base + k;
      const y1 = by[k]!;
      const y2 = by[k + 1]!;
      const haze = fog ? this.fogAt(k / n) : 0;
      if (y2 < y1) {
        this.drawSegment(ctx, i, bx[k]!, y1, bs[k]!, bx[k + 1]!, y2, bs[k + 1]!);
        if (haze > 0) {
          ctx.globalAlpha = alpha * haze;
          ctx.fillStyle = fog!;
          ctx.fillRect(0, y2, this.width, y1 - y2 + 1);
        }
      }
      ctx.globalAlpha = alpha * (1 - haze);
      const side = this.roadside?.(i);
      if (side && bd[k]! > near) {
        for (const s of side) s.draw(ctx, bx[k]! + s.offset * this.roadWidth * bs[k]!, y1, bs[k]!);
      }
      const objs = buckets.get(k);
      if (objs) {
        objs.sort((a, b) => b.z - a.z);
        for (const o of objs) {
          const t = (o.z - i * L) / L;
          const d = bd[k]! + (bd[k + 1]! - bd[k]!) * t;
          if (d <= near) continue;
          const sc = bs[k]! + (bs[k + 1]! - bs[k]!) * t;
          const cx = bx[k]! + (bx[k + 1]! - bx[k]!) * t;
          o.draw(ctx, cx + o.offset * this.roadWidth * sc, y1 + (y2 - y1) * t, sc);
        }
      }
      ctx.globalAlpha = alpha;
    }
  }

  /** Haze amount (0..1) at a fraction of the draw distance. */
  fogAt(t: number): number {
    if (!this.fog || t <= this.fogStart) return 0;
    const f = Math.min(1, (t - this.fogStart) / (1 - this.fogStart));
    return f * (2 - f);
  }

  private drawSegment(ctx: Ctx2D, i: number, x1: number, y1: number, s1: number, x2: number, y2: number, s2: number): void {
    const c = this.colors;
    const alt = Math.floor(i / this.rumbleLength) % 2 === 0 ? 0 : 1;
    const w1 = this.roadWidth * s1;
    const w2 = this.roadWidth * s2;
    const r1 = w1 / Math.max(6, 2 * this.lanes);
    const r2 = w2 / Math.max(6, 2 * this.lanes);
    this.segmentsDrawn++;
    ctx.fillStyle = c.grass[alt];
    ctx.fillRect(0, y2, this.width, y1 - y2 + 1);
    ctx.fillStyle = c.rumble[alt];
    quad(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2);
    quad(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2);
    ctx.fillStyle = c.road[alt];
    quad(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2);
    if (c.lane && alt === 0 && this.lanes > 1) {
      const l1 = w1 / Math.max(32, 8 * this.lanes);
      const l2 = w2 / Math.max(32, 8 * this.lanes);
      const lw1 = (w1 * 2) / this.lanes;
      const lw2 = (w2 * 2) / this.lanes;
      ctx.fillStyle = c.lane;
      for (let lane = 1; lane < this.lanes; lane++) {
        const lx1 = x1 - w1 + lw1 * lane;
        const lx2 = x2 - w2 + lw2 * lane;
        quad(ctx, lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2);
      }
    }
  }

  override describe() {
    return { ...super.describe(), position: Math.round(this.position), segments: this.segmentsDrawn };
  }
}

function quad(ctx: Ctx2D, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}
