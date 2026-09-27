import { clamp, Node, Scene, Sprite, Text, roundRectPath, type Ctx2D, type NodeOptions } from '@engine';
import {
  ART_KEYS,
  ARROW_CARD_W,
  drawApple,
  drawArrow,
  drawBackdrop,
  drawExplosion,
  drawFighter,
  drawLightning,
  drawPlatform,
  nockDistance,
} from '../art/index';
import { APPLES, ARROWS, COLORS, type ArrowId } from '../config';
import { BODY, J, JOINT_COUNT, type FighterView, type PlatformView, type StuckArrowView, type Vec } from '../types';

export interface GalleryParams {
  /**
   * 'sheet' (default): every asset at battle size; 'zoom': a few fighters, arrows and props enlarged; 'armor': the
   * armor gear tiers on players, enemies, a boss and fallen bodies, plus close-ups.
   */
  page?: 'sheet' | 'zoom' | 'armor';
}

/** A node that runs a painter in its local space (world units once the node is scaled). */
class ArtPaint extends Node {
  constructor(
    private readonly painter: (ctx: Ctx2D) => void,
    opts?: NodeOptions,
  ) {
    super(opts);
  }

  override get kind(): string {
    return 'ArtPaint';
  }

  override draw(ctx: Ctx2D): void {
    this.painter(ctx);
  }
}

// ---------------------------------------------------------------- hand-built poses

interface Limbs {
  /** Absolute angles for a right-facing figure (0 = right, PI/2 = down); mirrored for facing -1. */
  torso: number;
  head: number;
  armF: readonly [number, number];
  armB: readonly [number, number];
  legF: readonly [number, number];
  legB: readonly [number, number];
}

const STAND: Limbs = {
  torso: -Math.PI / 2,
  head: -Math.PI / 2,
  armF: [0.3, 0.2],
  armB: [Math.PI / 2 + 0.28, Math.PI / 2 + 0.08],
  legF: [1.4, 1.52],
  legB: [1.8, 1.68],
};

const JUMP: Limbs = {
  torso: -Math.PI / 2 + 0.08,
  head: -Math.PI / 2 + 0.05,
  armF: [0, 0],
  armB: [2, 2],
  legF: [0.55, 1.85],
  legB: [1.15, 2.3],
};

/** Slumped against nothing, sitting on the floor: torso fallen back, head dropped forward, bow flat on the floor. */
const SLUMPED: Limbs = {
  torso: -Math.PI / 2 - 0.45,
  head: -0.6,
  armF: [0.64, Math.PI / 2],
  armB: [Math.PI / 2 + 0.5, Math.PI / 2 + 0.9],
  legF: [-0.25, 0.25],
  legB: [-0.05, 0.03],
};

/** Flat on the back on the floor, head toward the back: arm along the body, the other flung over the head. */
const LYING: Limbs = {
  torso: Math.PI,
  head: Math.PI + 0.06,
  armF: [0.12, -0.15],
  armB: [Math.PI - 0.3, Math.PI - 0.12],
  legF: [-0.08, 0.04],
  legB: [0.1, -0.03],
};

/** Flung upside down in mid-air: head and shoulders below the hips, limbs flailing. */
const TUMBLE: Limbs = {
  torso: 1.95,
  head: 2.2,
  armF: [0.5, 1.1],
  armB: [2.9, 2.4],
  legF: [-1.15, -0.6],
  legB: [-1.9, -2.5],
};

const at = (o: Vec, angle: number, len: number): Vec => ({ x: o.x + Math.cos(angle) * len, y: o.y + Math.sin(angle) * len });

