import { Emitter } from '../core/emitter';
import type { Game, System } from '../core/game';
import type { Rect } from '../core/math';
import type { Node } from '../scene/node';
import {
  aabbCircleOverlap,
  segmentVsCircle,
  segmentVsRect,
  type GridRayHit,
  type Manifold,
  type RayHit,
} from './collide';
import { SpatialHash } from './spatial';
import { TILE_ONE_WAY, TILE_SOLID, type TileMap } from './tilemap';

export type ArcadeShape = 'aabb' | 'circle';

export interface ArcadeContacts {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** A body-body contact. The normal points from `a` to `b`. */
export interface ArcadeCollision {
  a: ArcadeBody;
  b: ArcadeBody;
  nx: number;
  ny: number;
  depth: number;
}

export interface ArcadeBodyOptions {
  id?: string;
  /** Center position. */
  x?: number;
  y?: number;
  /** AABB size (default 32 × 32). Ignored when radius is set. */
  width?: number;
  height?: number;
  /** Makes the body a circle. */
  radius?: number;
  vx?: number;
  vy?: number;
  ax?: number;
  ay?: number;
  /** Multiplies world gravity (default 1). */
  gravityScale?: number;
  /** Linear damping per second on both axes (v /= 1 + drag·dt). */
  drag?: number;
  dragX?: number;
  dragY?: number;
  maxSpeed?: number;
  maxVelocityX?: number;
  maxVelocityY?: number;
  /** Restitution 0..1. */
  bounce?: number;
  mass?: number;
  /** Not pushed by other bodies and not affected by gravity (walls, moving platforms). */
  immovable?: boolean;
  /** Reports overlaps but is never separated. */
  sensor?: boolean;
  /** Category bits of this body. Default 1. */
  layer?: number;
  /** Categories it collides with. Default all (-1). */
  mask?: number;
  collideTiles?: boolean;
  collideBounds?: boolean;
  /** Node whose x/y follow the body (plus offset). */
  node?: Node;
  offsetX?: number;
  offsetY?: number;
  data?: Record<string, unknown>;
}

const noContacts = (): ArcadeContacts => ({ up: false, down: false, left: false, right: false });

/**
 * Arcade (non-rotating) rigid body: AABB or circle, centered at (x, y). Add to a PhysicsWorld, which integrates
 * velocity with gravity/acceleration/drag, resolves tiles per axis (no tunneling) and separates bodies.
 */
export class ArcadeBody {
  id: string;
  readonly shape: ArcadeShape;
  halfWidth: number;
  halfHeight: number;
  radius: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  gravityScale: number;
  dragX: number;
  dragY: number;
  maxSpeed: number;
  maxVelocityX: number;
  maxVelocityY: number;
  bounce: number;
  mass: number;
  immovable: boolean;
  sensor: boolean;
  layer: number;
  mask: number;
  collideTiles: boolean;
  collideBounds: boolean;
  /** Fall through one-way platforms while true. */
  dropThrough = false;
  enabled = true;
  node: Node | null;
  offsetX: number;
  offsetY: number;
  data: Record<string, unknown>;
  /** Contacts from the last step (tiles, bounds and bodies). */
  readonly touching: ArcadeContacts = noContacts();
  /** Tile / world-bounds contacts from the last step. */
  readonly blocked: ArcadeContacts = noContacts();
  readonly wasTouching: ArcadeContacts = noContacts();
  /** Called for each solid contact with another body (normal points from this body to `other`). */
  onCollide: ((other: ArcadeBody, c: ArcadeCollision) => void) | null = null;
  /** Called for each sensor overlap. */
  onOverlap: ((other: ArcadeBody, c: ArcadeCollision) => void) | null = null;
  world: PhysicsWorld | null = null;
  /** @internal Position in a world's `bodies` as of that world's index rebuild with this epoch. */
  indexEpoch = 0;
  /** @internal */
  indexInWorld = -1;

