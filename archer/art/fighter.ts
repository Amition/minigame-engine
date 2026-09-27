import { clamp01, TAU, type Ctx2D } from '@engine';
import { COLORS } from '../config';
import { BODY, BONES, J, type FighterView, type JointIndex } from '../types';
import { drawArrow, drawStuckArrow } from './arrows';
import { artTime, colorSteps, hash01, pickStep, rrect } from './common';

/**
 * Stick-man archers. Everything is drawn live in world units from the joint snapshot (BODY sizes times f.scale):
 * back limbs, tapered torso with faint muscles, front leg, head, front (bow) arm, then bow, string, nocked arrow and
 * the fist on the grip. Arrows stuck in the body are painted first, so the body hides their embedded ends.
 * Armor (armorTier) is steel gear layered into that order: back shoulder guard behind the torso, chest plate and
 * helmet after the head, front shoulder guard over the bow arm.
 */

const HALF_PI = Math.PI / 2;
const TINT_STEPS = 12;
const FLASH_FRONT = colorSteps(COLORS.figure, '#ff8a8a', TINT_STEPS);
const FLASH_BACK = colorSteps(COLORS.figureShade, '#e36565', TINT_STEPS);
const POISON_FRONT = colorSteps(COLORS.figure, '#c4f2ad', TINT_STEPS);
const POISON_BACK = colorSteps(COLORS.figureShade, '#93d177', TINT_STEPS);
const FLASH_GLOW = '#ff5c5c';
const BOSS_RIM = '#202023';
const MUSCLE_LINE = 'rgba(46,46,56,0.17)';
const MUSCLE_FILL = 'rgba(46,46,56,0.1)';
const BACK_SHADE = 'rgba(46,46,56,0.07)';
const BOW_HI = '#ffd07a';
const HP_DARK = '#b7333a';
const HP_HI = 'rgba(255,255,255,0.28)';
const CROWN = '#f5c542';
const CROWN_DARK = '#b8861c';
const CROWN_GEM = '#e5484d';
const STRING_W = 1.1;
const BUBBLE = 'rgba(126,217,87,0.85)';
const BUBBLE_HI = 'rgba(235,255,220,0.9)';
const SPARK_GLOW = 'rgba(127,212,255,0.35)';
const BALLOON_STRING = 'rgba(233,233,233,0.75)';
const BALLOON_HI = 'rgba(255,255,255,0.55)';
const BALLOON_COLORS = ['#ff6b9a', '#ffd166', '#7fd4ff', '#a3e635', '#c38bff'] as const;
const BALLOON_KNOTS = ['#d94d7c', '#d9a93f', '#4fa9d6', '#7fb82a', '#9a62d9'] as const;

/** Blue-grey steel: dark outline (also the visor slit), shaded far plates, lit metal, highlight. */
export const ARMOR_COLORS = {
  dark: '#232a36',
  shade: '#667489',
  metal: '#98a8bd',
  hi: '#e6eef7',
} as const;
const ARMOR_FLASH = colorSteps(ARMOR_COLORS.metal, '#f4a7a7', TINT_STEPS);
const ARMOR_FLASH_SHADE = colorSteps(ARMOR_COLORS.shade, '#c8676c', TINT_STEPS);
const ARMOR_POISON = colorSteps(ARMOR_COLORS.metal, '#a9d493', TINT_STEPS);
const ARMOR_POISON_SHADE = colorSteps(ARMOR_COLORS.shade, '#6c9a57', TINT_STEPS);
const ARMOR_LINE = 1.6;
/** Helmet shell radius (local units at scale 1): a little proud of the head. */
const HELM_R = BODY.headR + 2.4;
/** How far a helmet pushes the boss crown up along the neck->head axis. */
const HELM_LIFT = 3.5;

/** Gear drawn for armor points: 0 none, 1 helmet (1-2), 2 helmet + chest plate (3-5), 3 visor helmet + chest plate + shoulder guards (6+). */
export function armorTier(armor: number): 0 | 1 | 2 | 3 {
  if (!(armor > 0)) return 0;
  return armor < 3 ? 1 : armor < 6 ? 2 : 3;
}

