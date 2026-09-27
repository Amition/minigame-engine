import type { AppleKind, ArrowId } from './config';

/**
 * View contract between the battle simulation (model.ts / ragdoll.ts) and the painters (art/). All positions are
 * world units: the battle world is WORLD_W x WORLD_H, y down, angles in radians (0 = right, -PI/2 = up).
 * Painters read these read-only snapshots; the model owns the objects and may reuse them between frames.
 */

export const WORLD_W = 1600;
export const WORLD_H = 900;

export interface Vec {
  x: number;
  y: number;
}

/**
 * Ragdoll joints. "F" = front limbs (bow arm, leading leg: drawn in front of the torso), "B" = back limbs (string
 * arm, trailing leg: drawn behind). The player faces right, enemies face left.
 */
export const J = {
  head: 0,
  neck: 1,
  pelvis: 2,
  elbowF: 3,
  handF: 4,
  elbowB: 5,
  handB: 6,
  kneeF: 7,
  footF: 8,
  kneeB: 9,
  footB: 10,
} as const;
export type JointIndex = (typeof J)[keyof typeof J];
export const JOINT_COUNT = 11;

/** Bones as [from, to] joint pairs in painter order: back limbs, torso, front leg, head, front arm. */
export const BONES: readonly (readonly [JointIndex, JointIndex])[] = [
  [J.neck, J.elbowB],
  [J.elbowB, J.handB],
  [J.pelvis, J.kneeB],
  [J.kneeB, J.footB],
  [J.neck, J.pelvis],
  [J.pelvis, J.kneeF],
  [J.kneeF, J.footF],
  [J.head, J.neck],
  [J.neck, J.elbowF],
  [J.elbowF, J.handF],
];

/**
 * Body proportions at scale 1 (world units): standing height about 175. Physics rest lengths and hit radii and the
 * painters' stroke widths all come from here, so what you see is what gets hit.
 */
export const BODY = {
  headR: 17,
  /** Neck joint to head centre. */
  neck: 24,
  /** Neck joint to pelvis. */
  torso: 54,
  upperArm: 32,
  foreArm: 30,
  thigh: 40,
  shin: 40,
  /** Stroke width of limbs (also the hit capsule diameter). */
  limbW: 13,
  /** Stroke width of the torso (also its hit capsule diameter). */
  torsoW: 24,
  /** Bow: distance from grip (handF) to each tip, and how far the bow bulges forward. */
  bowHalf: 46,
  bowBulge: 20,
  /** Arrow length, tip to nock. */
  arrowLen: 80,
} as const;

/** An arrow stuck in a body or a platform, placed by its tip (the painter draws the shaft behind the tip). */
export interface StuckArrowView {
  type: ArrowId;
  x: number;
  y: number;
  angle: number;
}

export interface FighterView {
  readonly id: number;
  readonly side: 'player' | 'enemy';
  /** 1 = normal; bosses are bigger. Multiply every BODY size by it. */
  readonly scale: number;
  /** JOINT_COUNT world positions, indexed by J. */
  readonly joints: readonly Vec[];
  /** +1 faces right (player), -1 faces left (enemies). */
  readonly facing: 1 | -1;
  /** Direction the bow (and the nocked arrow) points. */
  readonly aimAngle: number;
  /** 0..1 how far the string is pulled back. */
  readonly draw: number;
  /** Arrow on the string, null right after a shot and when dead. */
  readonly nocked: ArrowId | null;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly boss: boolean;
  /**
   * Armor points (0 = none; see damageTaken in config.ts). Drawn as gear: 1-2 a helmet, 3-5 helmet + chest plate,
   * 6+ helmet with visor + chest plate + shoulder guards.
   */
  readonly armor: number;
  /** Arrows stuck in this body (world positions, updated every step). */
  readonly stuck: readonly StuckArrowView[];
  /** Seconds of poison left (green tint while > 0). */
  readonly poison: number;
  /** Seconds of stun left (electric sparks while > 0). */
  readonly stun: number;
  /** Balloons tied to the body (drawn on strings above the neck). */
  readonly balloons: number;
  /** 0..1, decays after a hit (white-hot flash / red tint). */
  readonly flash: number;
}

export interface ArrowView {
  readonly id: number;
  readonly type: ArrowId;
  /** Tip position and flight direction. */
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly owner: 'player' | 'enemy';
  /** Seconds since it was shot (trails, missile flame, axe spin). */
  readonly age: number;
}

export interface AppleView {
  readonly id: number;
  readonly kind: AppleKind;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly angle: number;
}

/** A solid rectangle centred at (x, y), w x h, rotated by angle. The tower's top edge is the player's floor. */
export interface PlatformView {
  readonly id: number;
  readonly kind: 'tower' | 'block';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly angle: number;
  /** Arrows stuck in the platform. */
  readonly stuck: readonly StuckArrowView[];
}