  constructor(opts: ArcadeBodyOptions = {}) {
    this.id = opts.id ?? '';
    this.shape = opts.radius !== undefined ? 'circle' : 'aabb';
    this.radius = opts.radius ?? 0;
    this.halfWidth = opts.radius ?? (opts.width ?? 32) / 2;
    this.halfHeight = opts.radius ?? (opts.height ?? 32) / 2;
    this.x = this.prevX = opts.x ?? 0;
    this.y = this.prevY = opts.y ?? 0;
    this.vx = opts.vx ?? 0;
    this.vy = opts.vy ?? 0;
    this.ax = opts.ax ?? 0;
    this.ay = opts.ay ?? 0;
    this.gravityScale = opts.gravityScale ?? 1;
    this.dragX = opts.dragX ?? opts.drag ?? 0;
    this.dragY = opts.dragY ?? opts.drag ?? 0;
    this.maxSpeed = opts.maxSpeed ?? Infinity;
    this.maxVelocityX = opts.maxVelocityX ?? Infinity;
    this.maxVelocityY = opts.maxVelocityY ?? Infinity;
    this.bounce = opts.bounce ?? 0;
    this.mass = opts.mass ?? 1;
    this.immovable = opts.immovable ?? false;
    this.sensor = opts.sensor ?? false;
    this.layer = opts.layer ?? 1;
    this.mask = opts.mask ?? -1;
    this.collideTiles = opts.collideTiles ?? true;
    this.collideBounds = opts.collideBounds ?? false;
    this.node = opts.node ?? null;
    this.offsetX = opts.offsetX ?? 0;
    this.offsetY = opts.offsetY ?? 0;
    this.data = opts.data ?? {};
    this.syncNode(1);
  }

  get width(): number {
    return this.halfWidth * 2;
  }

  get height(): number {
    return this.halfHeight * 2;
  }

  get left(): number {
    return this.x - this.halfWidth;
  }

  get right(): number {
    return this.x + this.halfWidth;
  }

  get top(): number {
    return this.y - this.halfHeight;
  }

  get bottom(): number {
    return this.y + this.halfHeight;
  }

  /** Standing on a tile, the world bounds or another body (last step). */
  get onGround(): boolean {
    return this.touching.down;
  }

