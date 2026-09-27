/**
 * Circle physics for the fruit jar: position-based dynamics with substeps (stable stacking of ~60 circles with
 * 1:60 mass ratios), Coulomb friction with rolling (disc inertia), and same-level contact reporting for merges.
 * Pure and deterministic: no engine or rendering imports, iteration order is insertion order.
 *
 * Coordinates: jar-local, x right, y down; walls at x = 0 and x = width, floor at y = height, open top.
 */

export interface FruitBody {
  readonly id: number;
  level: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Current radius (grows toward targetR after a merge). */
  r: number;
  targetR: number;
  /** Radians, positive = clockwise on screen (canvas rotation). */
  angle: number;
  /** Angular velocity, rad/s. */
  av: number;
  invMass: number;
  /** Simulation time when added. */
  born: number;
  /** Has touched the floor or another fruit since it was added. */
  landed: boolean;
  /** Largest velocity change from collisions during the last step (landing / hit strength). */
  impact: number;
  removed: boolean;
  /** Previous substep position (internal). */
  px: number;
  py: number;
}

export interface FruitPhysicsOptions {
  width: number;
  height: number;
  /** Units/s². Default 2600. */
  gravity?: number;
  /** Substeps per step(). Default 8. */
  substeps?: number;
  /** Constraint passes per substep. Default 2. */
  iterations?: number;
  /** Friction coefficient (fruit-fruit and walls). Default 0.35. */
  friction?: number;
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

interface Contact {
  a: FruitBody;
  /** null = static wall / floor. */
  b: FruitBody | null;
  nx: number;
  ny: number;
  /** Position correction this substep (normal impulse proxy). */
  depth: number;
}

const massOf = (r: number): number => (r / 50) * (r / 50);

export class FruitPhysics {
  readonly width: number;
  readonly height: number;
  gravity: number;
  substeps: number;
  iterations: number;
  friction: number;
  growTime: number;
  maxSpeed: number;
  time = 0;
  readonly bodies: FruitBody[] = [];
  private nextId = 1;
  private contacts: Contact[] = [];
  private contactCount = 0;
  /** Same-level pairs that touched during the current step, in detection order. */
  private touches: FruitBody[] = [];

  constructor(opts: FruitPhysicsOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.gravity = opts.gravity ?? 2600;
    this.substeps = opts.substeps ?? 8;
    this.iterations = opts.iterations ?? 2;
    this.friction = opts.friction ?? 0.35;
    this.growTime = opts.growTime ?? 0.14;
    this.maxSpeed = opts.maxSpeed ?? 3000;
  }

  /** Adds a fruit centred at (x, y). `r` is the starting radius (defaults to the full radius). */
  add(level: number, radius: number, x: number, y: number, opts: { vx?: number; vy?: number; r?: number; angle?: number } = {}): FruitBody {
    const b: FruitBody = {
      id: this.nextId++,
      level,
      x,
      y,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      r: opts.r ?? radius,
      targetR: radius,
      angle: opts.angle ?? 0,
      av: 0,
      invMass: 1 / massOf(radius),
      born: this.time,
      landed: false,
      impact: 0,
      removed: false,
      px: x,
      py: y,
    };
    this.bodies.push(b);
    return b;
  }

  remove(b: FruitBody): void {
    if (b.removed) return;
    b.removed = true;
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  clear(): void {
    for (const b of this.bodies) b.removed = true;
    this.bodies.length = 0;
  }

  /** Advances by dt seconds (call with a fixed dt, e.g. 1/60). */
  step(dt: number): StepResult {
    const h = dt / this.substeps;
    this.touches.length = 0;
    for (const b of this.bodies) b.impact = 0;
    for (let s = 0; s < this.substeps; s++) this.substep(h);
    this.time += dt;
    return { merges: this.findMerges() };
  }

  private substep(h: number): void {
    const bodies = this.bodies;
    const g = this.gravity;
    const grow = h / Math.max(1e-6, this.growTime);
    for (const b of bodies) {
      b.vy += g * h;
      b.px = b.x;
      b.py = b.y;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.angle += b.av * h;
      if (b.r < b.targetR) b.r = Math.min(b.targetR, b.r + b.targetR * grow);
    }
    this.contactCount = 0;
    for (let it = 0; it < this.iterations; it++) this.solvePositions(it === 0);
    const maxV = this.maxSpeed;
    for (const b of bodies) {
      const ovx = b.vx;
      const ovy = b.vy;
      b.vx = (b.x - b.px) / h;
      b.vy = (b.y - b.py) / h;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > maxV) {
        b.vx *= maxV / sp;
        b.vy *= maxV / sp;
      }
      const dv = Math.hypot(b.vx - ovx, b.vy - ovy);
      if (dv > b.impact) b.impact = dv;
    }
    this.solveFriction(h);
    const damp = Math.max(0, 1 - 0.6 * h);
    const angDamp = Math.max(0, 1 - 1.5 * h);
    for (const b of bodies) {
      b.vx *= damp;
      b.vy *= damp;
      b.av *= angDamp;
    }
  }

