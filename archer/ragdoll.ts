import { BODY, BONES, J, JOINT_COUNT, type PlatformView, type Vec } from './types';

/**
 * Active Verlet ragdoll for the stick-man archers (pure, no rendering). Alive fighters are pulled toward a pose target
 * (standing upright, feet on the stand point, bow arm along aimAngle, string hand back by draw) by per-joint springs,
 * so hits and impulses make them flinch and wobble and then recover. Dead ones go limp, fall with gravity and collide
 * with platforms (rotated rectangles). World units, y down, fixed step.
 */

export const GRAVITY = 1400;

/** Bone index of the torso ([neck, pelvis]) and the neck bone ([head, neck]) in BONES. */
export const TORSO_BONE = BONES.findIndex(([a, b]) => a === J.neck && b === J.pelvis);
export const NECK_BONE = BONES.findIndex(([a, b]) => a === J.head && b === J.neck);

const ITERATIONS = 6;
const ARM = BODY.upperArm + BODY.foreArm;
const LEG = BODY.thigh + BODY.shin;

/** Spring frequency (Hz) per joint toward its pose target, indexed by J. */
const FREQ = [5, 6, 6, 5, 7, 5, 7, 6, 10, 6, 10];
const DAMPING_RATIO = 0.38;
const AIR_DRAG = 0.4;

interface Link {
  a: number;
  b: number;
  min: number;
  max: number;
}

export interface RagdollOptions {
  /** Stand point: where the feet meet the platform (world units). */
  x: number;
  y: number;
  facing: 1 | -1;
  scale?: number;
  aimAngle?: number;
  /** Ground slope under the feet: 0 = flat tower top, 1 = the 45 degree corner of a floating block. */
  slope?: number;
}

/** Result of a swept arrow test against a body. */
export interface BodyHit {
  /** Index into BONES (NECK_BONE for head hits). */
  bone: number;
  head: boolean;
  /** 0..1 along the swept segment. */
  param: number;
  x: number;
  y: number;
}

export class Ragdoll {
  readonly pos: Vec[] = [];
  readonly prev: Vec[] = [];
  readonly target: Vec[] = [];
  readonly scale: number;
  facing: 1 | -1;
  aimAngle: number;
  /** 0..1 how far the string is pulled back. */
  draw = 0;
  /** 0..1 pose strength: 1 = alive and upright, 0 = limp. */
  stiffness = 1;
  /** Feet pinned to the stand point. */
  grounded = true;
  readonly stand: Vec;
  slope: number;
  /** Balloons tied to the body. */
  balloons = 0;
  /** Balloons needed to lift the body off its stand. */
  liftAt = 2;
  /** 0..1 hit wobble: loosens the pose for a moment after an impulse. */
  hurt = 0;
  /** Seconds airborne since the last jump / lift. */
  airTime = 0;
  private readonly links: Link[] = [];
  private readonly radius: number[] = [];
  private readonly inv: number[] = [];
  private dt = 1 / 60;

  constructor(o: RagdollOptions) {
    this.scale = o.scale ?? 1;
    this.facing = o.facing;
    this.aimAngle = o.aimAngle ?? (o.facing === 1 ? 0 : Math.PI);
    this.stand = { x: o.x, y: o.y };
    this.slope = o.slope ?? 0;
    for (let i = 0; i < JOINT_COUNT; i++) {
      this.pos.push({ x: 0, y: 0 });
      this.prev.push({ x: 0, y: 0 });
      this.target.push({ x: 0, y: 0 });
      this.radius.push((i === J.head ? BODY.headR : BODY.limbW / 2) * this.scale);
      this.inv.push(1);
    }
    const s = this.scale;
    const bone = (a: number, b: number, len: number) => this.links.push({ a, b, min: len * s, max: len * s });
    const range = (a: number, b: number, min: number, max: number) => this.links.push({ a, b, min: min * s, max: max * s });
    for (const [a, b] of BONES) bone(a, b, restLength(a, b));
    range(J.head, J.pelvis, (BODY.neck + BODY.torso) * 0.92, BODY.neck + BODY.torso);
    range(J.pelvis, J.footF, LEG * 0.45, LEG);
    range(J.pelvis, J.footB, LEG * 0.45, LEG);
    range(J.neck, J.handF, ARM * 0.3, ARM);
    range(J.neck, J.footF, (BODY.torso + LEG) * 0.4, BODY.torso + LEG);
    range(J.neck, J.footB, (BODY.torso + LEG) * 0.4, BODY.torso + LEG);
    range(J.footF, J.footB, 8, LEG * 1.6);
    range(J.kneeF, J.kneeB, 6, LEG * 1.2);
    this.reset();
  }