  /** Touched down this step after being airborne. */
  get justLanded(): boolean {
    return this.touching.down && !this.wasTouching.down;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Teleports (also resets the previous position used for interpolation). */
  setPosition(x: number, y: number): this {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.syncNode(1);
    return this;
  }

  setVelocity(vx: number, vy: number): this {
    this.vx = vx;
    this.vy = vy;
    return this;
  }

  bounds(out: Rect = { x: 0, y: 0, w: 0, h: 0 }): Rect {
    out.x = this.x - this.halfWidth;
    out.y = this.y - this.halfHeight;
    out.w = this.halfWidth * 2;
    out.h = this.halfHeight * 2;
    return out;
  }

  containsPoint(px: number, py: number): boolean {
    if (this.shape === 'circle') {
      const dx = px - this.x;
      const dy = py - this.y;
      return dx * dx + dy * dy <= this.radius * this.radius;
    }
    return Math.abs(px - this.x) <= this.halfWidth && Math.abs(py - this.y) <= this.halfHeight;
  }

  /** Copies the (optionally interpolated) position to the attached node. */
  syncNode(alpha = 1): void {
    const n = this.node;
    if (!n) return;
    n.x = (alpha >= 1 ? this.x : this.prevX + (this.x - this.prevX) * alpha) + this.offsetX;
    n.y = (alpha >= 1 ? this.y : this.prevY + (this.y - this.prevY) * alpha) + this.offsetY;
  }

  /** One-line summary for dumps. */
  describe(): string {
    const size = this.shape === 'circle' ? `r${r1(this.radius)}` : `${r1(this.width)}x${r1(this.height)}`;
    const flags = (['up', 'down', 'left', 'right'] as const).filter((k) => this.touching[k]);
    let s = `${this.id ? '#' + this.id + ' ' : ''}${this.shape} ${size} @${r1(this.x)},${r1(this.y)} v=${r1(this.vx)},${r1(this.vy)}`;
    if (this.immovable) s += ' immovable';
    if (this.sensor) s += ' sensor';
    if (!this.enabled) s += ' disabled';
    if (flags.length) s += ' touching=' + flags.join('+');
    return s;
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export interface PhysicsEvents {
  collide: ArcadeCollision;
  overlap: ArcadeCollision;
  /** After each fixed step; payload: step seconds. */
  step: number;
}

export interface PhysicsWorldOptions {
  /** Number = downward gravity (units/s²). Default 0. */
  gravity?: number | { x: number; y: number };
  /** Seconds per step. Default 1/60. */
  fixedStep?: number;
  /** Max steps per update (excess time is dropped). Default 8. */
  maxSubSteps?: number;
  /** Broadphase cell size. Default 128. */
  cellSize?: number;
  /** Rect used by bodies with collideBounds. */
  bounds?: Rect | null;
  /** Interpolate node positions between steps (smoother on 90/120 Hz screens, one step of latency). Default false. */
  interpolate?: boolean;
}

export interface PhysicsRayHit extends RayHit {
  /** Distance from the ray start. */
  distance: number;
  body: ArcadeBody | null;
  map: TileMap | null;
  tx?: number;
  ty?: number;
}

export interface PhysicsRayOptions {
  /** Only bodies whose layer matches. Default all. */
  mask?: number;
  tiles?: boolean;
  bodies?: boolean;
  /** Include sensors. Default false. */
  sensors?: boolean;
  ignore?: ArcadeBody | null;
}

const EPS = 1e-6;
/** Shared by all worlds so a body's stamp names exactly one world's rebuild. */
let indexEpochs = 0;

/**
 * Fixed-timestep arcade physics system. Register it with `world.attach(game, scene)` (or game.addSystem);
 * it steps before the scene graph updates and copies body positions to their nodes.
 *
 *     const physics = new PhysicsWorld({ gravity: 1800 });
 *     physics.attach(this.game, this);       // removed when the scene is destroyed
 *     physics.addTileMap(map);
 *     const body = physics.add({ id: 'hero', x: 100, y: 100, width: 40, height: 56, node: heroNode });
 */
export class PhysicsWorld implements System {
  gravityX = 0;
  gravityY = 0;
  fixedStep: number;
  maxSubSteps: number;
  bounds: Rect | null;
  interpolate: boolean;
  paused = false;
  readonly bodies: ArcadeBody[] = [];
  readonly tilemaps: TileMap[] = [];
  readonly hash: SpatialHash<ArcadeBody>;
  /** Simulated seconds and fixed steps so far. */
  time = 0;
  steps = 0;
  /** Leftover fraction of a step (0..1), used for interpolation. */
  alpha = 0;
  private acc = 0;
  private index = new Map<ArcadeBody, number>();
  private indexDirty = true;
  private epoch = 0;
  /** Broadphase candidates of the body being resolved: cand[0..candLen), longer entries are stale. */
  private cand: ArcadeBody[] = [];
  private candLen = 0;
  private tmpRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly events = new Emitter<PhysicsEvents>();
  private stepping = false;
  /** Bodies removed during a step (e.g. from onOverlap); spliced out once the step ends. */
  private readonly pending: ArcadeBody[] = [];
  private restH = NaN;
  private restGX = NaN;
  private restGY = NaN;
  private restV = 20;

  constructor(opts: PhysicsWorldOptions = {}) {
    if (typeof opts.gravity === 'number') this.gravityY = opts.gravity;
    else if (opts.gravity) {
      this.gravityX = opts.gravity.x;
      this.gravityY = opts.gravity.y;
    }
    this.fixedStep = opts.fixedStep ?? 1 / 60;
    this.maxSubSteps = opts.maxSubSteps ?? 8;
    this.bounds = opts.bounds ?? null;
    this.interpolate = opts.interpolate ?? false;
    this.hash = new SpatialHash<ArcadeBody>(opts.cellSize ?? 128);
  }

  /** Adds a body (or creates one from options). */
  add(body: ArcadeBody | ArcadeBodyOptions): ArcadeBody {
    const b = body instanceof ArcadeBody ? body : new ArcadeBody(body);
    if (b.world === this) return b;
    b.world?.remove(b);
    b.world = this;
    const p = this.pending.indexOf(b);
    if (p >= 0) {
      this.pending.splice(p, 1);
    } else {
      this.bodies.push(b);
      this.indexDirty = true;
    }
    return b;
  }

  /** Removes a body; safe to call from collision callbacks (takes effect when the current step ends). */
  remove(body: ArcadeBody): void {
    if (body.world !== this) return;
    body.world = null;
    if (this.stepping) this.pending.push(body);
    else this.detach(body);
  }

  clear(): void {
    for (const b of this.bodies) b.world = null;
    this.bodies.length = 0;
    this.pending.length = 0;
    this.hash.clear();
    this.indexDirty = true;
  }

  private detach(body: ArcadeBody): void {
    const i = this.bodies.indexOf(body);
    if (i < 0) return;
    this.bodies.splice(i, 1);
    this.hash.remove(body);
    this.indexDirty = true;
  }

  /** Bodies with collideTiles collide with this map's solid (and one-way) tiles. */
  addTileMap(map: TileMap): void {
    if (!this.tilemaps.includes(map)) this.tilemaps.push(map);
  }

  removeTileMap(map: TileMap): void {
    const i = this.tilemaps.indexOf(map);
    if (i >= 0) this.tilemaps.splice(i, 1);
  }

  /** Registers with the game loop; when `owner` is given, unregisters once it is destroyed. Returns a remover. */
  attach(game: Game, owner?: Node): () => void {
    const off = game.addSystem(this);
    if (!owner) return off;
    const offD = owner.on('destroyed', () => off());
    return () => {
      off();
      offD();
    };
  }

  get(id: string): ArcadeBody | undefined {
    return this.bodies.find((b) => b.id === id);
  }

  /** Subscribes to 'collide' / 'overlap' / 'step'. Returns a remover. */
  on<K extends keyof PhysicsEvents>(type: K, fn: (e: PhysicsEvents[K]) => void): () => void {
    return this.events.on(type, fn);
  }

  private emit<K extends keyof PhysicsEvents>(type: K, e: PhysicsEvents[K]): void {
    this.events.emit(type, e);
  }

  /** Accumulates dt and runs whole fixed steps. */
  update(dt: number): void {
    if (this.paused) return;
    this.acc += dt;
    const h = this.fixedStep;
    let n = 0;
    while (this.acc >= h - 1e-9 && n < this.maxSubSteps) {
      this.step(h);
      this.acc -= h;
      n++;
    }
    if (this.acc >= h) this.acc = 0;
    if (this.acc < 0) this.acc = 0;
    this.alpha = this.acc / h;
    const a = this.interpolate ? this.alpha : 1;
    for (const b of this.bodies) b.syncNode(a);
  }

  /** One fixed step: integrate, move with tile collision, then separate overlapping bodies. */
  step(h: number = this.fixedStep): void {
    this.steps++;
    this.time += h;
    this.stepping = true;
    try {
      this.integrate(h);
      this.resolveBodies(h);
    } finally {
      this.stepping = false;
      for (const b of this.pending) if (b.world !== this) this.detach(b);
      this.pending.length = 0;
    }
    this.emit('step', h);
  }

  private integrate(h: number): void {
    for (const b of this.bodies) {
      if (!b.enabled) continue;
      b.prevX = b.x;
      b.prevY = b.y;
      copyContacts(b.touching, b.wasTouching);
      resetContacts(b.touching);
      resetContacts(b.blocked);
      const gs = b.immovable ? 0 : b.gravityScale;
      b.vx += (b.ax + this.gravityX * gs) * h;
      b.vy += (b.ay + this.gravityY * gs) * h;
      if (b.dragX) b.vx /= 1 + b.dragX * h;
      if (b.dragY) b.vy /= 1 + b.dragY * h;
      if (b.vx > b.maxVelocityX) b.vx = b.maxVelocityX;
      else if (b.vx < -b.maxVelocityX) b.vx = -b.maxVelocityX;
      if (b.vy > b.maxVelocityY) b.vy = b.maxVelocityY;
      else if (b.vy < -b.maxVelocityY) b.vy = -b.maxVelocityY;
      if (b.maxSpeed < Infinity) {
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > b.maxSpeed) {
          b.vx *= b.maxSpeed / sp;
          b.vy *= b.maxSpeed / sp;
        }
      }
      this.moveBody(b, b.vx * h, b.vy * h, h);
    }
  }

  /** Moves a body by (dx, dy), stopping at solid tiles (per axis) and the world bounds. */
  moveBody(b: ArcadeBody, dx: number, dy: number, h: number = this.fixedStep): void {
    if (h !== this.restH || this.gravityX !== this.restGX || this.gravityY !== this.restGY) this.updateRest(h);
    const rest = this.restV;
    if (dx !== 0) {
      let mx = dx;
      if (b.collideTiles) for (const m of this.tilemaps) mx = sweepX(b, m, mx);
      b.x += mx;
      if (mx !== dx) {
        if (dx > 0) b.blocked.right = b.touching.right = true;
        else b.blocked.left = b.touching.left = true;
        b.vx = respond(b.vx, dx, b.bounce, rest);
      }
    }
    if (dy !== 0) {
      let my = dy;
      if (b.collideTiles) for (const m of this.tilemaps) my = sweepY(b, m, my);
      b.y += my;
      if (my !== dy) {
        if (dy > 0) b.blocked.down = b.touching.down = true;
        else b.blocked.up = b.touching.up = true;
        b.vy = respond(b.vy, dy, b.bounce, rest);
      }
    }
    const B = this.bounds;
    if (b.collideBounds && B) {
      if (b.x - b.halfWidth < B.x) {
        b.x = B.x + b.halfWidth;
        b.blocked.left = b.touching.left = true;
        if (b.vx < 0) b.vx = respond(b.vx, -1, b.bounce, rest);
      } else if (b.x + b.halfWidth > B.x + B.w) {
        b.x = B.x + B.w - b.halfWidth;
        b.blocked.right = b.touching.right = true;
        if (b.vx > 0) b.vx = respond(b.vx, 1, b.bounce, rest);
      }
      if (b.y - b.halfHeight < B.y) {
        b.y = B.y + b.halfHeight;
        b.blocked.up = b.touching.up = true;
        if (b.vy < 0) b.vy = respond(b.vy, -1, b.bounce, rest);
      } else if (b.y + b.halfHeight > B.y + B.h) {
        b.y = B.y + B.h - b.halfHeight;
        b.blocked.down = b.touching.down = true;
        if (b.vy > 0) b.vy = respond(b.vy, 1, b.bounce, rest);
      }
    }
  }

  /** Speeds below `restV` stop instead of bouncing: two steps of gravity, at least 20 (cached per gravity and h). */
  private updateRest(h: number): void {
    this.restH = h;
    this.restGX = this.gravityX;
    this.restGY = this.gravityY;
    this.restV = Math.max(20, Math.hypot(this.gravityX, this.gravityY) * h * 2);
  }

  private rebuildIndex(): void {
    if (!this.indexDirty) return;
    this.indexDirty = false;
    this.index.clear();
    const epoch = (this.epoch = ++indexEpochs);
    this.bodies.forEach((b, i) => {
      this.index.set(b, i);
      b.indexEpoch = epoch;
      b.indexInWorld = i;
    });
  }

  /** Index of a body as of the last rebuild; the map answers when another world has restamped the body since. */
  private indexOf(b: ArcadeBody): number | undefined {
    return b.indexEpoch === this.epoch ? b.indexInWorld : this.index.get(b);
  }

  private resolveBodies(h: number): void {
    this.rebuildIndex();
    const bodies = this.bodies;
    const hash = this.hash;
    const events = this.events;
    hash.clear();
    for (const b of bodies) if (b.enabled) hash.insert(b, b.bounds(this.tmpRect));
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      if (!a.enabled || a.world !== this || this.indexOf(a) !== i) continue;
      const cand = this.cand;
      this.candLen = hash.queryInto(a.bounds(this.tmpRect), cand);
      // candLen is re-read like an array length: a step() nested in a callback refills cand and candLen.
      for (let k = 0; k < this.candLen; k++) {
        const b = cand[k]!;
        if (a.world !== this) break;
        const j = this.indexOf(b);
        if (j === undefined || j <= i || b.world !== this) continue;
        if ((a.layer & b.mask) === 0 || (b.layer & a.mask) === 0) continue;
        const sensor = a.sensor || b.sensor;
        if (!sensor && a.immovable && b.immovable) continue;
        if (!manifold(a, b)) continue;
        const nx = scratch.nx;
        const ny = scratch.ny;
        const depth = scratch.depth;
        // Payloads only for someone who receives them; `c` is shared by a's callback and the world event.
        let c: ArcadeCollision | null = null;
        if (sensor) {
          a.onOverlap?.(b, (c = collision(a, b, nx, ny, depth)));
          b.onOverlap?.(a, collision(b, a, -nx, -ny, depth));
          if (events.hasListeners('overlap')) this.emit('overlap', c ?? collision(a, b, nx, ny, depth));
          continue;
        }
        const invA = a.immovable ? 0 : 1 / a.mass;
        const invB = b.immovable ? 0 : 1 / b.mass;
        const total = invA + invB;
        const pa = (depth * invA) / total;
        const pb = (depth * invB) / total;
        if (pa) this.moveBody(a, -nx * pa, -ny * pa, h);
        if (pb) this.moveBody(b, nx * pb, ny * pb, h);
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const e = Math.max(a.bounce, b.bounce);
          const j = (-(1 + e) * rv) / total;
          a.vx -= j * invA * nx;
          a.vy -= j * invA * ny;
          b.vx += j * invB * nx;
          b.vy += j * invB * ny;
        }
        if (ny > 0.5) {
          a.touching.down = true;
          b.touching.up = true;
        } else if (ny < -0.5) {
          a.touching.up = true;
          b.touching.down = true;
        }
        if (nx > 0.5) {
          a.touching.right = true;
          b.touching.left = true;
        } else if (nx < -0.5) {
          a.touching.left = true;
          b.touching.right = true;
        }
        a.onCollide?.(b, (c = collision(a, b, nx, ny, depth)));
        b.onCollide?.(a, collision(b, a, -nx, -ny, depth));
        if (events.hasListeners('collide')) this.emit('collide', c ?? collision(a, b, nx, ny, depth));
      }
    }
  }

