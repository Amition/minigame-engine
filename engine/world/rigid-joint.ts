import type { Vec2 } from '../core/math';
import type { RigidBody } from './rigid-body';
import type { RigidWorld } from './rigid-world';

export type RigidJointType = 'distance' | 'revolute' | 'weld' | 'mouse';

/** Options every joint type accepts. */
export interface RigidJointCommonOptions {
  /** Shown in dumps. */
  name?: string;
  /** Let the two jointed bodies collide with each other. Default false. */
  collideConnected?: boolean;
  /** Breaks (removed at the end of the step, 'jointBreak' event) when the reaction force exceeds this. Default Infinity. */
  breakForce?: number;
  /** Same for the reaction torque (revolute: motor + limits + spring, weld: angular part). Default Infinity. */
  breakTorque?: number;
  userData?: unknown;
}

/**
 * Keeps two anchor points at a distance: a rigid rod by default, a rope with `minLength: 0`, a spring with `springHz`.
 * Missing bounds default to `length` when rigid; with a spring they default to 0 / Infinity (spring only).
 */
export interface RigidDistanceJointOptions extends RigidJointCommonOptions {
  type: 'distance';
  a: RigidBody;
  b: RigidBody;
  /** Body-local anchor points (relative to the centre of mass). Default 0, 0. */
  anchorA?: Vec2;
  anchorB?: Vec2;
  /** Rest length. Default: the current distance between the anchors. */
  length?: number;
  minLength?: number;
  maxLength?: number;
  /** Spring frequency toward `length` (0 / undefined = rigid). */
  springHz?: number;
  /** Default 1 (critical) when springHz is set. */
  dampingRatio?: number;
}

/**
 * Pin joint: both bodies share one point and rotate freely around it, optionally with angle limits, a motor and an
 * angular spring toward `targetAngle` (an 'active ragdoll' joint that holds a pose and flinches when hit).
 * Angles are angle(b) - angle(a) - referenceAngle, radians, positive = clockwise on screen.
 */
export interface RigidRevoluteJointOptions extends RigidJointCommonOptions {
  type: 'revolute';
  a: RigidBody;
  b: RigidBody;
  /** World pivot point. Default: b's position. Ignored when anchorA / anchorB are given. */
  anchor?: Vec2;
  /** Body-local pivots; a missing one is taken from the other's world position. */
  anchorA?: Vec2;
  anchorB?: Vec2;
  /** angle(b) - angle(a) that counts as 0. Default: the difference at creation. */
  referenceAngle?: number;
  /** Limits (either one enables them; the missing side is unlimited). */
  lowerAngle?: number;
  upperAngle?: number;
  /** Motor target speed in rad/s (b relative to a); runs when maxMotorTorque > 0. */
  motorSpeed?: number;
  maxMotorTorque?: number;
  /** Spring rest angle. Default 0. */
  targetAngle?: number;
  /** Angular spring frequency (0 / undefined = no spring); stiffness scales with the two bodies' inertia. */
  springHz?: number;
  /** Default 1 (critical). */
  dampingRatio?: number;
}

/** Glues two bodies together at their current relative pose; `springHz` makes the angular part soft. */
export interface RigidWeldJointOptions extends RigidJointCommonOptions {
  type: 'weld';
  a: RigidBody;
  b: RigidBody;
  /** World point where the bodies are glued. Default: b's position. */
  anchor?: Vec2;
  referenceAngle?: number;
  /** Angular softness (0 / undefined = rigid). */
  springHz?: number;
  dampingRatio?: number;
}

/** Pulls a point of `body` toward `target` with a soft, force-limited spring (drag objects with the pointer). */
export interface RigidMouseJointOptions extends RigidJointCommonOptions {
  type: 'mouse';
  body: RigidBody;
  target: Vec2;
  /** World grab point on the body. Default: target. */
  anchor?: Vec2;
  /** Default 30000 * body mass (about 19 g at gravity 1600). */
  maxForce?: number;
  /** Default 5. */
  springHz?: number;
  /** Default 0.7. */
  dampingRatio?: number;
}

export type RigidJointOptions =
  | RigidDistanceJointOptions
  | RigidRevoluteJointOptions
  | RigidWeldJointOptions
  | RigidMouseJointOptions;

/** Tolerances the world hands to the position pass (internal). */
export interface RigidJointSolverSettings {
  slop: number;
  maxCorrection: number;
}

const ANGULAR_SLOP = (2 / 180) * Math.PI;
const MAX_ANGULAR_CORRECTION = (8 / 180) * Math.PI;

/** Soft constraint coefficients (Box2D v3 b2MakeSoft) for frequency hz, damping ratio zeta and step h. */
interface Soft {
  biasRate: number;
  massScale: number;
  impulseScale: number;
}

function makeSoft(out: Soft, hz: number, zeta: number, h: number): void {
  if (!(hz > 0)) {
    out.biasRate = 0;
    out.massScale = 1;
    out.impulseScale = 0;
    return;
  }
  const omega = 2 * Math.PI * hz;
  const a1 = 2 * zeta + h * omega;
  const a2 = h * omega * a1;
  const a3 = 1 / (1 + a2);
  out.biasRate = omega / a1;
  out.massScale = a2 * a3;
  out.impulseScale = a3;
}

const newSoft = (): Soft => ({ biasRate: 0, massScale: 1, impulseScale: 0 });

/** Velocity impulse (px, py) at rA / rB plus angular impulse `ang`: a gets minus, b gets plus. */
function applyVelocity(a: RigidBody, b: RigidBody, px: number, py: number, rAx: number, rAy: number, rBx: number, rBy: number, ang: number): void {
  a.vx -= a.invMass * px;
  a.vy -= a.invMass * py;
  a.av -= a.invInertia * (rAx * py - rAy * px + ang);
  b.vx += b.invMass * px;
  b.vy += b.invMass * py;
  b.av += b.invInertia * (rBx * py - rBy * px + ang);
}