  /** Snaps every joint onto the pose target, at rest. */
  reset(): void {
    this.computeTargets(false);
    for (let i = 0; i < JOINT_COUNT; i++) {
      this.pos[i]!.x = this.prev[i]!.x = this.target[i]!.x;
      this.pos[i]!.y = this.prev[i]!.y = this.target[i]!.y;
    }
    this.hurt = 0;
    this.airTime = 0;
  }

  /** Moves the stand point (e.g. a gliding block); grounded bodies follow rigidly. */
  moveStand(x: number, y: number): void {
    const dx = x - this.stand.x;
    const dy = y - this.stand.y;
    this.stand.x = x;
    this.stand.y = y;
    if (!this.grounded || (dx === 0 && dy === 0)) return;
    for (let i = 0; i < JOINT_COUNT; i++) {
      this.pos[i]!.x += dx;
      this.pos[i]!.y += dy;
      this.prev[i]!.x += dx;
      this.prev[i]!.y += dy;
    }
  }

  get alive(): boolean {
    return this.stiffness > 0;
  }

  /** Goes limp for good (death). */
  kill(): void {
    this.stiffness = 0;
    this.grounded = false;
  }

  /** Leaves the ground with an upward speed (units/s). */
  jump(speed: number): void {
    if (!this.grounded) return;
    this.grounded = false;
    this.airTime = 0;
    this.pushAll(0, -speed);
  }

  /** Adds velocity (units/s) to one joint. */
  push(joint: number, vx: number, vy: number): void {
    const p = this.prev[joint]!;
    p.x -= vx * this.dt;
    p.y -= vy * this.dt;
    this.hurt = Math.min(1, this.hurt + Math.hypot(vx, vy) / 900);
  }

  pushAll(vx: number, vy: number): void {
    for (const p of this.prev) {
      p.x -= vx * this.dt;
      p.y -= vy * this.dt;
    }
  }

  /** Arrow impulse on a bone: split between its two joints by `t` (0 = first joint). */
  pushBone(bone: number, t: number, vx: number, vy: number): void {
    const [a, b] = BONES[bone]!;
    this.push(a, vx * (1 - t), vy * (1 - t));
    this.push(b, vx * t, vy * t);
  }

  /** Radial impulse from (x, y): speed falls off linearly to 0 at radius. */
  blast(x: number, y: number, radius: number, speed: number): void {
    for (let i = 0; i < JOINT_COUNT; i++) {
      const p = this.pos[i]!;
      const dx = p.x - x;
      const dy = p.y - y;
      const d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      const k = (speed * (1 - d / radius)) / Math.max(d, 1);
      this.push(i, dx * k, dy * k - speed * 0.25 * (1 - d / radius));
    }
  }

  /** Centre of the torso. */
  chest(): Vec {
    const n = this.pos[J.neck]!;
    const p = this.pos[J.pelvis]!;
    return { x: (n.x + p.x) / 2, y: (n.y + p.y) / 2 };
  }

  /** Smallest joint y: the body fell out of the world when this is below the world bottom. */
  top(): number {
    let y = Infinity;
    for (const p of this.pos) y = Math.min(y, p.y);
    return y;
  }