  // ---------------------------------------------------------------- queries

  /** Bodies containing a point (mask filters by body layer). Queries append to `out` when given. */
  queryPoint(x: number, y: number, mask = -1, out: ArcadeBody[] = []): ArcadeBody[] {
    for (const b of this.bodies) if (this.live(b, mask) && b.containsPoint(x, y)) out.push(b);
    return out;
  }

  /** Bodies overlapping a rect. */
  queryRect(r: Rect, mask = -1, out: ArcadeBody[] = []): ArcadeBody[] {
    const hw = r.w / 2;
    const hh = r.h / 2;
    const cx = r.x + hw;
    const cy = r.y + hh;
    for (const b of this.bodies) {
      if (!this.live(b, mask)) continue;
      const hit =
        b.shape === 'circle'
          ? aabbCircleOverlap(cx, cy, hw, hh, b.x, b.y, b.radius, scratch) !== null
          : Math.abs(b.x - cx) <= b.halfWidth + hw && Math.abs(b.y - cy) <= b.halfHeight + hh;
      if (hit) out.push(b);
    }
    return out;
  }

  /** Bodies overlapping a circle. */
  queryCircle(x: number, y: number, r: number, mask = -1, out: ArcadeBody[] = []): ArcadeBody[] {
    for (const b of this.bodies) {
      if (!this.live(b, mask)) continue;
      let hit: boolean;
      if (b.shape === 'circle') {
        const dx = b.x - x;
        const dy = b.y - y;
        const rr = b.radius + r;
        hit = dx * dx + dy * dy <= rr * rr;
      } else {
        const qx = Math.max(b.left, Math.min(x, b.right));
        const qy = Math.max(b.top, Math.min(y, b.bottom));
        hit = (qx - x) * (qx - x) + (qy - y) * (qy - y) <= r * r;
      }
      if (hit) out.push(b);
    }
    return out;
  }