/**
 * Bow geometry (local units at scale 1, grip at the origin, +x = aim): the string's rest line lies BOW_REST behind
 * the grip and a full draw pulls the nock BOW_PULL further back (about the chin when the bow arm is straight).
 */
const BOW_REST = 15.5;
const BOW_PULL = 52;
const TIP_X = -BOW_REST;
const TIP_Y = 47;

/** Distance from the grip (handF) back along the aim to the nock and string hand, for a draw of 0..1. */
export function nockDistance(draw: number, scale = 1): number {
  return (BOW_REST + clamp01(draw) * BOW_PULL) * scale;
}

// bone kinds in painter order: 0 back limb, 1 torso, 2 front limb, 3 neck (followed by the head)
const BACK = new Set<number>([J.elbowB, J.handB, J.kneeB, J.footB]);
const BONE_KIND: readonly number[] = BONES.map(([a, b]) => {
  if ((a === J.neck && b === J.pelvis) || (a === J.pelvis && b === J.neck)) return 1;
  if (a === J.head || b === J.head) return 3;
  return BACK.has(a) || BACK.has(b) ? 0 : 2;
});

export function drawFighter(ctx: Ctx2D, f: FighterView): void {
  const flash = clamp01(f.flash);
  const pois = f.poison > 0 ? 0.35 + 0.35 * clamp01(f.poison / 3) : 0;
  const tier = armorTier(f.armor);
  let front: string = COLORS.figure;
  let back: string = COLORS.figureShade;
  let metal: string = ARMOR_COLORS.metal;
  let shade: string = ARMOR_COLORS.shade;
  if (flash > 0.02) {
    front = pickStep(FLASH_FRONT, flash * 0.85);
    back = pickStep(FLASH_BACK, flash * 0.85);
    metal = pickStep(ARMOR_FLASH, flash * 0.85);
    shade = pickStep(ARMOR_FLASH_SHADE, flash * 0.85);
  } else if (pois > 0) {
    front = pickStep(POISON_FRONT, pois);
    back = pickStep(POISON_BACK, pois);
    metal = pickStep(ARMOR_POISON, pois * 0.7);
    shade = pickStep(ARMOR_POISON_SHADE, pois * 0.7);
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (f.balloons > 0) paintBalloons(ctx, f);
  for (let i = 0; i < f.stuck.length; i++) {
    const st = f.stuck[i]!;
    drawStuckArrow(ctx, st.type, st.x, st.y, st.angle);
  }
  if (f.boss) paintSilhouette(ctx, f, BOSS_RIM, 5 * f.scale);
  if (flash > 0.02) {
    ctx.globalAlpha = flash * 0.45;
    paintSilhouette(ctx, f, FLASH_GLOW, 11 * f.scale);
    ctx.globalAlpha = flash * 0.35;
    paintSilhouette(ctx, f, '#ffffff', 5 * f.scale);
    ctx.globalAlpha = 1;
  }
  paintBody(ctx, f, front, back, tier, metal, shade);
  paintBow(ctx, f, front);
  if (pois > 0) paintPoison(ctx, f);
  if (f.stun > 0) paintStun(ctx, f);
  if (f.boss) paintCrown(ctx, f);
  ctx.restore();
  if (f.hpBar && f.alive) drawHpBar(ctx, f);
}

function paintBody(ctx: Ctx2D, f: FighterView, front: string, back: string, tier: number, metal: string, shade: string): void {
  const p = f.joints;
  const lw = BODY.limbW * f.scale;
  let open = -1;
  let last = -1;
  for (let i = 0; i < BONES.length; i++) {
    const bone = BONES[i]!;
    const a = bone[0];
    const b = bone[1];
    const kind = BONE_KIND[i]!;
    if (open >= 0 && kind !== open) {
      ctx.stroke();
      open = -1;
    }
    if (kind === 1) {
      if (tier >= 3) paintPauldron(ctx, f, J.elbowB, shade, shade);
      paintTorso(ctx, f, front);
      continue;
    }
    if (open < 0) {
      ctx.beginPath();
      ctx.lineWidth = lw;
      ctx.strokeStyle = kind === 0 ? back : front;
      open = kind;
      last = -1;
    }
    if (a !== last) ctx.moveTo(p[a]!.x, p[a]!.y);
    ctx.lineTo(p[b]!.x, p[b]!.y);
    last = b;
    if (kind === 3) {
      ctx.stroke();
      open = -1;
      paintHead(ctx, f, front);
      if (tier >= 2) paintChestPlate(ctx, f, tier, metal, shade);
      if (tier >= 1) paintHelmet(ctx, f, tier, metal, shade);
    }
  }
  if (open >= 0) ctx.stroke();
  if (tier >= 3) paintPauldron(ctx, f, J.elbowF, metal, shade);
}

/** Tapered capsule from the shoulders (wide) to the pelvis (narrow) plus faint chest and ab shading. */
function paintTorso(ctx: Ctx2D, f: FighterView, color: string): void {
  const s = f.scale;
  const n = f.joints[J.neck]!;
  const pv = f.joints[J.pelvis]!;
  let dx = pv.x - n.x;
  let dy = pv.y - n.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) {
    dx = 0;
    dy = 1;
  } else {
    dx /= len;
    dy /= len;
  }
  const r1 = BODY.torsoW * 0.56 * s;
  const r2 = BODY.torsoW * 0.4 * s;
  const off = r1 * 0.45;
  const tx = n.x + dx * off;
  const ty = n.y + dy * off;
  const L = Math.max(1e-3, len - off);
  const a = Math.atan2(dy, dx);
  const phi = Math.asin(Math.max(-1, Math.min(1, (r1 - r2) / L)));
  ctx.beginPath();
  ctx.arc(tx, ty, r1, a + HALF_PI - phi, a + 3 * HALF_PI + phi);
  ctx.arc(pv.x, pv.y, r2, a - HALF_PI + phi, a + HALF_PI - phi);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // muscles in a torso frame: origin at the neck, +y down the spine, +x toward the chest side
  const T = len;
  const W = BODY.torsoW * s;
  const cx = W * 0.07;
  ctx.save();
  ctx.translate(n.x, n.y);
  ctx.rotate(a - HALF_PI);
  ctx.scale(f.facing, 1);
  ctx.beginPath();
  ctx.moveTo(-W * 0.4, T * 0.16);
  ctx.quadraticCurveTo(-W * 0.44, T * 0.6, -W * 0.3, T * 0.98);
  ctx.lineWidth = W * 0.2;
  ctx.strokeStyle = BACK_SHADE;
  ctx.stroke();
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = MUSCLE_LINE;
  ctx.beginPath();
  ctx.moveTo(cx - W * 0.4, T * 0.27);
  ctx.quadraticCurveTo(cx - W * 0.2, T * 0.42, cx - W * 0.01, T * 0.3);
  ctx.moveTo(cx + W * 0.01, T * 0.3);
  ctx.quadraticCurveTo(cx + W * 0.2, T * 0.42, cx + W * 0.4, T * 0.27);
  ctx.moveTo(cx, T * 0.36);
  ctx.lineTo(cx, T * 0.9);
  ctx.stroke();
  ctx.beginPath();
  for (let row = 0; row < 3; row++) {
    const y = T * (0.5 + row * 0.15);
    const rx = W * (0.12 - row * 0.012);
    const ry = T * 0.058;
    ctx.moveTo(cx - W * 0.03, y);
    ctx.ellipse(cx - W * 0.03 - rx, y, rx, ry, 0, 0, TAU);
    ctx.moveTo(cx + W * 0.03 + 2 * rx, y);
    ctx.ellipse(cx + W * 0.03 + rx, y, rx, ry, 0, 0, TAU);
  }
  ctx.fillStyle = MUSCLE_FILL;
  ctx.fill();
  ctx.restore();
}

