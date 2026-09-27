import type { Vec2 } from '../core/math';
import type { RigidBody } from './rigid-body';
import type { RigidRevoluteJoint } from './rigid-joint';
import { rigidCircle, rigidPolygon, rigidBox, type RigidShape } from './rigid-shapes';
import type { RigidWorld } from './rigid-world';

// ---------------------------------------------------------------- ragdoll

export type RigidRagdollPart =
  | 'head'
  | 'torso'
  | 'upperArmF'
  | 'foreArmF'
  | 'upperArmB'
  | 'foreArmB'
  | 'thighF'
  | 'shinF'
  | 'thighB'
  | 'shinB';

export type RigidRagdollJointName = 'neck' | 'shoulderF' | 'elbowF' | 'shoulderB' | 'elbowB' | 'hipF' | 'kneeF' | 'hipB' | 'kneeB';

/** 'stand': walking stance, arms slightly bent; 'limp': arms and legs hanging almost straight. */
export type RigidRagdollPose = 'stand' | 'limp';

export interface RigidRagdollOptions {
  /** Hip joint (pelvis) in world space. Standing, the soles are 86 * scale below it and the head top 85 * scale above. */
  x: number;
  y: number;
  /** 1 = about 171 units tall. Default 1. */
  scale?: number;
  /** 1 = faces +x (knees bend toward +x), -1 = mirrored. Default 1. */
  facing?: 1 | -1;
  /** Spawn pose, also the pose the springs hold. Default 'stand'. */
  pose?: RigidRagdollPose;
  /** 0 = limp ragdoll, 1 = holds the pose with revolute springs (active ragdoll), > 1 stiffer. Default 0. */
  stiffness?: number;
  /** Spring damping ratio. Default 1. */
  dampingRatio?: number;
  /** Friction torque in every joint as a fraction of weight * height (damps flailing, helps sleeping). Default 0.001. */
  jointFriction?: number;
  /** Tilt of the whole body around the hip, radians. Default 0. */
  angle?: number;
  /** Initial velocity of every part. */
  vx?: number;
  vy?: number;
  /** Default: the world's default density (0.001). */
  density?: number;
  /** Default 0.6. */
  friction?: number;
  restitution?: number;
  category?: number;
  mask?: number;
  /** Collision group of all parts; default: a fresh negative group, so parts never collide with each other. */
  group?: number;
  /** Joints break above this reaction force (dismemberment). Default Infinity. */
  breakForce?: number;
  /** Body names become `<name>.head`, ...; default just `head`, ... */
  name?: string;
  /** userData of every part (default null). */
  userData?: unknown;
}

export interface RigidRagdoll {
  readonly parts: Record<RigidRagdollPart, RigidBody>;
  /** Joints by name. */
  readonly joint: Record<RigidRagdollJointName, RigidRevoluteJoint>;
  /** neck, shoulderF, elbowF, shoulderB, elbowB, hipF, kneeF, hipB, kneeB. */
  readonly joints: RigidRevoluteJoint[];
  /** Parts in draw order: back limbs, torso, head, front limbs. */
  readonly bodies: RigidBody[];
  readonly group: number;
  readonly scale: number;
  readonly facing: 1 | -1;
  readonly stiffness: number;
  /** 0 = limp, 1 = holds the pose; wakes the ragdoll. */
  setStiffness(k: number): void;
  /** Changes the pose the springs pull toward. */
  setPose(pose: RigidRagdollPose): void;
  /** Impulse at a world point on the part containing it (else the part with the nearest centre); returns that part. */
  impulse(x: number, y: number, ix: number, iy: number): RigidBody;
  /** Which part a body is, or null. */
  partOf(body: RigidBody): RigidRagdollPart | null;
  centerOfMass(): Vec2;
  /** Removes all parts (their joints go with them). */
  remove(): void;
}

interface PartDef {
  name: RigidRagdollPart;
  /** Joint connecting it to its parent (none for the torso). */
  joint: RigidRagdollJointName | null;
}