  /** Largest joint y: the body floated out of the world when this is above the world top. */
  bottom(): number {
    let y = -Infinity;
    for (const p of this.pos) y = Math.max(y, p.y);
    return y;
  }

  /**
   * One fixed step. `lift` is the upward acceleration per balloon; platforms collide with every free joint.
   * Returns true when an airborne living body landed back on its stand this step.
   */
  step(dt: number, platforms: readonly PlatformView[], lift = 0): boolean {
    this.dt = dt;
    const s = this.stiffness * (1 - 0.65 * this.hurt);
    this.hurt = Math.max(0, this.hurt - dt * 2.2);
    const lifted = this.balloons >= this.liftAt;
    if (lifted && this.grounded) {
      this.grounded = false;
      this.airTime = 0;
    }
    if (!this.grounded) this.airTime += dt;
    this.computeTargets(!this.grounded);

    let mvx = 0;
    let mvy = 0;
    for (let i = 0; i < JOINT_COUNT; i++) {
      mvx += this.pos[i]!.x - this.prev[i]!.x;
      mvy += this.pos[i]!.y - this.prev[i]!.y;
    }
    mvx /= JOINT_COUNT;
    mvy /= JOINT_COUNT;
    const air = Math.exp(-AIR_DRAG * dt);
    const dt2 = dt * dt;
    let upAll = 0;
    let upHead = 0;
    if (this.balloons > 0 && lift > 0) {
      if (lifted) upAll = GRAVITY + lift * (this.balloons - this.liftAt + 1);
      else upHead = lift * this.balloons * 3;
    }
    for (let i = 0; i < JOINT_COUNT; i++) {
      const p = this.pos[i]!;
      const q = this.prev[i]!;
      let vx = p.x - q.x;
      let vy = p.y - q.y;
      let ax = 0;
      let ay = GRAVITY - upAll;
      if (i === J.head || i === J.neck) ay -= upHead;
      if (s > 0) {
        const w = 2 * Math.PI * FREQ[i]!;
        const t = this.target[i]!;
        ax += (t.x - p.x) * w * w * s;
        ay += (t.y - p.y) * w * w * s;
        const damp = Math.exp(-2 * DAMPING_RATIO * w * dt * s);
        vx = mvx * air + (vx - mvx) * damp;
        vy = mvy * air + (vy - mvy) * damp;
        if (this.grounded) ay -= GRAVITY * s;
      } else {
        vx *= air;
        vy *= air;
      }
      q.x = p.x;
      q.y = p.y;
      p.x += vx + ax * dt2;
      p.y += vy + ay * dt2;
    }

    const pinned = this.grounded;
    this.inv[J.footF] = this.inv[J.footB] = pinned ? 0 : 1;
    if (pinned) this.pinFeet();
    for (let it = 0; it < ITERATIONS; it++) {
      for (const l of this.links) this.solve(l);
      if (it % 2 === 1 || it === ITERATIONS - 1) this.collide(platforms);
    }
    if (pinned) this.pinFeet();

    if (!this.grounded && this.stiffness > 0 && !lifted && this.airTime > 0.1) {
      const f = this.pos[J.footF]!;
      const b = this.pos[J.footB]!;
      const falling = f.y - this.prev[J.footF]!.y > 0;
      const groundY = this.stand.y + this.footDrop();
      if (falling && Math.max(f.y, b.y) >= groundY - this.radius[J.footF]! - 3) {
        this.grounded = true;
        this.airTime = 0;
        this.computeTargets(false);
        this.pinFeet();
        return true;
      }
    }
    return false;
  }