function paintHead(ctx: Ctx2D, f: FighterView, color: string): void {
  const h = f.joints[J.head]!;
  ctx.beginPath();
  ctx.arc(h.x, h.y, BODY.headR * f.scale, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Fill with the current fillStyle, then the dark gear outline. */
function fillOutlined(ctx: Ctx2D, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = ARMOR_LINE;
  ctx.strokeStyle = ARMOR_COLORS.dark;
  ctx.stroke();
}

/** Helmet in a head frame: origin at the head centre, -y along neck->head, +x toward the facing side, scale units. */
function paintHelmet(ctx: Ctx2D, f: FighterView, tier: number, metal: string, shade: string): void {
  const h = f.joints[J.head]!;
  upAxis(f, up);
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(Math.atan2(up.y, up.x) + HALF_PI);
  ctx.scale(f.facing * f.scale, f.scale);
  if (tier >= 3) paintVisorHelm(ctx, metal, shade);
  else paintCap(ctx, metal, shade);
  ctx.restore();
}

/** Open steel cap: dome over the brow, a highlight on the crown, a brim band jutting out over the face. */
function paintCap(ctx: Ctx2D, metal: string, shade: string): void {
  ctx.beginPath();
  ctx.arc(0, -1, HELM_R, Math.PI, TAU);
  ctx.closePath();
  fillOutlined(ctx, metal);
  ctx.beginPath();
  ctx.arc(0, -1, HELM_R - 4.2, Math.PI + 0.5, Math.PI + 1.35);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = ARMOR_COLORS.hi;
  ctx.stroke();
  ctx.beginPath();
  rrect(ctx, -HELM_R - 1.2, -3, 2 * HELM_R + 5.5, 5.6, 2.8);
  fillOutlined(ctx, shade);
}

/** Closed helm: round shell, a visor plate with a snout pivoting on a side rivet, eye slit and breath holes. */
function paintVisorHelm(ctx: Ctx2D, metal: string, shade: string): void {
  ctx.beginPath();
  ctx.arc(0, 0, HELM_R, 0, TAU);
  fillOutlined(ctx, shade);
  ctx.beginPath();
  ctx.arc(0, 0, HELM_R - 4, Math.PI + 0.45, Math.PI + 1.4);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = ARMOR_COLORS.hi;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-3.5, -11);
  ctx.quadraticCurveTo(12, -15.5, HELM_R + 3.5, -2);
  ctx.quadraticCurveTo(HELM_R + 1.5, 11, 6.5, HELM_R - 1);
  ctx.quadraticCurveTo(-2.5, 12, -3.5, -11);
  ctx.closePath();
  fillOutlined(ctx, metal);
  ctx.beginPath();
  rrect(ctx, 2, -6, HELM_R + 1, 3.6, 1.8);
  ctx.moveTo(10.5, 6);
  ctx.arc(9.5, 6, 1.1, 0, TAU);
  ctx.moveTo(15, 5);
  ctx.arc(14, 5, 1.1, 0, TAU);
  ctx.moveTo(13.5, 9.8);
  ctx.arc(12.5, 9.8, 1.1, 0, TAU);
  ctx.fillStyle = ARMOR_COLORS.dark;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-2, -0.5, 2.2, 0, TAU);
  ctx.fillStyle = ARMOR_COLORS.hi;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = ARMOR_COLORS.dark;
  ctx.stroke();
}