  /** Closest hit along a segment among solid tiles and bodies. */
  raycast(x0: number, y0: number, x1: number, y1: number, opts: PhysicsRayOptions = {}): PhysicsRayHit | null {
    const len = Math.hypot(x1 - x0, y1 - y0);
    let found = false;
    let bestT = 0;
    let tileHit: GridRayHit | null = null;
    let tileMap: TileMap | null = null;
    let body: ArcadeBody | null = null;
    let bx = 0;
    let by = 0;
    let bnx = 0;
    let bny = 0;
    if (opts.tiles !== false) {
      for (const m of this.tilemaps) {
        const h = m.raycast(x0, y0, x1, y1);
        if (h && (!found || h.t < bestT)) {
          found = true;
          bestT = h.t;
          tileHit = h;
          tileMap = m;
        }
      }
    }
    if (opts.bodies !== false) {
      const mask = opts.mask ?? -1;
      for (const b of this.bodies) {
        if (!this.live(b, mask) || b === opts.ignore || (b.sensor && !opts.sensors)) continue;
        const h =
          b.shape === 'circle'
            ? segmentVsCircle(x0, y0, x1, y1, b.x, b.y, b.radius, rayScratch)
            : segmentVsRect(x0, y0, x1, y1, b.bounds(this.tmpRect), rayScratch);
        if (h && (!found || h.t < bestT)) {
          found = true;
          bestT = h.t;
          body = b;
          bx = h.x;
          by = h.y;
          bnx = h.nx;
          bny = h.ny;
        }
      }
    }
    if (body) return { t: bestT, x: bx, y: by, nx: bnx, ny: bny, distance: bestT * len, body, map: null };
    if (tileHit) return { ...tileHit, distance: tileHit.t * len, body: null, map: tileMap };
    return null;
  }

