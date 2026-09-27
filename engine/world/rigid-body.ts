import type { Node } from '../scene/node';
import { rigidShapeMass, type RigidShape } from './rigid-shapes';
import type { RigidWorld } from './rigid-world';

/** dynamic: moved by forces and contacts; static: never moves; kinematic: moves by its velocity only, pushes dynamics. */
export type RigidBodyType = 'dynamic' | 'static' | 'kinematic';

export interface RigidBodyOptions {
  shape: RigidShape;
  /** Default 'dynamic'. */
  type?: RigidBodyType;
  /** Shown in dumps. */
  name?: string;
  /** Centre of mass (circle centre, polygon centroid). */
  x?: number;
  y?: number;
  /** Radians, positive = clockwise on screen (same as Node.rotation). */
  angle?: number;
  vx?: number;
  vy?: number;
  /** Angular velocity, rad/s. */
  av?: number;
  /** Mass per square unit. Default 0.001 (a 100x100 box weighs 10). */
  density?: number;
  /** Coulomb friction; a pair uses sqrt(fa * fb). Default 0.4. */
  friction?: number;
  /** Bounciness 0..1; a pair uses the max. Default 0. */
  restitution?: number;
  /** Velocity damping per second (v /= 1 + damping * dt). Default 0. */
  linearDamping?: number;
  angularDamping?: number;
  /** Multiplies world gravity. Default 1. */
  gravityScale?: number;
  /** Never rotates (infinite inertia). */
  fixedRotation?: boolean;
  /** Reports contactBegin/contactEnd overlaps but never pushes or gets pushed. */
  sensor?: boolean;
  /** Category bits of this body. Default 1. */
  category?: number;
  /** Categories it collides with; both sides must accept each other. Default all (-1). */
  mask?: number;
  /** Default true. */
  allowSleep?: boolean;
  /** Start asleep (pre-settled stacks). Default true = awake. */
  awake?: boolean;
  userData?: unknown;
}

/**
 * A rigid body with one shape. Create through `world.add({...})`. Position is the centre of mass; move bodies with
 * velocities, forces and impulses, and teleport with setPosition (plain writes to x/y skip waking and AABB updates).
 */
export class RigidBody {
  /** Assigned by the world on add, in add order (used for deterministic ordering). 0 = never added. */
  id = 0;
  name: string;
  readonly type: RigidBodyType;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  av: number;
  /** Pose at the start of the last step (interpolation). */
  prevX: number;
  prevY: number;
  prevAngle: number;
  /** Force / torque accumulated for the next step (cleared after each step). */
  fx = 0;
  fy = 0;
  torque = 0;
  mass = 0;
  invMass = 0;
  inertia = 0;
  invInertia = 0;
  density: number;
  friction: number;
  restitution: number;
  linearDamping: number;
  angularDamping: number;
  gravityScale: number;
  sensor: boolean;
  category: number;
  mask: number;
  allowSleep: boolean;
  sleeping = false;
  /** Seconds this body has been slow enough to sleep. */
  sleepTime = 0;
  userData: unknown;
  world: RigidWorld | null = null;
  /** Node synced by the world (see bindRigidNode). */
  node: Node | null = null;
  /** Body-local offset of the node (rotates with the body). */
  nodeOffsetX = 0;
  nodeOffsetY = 0;
  /** Copy the angle to node.rotation. */
  nodeRotate = true;
  /** World AABB of the shape (updated each step and on teleport). */
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;
  /** cos/sin of angle (internal, refreshed by the world). */
  c = 1;
  s = 0;
  /** Index in world.bodies during a step (internal). */
  slot = 0;
  /** How far the body can travel this substep (speculative contact reach, internal). */
  spec = 0;
  private _shape: RigidShape;
  private _fixedRotation: boolean;

  constructor(opts: RigidBodyOptions) {
    this.name = opts.name ?? '';
    this.type = opts.type ?? 'dynamic';
    this._shape = opts.shape;
    this.x = this.prevX = opts.x ?? 0;
    this.y = this.prevY = opts.y ?? 0;
    this.angle = this.prevAngle = opts.angle ?? 0;
    const moving = this.type !== 'static';
    this.vx = moving ? (opts.vx ?? 0) : 0;
    this.vy = moving ? (opts.vy ?? 0) : 0;
    this.av = moving ? (opts.av ?? 0) : 0;
    this.density = opts.density ?? 0.001;
    this.friction = opts.friction ?? 0.4;
    this.restitution = opts.restitution ?? 0;
    this.linearDamping = opts.linearDamping ?? 0;
    this.angularDamping = opts.angularDamping ?? 0;
    this.gravityScale = opts.gravityScale ?? 1;
    this._fixedRotation = opts.fixedRotation ?? false;
    this.sensor = opts.sensor ?? false;
    this.category = opts.category ?? 1;
    this.mask = opts.mask ?? -1;
    this.allowSleep = opts.allowSleep ?? true;
    this.sleeping = this.type === 'dynamic' && opts.awake === false;
    this.userData = opts.userData ?? null;
    this.resetMass();
    this.syncTransform();
  }

  get shape(): RigidShape {
    return this._shape;
  }

  get fixedRotation(): boolean {
    return this._fixedRotation;
  }

  set fixedRotation(v: boolean) {
    this._fixedRotation = v;
    if (v) this.av = 0;
    this.resetMass();
  }