function skeleton(pelvis: Vec, facing: 1 | -1, s: number, l: Limbs): Vec[] {
  const m = (a: number) => (facing === 1 ? a : Math.PI - a);
  const j: Vec[] = new Array<Vec>(JOINT_COUNT);
  j[J.pelvis] = pelvis;
  j[J.neck] = at(pelvis, m(l.torso), BODY.torso * s);
  j[J.head] = at(j[J.neck]!, m(l.head), BODY.neck * s);
  j[J.elbowF] = at(j[J.neck]!, m(l.armF[0]), BODY.upperArm * s);
  j[J.handF] = at(j[J.elbowF]!, m(l.armF[1]), BODY.foreArm * s);
  j[J.elbowB] = at(j[J.neck]!, m(l.armB[0]), BODY.upperArm * s);
  j[J.handB] = at(j[J.elbowB]!, m(l.armB[1]), BODY.foreArm * s);
  j[J.kneeF] = at(pelvis, m(l.legF[0]), BODY.thigh * s);
  j[J.footF] = at(j[J.kneeF]!, m(l.legF[1]), BODY.shin * s);
  j[J.kneeB] = at(pelvis, m(l.legB[0]), BODY.thigh * s);
  j[J.footB] = at(j[J.kneeB]!, m(l.legB[1]), BODY.shin * s);
  return j;
}

/** Bow arm along the aim, string arm solved (two-bone IK) so the hand sits on the nock for this draw. */
function aimArms(j: Vec[], aim: number, draw: number, s: number, facing: 1 | -1, holdString: boolean): void {
  const neck = j[J.neck]!;
  j[J.elbowF] = at(neck, aim + 0.1 * facing, BODY.upperArm * s);
  j[J.handF] = at(j[J.elbowF]!, aim - 0.03 * facing, BODY.foreArm * s);
  if (!holdString) return;
  const hand = j[J.handF]!;
  const d = nockDistance(draw, s);
  const tx = hand.x - Math.cos(aim) * d;
  const ty = hand.y - Math.sin(aim) * d;
  const a = BODY.upperArm * s;
  const b = BODY.foreArm * s;
  const dist = Math.hypot(tx - neck.x, ty - neck.y);
  const dc = clamp(dist, Math.abs(a - b) + 0.5, a + b - 0.5);
  const phi = dist > 1e-6 ? Math.atan2(ty - neck.y, tx - neck.x) : aim + Math.PI;
  const alpha = Math.acos(clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1));
  const e1 = at(neck, phi + alpha, a);
  const e2 = at(neck, phi - alpha, a);
  const score = (e: Vec) => (e.x - neck.x) * Math.cos(aim) + (e.y - neck.y) * Math.sin(aim) + (e.y - neck.y) * 0.5;
  j[J.elbowB] = score(e1) < score(e2) ? e1 : e2;
  j[J.handB] = at(neck, phi, dc);
}

interface FighterSpec {
  /** Feet baseline centre (local units of the node the fighter is painted in). */
  x: number;
  feet: number;
  facing?: 1 | -1;
  scale?: number;
  limbs?: Limbs;
  aim?: number;
  draw?: number;
  nocked?: ArrowId | null;
  side?: 'player' | 'enemy';
  hp?: number;
  alive?: boolean;
  boss?: boolean;
  poison?: number;
  stun?: number;
  balloons?: number;
  flash?: number;
  armor?: number;
  /** Drop the pelvis this far above the standing height (jumps) or below it (sitting). */
  lift?: number;
}

let nextId = 1;

function fighter(spec: FighterSpec): FighterView & { stuck: StuckArrowView[] } {
  const s = spec.scale ?? 1;
  const facing = spec.facing ?? (spec.side === 'enemy' ? -1 : 1);
  const alive = spec.alive ?? true;
  const pelvis = { x: spec.x, y: spec.feet - (BODY.thigh + BODY.shin - 1) * s - (spec.lift ?? 0) * s };
  const joints = skeleton(pelvis, facing, s, spec.limbs ?? STAND);
  const aim = spec.aim ?? (facing === 1 ? -0.3 : Math.PI + 0.3);
  const draw = spec.draw ?? 0;
  if (alive) aimArms(joints, aim, draw, s, facing, draw > 0);
  return {
    id: nextId++,
    side: spec.side ?? 'player',
    scale: s,
    joints,
    facing,
    aimAngle: aim,
    draw,
    nocked: spec.nocked === undefined ? 'normal' : spec.nocked,
    hp: spec.hp ?? 100,
    maxHp: 100,
    alive,
    boss: spec.boss ?? false,
    armor: spec.armor ?? 0,
    stuck: [],
    poison: spec.poison ?? 0,
    stun: spec.stun ?? 0,
    balloons: spec.balloons ?? 0,
    flash: spec.flash ?? 0,
  };
}