  private live(b: ArcadeBody, mask: number): boolean {
    return b.enabled && b.world === this && (b.layer & mask) !== 0;
  }

  /** Text summary of all bodies (for tests and debugging). */
  dump(): string {
    const lines = [
      `PhysicsWorld steps=${this.steps} bodies=${this.bodies.length} gravity=${this.gravityX},${this.gravityY} tilemaps=${this.tilemaps.length}`,
    ];
    for (const b of this.bodies) lines.push('  ' + b.describe());
    return lines.join('\n');
  }
}

function copyContacts(from: ArcadeContacts, to: ArcadeContacts): void {
  to.up = from.up;
  to.down = from.down;
  to.left = from.left;
  to.right = from.right;
}

function resetContacts(c: ArcadeContacts): void {
  c.up = c.down = c.left = c.right = false;
}

/** Velocity after hitting a wall while moving in direction `dir`. */
function respond(v: number, dir: number, bounce: number, rest: number): number {
  if (Math.sign(v) !== Math.sign(dir) || v === 0) return v;
  return bounce > 0 && Math.abs(v) > rest ? -v * bounce : 0;
}

/** Scratch results (the step and queries copy what they need before any user callback runs). */
const scratch: Manifold = { nx: 0, ny: 0, depth: 0 };
const rayScratch: RayHit = { t: 0, x: 0, y: 0, nx: 0, ny: 0 };

/**
 * Overlap of two bodies into `scratch` (normal from a to b); false when apart. Same expressions as aabbOverlap,
 * circleOverlap and aabbCircleOverlap, but taking bodies: passing a dozen doubles to calls the optimizer does not
 * inline boxes each of them.
 */
function manifold(a: ArcadeBody, b: ArcadeBody): boolean {
  if (a.shape === 'aabb' && b.shape === 'aabb') return boxBox(a, b);
  if (a.shape === 'circle' && b.shape === 'circle') return circleCircle(a, b);
  if (a.shape === 'aabb') return boxCircle(a, b);
  if (!boxCircle(b, a)) return false;
  scratch.nx = -scratch.nx;
  scratch.ny = -scratch.ny;
  return true;
}

function setScratch(nx: number, ny: number, depth: number): true {
  scratch.nx = nx;
  scratch.ny = ny;
  scratch.depth = depth;
  return true;
}

function boxBox(a: ArcadeBody, b: ArcadeBody): boolean {
  const dx = b.x - a.x;
  const px = a.halfWidth + b.halfWidth - Math.abs(dx);
  if (px <= 0) return false;
  const dy = b.y - a.y;
  const py = a.halfHeight + b.halfHeight - Math.abs(dy);
  if (py <= 0) return false;
  if (px < py) return setScratch(dx < 0 ? -1 : 1, 0, px);
  return setScratch(0, dy < 0 ? -1 : 1, py);
}

function circleCircle(a: ArcadeBody, b: ArcadeBody): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rr = a.radius + b.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return false;
  const d = Math.sqrt(d2);
  if (d === 0) return setScratch(0, 1, rr);
  return setScratch(dx / d, dy / d, rr - d);
}