interface JointDef {
  name: RigidRagdollJointName;
  parent: RigidRagdollPart;
  child: RigidRagdollPart;
  /** Pivot in the neutral skeleton (hip at 0,0, facing +x, scale 1). */
  px: number;
  py: number;
  /** Limits for facing +1 (mirrored for -1). */
  lower: number;
  upper: number;
  /** Spring stiffness at stiffness 1, as a fraction of weight * height per radian. */
  load: number;
}

const HEIGHT = 171;

// Creation order = draw order (back limbs behind the torso, front limbs over it).
const PARTS: PartDef[] = [
  { name: 'upperArmB', joint: 'shoulderB' },
  { name: 'foreArmB', joint: 'elbowB' },
  { name: 'thighB', joint: 'hipB' },
  { name: 'shinB', joint: 'kneeB' },
  { name: 'torso', joint: null },
  { name: 'head', joint: 'neck' },
  { name: 'thighF', joint: 'hipF' },
  { name: 'shinF', joint: 'kneeF' },
  { name: 'upperArmF', joint: 'shoulderF' },
  { name: 'foreArmF', joint: 'elbowF' },
];

const JOINTS: JointDef[] = [
  { name: 'neck', parent: 'torso', child: 'head', px: 0, py: -58, lower: -0.45, upper: 0.55, load: 0.06 },
  { name: 'shoulderF', parent: 'torso', child: 'upperArmF', px: 0, py: -52, lower: -3.0, upper: 0.9, load: 0.1 },
  { name: 'elbowF', parent: 'upperArmF', child: 'foreArmF', px: 0, py: -24, lower: -2.6, upper: 0.02, load: 0.05 },
  { name: 'shoulderB', parent: 'torso', child: 'upperArmB', px: 0, py: -52, lower: -3.0, upper: 0.9, load: 0.1 },
  { name: 'elbowB', parent: 'upperArmB', child: 'foreArmB', px: 0, py: -24, lower: -2.6, upper: 0.02, load: 0.05 },
  { name: 'hipF', parent: 'torso', child: 'thighF', px: 0, py: 0, lower: -2.2, upper: 0.5, load: 0.35 },
  { name: 'kneeF', parent: 'thighF', child: 'shinF', px: 0, py: 40, lower: -0.02, upper: 2.5, load: 0.35 },
  { name: 'hipB', parent: 'torso', child: 'thighB', px: 0, py: 0, lower: -2.2, upper: 0.5, load: 0.35 },
  { name: 'kneeB', parent: 'thighB', child: 'shinB', px: 0, py: 40, lower: -0.02, upper: 2.5, load: 0.35 },
];

/** Relative joint angles for facing +1 (positive = the child turns clockwise on screen). */
const POSES: Record<RigidRagdollPose, Record<RigidRagdollJointName, number>> = {
  stand: { neck: 0, shoulderF: -0.35, elbowF: -0.6, shoulderB: 0.3, elbowB: -0.4, hipF: -0.22, kneeF: 0.12, hipB: 0.2, kneeB: 0.02 },
  limp: { neck: 0, shoulderF: -0.1, elbowF: -0.15, shoulderB: 0.1, elbowB: -0.1, hipF: -0.05, kneeF: 0.05, hipB: 0.05, kneeB: 0.05 },
};

/** Octagon with chamfered corners, centred: a cheap capsule. */
function capsulePoints(w: number, h: number, cx: number, cy: number): number[] {
  const c = Math.min(w, h) * 0.35;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return [x0, y0 + c, x0 + c, y0, x1 - c, y0, x1, y0 + c, x1, y1 - c, x1 - c, y1, x0 + c, y1, x0, y1 - c];
}