/**
 * Breastplate in the torso frame (origin at the neck, +y down the spine, +x toward the chest side, scale units):
 * shaded back half, lit chest half split by a keel ridge, neckline scooped around the neck. Tier 3 adds two faulds.
 */
function paintChestPlate(ctx: Ctx2D, f: FighterView, tier: number, metal: string, shade: string): void {
  const n = f.joints[J.neck]!;
  const pv = f.joints[J.pelvis]!;
  const dx = pv.x - n.x;
  const dy = pv.y - n.y;
  const a = Math.abs(dx) + Math.abs(dy) < 1e-3 ? HALF_PI : Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(n.x, n.y);
  ctx.rotate(a - HALF_PI);
  ctx.scale(f.facing * f.scale, f.scale);
  if (tier >= 3) {
    ctx.beginPath();
    rrect(ctx, -10, 44, 22, 7, 3.5);
    fillOutlined(ctx, shade);
    ctx.beginPath();
    rrect(ctx, -11.5, 37.5, 25, 7.5, 3.75);
    fillOutlined(ctx, metal);
  }
  ctx.beginPath();
  breastplatePath(ctx);
  ctx.fillStyle = metal;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-13, 2);
  ctx.quadraticCurveTo(-13.5, -6.5, -6.5, -6);
  ctx.quadraticCurveTo(-2.5, -3.5, 1.5, -3.5);
  ctx.lineTo(1.5, 44);
  ctx.quadraticCurveTo(-6, 43, -10.5, 33);
  ctx.quadraticCurveTo(-12.8, 22, -13, 2);
  ctx.closePath();
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(4, -2);
  ctx.lineTo(4, 38);
  ctx.lineWidth = 2;
  ctx.strokeStyle = ARMOR_COLORS.hi;
  ctx.stroke();
  ctx.beginPath();
  breastplatePath(ctx);
  ctx.lineWidth = ARMOR_LINE;
  ctx.strokeStyle = ARMOR_COLORS.dark;
  ctx.stroke();
  ctx.restore();
}