/** Position impulse, same convention; refreshes cos/sin of rotated bodies. */
function applyPosition(a: RigidBody, b: RigidBody, px: number, py: number, rAx: number, rAy: number, rBx: number, rBy: number, ang: number): void {
  a.x -= a.invMass * px;
  a.y -= a.invMass * py;
  if (a.invInertia > 0) {
    a.angle -= a.invInertia * (rAx * py - rAy * px + ang);
    a.c = Math.cos(a.angle);
    a.s = Math.sin(a.angle);
  }
  b.x += b.invMass * px;
  b.y += b.invMass * py;
  if (b.invInertia > 0) {
    b.angle += b.invInertia * (rBx * py - rBy * px + ang);
    b.c = Math.cos(b.angle);
    b.s = Math.sin(b.angle);
  }
}

/** World point of a body-local point, optionally blended from the previous step's pose (alpha < 1). */
function bodyPoint(b: RigidBody, lx: number, ly: number, alpha: number): Vec2 {
  const x = alpha >= 1 ? b.x : b.prevX + (b.x - b.prevX) * alpha;
  const y = alpha >= 1 ? b.y : b.prevY + (b.y - b.prevY) * alpha;
  const a = alpha >= 1 ? b.angle : b.prevAngle + (b.angle - b.prevAngle) * alpha;
  const c = alpha >= 1 ? b.c : Math.cos(a);
  const s = alpha >= 1 ? b.s : Math.sin(a);
  return { x: x + c * lx - s * ly, y: y + s * lx + c * ly };
}