  /** Swept test of the segment (x0, y0) -> (x1, y1) against the head circle and every bone capsule. */
  sweep(x0: number, y0: number, x1: number, y1: number): BodyHit | null {
    const s = this.scale;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    let best: BodyHit | null = null;
    const head = this.pos[J.head]!;
    const hp = segCircle(x0, y0, dx, dy, head.x, head.y, BODY.headR * s);
    if (hp !== null) best = { bone: NECK_BONE, head: true, param: hp, x: x0 + dx * hp, y: y0 + dy * hp };
    for (let i = 0; i < BONES.length; i++) {
      const [a, b] = BONES[i]!;
      const pa = this.pos[a]!;
      const pb = this.pos[b]!;
      const r = ((i === TORSO_BONE ? BODY.torsoW : BODY.limbW) / 2) * s;
      segSeg(x0, y0, x1, y1, pa.x, pa.y, pb.x, pb.y, closest);
      if (closest.d2 > r * r) continue;
      const back = len > 1e-6 ? Math.sqrt(r * r - closest.d2) / len : 0;
      const param = Math.max(0, closest.s - back);
      if (best && best.param <= param) continue;
      best = { bone: i, head: false, param, x: x0 + dx * param, y: y0 + dy * param };
    }
    return best;
  }

  /** Bone frame for attaching things: origin at the bone's first joint, unit axis along the bone. */
  boneFrame(bone: number): { ox: number; oy: number; ux: number; uy: number } {
    const [a, b] = BONES[bone]!;
    const pa = this.pos[a]!;
    const pb = this.pos[b]!;
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    return { ox: pa.x, oy: pa.y, ux: (pb.x - pa.x) / len, uy: (pb.y - pa.y) / len };
  }

  /** Parameter 0..1 of the point along a bone (for splitting impulses). */
  boneParam(bone: number, x: number, y: number): number {
    const [a, b] = BONES[bone]!;
    const pa = this.pos[a]!;
    const pb = this.pos[b]!;
    const ex = pb.x - pa.x;
    const ey = pb.y - pa.y;
    const l2 = ex * ex + ey * ey || 1;
    return Math.min(1, Math.max(0, ((x - pa.x) * ex + (y - pa.y) * ey) / l2));
  }

  /** Nearest distance from a point to any joint. */
  distanceTo(x: number, y: number): number {
    let d = Infinity;
    for (const p of this.pos) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
    return d;
  }

  // ---------------------------------------------------------------- internals

  private footDrop(): number {
    return this.slope * this.stanceHalf();
  }

  private stanceHalf(): number {
    return (this.slope > 0 ? 17 : 15) * this.scale;
  }

  private pinFeet(): void {
    for (const j of [J.footF, J.footB]) {
      const t = this.target[j]!;
      this.pos[j]!.x = this.prev[j]!.x = t.x;
      this.pos[j]!.y = this.prev[j]!.y = t.y;
    }
  }