function boxCircle(box: ArcadeBody, c: ArcadeBody): boolean {
  const hw = box.halfWidth;
  const hh = box.halfHeight;
  const r = c.radius;
  const dx = c.x - box.x;
  const dy = c.y - box.y;
  const qx = Math.max(-hw, Math.min(hw, dx));
  const qy = Math.max(-hh, Math.min(hh, dy));
  if (qx === dx && qy === dy) {
    const px = hw - Math.abs(dx);
    const py = hh - Math.abs(dy);
    if (px < py) return setScratch(dx < 0 ? -1 : 1, 0, px + r);
    return setScratch(0, dy < 0 ? -1 : 1, py + r);
  }
  const ex = dx - qx;
  const ey = dy - qy;
  const d2 = ex * ex + ey * ey;
  if (d2 >= r * r) return false;
  const d = Math.sqrt(d2);
  return setScratch(ex / d, ey / d, r - d);
}

function collision(a: ArcadeBody, b: ArcadeBody, nx: number, ny: number, depth: number): ArcadeCollision {
  return { a, b, nx, ny, depth };
}

let spanLo = 0;
let spanHi = 0;

/** Rows (or columns) a span [lo, hi) overlaps, clamped for iteration, into spanLo..spanHi. */
function span(lo: number, hi: number, size: number, count: number, outsideSolid: boolean): void {
  let a = Math.floor((lo + EPS) / size);
  let b = Math.ceil((hi - EPS) / size) - 1;
  if (outsideSolid) {
    a = Math.max(a, -1);
    b = Math.min(b, count);
  } else {
    a = Math.max(a, 0);
    b = Math.min(b, count - 1);
  }
  spanLo = a;
  spanHi = b;
}

