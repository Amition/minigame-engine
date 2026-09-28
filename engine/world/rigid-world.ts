import { Emitter } from '../core/emitter';
import type { Game, System } from '../core/game';
import type { Rect } from '../core/math';
import type { Node } from '../scene/node';
import { RigidBody, type RigidBodyOptions } from './rigid-body';
import {
  collideRigid,
  newRigidManifold,
  rigidRaycastBody,
  rigidWorldManifold,
  RIGID_CIRCLES,
  RIGID_FACE_A,
  type RigidRayScratch,
  type RigidWorldPoint,
} from './rigid-collide';
import {
  createRigidJoint,
  type RigidDistanceJoint,
  type RigidDistanceJointOptions,
  type RigidJoint,
  type RigidJointOptions,
  type RigidJointSolverSettings,
  type RigidMouseJoint,
  type RigidMouseJointOptions,
  type RigidRevoluteJoint,
  type RigidRevoluteJointOptions,
  type RigidWeldJoint,
  type RigidWeldJointOptions,
} from './rigid-joint';

/** One point of a contact manifold. Solver fields are internal. */
export class RigidContactPoint {
  /** World position at the last narrowphase (midway between the surfaces). */
  x = 0;
  y = 0;
  /** Distance between the surfaces along the normal; negative = penetration. */
  separation = 0;
  /** Accumulated impulses of the last solve (reused for warm starting). */
  normalImpulse = 0;
  tangentImpulse = 0;
  lx = 0;
  ly = 0;
  id = 0;
  maxNormalImpulse = 0;
  rAx = 0;
  rAy = 0;
  rBx = 0;
  rBy = 0;
  normalMass = 0;
  tangentMass = 0;
  bias = 0;
  relVel = 0;
  /** Approach speed of a speculative hit, bounced off once the surfaces meet (next substep). */
  approach = 0;
}

/**
 * A pair of bodies whose AABBs overlap (within the contact margin plus how far they can move this substep).
 * `touching` means the shapes are closer than the margin, or were about to collide during the substep; points
 * farther away are speculative (they only stop the bodies from closing the gap too fast). The normal points from
 * `a` to `b`.
 */
export class RigidContact {
  readonly a: RigidBody;
  readonly b: RigidBody;
  /** Either body is a sensor: overlap is reported, nothing is pushed. */
  readonly sensor: boolean;
  touching = false;
  nx = 0;
  ny = 0;
  /** Valid points (0..2), including speculative ones. */
  count = 0;
  readonly points: readonly [RigidContactPoint, RigidContactPoint] = [new RigidContactPoint(), new RigidContactPoint()];
  friction = 0;
  restitution = 0;
  /** Relative normal speed when the touch began (>= 0). */
  approachSpeed = 0;
  stamp = 0;
  touchStamp = 0;
  mtype = RIGID_CIRCLES;
  lnx = 0;
  lny = 0;
  lpx = 0;
  lpy = 0;
  solveCount = 0;
  k11 = 0;
  k12 = 0;
  k22 = 0;
  nm11 = 0;
  nm12 = 0;
  nm22 = 0;

  constructor(a: RigidBody, b: RigidBody) {
    this.a = a;
    this.b = b;
    this.sensor = a.sensor || b.sensor;
  }

  /** The body on the other side. */
  other(body: RigidBody): RigidBody {
    return body === this.a ? this.b : this.a;
  }

  /** Total normal impulse of the last solve. */
  get impulse(): number {
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.points[i]!.normalImpulse;
    return s;
  }

  /** Average contact point (last known). */
  get x(): number {
    return this.count === 2 ? (this.points[0].x + this.points[1].x) / 2 : this.points[0].x;
  }

  get y(): number {
    return this.count === 2 ? (this.points[0].y + this.points[1].y) / 2 : this.points[0].y;
  }
}

/** Payload of contactBegin / contactEnd (a snapshot; `contact` is the live object). */
export interface RigidContactEvent {
  a: RigidBody;
  b: RigidBody;
  contact: RigidContact;
  sensor: boolean;
  /** Normal from a to b. */
  nx: number;
  ny: number;
  /** Contact point. */
  x: number;
  y: number;
  /** Relative normal speed at first touch (0 for contactEnd). */
  approachSpeed: number;
  /** Normal impulse applied by the solver in the (sub)step the touch began (0 for sensors and contactEnd). */
  impulse: number;
}

export interface RigidWorldEvents {
  contactBegin: RigidContactEvent;
  contactEnd: RigidContactEvent;
  /** A joint's reaction exceeded its breakForce / breakTorque; it has already left the world (`broken` is true). */
  jointBreak: RigidJoint;
  /** After each step, once contact events and deferred adds/removes are done. Payload: step seconds. */
  step: number;
}

export interface RigidWorldOptions {
  /** Number = downward gravity (units/s²). Default 1600. */
  gravity?: number | { x: number; y: number };
  /** Fixed steps per second used by update(). Default 60. */
  hz?: number;
  /** Max fixed steps per update() call (excess time is dropped). Default 5. */
  maxSteps?: number;
  /** Collide + solve passes per step (more = stiffer, costs linearly). Default 1. */
  substeps?: number;
  /** Default 8. */
  velocityIterations?: number;
  /** Default 3. */
  positionIterations?: number;
  /** Allowed penetration in units (keeps contacts alive, avoids jitter). Default 0.25. */
  slop?: number;
  /** Shapes closer than this count as touching (events, touches list) and get speculative contacts. Default 1. */
  contactMargin?: number;
  /** Fraction of the penetration fixed per position iteration. Default 0.2. */
  baumgarte?: number;
  /** Max position correction per iteration in units. Default 8. */
  maxCorrection?: number;
  /** Approach speeds below this do not bounce (units/s). Default 50. */
  restitutionThreshold?: number;
  /** Bodies slower than these for timeToSleep seconds (whole touching island) sleep. Default 4 units/s. */
  sleepLinear?: number;
  /** Default 0.1 rad/s. */
  sleepAngular?: number;
  /** Default 0.5 s. */
  timeToSleep?: number;
  /** Default true. */
  allowSleep?: boolean;
  /** Speed cap (units/s). Default 10000. */
  maxSpeed?: number;
  /** Interpolate bound nodes between steps in update() (smoother, one step of latency). Default false. */
  interpolate?: boolean;
  /** Reuse last step's impulses (much better stacking). Default true. */
  warmStarting?: boolean;
}

export interface RigidQueryOptions {
  /** Only bodies whose category matches. Default all. */
  mask?: number;
  /** Include sensor bodies. Default false. */
  sensors?: boolean;
  ignore?: RigidBody | null;
}

export interface RigidRayHit {
  body: RigidBody;
  x: number;
  y: number;
  /** Surface normal at the hit. */
  nx: number;
  ny: number;
  /** 0..1 along the segment. */
  fraction: number;
  distance: number;
}

/** Awake dynamic body or moving kinematic body: its contacts need updating. */
function isActive(b: RigidBody): boolean {
  if (b.type === 'dynamic') return !b.sleeping;
  return b.type === 'kinematic' && (b.vx !== 0 || b.vy !== 0 || b.av !== 0);
}

type QueuedEvent = ['contactBegin' | 'contactEnd', RigidContactEvent] | ['jointBreak', RigidJoint];

/** A joint that must not let its two bodies collide links them (checked on AABB-overlapping pairs only). */
function jointBlocksPair(a: RigidBody, b: RigidBody): boolean {
  const list = a.joints.length <= b.joints.length ? a.joints : b.joints;
  for (let i = 0; i < list.length; i++) {
    const j = list[i]!;
    if (!j.collideConnected && !j.broken && ((j.a === a && j.b === b) || (j.a === b && j.b === a))) return true;
  }
  return false;
}

/** The contact between a and b, if any (scans the shorter contact edge list). */
function findContact(a: RigidBody, b: RigidBody): RigidContact | null {
  const edges = a.contactEdges.length <= b.contactEdges.length ? a.contactEdges : b.contactEdges;
  const other = edges === a.contactEdges ? b : a;
  for (let i = 0; i < edges.length; i++) {
    const c = edges[i]!;
    if (c.a === other || c.b === other) return c;
  }
  return null;
}

