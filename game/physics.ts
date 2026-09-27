import { rigidBox, rigidCircle, RigidWorld, type RigidBody } from '@engine';

/**
 * Fruit jar physics: a thin adapter over the engine's RigidWorld (circles in a static jar). It keeps the rules-facing
 * API: FruitBody with x/y/angle/r/level/landed/impact, same-level touching pairs for merges (the engine records every
 * pair that touched during the step, within a 1-unit contact margin, so brief and exact touches count), and merged
 * fruits that grow to full size. Rolling and rotation come from the engine. Pure and deterministic.
 *
 * Coordinates: jar-local, x right, y down; walls at x = 0 and x = width, floor at y = height, open top.
 */

/** A fruit in the jar; pose and velocity are read from its rigid body. */
export class FruitBody {
  readonly id: number;
  level: number;
  /** Current radius (grows toward targetR after a merge). */
  r: number;
  targetR: number;
  /** Simulation time when added. */
  born: number;
  /** Has touched the floor or another fruit since it was added. */
  landed = false;
  /** Velocity change from collisions during the last step (landing / hit strength). */
  impact = 0;
  removed = false;
  readonly body: RigidBody;

  constructor(id: number, level: number, r: number, targetR: number, born: number, body: RigidBody) {
    this.id = id;
    this.level = level;
    this.r = r;
    this.targetR = targetR;
    this.born = born;
    this.body = body;
  }

  get x(): number {
    return this.body.x;
  }

  get y(): number {
    return this.body.y;
  }

  get vx(): number {
    return this.body.vx;
  }

  get vy(): number {
    return this.body.vy;
  }

  /** Radians, positive = clockwise on screen (canvas rotation). */
  get angle(): number {
    return this.body.angle;
  }

  /** Angular velocity, rad/s. */
  get av(): number {
    return this.body.av;
  }
}

export interface FruitPhysicsOptions {
  width: number;
  height: number;
  /** Units/s². Default 2600. */
  gravity?: number;
  /** RigidWorld substeps per step(). Default 2. */
  substeps?: number;
  /** Velocity iterations per substep. Default 8. */
  iterations?: number;
  /** Friction coefficient (fruit-fruit and walls). Default 0.35. */
  friction?: number;
  /** Bounciness. Default 0.05. */
  restitution?: number;
  /** Seconds for a merged fruit to grow to full size. Default 0.14. */
  growTime?: number;
  /** Speed cap in units/s. Default 3000. */
  maxSpeed?: number;
}

export interface MergeContact {
  a: FruitBody;
  b: FruitBody;
}

export interface StepResult {
  /** Touching same-level pairs (each body appears at most once), in detection order. */
  merges: MergeContact[];
}

const WALL = 400;
const LINEAR_DAMPING = 0.4;
const ANGULAR_DAMPING = 1.2;

export class FruitPhysics {
  readonly width: number;
  readonly height: number;
  readonly world: RigidWorld;
  friction: number;
  restitution: number;
  growTime: number;
  time = 0;
  readonly bodies: FruitBody[] = [];
  private nextId = 1;
  private readonly floor: RigidBody;

  constructor(opts: FruitPhysicsOptions) {
    const W = (this.width = opts.width);
    const H = (this.height = opts.height);
    this.friction = opts.friction ?? 0.35;
    this.restitution = opts.restitution ?? 0.05;
    this.growTime = opts.growTime ?? 0.14;
    this.world = new RigidWorld({
      gravity: opts.gravity ?? 2600,
      substeps: opts.substeps ?? 2,
      velocityIterations: opts.iterations ?? 8,
      // Strong, velocity-free position correction pushes neighbours out of a freshly merged fruit within a few frames.
      positionIterations: 8,
      slop: 0.2,
      contactMargin: 1,
      baumgarte: 0.4,
      maxCorrection: 12,
      restitutionThreshold: 120,
      sleepLinear: 6,
      sleepAngular: 0.15,
      timeToSleep: 0.4,
      maxSpeed: opts.maxSpeed ?? 3000,
    });
    const wallH = H + 3000 + WALL;
    const wallY = H + WALL - wallH / 2;
    const f = this.friction;
    this.world.add({ type: 'static', name: 'wall-left', shape: rigidBox(WALL, wallH), x: -WALL / 2, y: wallY, friction: f });
    this.world.add({ type: 'static', name: 'wall-right', shape: rigidBox(WALL, wallH), x: W + WALL / 2, y: wallY, friction: f });
    this.floor = this.world.add({ type: 'static', name: 'floor', shape: rigidBox(W + WALL * 2, WALL), x: W / 2, y: H + WALL / 2, friction: f });
  }

  /** Adds a fruit centred at (x, y). `r` is the starting radius (defaults to the full radius). */
  add(level: number, radius: number, x: number, y: number, opts: { vx?: number; vy?: number; r?: number; angle?: number } = {}): FruitBody {
    const r = opts.r ?? radius;
    const body = this.world.add({
      shape: rigidCircle(r),
      x,
      y,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      angle: opts.angle ?? 0,
      friction: this.friction,
      restitution: this.restitution,
      linearDamping: LINEAR_DAMPING,
      angularDamping: ANGULAR_DAMPING,
    });
    const b = new FruitBody(this.nextId++, level, r, radius, this.time, body);
    body.userData = b;
    this.bodies.push(b);
    return b;
  }

  remove(b: FruitBody): void {
    if (b.removed) return;
    b.removed = true;
    this.world.remove(b.body);
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  clear(): void {
    for (const b of this.bodies.slice()) this.remove(b);
  }

  /** Advances by dt seconds (call with a fixed dt, e.g. 1/60). */
  step(dt: number): StepResult {
    const bodies = this.bodies;
    const grow = dt / Math.max(1e-6, this.growTime);
    const g = this.world.gravityY;
    const pre: number[] = [];
    for (const b of bodies) {
      if (b.r < b.targetR) {
        b.r = Math.min(b.targetR, b.r + b.targetR * grow);
        b.body.setShape(rigidCircle(b.r));
      }
      const body = b.body;
      pre.push(body.sleeping ? NaN : body.vx, body.vy);
    }
    this.world.step(dt);
    this.time += dt;
    const damp = 1 / (1 + dt * LINEAR_DAMPING);
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      const body = b.body;
      const pvx = pre[i * 2]!;
      b.impact = Number.isNaN(pvx) ? 0 : Math.hypot(body.vx - pvx * damp, body.vy - (pre[i * 2 + 1]! + g * dt) * damp);
    }
    const merges: MergeContact[] = [];
    const used = new Set<FruitBody>();
    for (const c of this.world.touches) {
      if (c.sensor) continue;
      const fa = c.a.userData;
      const fb = c.b.userData;
      const a = fa instanceof FruitBody ? fa : null;
      const b = fb instanceof FruitBody ? fb : null;
      if (a && (b || c.b === this.floor)) a.landed = true;
      if (b && (a || c.a === this.floor)) b.landed = true;
      if (!a || !b || a.level !== b.level || a.removed || b.removed || used.has(a) || used.has(b)) continue;
      merges.push({ a, b });
      used.add(a);
      used.add(b);
    }
    return { merges };
  }

  /** Fastest fruit speed (for settling checks in tests). */
  maxSpeedNow(): number {
    let m = 0;
    for (const b of this.bodies) m = Math.max(m, b.body.speed);
    return m;
  }
}