const lerpV = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function stuckAt(p: Vec, angle: number, type: ArrowId, depth = 6): StuckArrowView {
  return { type, x: p.x + Math.cos(angle) * depth, y: p.y + Math.sin(angle) * depth, angle };
}

// ---------------------------------------------------------------- scene

const SHEET_W = 1334;
const SHEET_H = 750;
const LABEL = COLORS.textDim;

/**
 * Art review sheet (landscape, fits 1334x750 and wider views): backdrop, fighters in hand-built poses, every arrow at
 * battle size and as a menu card, tower and block with stuck arrows, apples, explosions, lightning and the icons.
 * `pnpm shot --app archer --scene gallery --device iphone-14-land` (add `--params '{"page":"zoom"}'` for close-ups,
 * `--params '{"page":"armor"}'` for the armor gear).
 */
export class GalleryScene extends Scene {
  private clock = 0;

  override get kind(): string {
    return 'GalleryScene';
  }

  override onEnter(params?: GalleryParams): void {
    nextId = 1;
    const w = this.width;
    const h = this.height;
    this.add(
      new ArtPaint((ctx) => drawBackdrop(ctx, w, h, this.clock), { id: 'backdrop', width: w, height: h, tags: ['lint-blocker'] }),
    );
    const ox = Math.round((w - SHEET_W) / 2);
    const oy = Math.round((h - SHEET_H) / 2);
    if (params?.page === 'zoom') this.buildZoom(ox, oy);
    else if (params?.page === 'armor') this.buildArmor(ox, oy);
    else this.buildSheet(ox, oy);
  }

  override update(dt: number): void {
    this.clock += dt;
  }

  private world(x: number, y: number, k: number, painter: (ctx: Ctx2D) => void): ArtPaint {
    return this.add(new ArtPaint(painter, { x, y, scale: k }));
  }

  private label(text: string, x: number, y: number, size = 15, anchor: number | [number, number] = 0.5): void {
    this.add(new Text(text, { fontSize: size, color: LABEL }, { x, y, anchor }));
  }