  /** Writes the pose target into `target`. Airborne bodies keep the shape around their own centroid. */
  private computeTargets(floating: boolean): void {
    const s = this.scale;
    const f = this.facing;
    const T = this.target;
    const sx = this.stand.x;
    const sy = this.stand.y;
    const half = this.stanceHalf();
    const drop = this.footDrop();
    T[J.footF]!.x = sx + f * half;
    T[J.footF]!.y = sy + drop;
    T[J.footB]!.x = sx - f * half * 0.9;
    T[J.footB]!.y = sy + drop;
    const legReach = LEG * s * 0.97;
    const hipY = sy + drop - Math.sqrt(Math.max(1, legReach * legReach - half * half));
    const lean = Math.sin(this.aimAngle) * 5 * s;
    T[J.pelvis]!.x = sx - f * 2 * s;
    T[J.pelvis]!.y = hipY;
    T[J.neck]!.x = T[J.pelvis]!.x + lean * -f * 0.2;
    T[J.neck]!.y = hipY - BODY.torso * s;
    T[J.head]!.x = T[J.neck]!.x + f * 2 * s;
    T[J.head]!.y = T[J.neck]!.y - BODY.neck * s;
    ik(T[J.pelvis]!, T[J.footF]!, BODY.thigh * s, BODY.shin * s, f, 0, T[J.kneeF]!);
    ik(T[J.pelvis]!, T[J.footB]!, BODY.thigh * s, BODY.shin * s, f, 0, T[J.kneeB]!);

    const c = Math.cos(this.aimAngle);
    const sn = Math.sin(this.aimAngle);
    const n = T[J.neck]!;
    const reach = ARM * s * 0.96;
    const hand = T[J.handF]!;
    hand.x = n.x + c * reach;
    hand.y = n.y + sn * reach;
    const upX = f * sn;
    const upY = -f * c;
    ik(n, hand, BODY.upperArm * s, BODY.foreArm * s, -upX, -upY, T[J.elbowF]!);
    const pull = reach * 0.92 * (1 - this.draw) + 2 * s * this.draw;
    const hb = T[J.handB]!;
    hb.x = n.x + c * pull + upX * 4 * s * this.draw;
    hb.y = n.y + sn * pull + upY * 4 * s * this.draw;
    ik(n, hb, BODY.upperArm * s, BODY.foreArm * s, upX * 0.4 - c, upY * 0.4 - sn, T[J.elbowB]!);

    if (floating) {
      let dx = 0;
      let dy = 0;
      for (let i = 0; i < JOINT_COUNT; i++) {
        dx += this.pos[i]!.x - T[i]!.x;
        dy += this.pos[i]!.y - T[i]!.y;
      }
      dx /= JOINT_COUNT;
      dy /= JOINT_COUNT;
      for (const t of T) {
        t.x += dx;
        t.y += dy;
      }
    }
  }

  private solve(l: Link): void {
    const pa = this.pos[l.a]!;
    const pb = this.pos[l.b]!;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const d = Math.hypot(dx, dy);
    let goal: number;
    if (d < l.min) goal = l.min;
    else if (d > l.max) goal = l.max;
    else return;
    const wa = this.inv[l.a]!;
    const wb = this.inv[l.b]!;
    const w = wa + wb;
    if (w === 0) return;
    let nx: number;
    let ny: number;
    if (d > 1e-6) {
      nx = dx / d;
      ny = dy / d;
    } else {
      nx = 0;
      ny = -1;
    }
    const diff = d - goal;
    pa.x += nx * diff * (wa / w);
    pa.y += ny * diff * (wa / w);
    pb.x -= nx * diff * (wb / w);
    pb.y -= ny * diff * (wb / w);
  }

  private collide(platforms: readonly PlatformView[]): void {
    for (let i = 0; i < JOINT_COUNT; i++) {
      if (this.inv[i] === 0) continue;
      const p = this.pos[i]!;
      const q = this.prev[i]!;
      const r = this.radius[i]!;
      for (const pl of platforms) {
        const c = Math.cos(pl.angle);
        const sn = Math.sin(pl.angle);
        const rx = p.x - pl.x;
        const ry = p.y - pl.y;
        let lx = rx * c + ry * sn;
        let ly = -rx * sn + ry * c;
        const hx = pl.w / 2 + r;
        const hy = pl.h / 2 + r;
        if (lx <= -hx || lx >= hx || ly <= -hy || ly >= hy) continue;
        const qx = q.x - pl.x;
        const qy = q.y - pl.y;
        let qlx = qx * c + qy * sn;
        let qly = -qx * sn + qy * c;
        const px = hx - Math.abs(lx);
        const py = hy - Math.abs(ly);
        if (px < py) {
          lx = lx >= 0 ? hx : -hx;
          const vt = ly - qly;
          qly = ly - vt * 0.55;
          qlx = lx;
        } else {
          ly = ly >= 0 ? hy : -hy;
          const vt = lx - qlx;
          qlx = lx - vt * 0.55;
          qly = ly;
        }
        p.x = pl.x + lx * c - ly * sn;
        p.y = pl.y + lx * sn + ly * c;
        q.x = pl.x + qlx * c - qly * sn;
        q.y = pl.y + qlx * sn + qly * c;
      }
    }
  }
}