/** Swap-removes a contact from one body's edge list. */
function removeEdge(body: RigidBody, c: RigidContact): void {
  const edges = body.contactEdges;
  const i = edges.lastIndexOf(c);
  if (i < 0) return;
  edges[i] = edges[edges.length - 1]!;
  edges.pop();
}

/** Insertion sort on the sweep-axis AABB min with id tie-breaks (nearly sorted from the previous substep). */
function sortSweep(list: RigidBody[], y: boolean): void {
  for (let i = 1; i < list.length; i++) {
    const b = list[i]!;
    const key = y ? b.minY : b.minX;
    let j = i - 1;
    while (j >= 0) {
      const o = list[j]!;
      const k = y ? o.minY : o.minX;
      if (!(k > key || (k === key && o.id > b.id))) break;
      list[j + 1] = o;
      j--;
    }
    list[j + 1] = b;
  }
}

function byMinX(a: RigidBody, b: RigidBody): number {
  return a.minX < b.minX ? -1 : a.minX > b.minX ? 1 : a.id - b.id;
}

function byMinY(a: RigidBody, b: RigidBody): number {
  return a.minY < b.minY ? -1 : a.minY > b.minY ? 1 : a.id - b.id;
}

/**
 * Rigid-body physics with rotation: circles and convex polygons, sequential impulses with warm starting and a
 * 2-point block solver, non-linear position correction with slop, speculative contacts within `contactMargin`,
 * island sleeping, category/mask/group filtering, sensors, contact events, queries and joints (distance, revolute,
 * weld, mouse; see addJoint). Deterministic: no randomness, iteration order is insertion order (sort-and-sweep
 * broadphase with id tie-breaks).
 *
 *     const world = new RigidWorld({ gravity: 1600 });
 *     world.add({ type: 'static', shape: rigidBox(750, 40), x: 375, y: 1200 });
 *     const crate = world.add({ shape: rigidBox(60, 60), x: 375, y: 300, friction: 0.6 });
 *     world.attach(this.game, this);           // steps at 60 Hz from the game loop, syncs bound nodes
 *     bindRigidNode(crateNode, crate);
 *
 * No continuous collision: keep speed * step below about half the thinnest body (use substeps or thicker walls).
 */
export class RigidWorld implements System {
  gravityX = 0;
  gravityY: number;
  fixedStep: number;
  maxSteps: number;
  substeps: number;
  velocityIterations: number;
  positionIterations: number;
  slop: number;
  contactMargin: number;
  baumgarte: number;
  maxCorrection: number;
  restitutionThreshold: number;
  sleepLinear: number;
  sleepAngular: number;
  timeToSleep: number;
  allowSleep: boolean;
  maxSpeed: number;
  interpolate: boolean;
  warmStarting: boolean;
  paused = false;
  readonly bodies: RigidBody[] = [];
  /** Current contact pairs (AABB overlap), touching or not, in creation order. */
  readonly contacts: RigidContact[] = [];
  /**
   * Contacts that touched at any point during the last step (including touches that began and ended inside it
   * and resting contacts of sleeping bodies), each once, in detection order. Rebuilt every step.
   */
  readonly touches: RigidContact[] = [];
  /** Joints in add order (see addJoint). */
  readonly joints: RigidJoint[] = [];
  /** Simulated seconds and steps so far. */
  time = 0;
  steps = 0;
  /** Leftover fraction of a step after update() (0..1), for interpolation. */
  alpha = 0;
  private acc = 0;
  private nextId = 1;
  private stamp = 0;
  private touchStamp = 0;
  private stepping = false;
  private readonly sorted: RigidBody[] = [];
  // Per-step lists are written by count and truncated once at the end of the step, so steady-state steps reuse
  // their backing stores instead of re-growing them.
  private touchCount = 0;
  private readonly solverList: RigidContact[] = [];
  private solverCount = 0;
  private readonly pendingAdd: RigidBody[] = [];
  private readonly pendingRemove: RigidBody[] = [];
  private nextJointId = 1;
  private readonly jointList: RigidJoint[] = [];
  private jointCount = 0;
  private readonly wakeStack: RigidBody[] = [];
  private activeIdx = new Int32Array(64);
  private sweepY = false;
  private readonly pendingJointAdd: RigidJoint[] = [];
  private readonly pendingJointRemove: RigidJoint[] = [];
  private readonly brokenJoints: RigidJoint[] = [];
  private readonly jointSettings: RigidJointSolverSettings = { slop: 0.25, maxCorrection: 8 };
  private queue: QueuedEvent[] = [];
  private substepBegins: RigidContactEvent[] = [];
  private readonly events = new Emitter<RigidWorldEvents>();
  private readonly manifold = newRigidManifold();
  private readonly worldPoint: RigidWorldPoint = { nx: 0, ny: 0, x: [0, 0], y: [0, 0], separation: [0, 0] };
  private readonly ray: RigidRayScratch = { fraction: 0, nx: 0, ny: 0 };
  private parent = new Int32Array(64);
  private minSleep = new Float64Array(64);

  constructor(opts: RigidWorldOptions = {}) {
    if (typeof opts.gravity === 'number') this.gravityY = opts.gravity;
    else if (opts.gravity) {
      this.gravityX = opts.gravity.x;
      this.gravityY = opts.gravity.y;
    } else this.gravityY = 1600;
    this.fixedStep = 1 / (opts.hz ?? 60);
    this.maxSteps = opts.maxSteps ?? 5;
    this.substeps = opts.substeps ?? 1;
    this.velocityIterations = opts.velocityIterations ?? 8;
    this.positionIterations = opts.positionIterations ?? 3;
    this.slop = opts.slop ?? 0.25;
    this.contactMargin = opts.contactMargin ?? 1;
    this.baumgarte = opts.baumgarte ?? 0.2;
    this.maxCorrection = opts.maxCorrection ?? 8;
    this.restitutionThreshold = opts.restitutionThreshold ?? 50;
    this.sleepLinear = opts.sleepLinear ?? 4;
    this.sleepAngular = opts.sleepAngular ?? 0.1;
    this.timeToSleep = opts.timeToSleep ?? 0.5;
    this.allowSleep = opts.allowSleep ?? true;
    this.maxSpeed = opts.maxSpeed ?? 10000;
    this.interpolate = opts.interpolate ?? false;
    this.warmStarting = opts.warmStarting ?? true;
  }

  // ---------------------------------------------------------------- bodies

  /** Adds a body (or creates one from options). Inside a step / event callback it joins when the step ends. */
  add(body: RigidBody | RigidBodyOptions): RigidBody {
    const b = body instanceof RigidBody ? body : new RigidBody(body);
    if (b.world === this) return b;
    b.world?.remove(b);
    b.world = this;
    const p = this.pendingRemove.indexOf(b);
    if (p >= 0) this.pendingRemove.splice(p, 1);
    else if (this.stepping) this.pendingAdd.push(b);
    else this.attachBody(b);
    return b;
  }

  /**
   * Removes a body; touching contacts end (contactEnd) and bodies resting on it wake. Safe inside event callbacks:
   * `body.world` is null at once, the removal itself happens when the step ends.
   */
  remove(body: RigidBody): void {
    if (body.world !== this) return;
    body.world = null;
    const i = this.pendingAdd.indexOf(body);
    if (i >= 0) {
      this.pendingAdd.splice(i, 1);
      return;
    }
    if (this.stepping) {
      this.pendingRemove.push(body);
      return;
    }
    this.detach(body);
    this.drain();
  }