  private buildSheet(ox: number, oy: number): void {
    const k = 0.8;
    const base = oy + 236;

    // row 1: poses, player facing right then enemies facing left
    const row: { x: number; label: string; f: FighterView }[] = [
      { x: 40, label: 'idle', f: fighter({ x: 0, feet: 0, aim: -0.35 }) },
      { x: 168, label: 'draw up', f: fighter({ x: 0, feet: 0, aim: -0.62, draw: 1 }) },
      { x: 258, label: 'draw 0.6', f: fighter({ x: 0, feet: 0, aim: -0.05, draw: 0.6, nocked: 'explosive' }) },
      { x: 364, label: 'draw down', f: fighter({ x: 0, feet: 0, aim: 0.42, draw: 1, nocked: 'axe' }) },
      { x: 452, label: 'jump', f: fighter({ x: 0, feet: 0, limbs: JUMP, lift: 34, aim: -0.2, draw: 0.8, nocked: 'split' }) },
      { x: 594, label: 'enemy up', f: fighter({ x: 0, feet: 0, side: 'enemy', aim: Math.PI + 0.62, draw: 1 }) },
      { x: 700, label: 'draw 0.5', f: fighter({ x: 0, feet: 0, side: 'enemy', aim: Math.PI + 0.05, draw: 0.5, nocked: 'electric', hp: 60 }) },
      { x: 800, label: 'down', f: fighter({ x: 0, feet: 0, side: 'enemy', aim: Math.PI - 0.42, draw: 1, nocked: 'missile', hp: 22 }) },
    ];
    const fx = fighter({ x: 0, feet: 0, side: 'enemy', aim: Math.PI + 0.12, nocked: 'poison', hp: 45, balloons: 3, poison: 2.5, stun: 1, flash: 0.55 });
    const p = fx.joints;
    fx.stuck.push(
      stuckAt(lerpV(p[J.neck]!, p[J.pelvis]!, 0.45), 0.12, 'normal'),
      stuckAt(p[J.head]!, -0.1, 'vampire', 2),
      stuckAt(lerpV(p[J.pelvis]!, p[J.kneeF]!, 0.55), 0.25, 'electric'),
      stuckAt(lerpV(p[J.neck]!, p[J.pelvis]!, 0.8), -0.2, 'split'),
      stuckAt(lerpV(p[J.neck]!, p[J.elbowF]!, 0.6), 0.5, 'poison', 4),
    );
    row.push({ x: 935, label: 'hit fx', f: fx });
    for (const r of row) {
      this.world(ox + r.x, base, k, (ctx) => drawFighter(ctx, r.f));
      this.label(r.label, ox + r.x, base + 12);
    }

    // row 2: tower with a slumped dead player, boss on its block, both with stuck arrows
    const tower: PlatformView = {
      id: 1,
      kind: 'tower',
      x: 0,
      y: 300,
      w: 220,
      h: 600,
      angle: 0,
      stuck: [
        { type: 'normal', x: 104, y: 60, angle: Math.PI - 0.25 },
        { type: 'vampire', x: 102, y: 150, angle: Math.PI - 0.1 },
        { type: 'axe', x: 104, y: 105, angle: Math.PI + 0.2 },
      ],
    };
    const dead = fighter({ x: 12, feet: 0, limbs: SLUMPED, alive: false, lift: -72, nocked: null });
    dead.stuck.push(stuckAt(lerpV(dead.joints[J.neck]!, dead.joints[J.pelvis]!, 0.4), Math.PI - 0.3, 'normal'));
    const towerTop = oy + 612;
    this.world(ox + 112, towerTop, k, (ctx) => {
      drawPlatform(ctx, tower);
      drawFighter(ctx, dead);
    });
    this.label('dead', ox + 112, towerTop + 40);

    const side = 120;
    const block: PlatformView = {
      id: 2,
      kind: 'block',
      x: 0,
      y: (side / Math.SQRT2) | 0,
      w: side,
      h: side,
      angle: Math.PI / 4,
      stuck: [
        { type: 'normal', x: -58, y: 108, angle: 0.3 },
        { type: 'chainsaw', x: -40, y: 128, angle: -0.15 },
      ],
    };
    const boss = fighter({ x: 0, feet: 0, side: 'enemy', scale: 1.6, boss: true, aim: Math.PI + 0.12, draw: 1, nocked: 'explosive', hp: 70 });
    this.world(ox + 336, oy + 528, k, (ctx) => {
      drawPlatform(ctx, block);
      drawFighter(ctx, boss);
    });
    this.label('boss x1.6', ox + 336, oy + 700);

    // arrows at battle size, tip to the right
    const ax = ox + 470;
    const ay = oy + 276;
    ARROWS.forEach((a, i) => {
      const cx = ax + (i % 2) * 270;
      const cy = ay + Math.floor(i / 2) * 38;
      this.world(cx + 8 + BODY.arrowLen * k, cy, k, (ctx) => drawArrow(ctx, a.id, 0, 0, 0));
      this.label(`${a.name} ${a.id}`, cx + 20 + BODY.arrowLen * k, cy, 17, [0, 0.5]);
    });

    // apples, lightning, explosions
    APPLES.forEach((a, i) => this.world(ox + 500 + i * 62, oy + 508, k, (ctx) => drawApple(ctx, a.kind, 0, 0, 22, (i - 1) * 0.35)));
    this.world(ox + 700, oy + 492, 1, (ctx) => drawLightning(ctx, 0, 0, 290, 26, 7));
    [0.1, 0.32, 0.62].forEach((pr, i) => {
      this.world(ox + 540 + i * 170, oy + 632, k, (ctx) => drawExplosion(ctx, 0, 0, 80, pr));
      this.label(`boom ${pr}`, ox + 540 + i * 170, oy + 712);
    });

    // menu cards on mock card backgrounds (owned / locked / trial), then icons and apple textures
    const cx0 = ox + SHEET_W - ARROW_CARD_W - 8;
    ARROWS.forEach((a, i) => {
      const y = oy + 6 + i * 59;
      const bg = a.cost === 0 ? COLORS.card : a.trial ? COLORS.cardTrial : COLORS.cardLocked;
      this.add(
        new ArtPaint(
          (ctx) => {
            ctx.beginPath();
            roundRectPath(ctx, 70, 0, ARROW_CARD_W - 76, 32, 5);
            ctx.fillStyle = bg;
            ctx.fill();
          },
          { x: cx0, y },
        ),
      );
      if (a.cost > 0 && !a.trial) this.add(new Sprite(ART_KEYS.lock, { x: cx0 + 82, y: y - 4, scale: 0.8 }));
      if (a.trial) this.add(new Sprite(ART_KEYS.film, { x: cx0 + 82, y: y - 4, scale: 0.8 }));
      this.add(new Text(a.name, { fontSize: 20, color: COLORS.buttonText }, { x: cx0 + ARROW_CARD_W - 60, y: y + 13, anchor: [1, 0.5] }));
      this.add(new Sprite(ART_KEYS.arrow(a.id), { x: cx0, y }));
    });
    const iy = oy + 600;
    const icons = [ART_KEYS.skull, ART_KEYS.lock, ART_KEYS.film, ART_KEYS.gear, ART_KEYS.podium];
    let ix = cx0 + 4;
    for (const key of icons) {
      this.add(new Sprite(key, { x: ix, y: iy + (key === ART_KEYS.podium ? 0 : 8) }));
      ix += key === ART_KEYS.podium ? 72 : 58;
    }
    APPLES.forEach((a, i) => this.add(new Sprite(ART_KEYS.apple(a.kind), { x: cx0 + 4 + i * 70, y: iy + 76 })));
    this.label('textures', cx0 + 230, iy + 108, 15, [0, 0.5]);
  }