  /**
   * One pass of position projection. The first pass records contacts for friction: it carries nearly all of the
   * substep's correction, which stands in for the normal impulse.
   */
  private solvePositions(record: boolean): void {
    const bodies = this.bodies;
    const n = bodies.length;
    const W = this.width;
    const H = this.height;
    for (let i = 0; i < n; i++) {
      const a = bodies[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) {
          if (record && a.level === b.level && d2 <= (rr + 1) * (rr + 1)) this.touches.push(a, b);
          continue;
        }
        let d = Math.sqrt(d2);
        let nx: number;
        let ny: number;
        if (d > 1e-6) {
          nx = dx / d;
          ny = dy / d;
        } else {
          nx = 0;
          ny = 1;
          d = 0;
        }
        const depth = rr - d;
        const wsum = a.invMass + b.invMass;
        const ka = a.invMass / wsum;
        const kb = b.invMass / wsum;
        a.x -= nx * depth * ka;
        a.y -= ny * depth * ka;
        b.x += nx * depth * kb;
        b.y += ny * depth * kb;
        a.landed = b.landed = true;
        if (record) {
          this.pushContact(a, b, nx, ny, depth);
          if (a.level === b.level) this.touches.push(a, b);
        }
      }
      if (a.x - a.r < 0) {
        const depth = a.r - a.x;
        a.x = a.r;
        if (record) this.pushContact(a, null, -1, 0, depth);
      } else if (a.x + a.r > W) {
        const depth = a.x + a.r - W;
        a.x = W - a.r;
        if (record) this.pushContact(a, null, 1, 0, depth);
      }
      if (a.y + a.r > H) {
        const depth = a.y + a.r - H;
        a.y = H - a.r;
        a.landed = true;
        if (record) this.pushContact(a, null, 0, 1, depth);
      }
    }
  }

  private pushContact(a: FruitBody, b: FruitBody | null, nx: number, ny: number, depth: number): void {
    let c = this.contacts[this.contactCount];
    if (!c) {
      c = { a, b, nx, ny, depth };
      this.contacts.push(c);
    } else {
      c.a = a;
      c.b = b;
      c.nx = nx;
      c.ny = ny;
      c.depth = depth;
    }
    this.contactCount++;
  }

  /**
   * Coulomb friction on the contact points of the last position pass, with disc inertia (I = m r² / 2), so sliding
   * turns into rolling. The normal impulse is estimated from the position correction.
   */
  private solveFriction(h: number): void {
    const mu = this.friction;
    for (let k = 0; k < this.contactCount; k++) {
      const c = this.contacts[k]!;
      const a = c.a;
      const b = c.b;
      const nx = c.nx;
      const ny = c.ny;
      const tx = -ny;
      const ty = nx;
      const ima = a.invMass;
      const imb = b ? b.invMass : 0;
      const ra = a.r;
      const rb = b ? b.r : 0;
      // Contact point velocities: v + w x r, with r_a = n ra and r_b = -n rb (w x r = (-w ry, w rx)).
      const vax = a.vx - a.av * ny * ra;
      const vay = a.vy + a.av * nx * ra;
      const vbx = b ? b.vx + b.av * ny * rb : 0;
      const vby = b ? b.vy - b.av * nx * rb : 0;
      const vt = (vbx - vax) * tx + (vby - vay) * ty;
      const kt = 3 * (ima + imb);
      if (kt <= 0) continue;
      let jt = -vt / kt;
      const jn = c.depth / (h * (ima + imb));
      const lim = mu * jn;
      if (jt > lim) jt = lim;
      else if (jt < -lim) jt = -lim;
      // Impulse P = jt t on b, -P on a. Angular: dw = invI * cross(r, P), invI = 2 invM / r².
      a.vx -= jt * tx * ima;
      a.vy -= jt * ty * ima;
      a.av -= (2 * ima / ra) * jt;
      if (b) {
        b.vx += jt * tx * imb;
        b.vy += jt * ty * imb;
        b.av -= (2 * imb / rb) * jt;
      }
    }
  }

  private findMerges(): MergeContact[] {
    const out: MergeContact[] = [];
    const used = new Set<FruitBody>();
    const t = this.touches;
    for (let i = 0; i < t.length; i += 2) {
      const a = t[i]!;
      const b = t[i + 1]!;
      if (a.removed || b.removed || used.has(a) || used.has(b) || a.level !== b.level) continue;
      out.push({ a, b });
      used.add(a);
      used.add(b);
    }
    return out;
  }

  /** Total kinetic energy proxy (for settling checks in tests). */
  maxSpeedNow(): number {
    let m = 0;
    for (const b of this.bodies) m = Math.max(m, Math.hypot(b.vx, b.vy));
    return m;
  }
}