/** Neutral skeleton outlines (hip at 0,0, facing +x, scale 1); circles are [cx, cy, r]. */
const OUTLINES: Record<RigidRagdollPart, number[]> = {
  head: [0, -71, 13],
  torso: capsulePoints(28, 66, 0, -28),
  upperArmF: capsulePoints(10, 38, 0, -38),
  upperArmB: capsulePoints(10, 38, 0, -38),
  foreArmF: capsulePoints(9, 37, 0, -10),
  foreArmB: capsulePoints(9, 37, 0, -10),
  thighF: capsulePoints(13, 53, 0, 20),
  thighB: capsulePoints(13, 53, 0, 20),
  // Shin with a small forward foot at the sole (convex "boot").
  shinF: [-5.5, 36.5, -3.5, 34, 3.5, 34, 5.5, 36.5, 9.5, 83, 8, 86, -6.5, 86, -7, 83],
  shinB: [-5.5, 36.5, -3.5, 34, 3.5, 34, 5.5, 36.5, 9.5, 83, 8, 86, -6.5, 86, -7, 83],
};

const lastGroup = new WeakMap<RigidWorld, number>();

function freshGroup(world: RigidWorld): number {
  let g = lastGroup.get(world) ?? 0;
  for (const b of world.bodies) if (b.group < g) g = b.group;
  g -= 1;
  lastGroup.set(world, g);
  return g;
}

/**
 * Builds a 10-part human ragdoll (head circle, capsule torso and limbs, boot-shaped shins) joined by 9 revolute
 * joints with human limits (knees and elbows bend one way, neck limited). Parts never collide with each other
 * (shared negative `group`). `stiffness` 1 makes an active ragdoll whose angular springs hold the pose and recover
 * after hits; 0 is a classic limp ragdoll.
 *
 *     const guy = createRigidRagdoll(world, { x: 200, y: 600, stiffness: 1 });
 *     guy.impulse(hitX, hitY, 400 * guy.parts.torso.mass, 0);
 *     guy.setStiffness(0);                           // knocked out
 */
