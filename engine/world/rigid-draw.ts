import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from '../scene/node';
import type { RigidBody } from './rigid-body';
import { RigidRevoluteJoint, type RigidJoint } from './rigid-joint';
import type { RigidWorld } from './rigid-world';

export interface RigidBindOptions {
  /** Body-local offset of the node (rotates with the body). Default 0, 0. */
  offsetX?: number;
  offsetY?: number;
  /** Copy the body angle to node.rotation. Default true. */
  rotate?: boolean;
  /** Remove the body from its world when the node is destroyed. Default false. */
  removeWithNode?: boolean;
}

/**
 * Makes the world copy the body pose to `node` (x, y, rotation) after each update(); the node's parent space must
 * be the physics space (e.g. both live in the same World container), and its anchor should be the centre of mass
 * (anchor 0.5 for circles and boxes). Unbinds when the node is destroyed. Returns an unbinder.
 */
export function bindRigidNode(node: Node, body: RigidBody, opts: RigidBindOptions = {}): () => void {
  body.node = node;
  body.nodeOffsetX = opts.offsetX ?? 0;
  body.nodeOffsetY = opts.offsetY ?? 0;
  body.nodeRotate = opts.rotate ?? true;
  body.world?.syncNodes(1);
  const off = node.on('destroyed', () => {
    if (body.node === node) body.node = null;
    if (opts.removeWithNode) body.world?.remove(body);
  });
  return () => {
    off();
    if (body.node === node) body.node = null;
  };
}

export interface RigidDrawColors {
  dynamic: string;
  static: string;
  kinematic: string;
  sleeping: string;
  sensor: string;
  contact: string;
  aabb: string;
  joint: string;
}

export interface RigidDrawOptions {
  /** Translucent fill under the outline. Default true. */
  fill?: boolean;
  lineWidth?: number;
  /** Contact points and normals of touching contacts. Default true. */
  contacts?: boolean;
  /** Joints: anchor dots, a line between the anchors, thin lines to the body centres, revolute limit arcs. Default true. */
  joints?: boolean;
  /** Body AABBs. Default false. */
  aabbs?: boolean;
  /** Blend poses from the previous step (0..1); default 1 = current poses. */
  alpha?: number;
  colors?: Partial<RigidDrawColors>;
}

const DEFAULT_COLORS: RigidDrawColors = {
  dynamic: '#f59e0b',
  static: '#64748b',
  kinematic: '#38bdf8',
  sleeping: '#8b95a7',
  sensor: '#34d399',
  contact: '#f43f5e',
  aabb: 'rgba(255,255,255,0.25)',
  joint: '#c084fc',
};

/**
 * Debug-draws a RigidWorld in physics space (set the transform before calling): shapes coloured by type,
 * sleeping bodies grey, sensors dashed green, a radius line showing each circle's rotation, contact points
 * with normals, and joints (violet anchor dots and lines; revolute limits as an arc with a tick for the angle).
 */