  /** Not static and not sleeping. */
  get awake(): boolean {
    return this.type !== 'static' && !this.sleeping;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Replaces the shape (e.g. a growing circle), recomputes mass and wakes the body. Shapes are immutable. */
  setShape(shape: RigidShape): this {
    this._shape = shape;
    this.resetMass();
    this.syncTransform();
    this.wake();
    return this;
  }

  /** Recomputes mass and inertia from shape and density (call after changing density). */
  resetMass(): void {
    if (this.type !== 'dynamic') {
      this.mass = this.invMass = this.inertia = this.invInertia = 0;
      return;
    }
    const m = rigidShapeMass(this._shape, this.density);
    this.mass = m.mass > 0 ? m.mass : 1;
    this.invMass = 1 / this.mass;
    this.inertia = this._fixedRotation || !(m.inertia > 0) ? 0 : m.inertia;
    this.invInertia = this.inertia > 0 ? 1 / this.inertia : 0;
  }

  /** Teleports (no interpolation smear), wakes the body and whatever touched it. */
  setPosition(x: number, y: number, angle: number = this.angle): this {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.angle = this.prevAngle = angle;
    this.syncTransform();
    this.wake();
    this.world?.onTeleport(this);
    return this;
  }

  setVelocity(vx: number, vy: number, av: number = this.av): this {
    if (this.type === 'static') return this;
    this.vx = vx;
    this.vy = vy;
    this.av = this._fixedRotation ? 0 : av;
    this.wake();
    return this;
  }

  /** Force (mass·units/s²) at a world point (default: centre of mass) for the next step. */
  applyForce(fx: number, fy: number, px: number = this.x, py: number = this.y): this {
    if (this.type !== 'dynamic') return this;
    this.fx += fx;
    this.fy += fy;
    this.torque += (px - this.x) * fy - (py - this.y) * fx;
    this.wake();
    return this;
  }

  applyTorque(t: number): this {
    if (this.type !== 'dynamic') return this;
    this.torque += t;
    this.wake();
    return this;
  }

  /** Instant velocity change: impulse (mass·units/s) at a world point (default: centre of mass). */
  applyImpulse(ix: number, iy: number, px: number = this.x, py: number = this.y): this {
    if (this.type !== 'dynamic') return this;
    this.vx += ix * this.invMass;
    this.vy += iy * this.invMass;
    this.av += this.invInertia * ((px - this.x) * iy - (py - this.y) * ix);
    this.wake();
    return this;
  }

  applyAngularImpulse(i: number): this {
    if (this.type !== 'dynamic') return this;
    this.av += this.invInertia * i;
    this.wake();
    return this;
  }

  /** Wakes a sleeping dynamic body (resets its sleep timer). */
  wake(): void {
    if (this.sleeping) {
      this.sleeping = false;
      this.sleepTime = 0;
    }
  }

  /** Puts a dynamic body to sleep now (it wakes on contact, impulse or teleport). */
  sleep(): void {
    if (this.type !== 'dynamic') return;
    this.sleeping = true;
    this.vx = this.vy = this.av = 0;
  }

  /** Velocity of the body at a world point. */
  velocityAt(px: number, py: number): { x: number; y: number } {
    return { x: this.vx - this.av * (py - this.y), y: this.vy + this.av * (px - this.x) };
  }

  containsPoint(px: number, py: number): boolean {
    const dx = px - this.x;
    const dy = py - this.y;
    const sh = this._shape;
    if (sh.type === 'circle') return dx * dx + dy * dy <= sh.radius * sh.radius;
    const lx = this.c * dx + this.s * dy;
    const ly = -this.s * dx + this.c * dy;
    const v = sh.vertices;
    const n = sh.normals;
    for (let i = 0; i < sh.count; i++) {
      if (n[i * 2]! * (lx - v[i * 2]!) + n[i * 2 + 1]! * (ly - v[i * 2 + 1]!) > 0) return false;
    }
    return true;
  }

  /** Refreshes cos/sin and the AABB from x, y, angle (internal; setPosition does this). */
  syncTransform(): void {
    const c = (this.c = Math.cos(this.angle));
    const s = (this.s = Math.sin(this.angle));
    const sh = this._shape;
    if (sh.type === 'circle') {
      const r = sh.radius;
      this.minX = this.x - r;
      this.minY = this.y - r;
      this.maxX = this.x + r;
      this.maxY = this.y + r;
      return;
    }
    const v = sh.vertices;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < sh.count; i++) {
      const lx = v[i * 2]!;
      const ly = v[i * 2 + 1]!;
      const wx = c * lx - s * ly;
      const wy = s * lx + c * ly;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
    }
    this.minX = this.x + minX;
    this.minY = this.y + minY;
    this.maxX = this.x + maxX;
    this.maxY = this.y + maxY;
  }

  /** One-line summary for dumps. */
  describe(): string {
    const sh = this._shape;
    const size =
      sh.type === 'circle' ? `circle r${r1(sh.radius)}` : `${sh.box ? 'box' : `poly${sh.count}`} ${r1(sh.width)}x${r1(sh.height)}`;
    let s = `${this.name ? '#' + this.name + ' ' : ''}${size} ${this.type} @${r1(this.x)},${r1(this.y)}`;
    s += ` a=${r1((this.angle * 180) / Math.PI)}°`;
    if (this.type !== 'static') s += ` v=${r1(this.vx)},${r1(this.vy)} w=${r2(this.av)}`;
    if (this.sleeping) s += ' sleeping';
    if (this.sensor) s += ' sensor';
    if (this.category !== 1 || this.mask !== -1) s += ` cat=${this.category} mask=${this.mask}`;
    return s;
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