/** Breastplate outline; the shaded back half in paintChestPlate reuses its back-side curves and keel point. */
function breastplatePath(ctx: Ctx2D): void {
  ctx.moveTo(-13, 2);
  ctx.quadraticCurveTo(-13.5, -6.5, -6.5, -6);
  ctx.quadraticCurveTo(1.5, -1, 9.5, -6);
  ctx.quadraticCurveTo(15.5, -6.5, 15, 2);
  ctx.quadraticCurveTo(14.5, 22, 12, 33);
  ctx.quadraticCurveTo(9, 43, 1.5, 44);
  ctx.quadraticCurveTo(-6, 43, -10.5, 33);
  ctx.quadraticCurveTo(-12.8, 22, -13, 2);
  ctx.closePath();
}

/** Layered shoulder guard over the shoulder end of an upper arm (frame: origin at the neck, +x toward the elbow). */
function paintPauldron(ctx: Ctx2D, f: FighterView, elbow: JointIndex, cap: string, lame: string): void {
  const n = f.joints[J.neck]!;
  const e = f.joints[elbow]!;
  const dx = e.x - n.x;
  const dy = e.y - n.y;
  const a = Math.abs(dx) + Math.abs(dy) < 1e-3 ? HALF_PI : Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(n.x, n.y);
  ctx.rotate(a);
  ctx.scale(f.scale, f.scale);
  ctx.beginPath();
  ctx.ellipse(17, 0, 5.5, 7.6, 0, 0, TAU);
  fillOutlined(ctx, lame);
  ctx.beginPath();
  ctx.ellipse(10.5, 0, 8.5, 9.6, 0, 0, TAU);
  fillOutlined(ctx, cap);
  ctx.beginPath();
  ctx.ellipse(9.5, 0, 4, 2.2, 0, 0, TAU);
  ctx.fillStyle = ARMOR_COLORS.hi;
  ctx.fill();
  ctx.restore();
}