export function drawRigidWorld(ctx: Ctx2D, world: RigidWorld, opts: RigidDrawOptions = {}): void {
  const colors = { ...DEFAULT_COLORS, ...opts.colors };
  const lw = opts.lineWidth ?? 2;
  const fill = opts.fill ?? true;
  const alpha = opts.alpha ?? 1;
  ctx.save();
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  for (const b of world.bodies) {
    const color = b.sensor
      ? colors.sensor
      : b.type === 'static'
        ? colors.static
        : b.sleeping
          ? colors.sleeping
          : b.type === 'kinematic'
            ? colors.kinematic
            : colors.dynamic;
    const x = alpha >= 1 ? b.x : b.prevX + (b.x - b.prevX) * alpha;
    const y = alpha >= 1 ? b.y : b.prevY + (b.y - b.prevY) * alpha;
    const a = alpha >= 1 ? b.angle : b.prevAngle + (b.angle - b.prevAngle) * alpha;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const sh = b.shape;
    ctx.beginPath();
    if (sh.type === 'circle') {
      ctx.arc(x, y, sh.radius, 0, Math.PI * 2);
    } else {
      const v = sh.vertices;
      for (let i = 0; i < sh.count; i++) {
        const lx = v[i * 2]!;
        const ly = v[i * 2 + 1]!;
        const wx = x + c * lx - s * ly;
        const wy = y + s * lx + c * ly;
        if (i === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.closePath();
    }
    if (fill) {
      ctx.globalAlpha = b.sensor ? 0.12 : 0.3;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (b.sensor) ctx.setLineDash([lw * 4, lw * 3]);
    ctx.strokeStyle = color;
    ctx.stroke();
    if (b.sensor) ctx.setLineDash([]);
    if (sh.type === 'circle' && !b.sensor) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + c * sh.radius, y + s * sh.radius);
      ctx.stroke();
    }
    if (opts.aabbs) {
      ctx.strokeStyle = colors.aabb;
      ctx.lineWidth = 1;
      ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      ctx.lineWidth = lw;
    }
  }
  if (opts.contacts ?? true) {
    const len = Math.max(8, lw * 6);
    ctx.fillStyle = colors.contact;
    ctx.strokeStyle = colors.contact;
    for (const ct of world.contacts) {
      if (!ct.touching || ct.sensor) continue;
      for (let i = 0; i < ct.count; i++) {
        const p = ct.points[i]!;
        ctx.beginPath();
        ctx.arc(p.x, p.y, lw * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + ct.nx * len, p.y + ct.ny * len);
        ctx.stroke();
      }
    }
  }
  if (opts.joints ?? true) for (const j of world.joints) drawJoint(ctx, j, colors.joint, lw, alpha);
  ctx.restore();
}

function drawJoint(ctx: Ctx2D, j: RigidJoint, color: string, lw: number, alpha: number): void {
  const pa = j.anchorWorldA(alpha);
  const pb = j.anchorWorldB(alpha);
  const bx = (b: RigidBody) => (alpha >= 1 ? b.x : b.prevX + (b.x - b.prevX) * alpha);
  const by = (b: RigidBody) => (alpha >= 1 ? b.y : b.prevY + (b.y - b.prevY) * alpha);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = Math.max(1, lw * 0.5);
  ctx.beginPath();
  if (j.type !== 'mouse') {
    ctx.moveTo(bx(j.a), by(j.a));
    ctx.lineTo(pa.x, pa.y);
  }
  ctx.moveTo(bx(j.b), by(j.b));
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = lw;
  if (j.type === 'mouse') ctx.setLineDash([lw * 3, lw * 2]);
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
  if (j.type === 'mouse') ctx.setLineDash([]);
  const r = Math.max(3, lw * 2);
  ctx.beginPath();
  ctx.arc(pa.x, pa.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(pb.x, pb.y, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
  if (j instanceof RigidRevoluteJoint && j.limitsEnabled) {
    // Arc = allowed directions of the line from the pivot to b's centre; tick = that line now.
    const a = j.a;
    const b = j.b;
    const angA = alpha >= 1 ? a.angle : a.prevAngle + (a.angle - a.prevAngle) * alpha;
    const angB = alpha >= 1 ? b.angle : b.prevAngle + (b.angle - b.prevAngle) * alpha;
    const phi = Math.atan2(-j.localAnchorB.y, -j.localAnchorB.x);
    const base = angA + j.referenceAngle + phi;
    const lo = j.lowerAngle === -Infinity ? -Math.PI : Math.max(-Math.PI, j.lowerAngle);
    const hi = j.upperAngle === Infinity ? Math.PI : Math.min(Math.PI, j.upperAngle);
    const rad = Math.max(10, lw * 7);
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1, lw * 0.75);
    ctx.beginPath();
    ctx.arc(pb.x, pb.y, rad, base + lo, base + hi);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pb.x, pb.y);
    ctx.lineTo(pb.x + Math.cos(angB + phi) * rad * 1.3, pb.y + Math.sin(angB + phi) * rad * 1.3);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = lw;
  }
}

/** A node that debug-draws a RigidWorld in its local space (put it in the container holding the physics). */
export class RigidDebugView extends Node {
  world: RigidWorld;
  options: RigidDrawOptions;

  constructor(world: RigidWorld, options: RigidDrawOptions = {}, nodeOpts?: NodeOptions) {
    super(nodeOpts);
    this.world = world;
    this.options = options;
  }

  override get kind(): string {
    return 'RigidDebugView';
  }

  override draw(ctx: Ctx2D): void {
    const w = this.world;
    drawRigidWorld(ctx, w, { alpha: w.interpolate ? w.alpha : 1, ...this.options });
  }

  override describe() {
    let sleeping = 0;
    for (const b of this.world.bodies) if (b.sleeping) sleeping++;
    return {
      ...super.describe(),
      bodies: this.world.bodies.length,
      sleeping,
      contacts: this.world.contacts.length,
      joints: this.world.joints.length,
    };
  }
}