  /** Removes everything at once, joints included (no contactEnd events). */
  clear(): void {
    for (const j of this.joints) j.world = null;
    for (const j of this.pendingJointAdd) j.world = null;
    for (const b of this.bodies) {
      b.world = null;
      b.joints.length = 0;
      b.contactEdges.length = 0;
    }
    for (const b of this.pendingAdd) b.world = null;
    this.joints.length = 0;
    this.jointList.length = 0;
    this.jointCount = 0;
    this.pendingJointAdd.length = 0;
    this.pendingJointRemove.length = 0;
    this.brokenJoints.length = 0;
    this.bodies.length = 0;
    this.sorted.length = 0;
    this.sweepY = false;
    this.contacts.length = 0;
    this.touches.length = 0;
    this.touchCount = 0;
    this.solverList.length = 0;
    this.solverCount = 0;
    this.wakeStack.length = 0;
    this.pendingAdd.length = 0;
    this.pendingRemove.length = 0;
    this.queue = [];
  }

  /** First body with this name. */
  get(name: string): RigidBody | undefined {
    return this.bodies.find((b) => b.name === name);
  }

  private attachBody(b: RigidBody): void {
    b.id = this.nextId++;
    b.syncTransform();
    this.bodies.push(b);
    this.sorted.push(b);
  }

  private detach(b: RigidBody): void {
    const i = this.bodies.indexOf(b);
    if (i < 0) return;
    while (b.joints.length) this.detachJoint(b.joints[b.joints.length - 1]!);
    this.bodies.splice(i, 1);
    const j = this.sorted.indexOf(b);
    if (j >= 0) this.sorted.splice(j, 1);
    const list = this.contacts;
    let n = 0;
    for (let k = 0; k < list.length; k++) {
      const c = list[k]!;
      if (c.a !== b && c.b !== b) {
        list[n++] = c;
        continue;
      }
      removeEdge(c.other(b), c);
      if (c.touching) {
        c.touching = false;
        this.queue.push(['contactEnd', this.makeEvent(c, false)]);
        if (!c.sensor) c.other(b).wake();
      }
    }
    list.length = n;
    b.contactEdges.length = 0;
  }

  // ---------------------------------------------------------------- joints

  /**
   * Connects two bodies of this world (both must be added first; the mouse joint takes one `body`). Wakes both.
   * Inside a step / event callback the joint joins when the step ends. Removing a body removes its joints.
   *
   *     world.addJoint({ type: 'revolute', a: arm, b: hand, anchor: { x, y }, lowerAngle: -1, upperAngle: 0.5 });
   *     world.addJoint({ type: 'distance', a: pivot, b: ball });                 // rigid rod at the current length
   *     world.addJoint({ type: 'distance', a: hook, b: crate, minLength: 0 });   // rope: may get shorter, never longer
   */
  addJoint(opts: RigidDistanceJointOptions): RigidDistanceJoint;
  addJoint(opts: RigidRevoluteJointOptions): RigidRevoluteJoint;
  addJoint(opts: RigidWeldJointOptions): RigidWeldJoint;
  addJoint(opts: RigidMouseJointOptions): RigidMouseJoint;
  addJoint(opts: RigidJointOptions): RigidJoint;
  addJoint(opts: RigidJointOptions): RigidJoint {
    const j = createRigidJoint(opts);
    if (j.a.world !== this || j.b.world !== this) throw new Error(`RigidWorld.addJoint(${opts.type}): add both bodies to this world first`);
    if (j.a === j.b && j.type !== 'mouse') throw new Error(`RigidWorld.addJoint(${opts.type}): a and b are the same body`);
    j.world = this;
    if (this.stepping) this.pendingJointAdd.push(j);
    else this.attachJoint(j);
    return j;
  }

  /** Removes a joint and wakes its bodies. Safe inside event callbacks (applied when the step ends). */
  removeJoint(j: RigidJoint): void {
    if (j.world !== this) return;
    j.world = null;
    const i = this.pendingJointAdd.indexOf(j);
    if (i >= 0) {
      this.pendingJointAdd.splice(i, 1);
      return;
    }
    if (this.stepping) this.pendingJointRemove.push(j);
    else this.detachJoint(j);
  }

  private attachJoint(j: RigidJoint): void {
    j.id = this.nextJointId++;
    this.joints.push(j);
    j.a.joints.push(j);
    if (j.b !== j.a) j.b.joints.push(j);
    j.a.wake();
    j.b.wake();
  }

  private detachJoint(j: RigidJoint): void {
    j.world = null;
    const i = this.joints.indexOf(j);
    if (i < 0) return;
    this.joints.splice(i, 1);
    const ia = j.a.joints.indexOf(j);
    if (ia >= 0) j.a.joints.splice(ia, 1);
    const ib = j.b.joints.indexOf(j);
    if (ib >= 0) j.b.joints.splice(ib, 1);
    j.a.wake();
    j.b.wake();
  }