export function createRigidRagdoll(world: RigidWorld, opts: RigidRagdollOptions): RigidRagdoll {
  const scale = opts.scale ?? 1;
  const facing = opts.facing ?? 1;
  const tilt = opts.angle ?? 0;
  const group = opts.group ?? freshGroup(world);
  const prefix = opts.name ? opts.name + '.' : '';
  let pose: RigidRagdollPose = opts.pose ?? 'stand';
  let stiffness = Math.max(0, opts.stiffness ?? 0);
  const ratio = opts.dampingRatio ?? 1;
  const rel = (name: RigidRagdollJointName, p: RigidRagdollPose) => POSES[p][name] * facing;

  // Neutral centres and shapes (scaled, mirrored).
  const shapes = {} as Record<RigidRagdollPart, RigidShape>;
  const centres = {} as Record<RigidRagdollPart, Vec2>;
  for (const p of PARTS) {
    const o = OUTLINES[p.name];
    if (p.name === 'head') {
      shapes.head = rigidCircle(o[2]! * scale);
      centres.head = { x: o[0]! * scale * facing, y: o[1]! * scale };
      continue;
    }
    const pts: number[] = [];
    for (let i = 0; i < o.length; i += 2) pts.push(o[i]! * scale * facing, o[i + 1]! * scale);
    const shape = rigidPolygon(pts);
    shapes[p.name] = shape;
    centres[p.name] = { x: shape.centroidX, y: shape.centroidY };
  }

  // Forward kinematics of the pose: angle and centre of every part in world space.
  const angles = {} as Record<RigidRagdollPart, number>;
  const pos = {} as Record<RigidRagdollPart, Vec2>;
  const pivots = {} as Record<RigidRagdollJointName, Vec2>;
  const rot = (ang: number, x: number, y: number): Vec2 => ({ x: Math.cos(ang) * x - Math.sin(ang) * y, y: Math.sin(ang) * x + Math.cos(ang) * y });
  angles.torso = tilt;
  const t = rot(tilt, centres.torso.x, centres.torso.y);
  pos.torso = { x: opts.x + t.x, y: opts.y + t.y };
  for (const j of JOINTS) {
    const pc = centres[j.parent];
    const pa = angles[j.parent];
    const pp = pos[j.parent];
    const qx = j.px * scale * facing;
    const qy = j.py * scale;
    const d = rot(pa, qx - pc.x, qy - pc.y);
    const pivot = { x: pp.x + d.x, y: pp.y + d.y };
    pivots[j.name] = pivot;
    const ca = pa + rel(j.name, pose);
    const cc = centres[j.child];
    const e = rot(ca, cc.x - qx, cc.y - qy);
    angles[j.child] = ca;
    pos[j.child] = { x: pivot.x + e.x, y: pivot.y + e.y };
  }

  const parts = {} as Record<RigidRagdollPart, RigidBody>;
  const bodies: RigidBody[] = [];
  for (const p of PARTS) {
    const b = world.add({
      name: prefix + p.name,
      shape: shapes[p.name],
      x: pos[p.name].x,
      y: pos[p.name].y,
      angle: angles[p.name],
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      ...(opts.density !== undefined ? { density: opts.density } : {}),
      friction: opts.friction ?? 0.6,
      restitution: opts.restitution ?? 0,
      category: opts.category ?? 1,
      mask: opts.mask ?? -1,
      group,
      userData: opts.userData ?? null,
    });
    parts[p.name] = b;
    bodies.push(b);
  }

  let totalMass = 0;
  for (const b of bodies) totalMass += b.mass;
  const g = Math.hypot(world.gravityX, world.gravityY) || 1600;
  const weightHeight = totalMass * g * HEIGHT * scale;
  const friction = (opts.jointFriction ?? 0.001) * weightHeight;

  const joint = {} as Record<RigidRagdollJointName, RigidRevoluteJoint>;
  const joints: RigidRevoluteJoint[] = [];
  for (const j of JOINTS) {
    const lower = facing > 0 ? j.lower : -j.upper;
    const upper = facing > 0 ? j.upper : -j.lower;
    const rj = world.addJoint({
      type: 'revolute',
      name: prefix + j.name,
      a: parts[j.parent],
      b: parts[j.child],
      anchor: pivots[j.name],
      referenceAngle: 0,
      lowerAngle: lower,
      upperAngle: upper,
      targetAngle: rel(j.name, pose),
      motorSpeed: 0,
      maxMotorTorque: friction,
      dampingRatio: ratio,
      ...(opts.breakForce !== undefined ? { breakForce: opts.breakForce } : {}),
    });
    joint[j.name] = rj;
    joints.push(rj);
  }

  const springHz = (rj: RigidRevoluteJoint, def: JointDef, k: number): number => {
    if (!(k > 0)) return 0;
    const inv = rj.a.invInertia + rj.b.invInertia;
    if (!(inv > 0)) return 0;
    // Stiffness (torque per radian) = k * load * weight * height; hz from stiffness = inertia * omega².
    const omega = Math.sqrt(k * def.load * weightHeight * inv);
    return Math.min(30, omega / (2 * Math.PI));
  };
  const applyStiffness = () => {
    JOINTS.forEach((def, i) => joints[i]!.setSpring(springHz(joints[i]!, def, stiffness), ratio));
  };
  applyStiffness();

  const partNames = new Map<RigidBody, RigidRagdollPart>();
  for (const p of PARTS) partNames.set(parts[p.name], p.name);

  return {
    parts,
    joint,
    joints,
    bodies,
    group,
    scale,
    facing,
    get stiffness() {
      return stiffness;
    },
    setStiffness(k: number) {
      stiffness = Math.max(0, k);
      applyStiffness();
    },
    setPose(p: RigidRagdollPose) {
      pose = p;
      for (const j of JOINTS) joint[j.name].setTarget(rel(j.name, p));
    },
    impulse(x: number, y: number, ix: number, iy: number): RigidBody {
      let best = bodies.find((b) => b.containsPoint(x, y));
      if (!best) {
        let bestD = Infinity;
        for (const b of bodies) {
          const d = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
      }
      best!.applyImpulse(ix, iy, x, y);
      return best!;
    },
    partOf(body: RigidBody) {
      return partNames.get(body) ?? null;
    },
    centerOfMass(): Vec2 {
      let x = 0;
      let y = 0;
      for (const b of bodies) {
        x += b.x * b.mass;
        y += b.y * b.mass;
      }
      return { x: x / totalMass, y: y / totalMass };
    },
    remove() {
      for (const b of bodies) b.world?.remove(b);
    },
  };
}

// ---------------------------------------------------------------- chain

/** A world point (pinned to a hidden static body) or a point on a body (body-local anchor, default its centre). */
export type RigidChainEnd = Vec2 | { body: RigidBody; anchor?: Vec2 };

export interface RigidChainOptions {
  from: RigidChainEnd;
  /** Other end; without it the chain hangs straight down from `from`. */
  to?: RigidChainEnd;
  links: number;
  /**
   * Length of each link. Default: span / links when `to` is given (taut), else 20. Longer than span / links makes a
   * sagging chain (laid out on a parabola); shorter is raised to span / links.
   */
  linkLength?: number;
  /** Thickness of each link. Default 8. */
  linkWidth?: number;
  density?: number;
  /** Default 0.6. */
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  category?: number;
  mask?: number;
  /** Negative = links never collide with each other (non-adjacent links collide by default). Default 0. */
  group?: number;
  /** Every joint breaks above this reaction force. Default Infinity. */
  breakForce?: number;
  /**
   * Friction torque in every joint as a fraction of one link's weight * length; damps swaying so bridges and ropes
   * come to rest and sleep. 0 = frictionless. Default 0.05.
   */
  jointFriction?: number;
  /** Body names become `<name>.0`, `<name>.1`, ... and `<name>.pin`. Default 'chain'. */
  name?: string;
  userData?: unknown;
}

export interface RigidChain {
  /** The links, from `from` to `to`. */
  readonly bodies: RigidBody[];
  /** Revolute joints in order: pin/body -> link 0, link 0 -> link 1, ..., last link -> pin/body. */
  readonly joints: RigidRevoluteJoint[];
  /** Hidden static bodies created for point ends (category 0: they never collide or show in queries). */
  readonly pins: RigidBody[];
  /** Removes links and pins (joints go with them). */
  remove(): void;
}

function chainEndPoint(e: RigidChainEnd): Vec2 {
  if (!('body' in e)) return { x: e.x, y: e.y };
  const b = e.body;
  const lx = e.anchor?.x ?? 0;
  const ly = e.anchor?.y ?? 0;
  return { x: b.x + b.c * lx - b.s * ly, y: b.y + b.s * lx + b.c * ly };
}

/**
 * Rope or hanging bridge: `links` boxes joined end to end by revolute joints, each end pinned to a point (a hidden
 * static body) or to a body. With `to` and linkLength * links longer than the span, the chain starts sagging.
 *
 *     createRigidChain(world, { from: { x: 100, y: 300 }, to: { x: 650, y: 300 }, links: 14, linkLength: 41, linkWidth: 12 });
 *     createRigidChain(world, { from: { x: 375, y: 100 }, to: { body: lamp }, links: 10 });   // lamp on a rope
 */
export function createRigidChain(world: RigidWorld, opts: RigidChainOptions): RigidChain {
  const n = Math.max(1, Math.floor(opts.links));
  const width = opts.linkWidth ?? 8;
  const name = opts.name ?? 'chain';
  const p0 = chainEndPoint(opts.from);
  const points: Vec2[] = [];
  let linkLength: number;
  if (opts.to) {
    const p1 = chainEndPoint(opts.to);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const span = Math.hypot(dx, dy);
    linkLength = Math.max(opts.linkLength ?? 0, span / n);
    const total = linkLength * n;
    if (total <= span * 1.0001 || span < 1e-6) {
      for (let i = 0; i <= n; i++) points.push({ x: p0.x + (dx * i) / n, y: p0.y + (dy * i) / n });
    } else {
      points.push(...sagPoints(p0, p1, total, n));
    }
  } else {
    linkLength = opts.linkLength ?? 20;
    for (let i = 0; i <= n; i++) points.push({ x: p0.x, y: p0.y + linkLength * i });
  }

  const shape = rigidBox(linkLength, width);
  const bodies: RigidBody[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    bodies.push(
      world.add({
        name: `${name}.${i}`,
        shape,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        ...(opts.density !== undefined ? { density: opts.density } : {}),
        friction: opts.friction ?? 0.6,
        restitution: opts.restitution ?? 0,
        linearDamping: opts.linearDamping ?? 0,
        angularDamping: opts.angularDamping ?? 0,
        category: opts.category ?? 1,
        mask: opts.mask ?? -1,
        group: opts.group ?? 0,
        userData: opts.userData ?? null,
      }),
    );
  }

  const pins: RigidBody[] = [];
  const endBody = (e: RigidChainEnd, p: Vec2): RigidBody => {
    if ('body' in e) return e.body;
    const pin = world.add({ name: `${name}.pin`, type: 'static', shape: rigidCircle(Math.max(2, width / 2)), x: p.x, y: p.y, category: 0, mask: 0 });
    pins.push(pin);
    return pin;
  };
  const g = Math.hypot(world.gravityX, world.gravityY) || 1600;
  const friction = (opts.jointFriction ?? 0.05) * bodies[0]!.mass * g * linkLength;
  const extra = { ...(opts.breakForce !== undefined ? { breakForce: opts.breakForce } : {}), motorSpeed: 0, maxMotorTorque: friction };
  const joints: RigidRevoluteJoint[] = [];
  joints.push(world.addJoint({ type: 'revolute', name: `${name}.j0`, a: endBody(opts.from, points[0]!), b: bodies[0]!, anchor: points[0]!, ...extra }));
  for (let i = 1; i < n; i++) {
    joints.push(world.addJoint({ type: 'revolute', name: `${name}.j${i}`, a: bodies[i - 1]!, b: bodies[i]!, anchor: points[i]!, ...extra }));
  }
  if (opts.to) {
    joints.push(world.addJoint({ type: 'revolute', name: `${name}.j${n}`, a: bodies[n - 1]!, b: endBody(opts.to, points[n]!), anchor: points[n]!, ...extra }));
  }

  return {
    bodies,
    joints,
    pins,
    remove() {
      for (const b of bodies) b.world?.remove(b);
      for (const b of pins) b.world?.remove(b);
    },
  };
}

/** n + 1 points at equal arc length on a parabola from p0 to p1 (sagging toward +y) whose length is `total`. */
function sagPoints(p0: Vec2, p1: Vec2, total: number, n: number): Vec2[] {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const span = Math.hypot(dx, dy);
  let nx = -dy / span;
  let ny = dx / span;
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const SAMPLES = 128;
  const at = (s: number, t: number): Vec2 => {
    const k = 4 * s * t * (1 - t);
    return { x: p0.x + dx * t + nx * k, y: p0.y + dy * t + ny * k };
  };
  const arc = (s: number): number => {
    let len = 0;
    let prev = at(s, 0);
    for (let i = 1; i <= SAMPLES; i++) {
      const p = at(s, i / SAMPLES);
      len += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
    return len;
  };
  let lo = 0;
  let hi = total;
  for (let it = 0; it < 50; it++) {
    const mid = (lo + hi) / 2;
    if (arc(mid) < total) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  const cum: number[] = [0];
  const samples: Vec2[] = [at(s, 0)];
  for (let i = 1; i <= SAMPLES; i++) {
    const p = at(s, i / SAMPLES);
    const q = samples[i - 1]!;
    cum.push(cum[i - 1]! + Math.hypot(p.x - q.x, p.y - q.y));
    samples.push(p);
  }
  const len = cum[SAMPLES]!;
  const out: Vec2[] = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const target = (len * i) / n;
    while (k < SAMPLES - 1 && cum[k + 1]! < target) k++;
    const seg = cum[k + 1]! - cum[k]!;
    const f = seg > 0 ? Math.min(1, Math.max(0, (target - cum[k]!) / seg)) : 0;
    const a = samples[k]!;
    const b = samples[k + 1]!;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  out[0] = { x: p0.x, y: p0.y };
  out[n] = { x: p1.x, y: p1.y };
  return out;
}