/** Math.sqrt is correctly rounded on every engine; Math.hypot is implementation-defined (breaks cross-engine replays). */
export function pointDistance(p: Vec2, q: Vec2): number {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** World point -> body-local point (current pose). */
function toLocal(b: RigidBody, x: number, y: number): Vec2 {
  const dx = x - b.x;
  const dy = y - b.y;
  return { x: b.c * dx + b.s * dy, y: -b.s * dx + b.c * dy };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const deg = (v: number) => Math.round((v * 1800) / Math.PI) / 10;
const bodyRef = (b: RigidBody) => (b.name ? '#' + b.name : 'id' + b.id);

/**
 * Base of all joints. Create with `world.addJoint({ type, ... })`; remove with `world.removeJoint(j)` (removing
 * either body removes it too). Solver methods are internal and driven by the world.
 */
export abstract class RigidJoint {
  abstract readonly type: RigidJointType;
  readonly a: RigidBody;
  readonly b: RigidBody;
  /** Assigned by the world when the joint joins (add order). 0 = not added yet. */
  id = 0;
  name: string;
  readonly collideConnected: boolean;
  breakForce: number;
  breakTorque: number;
  userData: unknown;
  /** Set when the reaction exceeded breakForce / breakTorque; the joint then leaves the world at the end of the step. */
  broken = false;
  world: RigidWorld | null = null;
  /** 1 / substep of the last prepare (reaction force = impulse * invH). */
  protected invH = 0;

  constructor(a: RigidBody, b: RigidBody, opts: RigidJointCommonOptions) {
    this.a = a;
    this.b = b;
    this.name = opts.name ?? '';
    this.collideConnected = opts.collideConnected ?? false;
    this.breakForce = opts.breakForce ?? Infinity;
    this.breakTorque = opts.breakTorque ?? Infinity;
    this.userData = opts.userData ?? null;
  }

  /** The body on the other side. */
  other(body: RigidBody): RigidBody {
    return body === this.a ? this.b : this.a;
  }

  /** Wakes both bodies. */
  wake(): void {
    this.a.wake();
    this.b.wake();
  }

  /** Anchor on body a in world space (alpha < 1 blends from the previous step, for interpolated drawing). */
  abstract anchorWorldA(alpha?: number): Vec2;
  abstract anchorWorldB(alpha?: number): Vec2;

  /** Magnitude of the linear reaction force of the last solved (sub)step, in force units (mass·units/s²). */
  abstract reactionForce(): number;

  /** Reaction torque of the last solved (sub)step (0 for joints without an angular part). */
  reactionTorque(): number {
    return 0;
  }

  /** One-line summary for dumps. */
  describe(): string {
    let s = `joint ${this.type}${this.name ? ' #' + this.name : ''} ${bodyRef(this.a)}-${bodyRef(this.b)}`;
    s += this.describeExtra();
    s += ` F=${Math.round(this.reactionForce())}`;
    if (this.broken) s += ' broken';
    return s;
  }

  protected abstract describeExtra(): string;

  /** Internal: computes solver data for a substep of h seconds and applies the warm-start impulses. */
  abstract prepare(h: number, warm: boolean): void;
  /** Internal: one velocity iteration. */
  abstract solveVelocity(): void;
  /** Internal: one position iteration; returns true when the error is within tolerance. */
  abstract solvePosition(s: RigidJointSolverSettings): boolean;
}

// ---------------------------------------------------------------- distance

export class RigidDistanceJoint extends RigidJoint {
  readonly type = 'distance';
  /** Body-local anchors (read only; set at creation). */
  readonly localAnchorA: Vec2;
  readonly localAnchorB: Vec2;
  length: number;
  minLength: number;
  maxLength: number;
  springHz: number;
  dampingRatio: number;
  private impulse = 0;
  private lowerImpulse = 0;
  private upperImpulse = 0;
  private ux = 0;
  private uy = 0;
  private rAx = 0;
  private rAy = 0;
  private rBx = 0;
  private rBy = 0;
  private current = 0;
  private mass = 0;
  /** Rigid mode: radial speed that keeps the length after a straight-line step (no energy lost to curvature). */
  private bias = 0;
  private readonly soft = newSoft();

  constructor(opts: RigidDistanceJointOptions) {
    super(opts.a, opts.b, opts);
    this.localAnchorA = { x: opts.anchorA?.x ?? 0, y: opts.anchorA?.y ?? 0 };
    this.localAnchorB = { x: opts.anchorB?.x ?? 0, y: opts.anchorB?.y ?? 0 };
    const pa = this.anchorWorldA();
    const pb = this.anchorWorldB();
    const length = Math.max(0, opts.length ?? pointDistance(pa, pb));
    this.springHz = opts.springHz ?? 0;
    this.dampingRatio = opts.dampingRatio ?? 1;
    const spring = this.springHz > 0;
    this.minLength = Math.max(0, opts.minLength ?? (spring ? 0 : length));
    this.maxLength = Math.max(this.minLength, opts.maxLength ?? (spring ? Infinity : length));
    this.length = Math.min(this.maxLength, Math.max(this.minLength, length));
  }

  /** Current distance between the anchors. */
  currentLength(): number {
    const pa = this.anchorWorldA();
    const pb = this.anchorWorldB();
    return pointDistance(pa, pb);
  }

  /** Changes the rest length and bounds (rope reel, spring target); wakes the bodies. */
  setLength(length: number, minLength = this.springHz > 0 ? this.minLength : length, maxLength = this.springHz > 0 ? this.maxLength : length): this {
    this.minLength = Math.max(0, minLength);
    this.maxLength = Math.max(this.minLength, maxLength);
    this.length = Math.min(this.maxLength, Math.max(this.minLength, length));
    this.wake();
    return this;
  }

  anchorWorldA(alpha = 1): Vec2 {
    return bodyPoint(this.a, this.localAnchorA.x, this.localAnchorA.y, alpha);
  }

  anchorWorldB(alpha = 1): Vec2 {
    return bodyPoint(this.b, this.localAnchorB.x, this.localAnchorB.y, alpha);
  }

  reactionForce(): number {
    return Math.abs(this.impulse + this.lowerImpulse - this.upperImpulse) * this.invH;
  }

  protected describeExtra(): string {
    let s = ` len=${r1(this.current || this.currentLength())}`;
    if (this.minLength === this.maxLength) s += ` rod=${r1(this.length)}`;
    else s += ` range=${r1(this.minLength)}..${this.maxLength === Infinity ? 'inf' : r1(this.maxLength)}`;
    if (this.springHz > 0) s += ` spring=${r1(this.springHz)}Hz rest=${r1(this.length)}`;
    return s;
  }

  prepare(h: number, warm: boolean): void {
    const a = this.a;
    const b = this.b;
    this.invH = 1 / h;
    const la = this.localAnchorA;
    const lb = this.localAnchorB;
    const rAx = (this.rAx = a.c * la.x - a.s * la.y);
    const rAy = (this.rAy = a.s * la.x + a.c * la.y);
    const rBx = (this.rBx = b.c * lb.x - b.s * lb.y);
    const rBy = (this.rBy = b.s * lb.x + b.c * lb.y);
    const dx = b.x + rBx - a.x - rAx;
    const dy = b.y + rBy - a.y - rAy;
    const len = Math.sqrt(dx * dx + dy * dy);
    this.current = len;
    if (len > 1e-6) {
      this.ux = dx / len;
      this.uy = dy / len;
    } else {
      this.ux = this.uy = 0;
    }
    const crA = rAx * this.uy - rAy * this.ux;
    const crB = rBx * this.uy - rBy * this.ux;
    const k = a.invMass + a.invInertia * crA * crA + b.invMass + b.invInertia * crB * crB;
    this.mass = k > 0 ? 1 / k : 0;
    const ranged = this.minLength < this.maxLength;
    if (ranged && this.springHz > 0) makeSoft(this.soft, this.springHz, this.dampingRatio, h);
    else if (ranged) this.impulse = 0;
    this.bias = 0;
    if (!ranged) {
      this.lowerImpulse = this.upperImpulse = 0;
      const L = this.length;
      if (len > 1e-6 && L > 0) {
        const dvx = b.vx - b.av * rBy - a.vx + a.av * rAy;
        const dvy = b.vy + b.av * rBx - a.vy - a.av * rAx;
        const vt = dvy * this.ux - dvx * this.uy;
        const q = L * L - h * h * vt * vt;
        if (q > 0) this.bias = (Math.sqrt(q) - L) / h;
      }
    }
    if (this.mass === 0 || !warm) {
      this.impulse = this.lowerImpulse = this.upperImpulse = 0;
      return;
    }
    const p = this.impulse + this.lowerImpulse - this.upperImpulse;
    if (p !== 0) applyVelocity(a, b, p * this.ux, p * this.uy, rAx, rAy, rBx, rBy, 0);
  }

  /** Relative speed of the anchors along the axis (b away from a). */
  private axisSpeed(): number {
    const a = this.a;
    const b = this.b;
    const dvx = b.vx - b.av * this.rBy - a.vx + a.av * this.rAy;
    const dvy = b.vy + b.av * this.rBx - a.vy - a.av * this.rAx;
    return dvx * this.ux + dvy * this.uy;
  }

  private push(impulse: number): void {
    applyVelocity(this.a, this.b, impulse * this.ux, impulse * this.uy, this.rAx, this.rAy, this.rBx, this.rBy, 0);
  }

  solveVelocity(): void {
    if (this.mass === 0) return;
    if (this.minLength < this.maxLength) {
      if (this.springHz > 0) {
        const sf = this.soft;
        const C = this.current - this.length;
        const imp = -sf.massScale * this.mass * (this.axisSpeed() + sf.biasRate * C) - sf.impulseScale * this.impulse;
        this.impulse += imp;
        this.push(imp);
      }
      if (this.minLength > 0) {
        const C = this.current - this.minLength;
        const imp = -this.mass * (this.axisSpeed() + Math.max(0, C) * this.invH);
        const next = Math.max(0, this.lowerImpulse + imp);
        const d = next - this.lowerImpulse;
        this.lowerImpulse = next;
        if (d !== 0) this.push(d);
      }
      if (this.maxLength < Infinity) {
        const C = this.maxLength - this.current;
        const imp = -this.mass * (-this.axisSpeed() + Math.max(0, C) * this.invH);
        const next = Math.max(0, this.upperImpulse + imp);
        const d = next - this.upperImpulse;
        this.upperImpulse = next;
        if (d !== 0) this.push(-d);
      }
    } else {
      const imp = -this.mass * (this.axisSpeed() - this.bias);
      this.impulse += imp;
      this.push(imp);
    }
  }

  solvePosition(s: RigidJointSolverSettings): boolean {
    const a = this.a;
    const b = this.b;
    const la = this.localAnchorA;
    const lb = this.localAnchorB;
    const cA = Math.cos(a.angle);
    const sA = Math.sin(a.angle);
    const cB = Math.cos(b.angle);
    const sB = Math.sin(b.angle);
    const rAx = cA * la.x - sA * la.y;
    const rAy = sA * la.x + cA * la.y;
    const rBx = cB * lb.x - sB * lb.y;
    const rBy = sB * lb.x + cB * lb.y;
    const dx = b.x + rBx - a.x - rAx;
    const dy = b.y + rBy - a.y - rAy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return true;
    let C: number;
    if (this.minLength === this.maxLength || len < this.minLength) C = len - this.minLength;
    else if (len > this.maxLength) C = len - this.maxLength;
    else return true;
    const ux = dx / len;
    const uy = dy / len;
    const crA = rAx * uy - rAy * ux;
    const crB = rBx * uy - rBy * ux;
    const k = a.invMass + a.invInertia * crA * crA + b.invMass + b.invInertia * crB * crB;
    if (k <= 0) return true;
    const clamped = Math.max(-s.maxCorrection, Math.min(s.maxCorrection, C));
    const imp = -clamped / k;
    applyPosition(a, b, imp * ux, imp * uy, rAx, rAy, rBx, rBy, 0);
    return Math.abs(C) <= s.slop;
  }
}

// ---------------------------------------------------------------- revolute

export class RigidRevoluteJoint extends RigidJoint {
  readonly type = 'revolute';
  readonly localAnchorA: Vec2;
  readonly localAnchorB: Vec2;
  readonly referenceAngle: number;
  lowerAngle: number;
  upperAngle: number;
  motorSpeed: number;
  maxMotorTorque: number;
  targetAngle: number;
  springHz: number;
  dampingRatio: number;
  private ix = 0;
  private iy = 0;
  private motorImpulse = 0;
  private lowerImpulse = 0;
  private upperImpulse = 0;
  private springImpulse = 0;
  private rAx = 0;
  private rAy = 0;
  private rBx = 0;
  private rBy = 0;
  private k11 = 0;
  private k12 = 0;
  private k22 = 0;
  private axialMass = 0;
  private angle0 = 0;
  private readonly soft = newSoft();

  constructor(opts: RigidRevoluteJointOptions) {
    super(opts.a, opts.b, opts);
    const { a, b } = opts;
    if (opts.anchorA || opts.anchorB) {
      const wa = opts.anchorA ? bodyPoint(a, opts.anchorA.x, opts.anchorA.y, 1) : null;
      const wb = opts.anchorB ? bodyPoint(b, opts.anchorB.x, opts.anchorB.y, 1) : null;
      this.localAnchorA = opts.anchorA ? { x: opts.anchorA.x, y: opts.anchorA.y } : toLocal(a, wb!.x, wb!.y);
      this.localAnchorB = opts.anchorB ? { x: opts.anchorB.x, y: opts.anchorB.y } : toLocal(b, wa!.x, wa!.y);
    } else {
      const p = opts.anchor ?? { x: b.x, y: b.y };
      this.localAnchorA = toLocal(a, p.x, p.y);
      this.localAnchorB = toLocal(b, p.x, p.y);
    }
    this.referenceAngle = opts.referenceAngle ?? b.angle - a.angle;
    this.lowerAngle = opts.lowerAngle ?? -Infinity;
    this.upperAngle = Math.max(this.lowerAngle, opts.upperAngle ?? Infinity);
    this.motorSpeed = opts.motorSpeed ?? 0;
    this.maxMotorTorque = opts.maxMotorTorque ?? 0;
    this.targetAngle = opts.targetAngle ?? 0;
    this.springHz = opts.springHz ?? 0;
    this.dampingRatio = opts.dampingRatio ?? 1;
  }

  /** angle(b) - angle(a) - referenceAngle (radians, not wrapped). */
  angle(): number {
    return this.b.angle - this.a.angle - this.referenceAngle;
  }

  /** Relative angular velocity (b - a), rad/s. */
  speed(): number {
    return this.b.av - this.a.av;
  }

  get limitsEnabled(): boolean {
    return this.lowerAngle > -Infinity || this.upperAngle < Infinity;
  }

  /** Motor toward `speed` rad/s with at most `maxTorque` (0 turns it off). Wakes the bodies. */
  setMotor(speed: number, maxTorque: number = this.maxMotorTorque): this {
    this.motorSpeed = speed;
    this.maxMotorTorque = Math.max(0, maxTorque);
    this.wake();
    return this;
  }

  /** Angle limits relative to the reference angle; pass -Infinity / Infinity to free a side. */
  setLimits(lower: number, upper: number): this {
    this.lowerAngle = Math.min(lower, upper);
    this.upperAngle = Math.max(lower, upper);
    this.wake();
    return this;
  }

  /** Spring rest angle (relative to the reference angle). */
  setTarget(angle: number): this {
    this.targetAngle = angle;
    this.wake();
    return this;
  }

  /** Angular spring frequency (0 = off) and damping ratio. */
  setSpring(hz: number, dampingRatio: number = this.dampingRatio): this {
    this.springHz = Math.max(0, hz);
    this.dampingRatio = dampingRatio;
    this.wake();
    return this;
  }

  /** Torque the motor applied in the last solved (sub)step. */
  motorTorque(): number {
    return this.motorImpulse * this.invH;
  }

  anchorWorldA(alpha = 1): Vec2 {
    return bodyPoint(this.a, this.localAnchorA.x, this.localAnchorA.y, alpha);
  }

  anchorWorldB(alpha = 1): Vec2 {
    return bodyPoint(this.b, this.localAnchorB.x, this.localAnchorB.y, alpha);
  }

  reactionForce(): number {
    return Math.sqrt(this.ix * this.ix + this.iy * this.iy) * this.invH;
  }

  override reactionTorque(): number {
    return (this.motorImpulse + this.lowerImpulse - this.upperImpulse + this.springImpulse) * this.invH;
  }

  protected describeExtra(): string {
    const p = this.anchorWorldB();
    let s = ` @${r1(p.x)},${r1(p.y)} angle=${deg(this.angle())}°`;
    if (this.limitsEnabled) s += ` limits=${this.lowerAngle === -Infinity ? '-inf' : deg(this.lowerAngle)}..${this.upperAngle === Infinity ? 'inf' : deg(this.upperAngle)}`;
    if (this.maxMotorTorque > 0) s += ` motor=${r1(this.motorSpeed)}/${Math.round(this.maxMotorTorque)}`;
    if (this.springHz > 0) s += ` spring=${r1(this.springHz)}Hz target=${deg(this.targetAngle)}°`;
    return s;
  }

  prepare(h: number, warm: boolean): void {
    const a = this.a;
    const b = this.b;
    this.invH = 1 / h;
    const la = this.localAnchorA;
    const lb = this.localAnchorB;
    const rAx = (this.rAx = a.c * la.x - a.s * la.y);
    const rAy = (this.rAy = a.s * la.x + a.c * la.y);
    const rBx = (this.rBx = b.c * lb.x - b.s * lb.y);
    const rBy = (this.rBy = b.s * lb.x + b.c * lb.y);
    const mA = a.invMass;
    const mB = b.invMass;
    const iA = a.invInertia;
    const iB = b.invInertia;
    this.k11 = mA + mB + rAy * rAy * iA + rBy * rBy * iB;
    this.k12 = -rAy * rAx * iA - rBy * rBx * iB;
    this.k22 = mA + mB + rAx * rAx * iA + rBx * rBx * iB;
    const fixedRotation = iA + iB === 0;
    this.axialMass = fixedRotation ? 0 : 1 / (iA + iB);
    this.angle0 = this.angle();
    if (!this.limitsEnabled || fixedRotation) this.lowerImpulse = this.upperImpulse = 0;
    if (!(this.maxMotorTorque > 0) || fixedRotation) this.motorImpulse = 0;
    if (this.springHz > 0 && !fixedRotation) makeSoft(this.soft, this.springHz, this.dampingRatio, h);
    else this.springImpulse = 0;
    if (!warm) {
      this.ix = this.iy = this.motorImpulse = this.lowerImpulse = this.upperImpulse = this.springImpulse = 0;
      return;
    }
    const axial = this.springImpulse + this.motorImpulse + this.lowerImpulse - this.upperImpulse;
    applyVelocity(a, b, this.ix, this.iy, rAx, rAy, rBx, rBy, axial);
  }

  solveVelocity(): void {
    const a = this.a;
    const b = this.b;
    const iA = a.invInertia;
    const iB = b.invInertia;
    if (this.axialMass > 0) {
      if (this.springHz > 0) {
        const sf = this.soft;
        const C = this.angle0 - this.targetAngle;
        const imp = -sf.massScale * this.axialMass * (b.av - a.av + sf.biasRate * C) - sf.impulseScale * this.springImpulse;
        this.springImpulse += imp;
        a.av -= iA * imp;
        b.av += iB * imp;
      }
      if (this.maxMotorTorque > 0) {
        const imp = -this.axialMass * (b.av - a.av - this.motorSpeed);
        const max = this.maxMotorTorque / this.invH;
        const next = Math.max(-max, Math.min(max, this.motorImpulse + imp));
        const d = next - this.motorImpulse;
        this.motorImpulse = next;
        a.av -= iA * d;
        b.av += iB * d;
      }
      if (this.lowerAngle > -Infinity) {
        const C = this.angle0 - this.lowerAngle;
        const imp = -this.axialMass * (b.av - a.av + Math.max(C, 0) * this.invH);
        const next = Math.max(this.lowerImpulse + imp, 0);
        const d = next - this.lowerImpulse;
        this.lowerImpulse = next;
        a.av -= iA * d;
        b.av += iB * d;
      }
      if (this.upperAngle < Infinity) {
        const C = this.upperAngle - this.angle0;
        const imp = -this.axialMass * (a.av - b.av + Math.max(C, 0) * this.invH);
        const next = Math.max(this.upperImpulse + imp, 0);
        const d = next - this.upperImpulse;
        this.upperImpulse = next;
        a.av += iA * d;
        b.av -= iB * d;
      }
    }
    const cx = b.vx - b.av * this.rBy - a.vx + a.av * this.rAy;
    const cy = b.vy + b.av * this.rBx - a.vy - a.av * this.rAx;
    const det = this.k11 * this.k22 - this.k12 * this.k12;
    if (det === 0) return;
    const inv = 1 / det;
    const px = -inv * (this.k22 * cx - this.k12 * cy);
    const py = -inv * (this.k11 * cy - this.k12 * cx);
    this.ix += px;
    this.iy += py;
    applyVelocity(a, b, px, py, this.rAx, this.rAy, this.rBx, this.rBy, 0);
  }

  solvePosition(s: RigidJointSolverSettings): boolean {
    const a = this.a;
    const b = this.b;
    const iA = a.invInertia;
    const iB = b.invInertia;
    let angularError = 0;
    if (this.limitsEnabled && iA + iB > 0) {
      const angle = this.angle();
      let C = 0;
      if (this.upperAngle - this.lowerAngle < 2 * ANGULAR_SLOP) {
        C = Math.max(-MAX_ANGULAR_CORRECTION, Math.min(MAX_ANGULAR_CORRECTION, angle - this.lowerAngle));
      } else if (angle <= this.lowerAngle) {
        C = Math.max(-MAX_ANGULAR_CORRECTION, Math.min(0, angle - this.lowerAngle + ANGULAR_SLOP));
      } else if (angle >= this.upperAngle) {
        C = Math.max(0, Math.min(MAX_ANGULAR_CORRECTION, angle - this.upperAngle - ANGULAR_SLOP));
      }
      if (C !== 0) {
        const imp = -C / (iA + iB);
        applyPosition(a, b, 0, 0, 0, 0, 0, 0, imp);
        angularError = Math.abs(C);
      }
    }
    const la = this.localAnchorA;
    const lb = this.localAnchorB;
    const cA = Math.cos(a.angle);
    const sA = Math.sin(a.angle);
    const cB = Math.cos(b.angle);
    const sB = Math.sin(b.angle);
    const rAx = cA * la.x - sA * la.y;
    const rAy = sA * la.x + cA * la.y;
    const rBx = cB * lb.x - sB * lb.y;
    const rBy = sB * lb.x + cB * lb.y;
    const cx = b.x + rBx - a.x - rAx;
    const cy = b.y + rBy - a.y - rAy;
    const positionError = Math.sqrt(cx * cx + cy * cy);
    const mA = a.invMass;
    const mB = b.invMass;
    const k11 = mA + mB + rAy * rAy * iA + rBy * rBy * iB;
    const k12 = -rAy * rAx * iA - rBy * rBx * iB;
    const k22 = mA + mB + rAx * rAx * iA + rBx * rBx * iB;
    const det = k11 * k22 - k12 * k12;
    if (det !== 0) {
      const inv = 1 / det;
      const px = -inv * (k22 * cx - k12 * cy);
      const py = -inv * (k11 * cy - k12 * cx);
      applyPosition(a, b, px, py, rAx, rAy, rBx, rBy, 0);
    }
    return positionError <= s.slop && angularError <= ANGULAR_SLOP;
  }
}

// ---------------------------------------------------------------- weld

export class RigidWeldJoint extends RigidJoint {
  readonly type = 'weld';
  readonly localAnchorA: Vec2;
  readonly localAnchorB: Vec2;
  readonly referenceAngle: number;
  springHz: number;
  dampingRatio: number;
  private ix = 0;
  private iy = 0;
  private iz = 0;
  private rAx = 0;
  private rAy = 0;
  private rBx = 0;
  private rBy = 0;
  /** Inverse of the linear 2x2 block (soft) or of the whole symmetric 3x3 (rigid). */
  private m11 = 0;
  private m12 = 0;
  private m13 = 0;
  private m22 = 0;
  private m23 = 0;
  private m33 = 0;
  private axialMass = 0;
  private angle0 = 0;
  private softAngular = false;
  private readonly soft = newSoft();

  constructor(opts: RigidWeldJointOptions) {
    super(opts.a, opts.b, opts);
    const p = opts.anchor ?? { x: opts.b.x, y: opts.b.y };
    this.localAnchorA = toLocal(opts.a, p.x, p.y);
    this.localAnchorB = toLocal(opts.b, p.x, p.y);
    this.referenceAngle = opts.referenceAngle ?? opts.b.angle - opts.a.angle;
    this.springHz = opts.springHz ?? 0;
    this.dampingRatio = opts.dampingRatio ?? 1;
  }

  /** angle(b) - angle(a) - referenceAngle. */
  angle(): number {
    return this.b.angle - this.a.angle - this.referenceAngle;
  }

  anchorWorldA(alpha = 1): Vec2 {
    return bodyPoint(this.a, this.localAnchorA.x, this.localAnchorA.y, alpha);
  }

  anchorWorldB(alpha = 1): Vec2 {
    return bodyPoint(this.b, this.localAnchorB.x, this.localAnchorB.y, alpha);
  }

  reactionForce(): number {
    return Math.sqrt(this.ix * this.ix + this.iy * this.iy) * this.invH;
  }

  override reactionTorque(): number {
    return this.iz * this.invH;
  }

  protected describeExtra(): string {
    const p = this.anchorWorldB();
    return ` @${r1(p.x)},${r1(p.y)} angle=${deg(this.angle())}°${this.springHz > 0 ? ` spring=${r1(this.springHz)}Hz` : ''}`;
  }

  prepare(h: number, warm: boolean): void {
    const a = this.a;
    const b = this.b;
    this.invH = 1 / h;
    const la = this.localAnchorA;
    const lb = this.localAnchorB;
    const rAx = (this.rAx = a.c * la.x - a.s * la.y);
    const rAy = (this.rAy = a.s * la.x + a.c * la.y);
    const rBx = (this.rBx = b.c * lb.x - b.s * lb.y);
    const rBy = (this.rBy = b.s * lb.x + b.c * lb.y);
    const mA = a.invMass;
    const mB = b.invMass;
    const iA = a.invInertia;
    const iB = b.invInertia;
    const a11 = mA + mB + rAy * rAy * iA + rBy * rBy * iB;
    const a12 = -rAy * rAx * iA - rBy * rBx * iB;
    const a13 = -rAy * iA - rBy * iB;
    const a22 = mA + mB + rAx * rAx * iA + rBx * rBx * iB;
    const a23 = rAx * iA + rBx * iB;
    const a33 = iA + iB;
    this.softAngular = this.springHz > 0 && a33 > 0;
    if (this.softAngular || a33 === 0) {
      const det = a11 * a22 - a12 * a12;
      const inv = det !== 0 ? 1 / det : 0;
      this.m11 = inv * a22;
      this.m12 = -inv * a12;
      this.m22 = inv * a11;
      this.m13 = this.m23 = this.m33 = 0;
      this.axialMass = a33 > 0 ? 1 / a33 : 0;
      if (this.softAngular) {
        makeSoft(this.soft, this.springHz, this.dampingRatio, h);
        this.angle0 = this.angle();
      } else this.iz = 0;
    } else {
      const det = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
      const inv = det !== 0 ? 1 / det : 0;
      this.m11 = inv * (a22 * a33 - a23 * a23);
      this.m12 = inv * (a13 * a23 - a12 * a33);
      this.m13 = inv * (a12 * a23 - a13 * a22);
      this.m22 = inv * (a11 * a33 - a13 * a13);
      this.m23 = inv * (a13 * a12 - a11 * a23);
      this.m33 = inv * (a11 * a22 - a12 * a12);
    }
    if (!warm) {
      this.ix = this.iy = this.iz = 0;
      return;
    }
    applyVelocity(a, b, this.ix, this.iy, rAx, rAy, rBx, rBy, this.iz);
  }

  solveVelocity(): void {
    const a = this.a;
    const b = this.b;
    if (this.softAngular) {
      const sf = this.soft;
      const imp = -sf.massScale * this.axialMass * (b.av - a.av + sf.biasRate * this.angle0) - sf.impulseScale * this.iz;
      this.iz += imp;
      a.av -= a.invInertia * imp;
      b.av += b.invInertia * imp;
    }
    const cx = b.vx - b.av * this.rBy - a.vx + a.av * this.rAy;
    const cy = b.vy + b.av * this.rBx - a.vy - a.av * this.rAx;
    if (this.softAngular || this.m33 === 0) {
      const px = -(this.m11 * cx + this.m12 * cy);
      const py = -(this.m12 * cx + this.m22 * cy);
      this.ix += px;
      this.iy += py;
      applyVelocity(a, b, px, py, this.rAx, this.rAy, this.rBx, this.rBy, 0);
      return;
    }
    const cz = b.av - a.av;
    const px = -(this.m11 * cx + this.m12 * cy + this.m13 * cz);
    const py = -(this.m12 * cx + this.m22 * cy + this.m23 * cz);
    const pz = -(this.m13 * cx + this.m23 * cy + this.m33 * cz);
    this.ix += px;
    this.iy += py;
    this.iz += pz;
    applyVelocity(a, b, px, py, this.rAx, this.rAy, this.rBx, this.rBy, pz);
  }

  solvePosition(s: RigidJointSolverSettings): boolean {
    const a = this.a;
    const b = this.b;
    const la = this.localAnchorA;
    const lb = this.localAnchorB;
    const cA = Math.cos(a.angle);
    const sA = Math.sin(a.angle);
    const cB = Math.cos(b.angle);
    const sB = Math.sin(b.angle);
    const rAx = cA * la.x - sA * la.y;
    const rAy = sA * la.x + cA * la.y;
    const rBx = cB * lb.x - sB * lb.y;
    const rBy = sB * lb.x + cB * lb.y;
    const mA = a.invMass;
    const mB = b.invMass;
    const iA = a.invInertia;
    const iB = b.invInertia;
    const a11 = mA + mB + rAy * rAy * iA + rBy * rBy * iB;
    const a12 = -rAy * rAx * iA - rBy * rBx * iB;
    const a13 = -rAy * iA - rBy * iB;
    const a22 = mA + mB + rAx * rAx * iA + rBx * rBx * iB;
    const a23 = rAx * iA + rBx * iB;
    const a33 = iA + iB;
    const c1x = b.x + rBx - a.x - rAx;
    const c1y = b.y + rBy - a.y - rAy;
    const positionError = Math.sqrt(c1x * c1x + c1y * c1y);
    let angularError = 0;
    let px: number;
    let py: number;
    let pz = 0;
    if (this.softAngular || a33 === 0) {
      const det = a11 * a22 - a12 * a12;
      const inv = det !== 0 ? 1 / det : 0;
      px = -inv * (a22 * c1x - a12 * c1y);
      py = -inv * (a11 * c1y - a12 * c1x);
    } else {
      const c2 = this.angle();
      angularError = Math.abs(c2);
      // Cramer's rule on the symmetric 3x3 (Box2D b2Mat33::Solve33).
      const det = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
      const inv = det !== 0 ? 1 / det : 0;
      px = -inv * (c1x * (a22 * a33 - a23 * a23) - a12 * (c1y * a33 - a23 * c2) + a13 * (c1y * a23 - a22 * c2));
      py = -inv * (a11 * (c1y * a33 - a23 * c2) - c1x * (a12 * a33 - a23 * a13) + a13 * (a12 * c2 - c1y * a13));
      pz = -inv * (a11 * (a22 * c2 - c1y * a23) - a12 * (a12 * c2 - c1y * a13) + c1x * (a12 * a23 - a22 * a13));
    }
    applyPosition(a, b, px, py, rAx, rAy, rBx, rBy, pz);
    return positionError <= s.slop && angularError <= ANGULAR_SLOP;
  }
}

// ---------------------------------------------------------------- mouse

/** Soft spring from a point of the body to a target; `a` and `b` are both the dragged body. */
export class RigidMouseJoint extends RigidJoint {
  readonly type = 'mouse';
  /** Grab point in body-local coordinates. */
  readonly localAnchor: Vec2;
  targetX: number;
  targetY: number;
  maxForce: number;
  springHz: number;
  dampingRatio: number;
  private ix = 0;
  private iy = 0;
  private rx = 0;
  private ry = 0;
  private m11 = 0;
  private m12 = 0;
  private m22 = 0;
  private gamma = 0;
  private cx = 0;
  private cy = 0;

  constructor(opts: RigidMouseJointOptions) {
    super(opts.body, opts.body, opts);
    const p = opts.anchor ?? opts.target;
    this.localAnchor = toLocal(opts.body, p.x, p.y);
    this.targetX = opts.target.x;
    this.targetY = opts.target.y;
    this.maxForce = opts.maxForce ?? 30000 * opts.body.mass;
    this.springHz = opts.springHz ?? 5;
    this.dampingRatio = opts.dampingRatio ?? 0.7;
  }

  get body(): RigidBody {
    return this.b;
  }

  /** Moves the target (e.g. to the pointer) and wakes the body. */
  setTarget(x: number, y: number): this {
    if (x !== this.targetX || y !== this.targetY) {
      this.targetX = x;
      this.targetY = y;
      this.b.wake();
    }
    return this;
  }

  /** The target point. */
  anchorWorldA(): Vec2 {
    return { x: this.targetX, y: this.targetY };
  }

  /** The grab point on the body. */
  anchorWorldB(alpha = 1): Vec2 {
    return bodyPoint(this.b, this.localAnchor.x, this.localAnchor.y, alpha);
  }

  reactionForce(): number {
    return Math.sqrt(this.ix * this.ix + this.iy * this.iy) * this.invH;
  }

  protected describeExtra(): string {
    return ` target=${r1(this.targetX)},${r1(this.targetY)}`;
  }

  prepare(h: number, warm: boolean): void {
    const b = this.b;
    this.invH = 1 / h;
    const mass = b.mass;
    const omega = 2 * Math.PI * this.springHz;
    const d = 2 * mass * this.dampingRatio * omega;
    const k = mass * omega * omega;
    const g = h * (d + h * k);
    this.gamma = g > 0 ? 1 / g : 0;
    const beta = h * k * this.gamma;
    const rx = (this.rx = b.c * this.localAnchor.x - b.s * this.localAnchor.y);
    const ry = (this.ry = b.s * this.localAnchor.x + b.c * this.localAnchor.y);
    const mB = b.invMass;
    const iB = b.invInertia;
    const k11 = mB + iB * ry * ry + this.gamma;
    const k12 = -iB * rx * ry;
    const k22 = mB + iB * rx * rx + this.gamma;
    const det = k11 * k22 - k12 * k12;
    const inv = det !== 0 ? 1 / det : 0;
    this.m11 = inv * k22;
    this.m12 = -inv * k12;
    this.m22 = inv * k11;
    this.cx = (b.x + rx - this.targetX) * beta;
    this.cy = (b.y + ry - this.targetY) * beta;
    b.av *= Math.pow(0.98, h * 60);
    if (!warm) {
      this.ix = this.iy = 0;
      return;
    }
    b.vx += mB * this.ix;
    b.vy += mB * this.iy;
    b.av += iB * (rx * this.iy - ry * this.ix);
  }

  solveVelocity(): void {
    const b = this.b;
    const rx = this.rx;
    const ry = this.ry;
    const vx = b.vx - b.av * ry + this.cx + this.gamma * this.ix;
    const vy = b.vy + b.av * rx + this.cy + this.gamma * this.iy;
    let px = -(this.m11 * vx + this.m12 * vy);
    let py = -(this.m12 * vx + this.m22 * vy);
    const oldX = this.ix;
    const oldY = this.iy;
    this.ix += px;
    this.iy += py;
    const max = this.maxForce / this.invH;
    const len2 = this.ix * this.ix + this.iy * this.iy;
    if (len2 > max * max) {
      const k = max / Math.sqrt(len2);
      this.ix *= k;
      this.iy *= k;
    }
    px = this.ix - oldX;
    py = this.iy - oldY;
    b.vx += b.invMass * px;
    b.vy += b.invMass * py;
    b.av += b.invInertia * (rx * py - ry * px);
  }

  solvePosition(): boolean {
    return true;
  }
}

/** Builds the joint object for world.addJoint (internal). */
export function createRigidJoint(opts: RigidJointOptions): RigidJoint {
  switch (opts.type) {
    case 'distance':
      return new RigidDistanceJoint(opts);
    case 'revolute':
      return new RigidRevoluteJoint(opts);
    case 'weld':
      return new RigidWeldJoint(opts);
    case 'mouse':
      return new RigidMouseJoint(opts);
  }
}