/** Every bone, the torso and the head as one wide stroke: boss rim and hit glow. */
function paintSilhouette(ctx: Ctx2D, f: FighterView, color: string, extra: number): void {
  const p = f.joints;
  const s = f.scale;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = BODY.limbW * s + extra;
  ctx.beginPath();
  for (let i = 0; i < BONES.length; i++) {
    if (BONE_KIND[i] === 1) continue;
    const bone = BONES[i]!;
    ctx.moveTo(p[bone[0]]!.x, p[bone[0]]!.y);
    ctx.lineTo(p[bone[1]]!.x, p[bone[1]]!.y);
  }
  ctx.stroke();
  ctx.lineWidth = BODY.torsoW * 0.95 * s + extra;
  ctx.beginPath();
  ctx.moveTo(p[J.neck]!.x, p[J.neck]!.y);
  ctx.lineTo(p[J.pelvis]!.x, p[J.pelvis]!.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p[J.head]!.x, p[J.head]!.y, (f.armor > 0 ? HELM_R + 1 : BODY.headR) * s + extra / 2, 0, TAU);
  ctx.fill();
}

/** Upper recurve limb centre line (sy = -1) or the mirrored lower one (sy = 1), shifted by dx along the aim. */
function bowLimbs(ctx: Ctx2D, dx: number): void {
  for (let sy = -1; sy <= 1; sy += 2) {
    ctx.moveTo(1 + dx, 0);
    ctx.bezierCurveTo(1 + dx, sy * 16, -8 + dx, sy * 31, -17 + dx, sy * 39.5);
    ctx.quadraticCurveTo(-21 + dx, sy * 43.5, TIP_X + dx, sy * TIP_Y);
  }
}

function paintBow(ctx: Ctx2D, f: FighterView, skin: string): void {
  const s = f.scale;
  const p = f.joints;
  const hand = p[J.handF]!;
  let angle = f.aimAngle;
  if (!f.alive) {
    const el = p[J.elbowF]!;
    if (Math.abs(hand.x - el.x) + Math.abs(hand.y - el.y) > 1e-3) angle = Math.atan2(hand.y - el.y, hand.x - el.x);
  }
  const c = Math.cos(angle);
  const sn = Math.sin(angle);

  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(angle);
  ctx.scale(s, s);
  ctx.beginPath();
  bowLimbs(ctx, -1.1);
  ctx.lineWidth = 5.4;
  ctx.strokeStyle = COLORS.bowDark;
  ctx.stroke();
  ctx.beginPath();
  bowLimbs(ctx, 0);
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLORS.bow;
  ctx.stroke();
  ctx.beginPath();
  for (let sy = -1; sy <= 1; sy += 2) {
    ctx.moveTo(2.6, sy * 5);
    ctx.bezierCurveTo(2.6, sy * 16, -5.6, sy * 29, -13, sy * 36);
  }
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = BOW_HI;
  ctx.stroke();
  ctx.beginPath();
  rrect(ctx, -2.8, -8, 6.2, 16, 2.6);
  ctx.fillStyle = COLORS.bowDark;
  ctx.fill();
  ctx.restore();

  // string: tips -> nock (pulled back toward the string hand while drawing)
  const ux = TIP_X * s;
  const uy = TIP_Y * s;
  const t1x = hand.x + ux * c + uy * sn;
  const t1y = hand.y + ux * sn - uy * c;
  const t2x = hand.x + ux * c - uy * sn;
  const t2y = hand.y + ux * sn + uy * c;
  let d = BOW_REST * s;
  if (f.alive && f.draw > 0.01) {
    const hb = p[J.handB]!;
    const proj = (hand.x - hb.x) * c + (hand.y - hb.y) * sn;
    const want = nockDistance(f.draw, s);
    d = Math.abs(proj - want) < 14 * s ? Math.max(BOW_REST * s, Math.min((BOW_REST + BOW_PULL) * s, proj)) : want;
  }
  const nx = hand.x - c * d;
  const ny = hand.y - sn * d;
  ctx.beginPath();
  ctx.moveTo(t1x, t1y);
  ctx.lineTo(nx, ny);
  ctx.lineTo(t2x, t2y);
  ctx.lineWidth = STRING_W * s;
  ctx.strokeStyle = COLORS.bowString;
  ctx.stroke();

  if (f.nocked && f.alive) {
    const len = BODY.arrowLen * s;
    drawArrow(ctx, f.nocked, nx + c * len, ny + sn * len, angle, s);
  }
  // fist over the grip
  ctx.beginPath();
  ctx.arc(hand.x, hand.y, BODY.limbW * 0.6 * s, 0, TAU);
  ctx.fillStyle = skin;
  ctx.fill();
}