function restLength(a: number, b: number): number {
  const key = (x: number, y: number) => (a === x && b === y) || (a === y && b === x);
  if (key(J.head, J.neck)) return BODY.neck;
  if (key(J.neck, J.pelvis)) return BODY.torso;
  if (key(J.neck, J.elbowF) || key(J.neck, J.elbowB)) return BODY.upperArm;
  if (key(J.elbowF, J.handF) || key(J.elbowB, J.handB)) return BODY.foreArm;
  if (key(J.pelvis, J.kneeF) || key(J.pelvis, J.kneeB)) return BODY.thigh;
  return BODY.shin;
}

/** Two-bone IK: elbow/knee position for root -> end with bone lengths a, b, bending toward (bx, by). */
function ik(root: Vec, end: Vec, a: number, b: number, bx: number, by: number, out: Vec): void {
  const dx = end.x - root.x;
  const dy = end.y - root.y;
  const d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx);
  const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
  const off = Math.acos(cosA);
  const x1 = Math.cos(base + off);
  const y1 = Math.sin(base + off);
  const x2 = Math.cos(base - off);
  const y2 = Math.sin(base - off);
  const pick = x1 * bx + y1 * by >= x2 * bx + y2 * by;
  out.x = root.x + a * (pick ? x1 : x2);
  out.y = root.y + a * (pick ? y1 : y2);
}

const closest = { s: 0, t: 0, d2: 0 };

/** Closest points of segments p1-q1 and p2-q2 (Ericson, RTCD 5.1.9). */
export function segSeg(
  p1x: number,
  p1y: number,
  q1x: number,
  q1y: number,
  p2x: number,
  p2y: number,
  q2x: number,
  q2y: number,
  out: { s: number; t: number; d2: number },
): void {
  const d1x = q1x - p1x;
  const d1y = q1y - p1y;
  const d2x = q2x - p2x;
  const d2y = q2y - p2y;
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s = 0;
  let t = 0;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) {
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const cx = p1x + d1x * s - (p2x + d2x * t);
  const cy = p1y + d1y * s - (p2y + d2y * t);
  out.s = s;
  out.t = t;
  out.d2 = cx * cx + cy * cy;
}

/** First parameter in [0, 1] where p + d * t enters the circle, or null. Starting inside counts as 0. */
export function segCircle(px: number, py: number, dx: number, dy: number, cx: number, cy: number, r: number): number | null {
  const fx = px - cx;
  const fy = py - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** First parameter in [0, 1] where the segment enters the rotated rectangle, or null (Liang-Barsky). */
export function segRect(x0: number, y0: number, x1: number, y1: number, pl: PlatformView): number | null {
  const c = Math.cos(pl.angle);
  const s = Math.sin(pl.angle);
  const ax = x0 - pl.x;
  const ay = y0 - pl.y;
  const bx = x1 - pl.x;
  const by = y1 - pl.y;
  const lx0 = ax * c + ay * s;
  const ly0 = -ax * s + ay * c;
  const lx1 = bx * c + by * s;
  const ly1 = -bx * s + by * c;
  const dx = lx1 - lx0;
  const dy = ly1 - ly0;
  const hx = pl.w / 2;
  const hy = pl.h / 2;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, lx0 + hx) || !clip(dx, hx - lx0) || !clip(-dy, ly0 + hy) || !clip(dy, hy - ly0)) return null;
  return t0 <= t1 ? t0 : null;
}

/** World point -> platform-local coordinates. */
export function toPlatform(pl: PlatformView, x: number, y: number): Vec {
  const c = Math.cos(pl.angle);
  const s = Math.sin(pl.angle);
  const dx = x - pl.x;
  const dy = y - pl.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** Platform-local point -> world coordinates. */
export function fromPlatform(pl: PlatformView, lx: number, ly: number): Vec {
  const c = Math.cos(pl.angle);
  const s = Math.sin(pl.angle);
  return { x: pl.x + lx * c - ly * s, y: pl.y + lx * s + ly * c };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