/** Allowed x movement of a body's AABB against a tile map (exact sweep over crossed columns). */
function sweepX(b: ArcadeBody, m: TileMap, dx: number): number {
  const tw = m.tileWidth;
  const th = m.tileHeight;
  const solidOut = m.solidOutside;
  span(b.y - b.halfHeight - m.y, b.y + b.halfHeight - m.y, th, m.rows, solidOut);
  const r0 = spanLo;
  const r1 = spanHi;
  if (r0 > r1) return dx;
  if (dx > 0) {
    const edge = b.x + b.halfWidth - m.x;
    let c0 = Math.ceil((edge - EPS) / tw);
    let c1 = Math.ceil((edge + dx - EPS) / tw) - 1;
    if (solidOut) c1 = Math.min(c1, Math.max(c0, m.cols));
    else {
      c0 = Math.max(c0, 0);
      c1 = Math.min(c1, m.cols - 1);
    }
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) if (m.tileFlags(c, r) & TILE_SOLID) return Math.max(0, c * tw - edge);
    }
  } else if (dx < 0) {
    const edge = b.x - b.halfWidth - m.x;
    let c0 = Math.floor((edge + EPS) / tw) - 1;
    let c1 = Math.floor((edge + dx + EPS) / tw);
    if (solidOut) c1 = Math.max(c1, Math.min(c0, -1));
    else {
      c0 = Math.min(c0, m.cols - 1);
      c1 = Math.max(c1, 0);
    }
    for (let c = c0; c >= c1; c--) {
      for (let r = r0; r <= r1; r++) if (m.tileFlags(c, r) & TILE_SOLID) return Math.min(0, (c + 1) * tw - edge);
    }
  }
  return dx;
}

/** Allowed y movement against a tile map; one-way tiles block downward movement only. */
function sweepY(b: ArcadeBody, m: TileMap, dy: number): number {
  const tw = m.tileWidth;
  const th = m.tileHeight;
  const solidOut = m.solidOutside;
  span(b.x - b.halfWidth - m.x, b.x + b.halfWidth - m.x, tw, m.cols, solidOut);
  const c0 = spanLo;
  const c1 = spanHi;
  if (c0 > c1) return dy;
  if (dy > 0) {
    const edge = b.y + b.halfHeight - m.y;
    let r0 = Math.ceil((edge - EPS) / th);
    let r1 = Math.ceil((edge + dy - EPS) / th) - 1;
    if (solidOut) r1 = Math.min(r1, Math.max(r0, m.rows));
    else {
      r0 = Math.max(r0, 0);
      r1 = Math.min(r1, m.rows - 1);
    }
    const block = b.dropThrough ? TILE_SOLID : TILE_SOLID | TILE_ONE_WAY;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) if (m.tileFlags(c, r) & block) return Math.max(0, r * th - edge);
    }
  } else if (dy < 0) {
    const edge = b.y - b.halfHeight - m.y;
    let r0 = Math.floor((edge + EPS) / th) - 1;
    let r1 = Math.floor((edge + dy + EPS) / th);
    if (solidOut) r1 = Math.max(r1, Math.min(r0, -1));
    else {
      r0 = Math.min(r0, m.rows - 1);
      r1 = Math.max(r1, 0);
    }
    for (let r = r0; r >= r1; r--) {
      for (let c = c0; c <= c1; c++) if (m.tileFlags(c, r) & TILE_SOLID) return Math.min(0, (r + 1) * th - edge);
    }
  }
  return dy;
}