  /** Called by RigidBody.setPosition: wakes bodies that touched it or overlap its new place. */
  onTeleport(b: RigidBody): void {
    if (b.world !== this) return;
    const edges = b.contactEdges;
    for (let i = 0; i < edges.length; i++) {
      const c = edges[i]!;
      c.a.wake();
      c.b.wake();
    }
    if (b.type === 'dynamic') return;
    const m = this.contactMargin;
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const o = bodies[i]!;
      if (o.sleeping && o.minX <= b.maxX + m && o.maxX >= b.minX - m && o.minY <= b.maxY + m && o.maxY >= b.minY - m) o.wake();
    }
  }

  // ---------------------------------------------------------------- events / loop

  /** Subscribes to 'contactBegin' / 'contactEnd' / 'jointBreak' / 'step'. Returns a remover. */
  on<K extends keyof RigidWorldEvents>(type: K, fn: (e: RigidWorldEvents[K]) => void): () => void {
    return this.events.on(type, fn);
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

  /** Accumulates dt, runs whole fixed steps, syncs bound nodes. Returns the interpolation alpha (0..1). */
  update(dt: number): number {
    if (this.paused) return this.alpha;
    const h = this.fixedStep;
    this.acc += dt;
    let n = 0;
    while (this.acc >= h - 1e-9 && n < this.maxSteps) {
      this.step(h);
      this.acc -= h;
      n++;
    }
    if (this.acc >= h) this.acc = 0;
    if (this.acc < 0) this.acc = 0;
    this.alpha = this.acc / h;
    this.syncNodes(this.interpolate ? this.alpha : 1);
    return this.alpha;
  }

  /** Copies body poses to bound nodes; alpha < 1 blends from the previous step's pose. */
  syncNodes(alpha = 1): void {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      const n = b.node;
      if (!n) continue;
      const x = alpha >= 1 ? b.x : b.prevX + (b.x - b.prevX) * alpha;
      const y = alpha >= 1 ? b.y : b.prevY + (b.y - b.prevY) * alpha;
      const a = alpha >= 1 ? b.angle : b.prevAngle + (b.angle - b.prevAngle) * alpha;
      const ox = b.nodeOffsetX;
      const oy = b.nodeOffsetY;
      if (ox !== 0 || oy !== 0) {
        const c = Math.cos(a);
        const s = Math.sin(a);
        n.x = x + c * ox - s * oy;
        n.y = y + s * ox + c * oy;
      } else {
        n.x = x;
        n.y = y;
      }
      if (b.nodeRotate) n.rotation = a;
    }
  }

  /** One fixed step of h seconds (split into `substeps`), then contact events and deferred adds/removes. */
  step(h: number = this.fixedStep): void {
    if (this.stepping) throw new Error('RigidWorld.step: already stepping (called from an event callback?)');
    this.stepping = true;
    try {
      this.touchCount = 0;
      this.touchStamp++;
      const bodies = this.bodies;
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]!;
        b.prevX = b.x;
        b.prevY = b.y;
        b.prevAngle = b.angle;
      }
      const n = Math.max(1, Math.floor(this.substeps));
      for (let i = 0; i < n; i++) this.substep(h / n);
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]!;
        b.fx = b.fy = b.torque = 0;
      }
      if (this.brokenJoints.length) {
        for (let i = 0; i < this.brokenJoints.length; i++) this.detachJoint(this.brokenJoints[i]!);
        this.brokenJoints.length = 0;
      }
      this.time += h;
      this.steps++;
    } finally {
      this.touches.length = this.touchCount;
      this.solverList.length = this.solverCount;
      this.jointList.length = this.jointCount;
      this.stepping = false;
    }
    this.drain();
    this.events.emit('step', h);
  }

  /** Emits queued contact / joint events and applies deferred removes/adds until nothing is left. */
  private drain(): void {
    const was = this.stepping;
    this.stepping = true;
    try {
      for (let guard = 0; guard < 10000; guard++) {
        if (this.queue.length) {
          const q = this.queue;
          this.queue = [];
          for (let i = 0; i < q.length; i++) {
            const e = q[i]!;
            if (e[0] === 'jointBreak') this.events.emit('jointBreak', e[1]);
            else this.events.emit(e[0], e[1]);
          }
        } else if (this.pendingRemove.length) {
          const list = this.pendingRemove.splice(0);
          for (let i = 0; i < list.length; i++) if (list[i]!.world !== this) this.detach(list[i]!);
        } else if (this.pendingJointRemove.length) {
          const list = this.pendingJointRemove.splice(0);
          for (let i = 0; i < list.length; i++) if (list[i]!.world !== this) this.detachJoint(list[i]!);
        } else if (this.pendingAdd.length) {
          const list = this.pendingAdd.splice(0);
          for (let i = 0; i < list.length; i++) if (list[i]!.world === this) this.attachBody(list[i]!);
        } else if (this.pendingJointAdd.length) {
          const list = this.pendingJointAdd.splice(0);
          for (let i = 0; i < list.length; i++) {
            const j = list[i]!;
            if (j.world !== this) continue;
            if (j.a.world === this && j.b.world === this) this.attachJoint(j);
            else j.world = null;
          }
        } else break;
      }
    } finally {
      this.stepping = was;
    }
  }

  private makeEvent(c: RigidContact, begin: boolean): RigidContactEvent {
    return {
      a: c.a,
      b: c.b,
      contact: c,
      sensor: c.sensor,
      nx: c.nx,
      ny: c.ny,
      x: c.count ? c.x : c.points[0].x,
      y: c.count ? c.y : c.points[0].y,
      approachSpeed: begin ? c.approachSpeed : 0,
      impulse: 0,
    };
  }

  // ---------------------------------------------------------------- step internals

  private substep(h: number): void {
    const bodies = this.bodies;
    let anyActive = false;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      b.slot = i;
      if (!anyActive && isActive(b)) anyActive = true;
    }
    if (!anyActive) {
      this.restingSubstep();
      return;
    }
    this.collide(h);
    this.propagateWake();

    const gx = this.gravityX;
    const gy = this.gravityY;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (b.type !== 'dynamic' || b.sleeping) continue;
      b.vx += h * (b.gravityScale * gx + b.invMass * b.fx);
      b.vy += h * (b.gravityScale * gy + b.invMass * b.fy);
      b.av += h * b.invInertia * b.torque;
      if (b.linearDamping > 0) {
        const d = 1 / (1 + h * b.linearDamping);
        b.vx *= d;
        b.vy *= d;
      }
      if (b.angularDamping > 0) b.av /= 1 + h * b.angularDamping;
    }

    this.prepareContacts(h);
    this.prepareJoints(h);
    const joints = this.jointList;
    const nJoints = this.jointCount;
    for (let i = 0; i < this.velocityIterations; i++) {
      for (let k = 0; k < nJoints; k++) joints[k]!.solveVelocity();
      this.solveVelocities();
    }
    if (nJoints) this.checkJointBreaks();
    this.applyRestitution();
    this.speculativeTouches();

    const maxV2 = this.maxSpeed * this.maxSpeed;
    const maxW = (0.5 * Math.PI) / h;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (!isActive(b)) continue;
      if (b.type === 'dynamic') {
        const v2 = b.vx * b.vx + b.vy * b.vy;
        if (v2 > maxV2) {
          const k = this.maxSpeed / Math.sqrt(v2);
          b.vx *= k;
          b.vy *= k;
        }
        if (b.av > maxW) b.av = maxW;
        else if (b.av < -maxW) b.av = -maxW;
      }
      b.x += h * b.vx;
      b.y += h * b.vy;
      if (b.av !== 0) {
        b.angle += h * b.av;
        b.c = Math.cos(b.angle);
        b.s = Math.sin(b.angle);
      }
    }
    const js = this.jointSettings;
    js.slop = this.slop;
    js.maxCorrection = this.maxCorrection;
    for (let i = 0; i < this.positionIterations; i++) {
      const contactsOk = this.solvePositions();
      let jointsOk = true;
      for (let k = 0; k < nJoints; k++) {
        const j = joints[k]!;
        if (!j.broken && !j.solvePosition(js)) jointsOk = false;
      }
      if (contactsOk && jointsOk) break;
    }
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (isActive(b)) b.syncTransform();
    }

    const begins = this.substepBegins;
    for (let i = 0; i < begins.length; i++) {
      const e = begins[i]!;
      e.impulse = e.sensor ? 0 : e.contact.impulse;
    }
    begins.length = 0;
    this.updateSleep(h);
  }

  /**
   * Substep of a world where nothing moves (every dynamic body asleep, kinematics still): no pair can be new or
   * change, so only the resting contacts are recorded in touches. Same outcome as a full substep.
   */
  private restingSubstep(): void {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) bodies[i]!.spec = 0;
    this.solverCount = 0;
    this.jointCount = 0;
    const list = this.contacts;
    const touches = this.touches;
    const stamp = this.touchStamp;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]!;
      if (c.touching && c.touchStamp !== stamp) {
        c.touchStamp = stamp;
        touches[this.touchCount++] = c;
      }
    }
  }

  /**
   * Sort-and-sweep on the AABB min of one axis; creates contacts for new pairs, stamps pairs that still overlap.
   * The axis is the one along which non-static bodies spread more (a tall pile sweeps y); it only flips once the
   * other axis spreads 1.5x more, and a flip re-sorts from scratch. Pairs of two inactive bodies are never needed,
   * so an inactive body only sweeps over the active bodies after it.
   */
  private broadphase(stamp: number): void {
    const list = this.sorted;
    const n = list.length;
    let k = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
      const b = list[i]!;
      if (b.type === 'static') continue;
      const cx = b.minX + b.maxX;
      const cy = b.minY + b.maxY;
      k++;
      sx += cx;
      sy += cy;
      sxx += cx * cx;
      syy += cy * cy;
    }
    // k^2 times the variances of the AABB centres (times 4): only their ratio matters.
    const varX = k * sxx - sx * sx;
    const varY = k * syy - sy * sy;
    if (this.sweepY ? varX > 1.5 * varY : varY > 1.5 * varX) {
      this.sweepY = !this.sweepY;
      list.sort(this.sweepY ? byMinY : byMinX);
    } else sortSweep(list, this.sweepY);
    const y = this.sweepY;

    if (this.activeIdx.length < n) this.activeIdx = new Int32Array(n * 2);
    const active = this.activeIdx;
    let nActive = 0;
    let maxSpec = 0;
    for (let i = 0; i < n; i++) {
      const b = list[i]!;
      if (b.spec > maxSpec) maxSpec = b.spec;
      if (isActive(b)) active[nActive++] = i;
    }
    const m = this.contactMargin;
    // next = number of active bodies before index i, so active[next] is the first active index >= i. The loops are
    // spelled out per axis: a shared loop reading the axis per candidate costs about 10% of a sparse world's step.
    let next = 0;
    for (let i = 0; i < n; i++) {
      const a = list[i]!;
      const reach = m + a.spec;
      const end = (y ? a.maxY : a.maxX) + reach + maxSpec;
      if (next < nActive && active[next] === i) {
        next++;
        if (y) {
          for (let j = i + 1; j < n; j++) {
            const b = list[j]!;
            if (b.minY > end) break;
            this.pair(a, b, reach, stamp, true);
          }
        } else {
          for (let j = i + 1; j < n; j++) {
            const b = list[j]!;
            if (b.minX > end) break;
            this.pair(a, b, reach, stamp, false);
          }
        }
      } else if (y) {
        for (let q = next; q < nActive; q++) {
          const b = list[active[q]!]!;
          if (b.minY > end) break;
          this.pair(a, b, reach, stamp, true);
        }
      } else {
        for (let q = next; q < nActive; q++) {
          const b = list[active[q]!]!;
          if (b.minX > end) break;
          this.pair(a, b, reach, stamp, false);
        }
      }
    }
  }

  /**
   * Broadphase candidate (at least one active; b sorts after a on the sweep axis, so b's min on that axis cannot be
   * below a's): stamps or creates their contact.
   */
  private pair(a: RigidBody, b: RigidBody, reach: number, stamp: number, y: boolean): void {
    const r = reach + b.spec;
    if (y) {
      if (b.minX > a.maxX + r || b.maxX < a.minX - r || b.minY > a.maxY + r) return;
    } else if (b.minY > a.maxY + r || b.maxY < a.minY - r || b.minX > a.maxX + r) return;
    if (!shouldCollide(a, b)) return;
    if (a.joints.length !== 0 && b.joints.length !== 0 && jointBlocksPair(a, b)) return;
    let c = findContact(a, b);
    if (!c) {
      const swap = a.shape.type !== b.shape.type ? a.shape.type === 'circle' : a.id > b.id;
      c = swap ? new RigidContact(b, a) : new RigidContact(a, b);
      a.contactEdges.push(c);
      b.contactEdges.push(c);
      this.contacts.push(c);
    }
    c.stamp = stamp;
  }

  private collide(h: number): void {
    const g = Math.sqrt(this.gravityX * this.gravityX + this.gravityY * this.gravityY) * h;
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (!isActive(b)) {
        b.spec = 0;
        continue;
      }
      const sh = b.shape;
      const spin = sh.type === 'polygon' ? Math.abs(b.av) * sh.extent : 0;
      b.spec = (b.speed + (b.type === 'dynamic' ? g * Math.abs(b.gravityScale) : 0) + spin) * h;
    }
    const stamp = ++this.stamp;
    this.broadphase(stamp);
    const list = this.contacts;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]!;
      const active = isActive(c.a) || isActive(c.b);
      if (c.stamp !== stamp) {
        if (active) {
          removeEdge(c.a, c);
          removeEdge(c.b, c);
          if (c.touching) {
            c.touching = false;
            this.queue.push(['contactEnd', this.makeEvent(c, false)]);
            if (!c.sensor) {
              c.a.wake();
              c.b.wake();
            }
          }
          continue;
        }
      } else if (active) {
        this.updateContact(c);
      }
      if (c.touching && c.touchStamp !== this.touchStamp) {
        c.touchStamp = this.touchStamp;
        this.touches[this.touchCount++] = c;
      }
      list[n++] = c;
    }
    list.length = n;
  }

  /** Narrowphase for one contact: new manifold, impulses carried over by feature id, begin/end events. */
  private updateContact(c: RigidContact): void {
    const a = c.a;
    const b = c.b;
    const m = this.manifold;
    const margin = this.contactMargin;
    collideRigid(m, a, b, c.sensor ? margin : margin + a.spec + b.spec);
    const pts = c.points;
    const oldCount = c.count;
    const id0 = pts[0].id;
    const n0 = pts[0].normalImpulse;
    const t0 = pts[0].tangentImpulse;
    const s0 = pts[0].approach;
    const id1 = pts[1].id;
    const n1 = pts[1].normalImpulse;
    const t1 = pts[1].tangentImpulse;
    const s1 = pts[1].approach;
    for (let j = 0; j < m.count; j++) {
      const p = pts[j]!;
      const id = m.id[j]!;
      p.lx = m.px[j]!;
      p.ly = m.py[j]!;
      if (oldCount > 0 && id0 === id) {
        p.normalImpulse = n0;
        p.tangentImpulse = t0;
        p.approach = s0;
      } else if (oldCount > 1 && id1 === id) {
        p.normalImpulse = n1;
        p.tangentImpulse = t1;
        p.approach = s1;
      } else {
        p.normalImpulse = 0;
        p.tangentImpulse = 0;
        p.approach = 0;
      }
      p.id = id;
    }
    c.count = m.count;
    c.mtype = m.type;
    c.lnx = m.lnx;
    c.lny = m.lny;
    c.lpx = m.lpx;
    c.lpy = m.lpy;
    c.friction = Math.sqrt(a.friction * b.friction);
    c.restitution = Math.max(a.restitution, b.restitution);
    const was = c.touching;
    let minSep = Infinity;
    if (m.count > 0) {
      const w = this.worldPoint;
      rigidWorldManifold(w, m, a, b);
      c.nx = w.nx;
      c.ny = w.ny;
      for (let j = 0; j < m.count; j++) {
        const p = pts[j]!;
        p.x = w.x[j]!;
        p.y = w.y[j]!;
        p.separation = w.separation[j]!;
        if (p.separation < minSep) minSep = p.separation;
      }
    }
    c.touching = minSep <= margin;
    if (c.touching === was) return;
    if (c.touching) {
      let approach = 0;
      for (let j = 0; j < c.count; j++) {
        const p = pts[j]!;
        const dvx = b.vx - b.av * (p.y - b.y) - a.vx + a.av * (p.y - a.y);
        const dvy = b.vy + b.av * (p.x - b.x) - a.vy - a.av * (p.x - a.x);
        approach = Math.max(approach, -(dvx * c.nx + dvy * c.ny));
      }
      c.approachSpeed = approach;
      const e = this.makeEvent(c, true);
      this.queue.push(['contactBegin', e]);
      this.substepBegins.push(e);
    } else {
      this.queue.push(['contactEnd', this.makeEvent(c, false)]);
    }
    if (!c.sensor) {
      a.wake();
      b.wake();
    }
  }

  /**
   * Sleeping bodies touching or jointed to an awake body (or a moving kinematic) wake, transitively, keeping their
   * timers.
   */
  private propagateWake(): void {
    const bodies = this.bodies;
    let any = false;
    for (let i = 0; i < bodies.length; i++) {
      if (bodies[i]!.sleeping) {
        any = true;
        break;
      }
    }
    if (!any) return;
    // The woken set is everything reachable from an active body through non-sensor contacts with points and joints
    // (woken dynamics are active too), so walk the graph from each active body instead of iterating to a fixed point.
    const stack = this.wakeStack;
    for (let i = 0; i < bodies.length; i++) {
      const seed = bodies[i]!;
      if (!isActive(seed)) continue;
      stack.push(seed);
      while (stack.length) {
        const b = stack.pop()!;
        const edges = b.contactEdges;
        for (let k = 0; k < edges.length; k++) {
          const c = edges[k]!;
          if (c.count === 0 || c.sensor) continue;
          const o = c.a === b ? c.b : c.a;
          if (o.sleeping) {
            o.sleeping = false;
            stack.push(o);
          }
        }
        const joints = b.joints;
        for (let k = 0; k < joints.length; k++) {
          const o = joints[k]!.other(b);
          if (o.sleeping) {
            o.sleeping = false;
            stack.push(o);
          }
        }
      }
    }
  }

  /** Joints to solve this substep (an awake dynamic body on either side); prepares them and warm starts. */
  private prepareJoints(h: number): void {
    const list = this.jointList;
    const joints = this.joints;
    let n = 0;
    const warm = this.warmStarting;
    for (let i = 0; i < joints.length; i++) {
      const j = joints[i]!;
      if (j.broken || j.world !== this) continue;
      const a = j.a;
      const b = j.b;
      if ((a.type !== 'dynamic' || a.sleeping) && (b.type !== 'dynamic' || b.sleeping)) continue;
      j.prepare(h, warm);
      list[n++] = j;
    }
    this.jointCount = n;
  }

  /** Marks joints whose reaction exceeded their limits as broken; they leave the world at the end of the step. */
  private checkJointBreaks(): void {
    const list = this.jointList;
    const n = this.jointCount;
    for (let i = 0; i < n; i++) {
      const j = list[i]!;
      if (j.breakForce === Infinity && j.breakTorque === Infinity) continue;
      if (j.reactionForce() <= j.breakForce && Math.abs(j.reactionTorque()) <= j.breakTorque) continue;
      j.broken = true;
      this.brokenJoints.push(j);
      this.queue.push(['jointBreak', j]);
    }
  }

  private prepareContacts(h: number): void {
    const list = this.solverList;
    const contacts = this.contacts;
    let count = 0;
    // Contacts with static/kinematic bodies go last: Gauss-Seidel favours the last constraint, so walls and floors win.
    let fixed = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < contacts.length; i++) {
        const c = contacts[i]!;
        if (c.count === 0 || c.sensor) continue;
        const a = c.a;
        const b = c.b;
        const dynA = a.type === 'dynamic' && !a.sleeping;
        const dynB = b.type === 'dynamic' && !b.sleeping;
        if (!dynA && !dynB) continue;
        const both = a.type === 'dynamic' && b.type === 'dynamic';
        if (both === (pass === 0)) list[count++] = c;
        else if (pass === 0) fixed++;
      }
      if (fixed === 0) break;
    }
    this.solverCount = count;
    const invH = 1 / h;
    const warm = this.warmStarting;
    for (let i = 0; i < count; i++) {
      const c = list[i]!;
      const a = c.a;
      const b = c.b;
      const mA = a.invMass;
      const iA = a.invInertia;
      const mB = b.invMass;
      const iB = b.invInertia;
      const nx = c.nx;
      const ny = c.ny;
      const tx = ny;
      const ty = -nx;
      for (let j = 0; j < c.count; j++) {
        const p = c.points[j]!;
        const rAx = (p.rAx = p.x - a.x);
        const rAy = (p.rAy = p.y - a.y);
        const rBx = (p.rBx = p.x - b.x);
        const rBy = (p.rBy = p.y - b.y);
        const rnA = rAx * ny - rAy * nx;
        const rnB = rBx * ny - rBy * nx;
        const kN = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
        p.normalMass = kN > 0 ? 1 / kN : 0;
        const rtA = rAx * ty - rAy * tx;
        const rtB = rBx * ty - rBy * tx;
        const kT = mA + mB + iA * rtA * rtA + iB * rtB * rtB;
        p.tangentMass = kT > 0 ? 1 / kT : 0;
        const dvx = b.vx - b.av * rBy - a.vx + a.av * rAy;
        const dvy = b.vy + b.av * rBx - a.vy - a.av * rAx;
        p.relVel = dvx * nx + dvy * ny;
        p.bias = p.separation > 0 ? -p.separation * invH : 0;
        p.maxNormalImpulse = 0;
        if (!warm) p.normalImpulse = p.tangentImpulse = 0;
      }
      c.solveCount = c.count;
      if (c.count === 2) {
        const p1 = c.points[0];
        const p2 = c.points[1];
        const rn1A = p1.rAx * ny - p1.rAy * nx;
        const rn1B = p1.rBx * ny - p1.rBy * nx;
        const rn2A = p2.rAx * ny - p2.rAy * nx;
        const rn2B = p2.rBx * ny - p2.rBy * nx;
        const k11 = mA + mB + iA * rn1A * rn1A + iB * rn1B * rn1B;
        const k22 = mA + mB + iA * rn2A * rn2A + iB * rn2B * rn2B;
        const k12 = mA + mB + iA * rn1A * rn2A + iB * rn1B * rn2B;
        const det = k11 * k22 - k12 * k12;
        if (k11 * k11 < 1000 * det) {
          c.k11 = k11;
          c.k12 = k12;
          c.k22 = k22;
          c.nm11 = k22 / det;
          c.nm12 = -k12 / det;
          c.nm22 = k11 / det;
        } else {
          c.solveCount = 1;
        }
      }
    }
    // Warm start in a separate pass so every relVel above is measured before any impulse is applied.
    for (let i = 0; i < count; i++) {
      const c = list[i]!;
      const a = c.a;
      const b = c.b;
      const mA = a.invMass;
      const iA = a.invInertia;
      const mB = b.invMass;
      const iB = b.invInertia;
      const nx = c.nx;
      const ny = c.ny;
      const tx = ny;
      const ty = -nx;
      for (let j = 0; j < c.solveCount; j++) {
        const p = c.points[j]!;
        const px = p.normalImpulse * nx + p.tangentImpulse * tx;
        const py = p.normalImpulse * ny + p.tangentImpulse * ty;
        if (px === 0 && py === 0) continue;
        a.vx -= mA * px;
        a.vy -= mA * py;
        a.av -= iA * (p.rAx * py - p.rAy * px);
        b.vx += mB * px;
        b.vy += mB * py;
        b.av += iB * (p.rBx * py - p.rBy * px);
      }
    }
  }

  private solveVelocities(): void {
    const list = this.solverList;
    const n = this.solverCount;
    for (let i = 0; i < n; i++) {
      const c = list[i]!;
      const a = c.a;
      const b = c.b;
      const mA = a.invMass;
      const iA = a.invInertia;
      const mB = b.invMass;
      const iB = b.invInertia;
      let vAx = a.vx;
      let vAy = a.vy;
      let wA = a.av;
      let vBx = b.vx;
      let vBy = b.vy;
      let wB = b.av;
      const nx = c.nx;
      const ny = c.ny;
      const tx = ny;
      const ty = -nx;
      const count = c.solveCount;
      const friction = c.friction;

      for (let j = 0; j < count; j++) {
        const p = c.points[j]!;
        const dvx = vBx - wB * p.rBy - vAx + wA * p.rAy;
        const dvy = vBy + wB * p.rBx - vAy - wA * p.rAx;
        const vt = dvx * tx + dvy * ty;
        let lambda = -p.tangentMass * vt;
        const maxF = friction * p.normalImpulse;
        const next = Math.max(-maxF, Math.min(maxF, p.tangentImpulse + lambda));
        lambda = next - p.tangentImpulse;
        p.tangentImpulse = next;
        const px = lambda * tx;
        const py = lambda * ty;
        vAx -= mA * px;
        vAy -= mA * py;
        wA -= iA * (p.rAx * py - p.rAy * px);
        vBx += mB * px;
        vBy += mB * py;
        wB += iB * (p.rBx * py - p.rBy * px);
      }

      if (count === 1) {
        const p = c.points[0];
        const dvx = vBx - wB * p.rBy - vAx + wA * p.rAy;
        const dvy = vBy + wB * p.rBx - vAy - wA * p.rAx;
        const vn = dvx * nx + dvy * ny;
        let lambda = -p.normalMass * (vn - p.bias);
        const next = Math.max(p.normalImpulse + lambda, 0);
        lambda = next - p.normalImpulse;
        p.normalImpulse = next;
        if (next > p.maxNormalImpulse) p.maxNormalImpulse = next;
        const px = lambda * nx;
        const py = lambda * ny;
        vAx -= mA * px;
        vAy -= mA * py;
        wA -= iA * (p.rAx * py - p.rAy * px);
        vBx += mB * px;
        vBy += mB * py;
        wB += iB * (p.rBx * py - p.rBy * px);
      } else if (count === 2) {
        // Box2D block solver: solve both normal constraints together (LCP by enumerating the 4 cases).
        const p1 = c.points[0];
        const p2 = c.points[1];
        const ax = p1.normalImpulse;
        const ay = p2.normalImpulse;
        const dv1x = vBx - wB * p1.rBy - vAx + wA * p1.rAy;
        const dv1y = vBy + wB * p1.rBx - vAy - wA * p1.rAx;
        const dv2x = vBx - wB * p2.rBy - vAx + wA * p2.rAy;
        const dv2y = vBy + wB * p2.rBx - vAy - wA * p2.rAx;
        const vn1 = dv1x * nx + dv1y * ny;
        const vn2 = dv2x * nx + dv2y * ny;
        const bx = vn1 - p1.bias - (c.k11 * ax + c.k12 * ay);
        const by = vn2 - p2.bias - (c.k12 * ax + c.k22 * ay);
        let xx = -(c.nm11 * bx + c.nm12 * by);
        let xy = -(c.nm12 * bx + c.nm22 * by);
        let ok = xx >= 0 && xy >= 0;
        if (!ok) {
          xx = -p1.normalMass * bx;
          xy = 0;
          ok = xx >= 0 && c.k12 * xx + by >= 0;
        }
        if (!ok) {
          xx = 0;
          xy = -p2.normalMass * by;
          ok = xy >= 0 && c.k12 * xy + bx >= 0;
        }
        if (!ok) {
          xx = 0;
          xy = 0;
          ok = bx >= 0 && by >= 0;
        }
        if (ok) {
          const d1 = xx - ax;
          const d2 = xy - ay;
          const p1x = d1 * nx;
          const p1y = d1 * ny;
          const p2x = d2 * nx;
          const p2y = d2 * ny;
          vAx -= mA * (p1x + p2x);
          vAy -= mA * (p1y + p2y);
          wA -= iA * (p1.rAx * p1y - p1.rAy * p1x + p2.rAx * p2y - p2.rAy * p2x);
          vBx += mB * (p1x + p2x);
          vBy += mB * (p1y + p2y);
          wB += iB * (p1.rBx * p1y - p1.rBy * p1x + p2.rBx * p2y - p2.rBy * p2x);
          p1.normalImpulse = xx;
          p2.normalImpulse = xy;
          if (xx > p1.maxNormalImpulse) p1.maxNormalImpulse = xx;
          if (xy > p2.maxNormalImpulse) p2.maxNormalImpulse = xy;
        }
      }

      a.vx = vAx;
      a.vy = vAy;
      a.av = wA;
      b.vx = vBx;
      b.vy = vBy;
      b.av = wB;
    }
  }

  /**
   * Bounce: after the solve, push touching points that collided fast enough to -restitution * approach speed.
   * Speculative points wait until the surfaces meet, then bounce with the speed they arrived with.
   */
  private applyRestitution(): void {
    const threshold = this.restitutionThreshold;
    const margin = this.contactMargin;
    const list = this.solverList;
    const n = this.solverCount;
    for (let i = 0; i < n; i++) {
      const c = list[i]!;
      const e = c.restitution;
      if (e === 0) continue;
      const a = c.a;
      const b = c.b;
      const mA = a.invMass;
      const iA = a.invInertia;
      const mB = b.invMass;
      const iB = b.invInertia;
      const nx = c.nx;
      const ny = c.ny;
      for (let j = 0; j < c.solveCount; j++) {
        const p = c.points[j]!;
        const rel = Math.min(p.relVel, -p.approach);
        if (rel > -threshold || p.maxNormalImpulse === 0 || p.separation > margin) continue;
        const dvx = b.vx - b.av * p.rBy - a.vx + a.av * p.rAy;
        const dvy = b.vy + b.av * p.rBx - a.vy - a.av * p.rAx;
        const vn = dvx * nx + dvy * ny;
        let lambda = -p.normalMass * (vn + e * rel);
        const next = Math.max(p.normalImpulse + lambda, 0);
        lambda = next - p.normalImpulse;
        p.normalImpulse = next;
        if (next > p.maxNormalImpulse) p.maxNormalImpulse = next;
        const px = lambda * nx;
        const py = lambda * ny;
        a.vx -= mA * px;
        a.vy -= mA * py;
        a.av -= iA * (p.rAx * py - p.rAy * px);
        b.vx += mB * px;
        b.vy += mB * py;
        b.av += iB * (p.rBx * py - p.rBy * px);
      }
    }
  }

  /** Speculative points the solver had to stop are hits within this substep: they begin touching now. */
  private speculativeTouches(): void {
    const margin = this.contactMargin;
    const list = this.solverList;
    const n = this.solverCount;
    for (let i = 0; i < n; i++) {
      const c = list[i]!;
      let hit = false;
      let approach = 0;
      for (let j = 0; j < c.solveCount; j++) {
        const p = c.points[j]!;
        if (p.separation <= margin) {
          p.approach = 0;
        } else if (p.normalImpulse > 0) {
          hit = true;
          p.approach = Math.max(p.approach, -p.relVel);
          approach = Math.max(approach, -p.relVel);
        }
      }
      if (!hit || c.touching) continue;
      c.touching = true;
      c.approachSpeed = approach;
      const e = this.makeEvent(c, true);
      this.queue.push(['contactBegin', e]);
      this.substepBegins.push(e);
      if (c.touchStamp !== this.touchStamp) {
        c.touchStamp = this.touchStamp;
        this.touches[this.touchCount++] = c;
      }
    }
  }

  /** One non-linear Gauss-Seidel pass on positions. Returns true when every contact is within 3 * slop. */
  private solvePositions(): boolean {
    const slop = this.slop;
    const baumgarte = this.baumgarte;
    const maxC = this.maxCorrection;
    let minSep = 0;
    const list = this.solverList;
    const n = this.solverCount;
    for (let i = 0; i < n; i++) {
      const c = list[i]!;
      const a = c.a;
      const b = c.b;
      const mA = a.invMass;
      const iA = a.invInertia;
      const mB = b.invMass;
      const iB = b.invInertia;
      const ra = a.shape.type === 'circle' ? a.shape.radius : 0;
      const rb = b.shape.type === 'circle' ? b.shape.radius : 0;
      const polyA = a.shape.type === 'polygon';
      const polyB = b.shape.type === 'polygon';
      for (let j = 0; j < c.solveCount; j++) {
        const p = c.points[j]!;
        let nx: number;
        let ny: number;
        let px: number;
        let py: number;
        let sep: number;
        if (c.mtype === RIGID_CIRCLES) {
          const pax = a.x + a.c * c.lpx - a.s * c.lpy;
          const pay = a.y + a.s * c.lpx + a.c * c.lpy;
          const pbx = b.x + b.c * p.lx - b.s * p.ly;
          const pby = b.y + b.s * p.lx + b.c * p.ly;
          const dx = pbx - pax;
          const dy = pby - pay;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 1e-12) {
            nx = dx / d;
            ny = dy / d;
          } else {
            nx = 1;
            ny = 0;
          }
          px = (pax + pbx) / 2;
          py = (pay + pby) / 2;
          sep = d - ra - rb;
        } else {
          const faceA = c.mtype === RIGID_FACE_A;
          const ref = faceA ? a : b;
          const inc = faceA ? b : a;
          nx = ref.c * c.lnx - ref.s * c.lny;
          ny = ref.s * c.lnx + ref.c * c.lny;
          const planeX = ref.x + ref.c * c.lpx - ref.s * c.lpy;
          const planeY = ref.y + ref.s * c.lpx + ref.c * c.lpy;
          px = inc.x + inc.c * p.lx - inc.s * p.ly;
          py = inc.y + inc.s * p.lx + inc.c * p.ly;
          sep = (px - planeX) * nx + (py - planeY) * ny - ra - rb;
          if (!faceA) {
            nx = -nx;
            ny = -ny;
          }
        }
        if (sep < minSep) minSep = sep;
        const C = Math.max(-maxC, Math.min(0, baumgarte * (sep + slop)));
        if (C === 0) continue;
        const rAx = px - a.x;
        const rAy = py - a.y;
        const rBx = px - b.x;
        const rBy = py - b.y;
        const rnA = rAx * ny - rAy * nx;
        const rnB = rBx * ny - rBy * nx;
        const K = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
        if (K <= 0) continue;
        const impulse = -C / K;
        const ix = impulse * nx;
        const iy = impulse * ny;
        a.x -= mA * ix;
        a.y -= mA * iy;
        if (iA > 0) {
          a.angle -= iA * (rAx * iy - rAy * ix);
          if (polyA) {
            a.c = Math.cos(a.angle);
            a.s = Math.sin(a.angle);
          }
        }
        b.x += mB * ix;
        b.y += mB * iy;
        if (iB > 0) {
          b.angle += iB * (rBx * iy - rBy * ix);
          if (polyB) {
            b.c = Math.cos(b.angle);
            b.s = Math.sin(b.angle);
          }
        }
      }
    }
    return minSep >= -3 * slop;
  }

  /** Island sleeping: bodies connected by contacts or joints sleep together once all were slow for timeToSleep. */
  private updateSleep(h: number): void {
    if (!this.allowSleep) return;
    const bodies = this.bodies;
    const n = bodies.length;
    if (this.parent.length < n) {
      this.parent = new Int32Array(n * 2);
      this.minSleep = new Float64Array(n * 2);
    }
    const parent = this.parent;
    const minSleep = this.minSleep;
    const lin2 = this.sleepLinear * this.sleepLinear;
    const ang2 = this.sleepAngular * this.sleepAngular;
    for (let i = 0; i < n; i++) {
      parent[i] = i;
      minSleep[i] = Infinity;
      const b = bodies[i]!;
      if (b.type !== 'dynamic' || b.sleeping) continue;
      if (!b.allowSleep || b.av * b.av > ang2 || b.vx * b.vx + b.vy * b.vy > lin2) b.sleepTime = 0;
      else b.sleepTime += h;
    }
    const contacts = this.solverList;
    const nContacts = this.solverCount;
    const joints = this.jointList;
    const nJoints = this.jointCount;
    for (let i = 0; i < nContacts; i++) sleepUnion(parent, contacts[i]!.a, contacts[i]!.b);
    for (let i = 0; i < nJoints; i++) sleepUnion(parent, joints[i]!.a, joints[i]!.b);
    for (let i = 0; i < n; i++) {
      const b = bodies[i]!;
      if (b.type !== 'dynamic' || b.sleeping) continue;
      const r = sleepFind(parent, i);
      if (b.sleepTime < minSleep[r]!) minSleep[r] = b.sleepTime;
    }
    for (let i = 0; i < nContacts; i++) kinematicWake(parent, minSleep, contacts[i]!.a, contacts[i]!.b);
    for (let i = 0; i < nJoints; i++) kinematicWake(parent, minSleep, joints[i]!.a, joints[i]!.b);
    const limit = this.timeToSleep;
    for (let i = 0; i < n; i++) {
      const b = bodies[i]!;
      if (b.type !== 'dynamic' || b.sleeping) continue;
      if (minSleep[sleepFind(parent, i)]! >= limit) b.sleep();
    }
  }

  // ---------------------------------------------------------------- queries

  /** Bodies whose shape contains the point, in body order. */
  queryPoint(x: number, y: number, opts?: RigidQueryOptions): RigidBody[] {
    const out: RigidBody[] = [];
    const mask = opts?.mask ?? -1;
    const sensors = opts?.sensors ?? false;
    const ignore = opts?.ignore ?? null;
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      if ((b.category & mask) === 0 || (b.sensor && !sensors) || b === ignore) continue;
      if (b.containsPoint(x, y)) out.push(b);
    }
    return out;
  }

  /** Bodies whose AABB overlaps the rect (a superset of true shape overlaps), in body order. */
  queryAABB(r: Rect, opts?: RigidQueryOptions): RigidBody[] {
    const out: RigidBody[] = [];
    const mask = opts?.mask ?? -1;
    const sensors = opts?.sensors ?? false;
    const ignore = opts?.ignore ?? null;
    const x0 = r.x;
    const y0 = r.y;
    const x1 = r.x + r.w;
    const y1 = r.y + r.h;
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (!(b.minX <= x1 && b.maxX >= x0 && b.minY <= y1 && b.maxY >= y0)) continue;
      if ((b.category & mask) === 0 || (b.sensor && !sensors) || b === ignore) continue;
      out.push(b);
    }
    return out;
  }

  /** Closest hit along the segment (x0,y0)-(x1,y1). Shapes containing the start point are not hit. */
  raycast(x0: number, y0: number, x1: number, y1: number, opts?: RigidQueryOptions): RigidRayHit | null {
    const mask = opts?.mask ?? -1;
    const sensors = opts?.sensors ?? false;
    const ignore = opts?.ignore ?? null;
    const sx0 = Math.min(x0, x1);
    const sx1 = Math.max(x0, x1);
    const sy0 = Math.min(y0, y1);
    const sy1 = Math.max(y0, y1);
    const ray = this.ray;
    let best: RigidBody | null = null;
    let fraction = 1;
    let nx = 0;
    let ny = 0;
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (b.minX > sx1 || b.maxX < sx0 || b.minY > sy1 || b.maxY < sy0) continue;
      if ((b.category & mask) === 0 || (b.sensor && !sensors) || b === ignore) continue;
      ray.fraction = fraction;
      if (rigidRaycastBody(ray, b, x0, y0, x1, y1) && (!best || ray.fraction < fraction)) {
        best = b;
        fraction = ray.fraction;
        nx = ray.nx;
        ny = ray.ny;
      }
    }
    if (!best) return null;
    const dx = x1 - x0;
    const dy = y1 - y0;
    return { body: best, x: x0 + dx * fraction, y: y0 + dy * fraction, nx, ny, fraction, distance: fraction * Math.sqrt(dx * dx + dy * dy) };
  }

  // ---------------------------------------------------------------- debugging

  /** Text summary: counts on the first line, then one line per body and one per joint (up to maxBodies each). */
  dump(maxBodies = 60): string {
    let awake = 0;
    let sleeping = 0;
    let fixed = 0;
    for (const b of this.bodies) {
      if (b.type === 'static') fixed++;
      else if (b.sleeping) sleeping++;
      else awake++;
    }
    let touching = 0;
    for (const c of this.contacts) if (c.touching) touching++;
    const lines = [
      `RigidWorld t=${this.time.toFixed(2)}s steps=${this.steps} bodies=${this.bodies.length} awake=${awake} sleeping=${sleeping} static=${fixed} contacts=${this.contacts.length} touching=${touching} gravity=${this.gravityX},${this.gravityY}` +
        (this.joints.length ? ` joints=${this.joints.length}` : ''),
    ];
    for (const b of this.bodies.slice(0, maxBodies)) lines.push('  ' + b.describe());
    if (this.bodies.length > maxBodies) lines.push(`  ... ${this.bodies.length - maxBodies} more`);
    for (const j of this.joints.slice(0, maxBodies)) lines.push('  ' + j.describe());
    if (this.joints.length > maxBodies) lines.push(`  ... ${this.joints.length - maxBodies} more joints`);
    return lines.join('\n');
  }
}