function paintBalloons(ctx: Ctx2D, f: FighterView): void {
  const s = f.scale;
  const n = Math.min(6, Math.floor(f.balloons));
  const neck = f.joints[J.neck]!;
  const t = artTime();
  const bx = neck.x;
  const by = neck.y - 6 * s;
  for (let i = 0; i < n; i++) {
    const phase = t * 2.1 + i * 1.9 + f.id * 0.7;
    const spread = (i - (n - 1) / 2) * 30 * s;
    const x = bx + spread + Math.sin(phase) * 4 * s;
    const y = neck.y - (104 + (i % 2) * 18) * s + Math.cos(phase * 0.8) * 3.5 * s;
    const rx = 15 * s;
    const ry = 18 * s;
    const knotY = y + ry;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + spread * 0.2 + Math.sin(phase + 1) * 8 * s, (by + knotY) / 2, x, knotY + 3 * s);
    ctx.lineWidth = 1.2 * s;
    ctx.strokeStyle = BALLOON_STRING;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, knotY - 1 * s);
    ctx.lineTo(x - 3.2 * s, knotY + 4 * s);
    ctx.lineTo(x + 3.2 * s, knotY + 4 * s);
    ctx.closePath();
    ctx.fillStyle = BALLOON_KNOTS[i % BALLOON_KNOTS.length]!;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.fillStyle = BALLOON_COLORS[i % BALLOON_COLORS.length]!;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.4, y - ry * 0.42, rx * 0.26, ry * 0.17, -0.6, 0, TAU);
    ctx.fillStyle = BALLOON_HI;
    ctx.fill();
  }
}

/** Green bubbles rising off the torso. */
function paintPoison(ctx: Ctx2D, f: FighterView): void {
  const s = f.scale;
  const n = f.joints[J.neck]!;
  const pv = f.joints[J.pelvis]!;
  const t = artTime();
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const ph = (t * 0.8 + i * 0.2 + f.id * 0.13) % 1;
    const k = 0.25 + ((i * 0.37) % 0.6);
    const x0 = n.x + (pv.x - n.x) * k + Math.sin(t * 3 + i * 2.1) * 9 * s;
    const y0 = n.y + (pv.y - n.y) * k - ph * 46 * s;
    const r = (2 + (1 - ph) * 2.8) * s;
    ctx.moveTo(x0 + r, y0);
    ctx.arc(x0, y0, r, 0, TAU);
  }
  ctx.fillStyle = BUBBLE;
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const ph = (t * 0.8 + i * 0.2 + f.id * 0.13) % 1;
    const k = 0.25 + ((i * 0.37) % 0.6);
    const x0 = n.x + (pv.x - n.x) * k + Math.sin(t * 3 + i * 2.1) * 9 * s;
    const y0 = n.y + (pv.y - n.y) * k - ph * 46 * s;
    const r = (2 + (1 - ph) * 2.8) * s;
    ctx.moveTo(x0 - r * 0.2, y0 - r * 0.35);
    ctx.arc(x0 - r * 0.35, y0 - r * 0.35, r * 0.3, 0, TAU);
  }
  ctx.fillStyle = BUBBLE_HI;
  ctx.fill();
}