  /** Armor gear: tiers side by side at battle size, a boss, fallen and tumbling bodies, effect overlays, close-ups. */
  private buildArmor(ox: number, oy: number): void {
    const k = 0.8;
    const base = oy + 250;
    const tiers: readonly [number, string][] = [
      [0, 'armor 0'],
      [2, '2 helmet'],
      [4, '4 +plate'],
      [8, '8 visor+guards'],
    ];
    tiers.forEach(([armor, label], i) => {
      const p = fighter({ x: 0, feet: 0, aim: -0.3, armor });
      this.world(ox + 50 + i * 130, base, k, (ctx) => drawFighter(ctx, p));
      this.label(label, ox + 50 + i * 130, base + 14);
      const e = fighter({ x: 0, feet: 0, side: 'enemy', aim: Math.PI + 0.3, hp: 100 - i * 20, armor });
      this.world(ox + 640 + i * 130, base, k, (ctx) => drawFighter(ctx, e));
      this.label(label, ox + 640 + i * 130, base + 14);
    });

    const block: PlatformView = { id: 5, kind: 'block', x: 0, y: 84, w: 120, h: 120, angle: Math.PI / 4, stuck: [] };
    const boss = fighter({ x: 0, feet: 0, side: 'enemy', scale: 1.6, boss: true, aim: Math.PI + 0.2, draw: 1, nocked: 'axe', hp: 80, armor: 10 });
    this.world(ox + 110, oy + 560, k, (ctx) => {
      drawPlatform(ctx, block);
      drawFighter(ctx, boss);
    });
    this.label('boss armor 10', ox + 110, oy + 716);

    const tower: PlatformView = { id: 6, kind: 'tower', x: 0, y: 300, w: 220, h: 600, angle: 0, stuck: [] };
    const slumped = fighter({ x: 12, feet: 0, limbs: SLUMPED, alive: false, lift: -72, nocked: null, armor: 8 });
    slumped.stuck.push(stuckAt(lerpV(slumped.joints[J.neck]!, slumped.joints[J.pelvis]!, 0.45), Math.PI - 0.3, 'normal'));
    this.world(ox + 300, oy + 640, k, (ctx) => {
      drawPlatform(ctx, tower);
      drawFighter(ctx, slumped);
    });
    this.label('dead 8', ox + 300, oy + 676);

    const lying = fighter({ x: 0, feet: 0, side: 'enemy', limbs: LYING, alive: false, lift: -72, nocked: null, armor: 4 });
    this.world(ox + 500, oy + 712, k, (ctx) => drawFighter(ctx, lying));
    this.label('lying 4', ox + 500, oy + 730);
    const tumble = fighter({ x: 0, feet: 0, side: 'enemy', limbs: TUMBLE, alive: false, nocked: null, armor: 7 });
    tumble.stuck.push(stuckAt(lerpV(tumble.joints[J.neck]!, tumble.joints[J.pelvis]!, 0.5), 2.6, 'poison'));
    this.world(ox + 500, oy + 520, k, (ctx) => drawFighter(ctx, tumble));
    this.label('tumbling 7', ox + 500, oy + 560);

    const fx = fighter({ x: 0, feet: 0, side: 'enemy', aim: Math.PI + 0.12, nocked: 'poison', hp: 45, balloons: 3, poison: 2.5, stun: 1, flash: 0.55, armor: 8 });
    const q = fx.joints;
    fx.stuck.push(
      stuckAt(lerpV(q[J.neck]!, q[J.pelvis]!, 0.45), 0.12, 'normal'),
      stuckAt(q[J.head]!, -0.1, 'vampire', 2),
      stuckAt(lerpV(q[J.pelvis]!, q[J.kneeF]!, 0.55), 0.25, 'electric'),
    );
    this.world(ox + 660, oy + 640, k, (ctx) => drawFighter(ctx, fx));
    this.label('hit fx 8', ox + 660, oy + 654);
    const poisoned = fighter({ x: 0, feet: 0, side: 'enemy', aim: Math.PI + 0.3, hp: 30, poison: 2, armor: 4 });
    this.world(ox + 770, oy + 640, k, (ctx) => drawFighter(ctx, poisoned));
    this.label('poison 4', ox + 770, oy + 654);
    const up = fighter({ x: 0, feet: 0, aim: -0.7, draw: 1, armor: 8 });
    this.world(ox + 850, oy + 490, k, (ctx) => drawFighter(ctx, up));
    this.label('draw up 8', ox + 850, oy + 504);
    const jump = fighter({ x: 0, feet: 0, limbs: JUMP, lift: 34, aim: 0.25, draw: 0.8, nocked: 'split', armor: 2 });
    this.world(ox + 850, oy + 700, k, (ctx) => drawFighter(ctx, jump));
    this.label('jump 2', ox + 850, oy + 714);

    const z = 1.7;
    const hero = fighter({ x: 0, feet: 0, aim: -0.25, draw: 1, armor: 8 });
    this.world(ox + 990, oy + 720, z, (ctx) => drawFighter(ctx, hero));
    const foe = fighter({ x: 0, feet: 0, side: 'enemy', aim: Math.PI + 0.2, draw: 0.4, nocked: 'explosive', hp: 70, armor: 4 });
    this.world(ox + 1250, oy + 720, z, (ctx) => drawFighter(ctx, foe));
    this.label('close-up 8 / 4', ox + 1120, oy + 736);
  }