function shouldCollide(a: RigidBody, b: RigidBody): boolean {
  if (a.sensor && b.sensor) return false;
  if (a.type !== 'dynamic' && b.type !== 'dynamic') {
    if (!a.sensor && !b.sensor) return false;
    if (a.type === 'static' && b.type === 'static') return false;
  }
  if (a.group !== 0 && a.group === b.group) return a.group > 0;
  return (a.category & b.mask) !== 0 && (b.category & a.mask) !== 0;
}

// Union-find over body slots for island sleeping (updateSleep).

function sleepFind(parent: Int32Array, i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]!]!;
    i = parent[i]!;
  }
  return i;
}

function sleepUnion(parent: Int32Array, a: RigidBody, b: RigidBody): void {
  if (a.type !== 'dynamic' || b.type !== 'dynamic') return;
  const ra = sleepFind(parent, a.slot);
  const rb = sleepFind(parent, b.slot);
  if (ra !== rb) parent[ra < rb ? rb : ra] = ra < rb ? ra : rb;
}

/** A moving kinematic keeps whatever it touches or is jointed to awake. */
function kinematicWake(parent: Int32Array, minSleep: Float64Array, a: RigidBody, b: RigidBody): void {
  const k = a.type === 'kinematic' ? a : b.type === 'kinematic' ? b : null;
  if (!k || !isActive(k)) return;
  const d = k === a ? b : a;
  if (d.type === 'dynamic') minSleep[sleepFind(parent, d.slot)] = 0;
}