/** Small electric zigzags flickering around the head and chest. */
function paintStun(ctx: Ctx2D, f: FighterView): void {
  const s = f.scale;
  const h = f.joints[J.head]!;
  const n = f.joints[J.neck]!;
  const pv = f.joints[J.pelvis]!;
  const frame = Math.floor(artTime() * 14) + f.id * 131;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const seed = frame * 7 + i * 13;
    const onHead = i < 3;
    const cx = onHead ? h.x : (n.x + pv.x) / 2;
    const cy = onHead ? h.y : (n.y + pv.y) / 2;
    const a = hash01(seed) * TAU;
    const r0 = (onHead ? BODY.headR * 1.15 : BODY.torsoW * 0.7) * s;
    let x = cx + Math.cos(a) * r0;
    let y = cy + Math.sin(a) * r0;
    ctx.moveTo(x, y);
    const seg = 5.5 * s;
    for (let j = 0; j < 3; j++) {
      const side = j % 2 ? 1 : -1;
      const ja = a + side * 0.9 + (hash01(seed + j + 1) - 0.5) * 0.6;
      x += Math.cos(ja) * seg;
      y += Math.sin(ja) * seg;
      ctx.lineTo(x, y);
    }
  }
  ctx.lineWidth = 4.2 * s;
  ctx.strokeStyle = SPARK_GLOW;
  ctx.stroke();
  ctx.lineWidth = 1.6 * s;
  ctx.strokeStyle = COLORS.electric;
  ctx.stroke();
}

/** Unit vector from neck to head (the body's "up"), or straight up when degenerate. */
function upAxis(f: FighterView, out: { x: number; y: number }): void {
  const h = f.joints[J.head]!;
  const n = f.joints[J.neck]!;
  const dx = h.x - n.x;
  const dy = h.y - n.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-3) {
    out.x = 0;
    out.y = -1;
  } else {
    out.x = dx / l;
    out.y = dy / l;
  }
}

const up = { x: 0, y: -1 };

function paintCrown(ctx: Ctx2D, f: FighterView): void {
  const s = f.scale;
  const h = f.joints[J.head]!;
  upAxis(f, up);
  const d = (BODY.headR * 0.82 + (f.armor > 0 ? HELM_LIFT : 0)) * s;
  ctx.save();
  ctx.translate(h.x + up.x * d, h.y + up.y * d);
  ctx.rotate(Math.atan2(up.y, up.x) + HALF_PI);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(-10, 2);
  ctx.lineTo(-11.5, -9);
  ctx.lineTo(-5, -3.5);
  ctx.lineTo(0, -12);
  ctx.lineTo(5, -3.5);
  ctx.lineTo(11.5, -9);
  ctx.lineTo(10, 2);
  ctx.closePath();
  ctx.fillStyle = CROWN;
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = CROWN_DARK;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -2, 1.9, 0, TAU);
  ctx.fillStyle = CROWN_GEM;
  ctx.fill();
  ctx.restore();
}

/** The red health bar floating above an enemy's head, tilted with the head. */
export function drawHpBar(ctx: Ctx2D, f: FighterView): void {
  const s = f.scale;
  const h = f.joints[J.head]!;
  upAxis(f, up);
  const d = (BODY.headR + (f.boss ? 30 : 20)) * s;
  const w = (f.boss ? 64 : 50) * s;
  const bh = 6 + 5 * s;
  const k = f.maxHp > 0 ? clamp01(f.hp / f.maxHp) : 0;
  ctx.save();
  ctx.translate(h.x + up.x * d, h.y + up.y * d);
  ctx.rotate(Math.atan2(up.y, up.x) + HALF_PI);
  ctx.beginPath();
  rrect(ctx, -w / 2 - 1.5, -bh / 2 - 1.5, w + 3, bh + 3, 3);
  ctx.fillStyle = COLORS.barTrack;
  ctx.fill();
  if (k > 0) {
    const fw = w * k;
    ctx.fillStyle = COLORS.hp;
    ctx.fillRect(-w / 2, -bh / 2, fw, bh);
    ctx.fillStyle = HP_DARK;
    ctx.fillRect(-w / 2, bh * 0.18, fw, bh * 0.32);
    ctx.fillStyle = HP_HI;
    ctx.fillRect(-w / 2, -bh / 2, fw, bh * 0.22);
  }
  ctx.restore();
}