  /** Close-ups for reviewing details: fighters and props enlarged. */
  private buildZoom(ox: number, oy: number): void {
    const k = 1.9;
    const player = fighter({ x: 0, feet: 0, aim: -0.25, draw: 1 });
    const tower: PlatformView = {
      id: 3,
      kind: 'tower',
      x: 0,
      y: 250,
      w: 220,
      h: 500,
      angle: 0,
      stuck: [{ type: 'normal', x: 105, y: 40, angle: Math.PI - 0.2 }],
    };
    this.world(ox + 170, oy + 400, k, (ctx) => {
      drawPlatform(ctx, tower);
      drawFighter(ctx, player);
    });
    const enemy = fighter({ x: 0, feet: 0, side: 'enemy', aim: Math.PI + 0.1, draw: 0.3, nocked: 'explosive', hp: 64, poison: 1 });
    const block: PlatformView = { id: 4, kind: 'block', x: 0, y: 85, w: 120, h: 120, angle: Math.PI / 4, stuck: [] };
    this.world(ox + 640, oy + 400, k, (ctx) => {
      drawPlatform(ctx, block);
      drawFighter(ctx, enemy);
    });
    ARROWS.forEach((a, i) => {
      const y = oy + 30 + i * 44;
      this.world(ox + 1300, y, 3, (ctx) => drawArrow(ctx, a.id, 0, 0, 0));
    });
    APPLES.forEach((a, i) => this.world(ox + 880 + i * 90, oy + 690, 1.8, (ctx) => drawApple(ctx, a.kind, 0, 0, 22, 0)));
  }
}
