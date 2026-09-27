import { darken, mix, TAU, type Ctx2D } from '@engine';
import { ARROWS, type ArrowDef, type ArrowId } from '../config';
import { BODY } from '../types';
import { rrect } from './common';

/**
 * Arrow painters. Every arrow is drawn in a local frame: tip at (0, 0) pointing +x, the shaft running back to
 * x = -len (BODY.arrowLen for battle arrows, longer on the menu cards), half-height at most 8 units. Arrows that
 * fly left are mirrored instead of turned upside down, so axe blades, drips and fuses keep their side.
 */

interface ArrowInk {
  readonly def: ArrowDef;
  readonly shaft: string;
  readonly shaftHi: string;
  readonly shaftDark: string;
  readonly head: string;
  readonly headHi: string;
  readonly headDark: string;
  readonly fletch: string;
  readonly fletchDark: string;
}

type ArrowPainter = (ctx: Ctx2D, k: ArrowInk, rear: number, stuck: boolean) => void;

/** Stuck arrows start this far behind the tip: the head is buried, deeper parts are hidden by the body painted on top. */
const STUCK_FRONT = -6;
/** Dark rim under shafts and bodies: invisible on the dark battle void, keeps light arrows readable on light cards. */
const RIM = 'rgba(22,22,26,0.55)';
const STEEL = '#b4b4bb';
const STEEL_HI = '#e2e2e8';
const STEEL_DARK = '#6e6e76';
const IVORY = '#f4eee2';
const IVORY_DARK = '#a8997f';
const FUSE = '#d9c9a3';
const SPARK_OUT = '#ff9b2f';
const SPARK_IN = '#fff1a8';
const BOLT_GLOW = 'rgba(127,212,255,0.28)';
const BALLOON_HI = 'rgba(255,255,255,0.6)';
const COIL = '#d98f3f';
const SHINE = 'rgba(255,255,255,0.55)';

const INK = {} as Record<ArrowId, ArrowInk>;
for (const def of ARROWS) {
  INK[def.id] = {
    def,
    shaft: def.shaft,
    shaftHi: mix(def.shaft, '#ffffff', 0.42),
    shaftDark: darken(def.shaft, 0.14),
    head: def.head,
    headHi: mix(def.head, '#ffffff', 0.5),
    headDark: darken(def.head, 0.22),
    fletch: def.fletch,
    fletchDark: darken(def.fletch, 0.2),
  };
}

// ---------------------------------------------------------------- shared parts

function shaft(ctx: Ctx2D, k: ArrowInk, front: number, rear: number, w = 3): void {
  ctx.beginPath();
  ctx.moveTo(front, 0);
  ctx.lineTo(rear, 0);
  ctx.lineWidth = w + 1.3;
  ctx.strokeStyle = RIM;
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = k.shaft;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(front, -w * 0.2);
  ctx.lineTo(rear + 1, -w * 0.2);
  ctx.lineWidth = w * 0.34;
  ctx.strokeStyle = k.shaftHi;
  ctx.stroke();
}

/** One feather vane with two notches on its outer edge; sy = -1 upper, +1 lower. */
function vane(ctx: Ctx2D, r: number, sy: number): void {
  ctx.moveTo(r + 20, sy * 1.5);
  ctx.lineTo(r + 13, sy * 7.3);
  ctx.lineTo(r + 10.6, sy * 5.7);
  ctx.lineTo(r + 8.4, sy * 7.3);
  ctx.lineTo(r + 6, sy * 5.7);
  ctx.lineTo(r + 3.8, sy * 7.3);
  ctx.lineTo(r + 0.6, sy * 7.3);
  ctx.lineTo(r + 4.6, sy * 1.5);
  ctx.closePath();
}

/** Scalloped bat-wing vane (vampire). */
function batVane(ctx: Ctx2D, r: number, sy: number): void {
  ctx.moveTo(r + 21, sy * 1.5);
  ctx.lineTo(r + 15, sy * 7.8);
  ctx.quadraticCurveTo(r + 12.6, sy * 5.2, r + 10, sy * 7.4);
  ctx.quadraticCurveTo(r + 7.6, sy * 5.2, r + 5.2, sy * 7.4);
  ctx.quadraticCurveTo(r + 3, sy * 5.4, r + 0.4, sy * 7.8);
  ctx.lineTo(r + 4.4, sy * 1.5);
  ctx.closePath();
}

function fletching(ctx: Ctx2D, k: ArrowInk, r: number, bat = false): void {
  ctx.beginPath();
  if (bat) {
    batVane(ctx, r, -1);
    batVane(ctx, r, 1);
  } else {
    vane(ctx, r, -1);
    vane(ctx, r, 1);
  }
  ctx.fillStyle = k.fletch;
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = k.fletchDark;
  ctx.stroke();
  // quill line and nock
  ctx.beginPath();
  ctx.moveTo(r + 20, 0);
  ctx.lineTo(r + 1, 0);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = k.fletchDark;
  ctx.stroke();
  ctx.fillStyle = k.shaftDark;
  ctx.fillRect(r - 0.6, -2, 3, 4);
}

/** Barbed triangular head, tip at (tx, ty) pointing along (c, s); length l, half-width hw, notch depth n. */
function headPoly(ctx: Ctx2D, tx: number, ty: number, c: number, s: number, l: number, hw: number, n: number): void {
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - c * l + s * hw, ty - s * l - c * hw);
  ctx.lineTo(tx - c * (l - n), ty - s * (l - n));
  ctx.lineTo(tx - c * l - s * hw, ty - s * l + c * hw);
  ctx.closePath();
}

function fillStroke(ctx: Ctx2D, fill: string, stroke: string, w = 0.8): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = w;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/** Steel broadhead with a lit upper half. */
function steelHead(ctx: Ctx2D, l: number, hw: number, fill = STEEL, hi = STEEL_HI, dark = STEEL_DARK): void {
  ctx.beginPath();
  headPoly(ctx, 0, 0, 1, 0, l, hw, l * 0.24);
  fillStroke(ctx, fill, dark);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-l, -hw);
  ctx.lineTo(-l * 0.76, 0);
  ctx.closePath();
  ctx.fillStyle = hi;
  ctx.fill();
}

function teardrop(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.moveTo(x, y);
  ctx.arc(x, y + 2 * r, r, -Math.PI * 0.18, Math.PI * 1.18);
  ctx.closePath();
}

// ---------------------------------------------------------------- the ten arrows

const paintNormal: ArrowPainter = (ctx, k, r, stuck) => {
  shaft(ctx, k, stuck ? STUCK_FRONT : -9, r);
  fletching(ctx, k, r);
  if (stuck) return;
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(-13.5, -2, 4.5, 4);
  steelHead(ctx, 13, 5.2, k.head, k.headHi, k.headDark);
};

const paintElectric: ArrowPainter = (ctx, k, r, stuck) => {
  shaft(ctx, k, stuck ? STUCK_FRONT : -12, r);
  fletching(ctx, k, r);
  // copper coil behind the head
  ctx.beginPath();
  for (let x = -26; x <= -18; x += 2.7) {
    ctx.moveTo(x, -2.4);
    ctx.lineTo(x + 1.2, 2.4);
  }
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = COIL;
  ctx.stroke();
  if (stuck) return;
  ctx.beginPath();
  ctx.ellipse(-8, -2.4, 12, 7, 0, 0, TAU);
  ctx.fillStyle = BOLT_GLOW;
  ctx.fill();
  // lightning-bolt head: classic zigzag glyph turned to point along the flight
  ctx.beginPath();
  ctx.moveTo(-17, -0.9);
  ctx.lineTo(-17, -6);
  ctx.lineTo(-10.2, -3.4);
  ctx.lineTo(-10.2, -6.8);
  ctx.lineTo(0, 0);
  ctx.lineTo(-7.6, -1.7);
  ctx.lineTo(-7.6, 1.7);
  ctx.closePath();
  fillStroke(ctx, k.head, k.headDark, 0.9);
  ctx.beginPath();
  ctx.moveTo(-15.5, -3.6);
  ctx.lineTo(-9.5, -1.6);
  ctx.moveTo(-9.8, -4.6);
  ctx.lineTo(-2.2, -0.7);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
};

const paintPoison: ArrowPainter = (ctx, k, r, stuck) => {
  shaft(ctx, k, stuck ? STUCK_FRONT : -10, r);
  fletching(ctx, k, r);
  // venom sac
  ctx.beginPath();
  ctx.ellipse(-18.5, 0, 5.2, 3.9, 0, 0, TAU);
  fillStroke(ctx, k.fletch, k.shaftDark);
  ctx.beginPath();
  ctx.ellipse(-19.6, -1.5, 2, 1, -0.2, 0, TAU);
  ctx.fillStyle = SHINE;
  ctx.fill();
  if (stuck) return;
  // leaf-shaped head with drips hanging below
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-5, -5.6, -12.5, -3.4);
  ctx.lineTo(-10.6, 0);
  ctx.lineTo(-12.5, 3.4);
  ctx.quadraticCurveTo(-5, 5.6, 0, 0);
  ctx.closePath();
  fillStroke(ctx, k.head, k.headDark);
  ctx.beginPath();
  teardrop(ctx, -5.5, 2.6, 1.5);
  teardrop(ctx, -10, 3, 1.1);
  ctx.fillStyle = k.head;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-1.5, -0.4);
  ctx.quadraticCurveTo(-5, -3.4, -10, -2.4);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = k.headHi;
  ctx.stroke();
};

const paintBalloon: ArrowPainter = (ctx, k, r, stuck) => {
  shaft(ctx, k, stuck ? STUCK_FRONT : -20, r);
  fletching(ctx, k, r);
  if (stuck) return;
  steelHead(ctx, 7, 2.8);
  // knot and tie
  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.lineTo(-24, -2.3);
  ctx.lineTo(-24, 2.3);
  ctx.closePath();
  ctx.fillStyle = k.headDark;
  ctx.fill();
  // pink balloon bulb
  ctx.beginPath();
  ctx.ellipse(-13.6, 0, 7.4, 6.3, 0, 0, TAU);
  fillStroke(ctx, k.head, k.headDark, 0.9);
  ctx.beginPath();
  ctx.ellipse(-15.4, -2.5, 2.7, 1.5, -0.35, 0, TAU);
  ctx.fillStyle = BALLOON_HI;
  ctx.fill();
};

const paintExplosive: ArrowPainter = (ctx, k, r, stuck) => {
  shaft(ctx, k, stuck ? STUCK_FRONT : -8, r);
  fletching(ctx, k, r);
  if (!stuck) steelHead(ctx, 9.5, 3.8);
  // dynamite stick with two dark bands, fuse and spark at its back
  ctx.beginPath();
  rrect(ctx, -33, -5, 24, 10, 2.6);
  fillStroke(ctx, k.head, k.headDark, 0.9);
  ctx.fillStyle = k.headHi;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(-32, -3.9, 22, 1.7);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2e2e33';
  ctx.fillRect(-15.6, -5, 3, 10);
  ctx.fillRect(-28.4, -5, 3, 10);
  ctx.beginPath();
  ctx.moveTo(-33, -1.5);
  ctx.quadraticCurveTo(-36.5, -2, -37.6, -5.2);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = FUSE;
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const rr = i % 2 ? 1.1 : 2.6;
    const x = -37.6 + Math.cos(a) * rr;
    const y = -5.4 + Math.sin(a) * rr;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = SPARK_OUT;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-37.6, -5.4, 0.9, 0, TAU);
  ctx.fillStyle = SPARK_IN;
  ctx.fill();
};

const paintAxe: ArrowPainter = (ctx, k, r, stuck) => {
  shaft(ctx, k, stuck ? STUCK_FRONT : -5, r);
  fletching(ctx, k, r);
  if (stuck) return;
  // front spike and eye collar
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-6, -2);
  ctx.lineTo(-6, 2);
  ctx.closePath();
  fillStroke(ctx, k.head, k.headDark);
  // blade flaring up to a curved cutting edge, small poll spike below
  ctx.beginPath();
  ctx.moveTo(-12.5, -2.2);
  ctx.lineTo(-6, -2.2);
  ctx.lineTo(-1.2, -7.4);
  ctx.quadraticCurveTo(-9, -9.6, -17.2, -7.4);
  ctx.closePath();
  ctx.moveTo(-11.8, 2.2);
  ctx.lineTo(-6.8, 2.2);
  ctx.lineTo(-10.4, 5.4);
  ctx.closePath();
  fillStroke(ctx, k.head, k.headDark, 0.9);
  ctx.beginPath();
  ctx.moveTo(-2.4, -7.2);
  ctx.quadraticCurveTo(-9, -9.1, -16, -7.3);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = k.headHi;
  ctx.stroke();
  ctx.beginPath();
  rrect(ctx, -13.4, -2.7, 8, 5.4, 1.3);
  ctx.fillStyle = k.headDark;
  ctx.fill();
};

const SPLIT_C = Math.cos(0.4);
const SPLIT_S = Math.sin(0.4);

const paintSplit: ArrowPainter = (ctx, k, r, stuck) => {
  shaft(ctx, k, stuck ? STUCK_FRONT : -12, r);
  fletching(ctx, k, r);
  if (stuck) return;
  // fork carrying two side prongs
  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.quadraticCurveTo(-9.5, 0, -6.6, -4.4);
  ctx.moveTo(-14, 0);
  ctx.quadraticCurveTo(-9.5, 0, -6.6, 4.4);
  ctx.moveTo(-14, 0);
  ctx.lineTo(-6, 0);
  ctx.lineWidth = 1.7;
  ctx.strokeStyle = k.headDark;
  ctx.stroke();
  ctx.beginPath();
  headPoly(ctx, 0, 0, 1, 0, 8.5, 3.5, 2);
  headPoly(ctx, -2, -6.6, SPLIT_C, -SPLIT_S, 6.5, 2.7, 1.5);
  headPoly(ctx, -2, 6.6, SPLIT_C, SPLIT_S, 6.5, 2.7, 1.5);
  fillStroke(ctx, k.head, k.headDark);
};

const paintChainsaw: ArrowPainter = (ctx, k, r, stuck) => {
  shaft(ctx, k, -34, r);
  fletching(ctx, k, r);
  // motor housing
  ctx.beginPath();
  rrect(ctx, -38, -5.4, 9, 10.8, 2.2);
  fillStroke(ctx, k.fletch, k.fletchDark, 0.9);
  // stuck: only the rear half of the bar sticks out of the wound
  const front = stuck ? STUCK_FRONT : 0;
  // teeth along both edges of the bar, pointing forward
  ctx.beginPath();
  for (let x = -29; x < front - 4; x += 3.3) {
    ctx.moveTo(x, -4);
    ctx.lineTo(x + 3.3, -6.6);
    ctx.lineTo(x + 3.3, -4);
    ctx.moveTo(x, 4);
    ctx.lineTo(x + 3.3, 6.6);
    ctx.lineTo(x + 3.3, 4);
  }
  ctx.fillStyle = k.head;
  ctx.fill();
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = k.headDark;
  ctx.stroke();
  // chain rim and dark bar
  ctx.beginPath();
  rrect(ctx, -30, -4.7, 30 + front, 9.4, 4.7, stuck ? 0 : 4.7);
  ctx.fillStyle = k.head;
  ctx.fill();
  ctx.beginPath();
  rrect(ctx, -29, -3.3, 27.6 + front, 6.6, 3.3, stuck ? 0 : 3.3);
  ctx.fillStyle = k.shaft;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-26, -1.2);
  ctx.lineTo(front - 5, -1.2);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = k.shaftHi;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-25, 0.8, 1.2, 0, TAU);
  ctx.moveTo(-19.6, 0.8);
  ctx.arc(-20.8, 0.8, 1.2, 0, TAU);
  ctx.fillStyle = k.head;
  ctx.fill();
};

const paintVampire: ArrowPainter = (ctx, k, r, stuck) => {
  shaft(ctx, k, stuck ? STUCK_FRONT : -11, r);
  fletching(ctx, k, r, true);
  if (stuck) return;
  // curved ivory fang with a blood-red point, red collar and a drop
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-4.4, -5.8, -12.6, -5);
  ctx.lineTo(-12.6, 3.2);
  ctx.quadraticCurveTo(-5.2, 3, 0, 0);
  ctx.closePath();
  fillStroke(ctx, IVORY, IVORY_DARK, 0.8);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-2.6, -3.5, -5.6, -4.2);
  ctx.lineTo(-5.2, 2);
  ctx.quadraticCurveTo(-2.4, 1.7, 0, 0);
  ctx.closePath();
  ctx.fillStyle = k.head;
  ctx.fill();
  ctx.beginPath();
  teardrop(ctx, -3.2, 1.4, 1.3);
  ctx.fill();
  ctx.beginPath();
  rrect(ctx, -15.4, -3, 4, 6, 1.2);
  fillStroke(ctx, k.head, k.headDark, 0.7);
};

/** Longest rocket body (battle length); longer card arrows get a launch stick behind it. */
const MISSILE_TAIL = -BODY.arrowLen;

const paintMissile: ArrowPainter = (ctx, k, r, stuck) => {
  const t = Math.max(r, MISSILE_TAIL);
  if (r < t) {
    ctx.beginPath();
    ctx.moveTo(t + 4, 0);
    ctx.lineTo(r + 2, 0);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = RIM;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = STEEL_DARK;
    ctx.stroke();
    ctx.fillStyle = k.fletchDark;
    ctx.fillRect(r, -1.8, 3, 3.6);
  }
  const back = t + 7;
  // fins
  ctx.beginPath();
  ctx.moveTo(t + 19, -4.2);
  ctx.lineTo(t + 7.5, -8);
  ctx.lineTo(t + 3.4, -8);
  ctx.lineTo(t + 5, -4.2);
  ctx.closePath();
  ctx.moveTo(t + 19, 4.2);
  ctx.lineTo(t + 7.5, 8);
  ctx.lineTo(t + 3.4, 8);
  ctx.lineTo(t + 5, 4.2);
  ctx.closePath();
  fillStroke(ctx, k.fletch, k.fletchDark);
  // nozzle
  ctx.beginPath();
  ctx.moveTo(back + 1, -3);
  ctx.lineTo(t + 2.2, -3.9);
  ctx.lineTo(t + 2.2, 3.9);
  ctx.lineTo(back + 1, 3);
  ctx.closePath();
  ctx.fillStyle = '#55555d';
  ctx.fill();
  // white body with shade, highlight and a red band
  const front = stuck ? STUCK_FRONT : -12.5;
  ctx.beginPath();
  rrect(ctx, back, -4.4, front - back, 8.8, 1.6);
  fillStroke(ctx, k.shaft, RIM, 0.9);
  ctx.fillStyle = '#c3c7cf';
  ctx.fillRect(back + 0.5, 1.4, front - back - 1, 2.6);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(back + 1, -3.2, front - back - 2, 1.3);
  ctx.fillStyle = k.head;
  ctx.fillRect(t + 21, -4.4, 3.2, 8.8);
  // centre fin seen edge-on
  ctx.fillStyle = k.fletchDark;
  ctx.fillRect(t + 5, -1, 13, 2);
  if (stuck) return;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-3.4, -4.4, -13, -4.4);
  ctx.lineTo(-13, 4.4);
  ctx.quadraticCurveTo(-3.4, 4.4, 0, 0);
  ctx.closePath();
  fillStroke(ctx, k.head, k.headDark);
  ctx.beginPath();
  ctx.moveTo(-2, -1.1);
  ctx.quadraticCurveTo(-5, -3.2, -11, -3.3);
  ctx.lineWidth = 1;
  ctx.strokeStyle = k.headHi;
  ctx.stroke();
};

const PAINTERS: Record<ArrowId, ArrowPainter> = {
  normal: paintNormal,
  electric: paintElectric,
  poison: paintPoison,
  balloon: paintBalloon,
  explosive: paintExplosive,
  axe: paintAxe,
  split: paintSplit,
  chainsaw: paintChainsaw,
  vampire: paintVampire,
  missile: paintMissile,
};

function paintArrow(
  ctx: Ctx2D,
  type: ArrowId,
  x: number,
  y: number,
  angle: number,
  scale: number,
  len: number,
  stuck: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, Math.cos(angle) < 0 ? -scale : scale);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  PAINTERS[type](ctx, INK[type], -len, stuck);
  ctx.restore();
}

/** An arrow with its TIP at (x, y), pointing along angle; the shaft extends BODY.arrowLen * scale behind the tip. */
export function drawArrow(ctx: Ctx2D, type: ArrowId, x: number, y: number, angle: number, scale = 1): void {
  paintArrow(ctx, type, x, y, angle, scale, BODY.arrowLen, false);
}

/**
 * An arrow embedded tip-first at (x, y): the head and the first 6 units are left out, so paint it BEFORE the body or
 * stone it is stuck in and the shaft seems to come out of the surface (tips placed 6+ units deep leave no gap).
 */
export function drawStuckArrow(ctx: Ctx2D, type: ArrowId, x: number, y: number, angle: number, scale = 1): void {
  paintArrow(ctx, type, x, y, angle, scale, BODY.arrowLen, true);
}

/** Menu card art: the arrow lying horizontally in a w x h box, tip on the left, longer and slimmer than in battle. */
export function drawArrowCard(ctx: Ctx2D, type: ArrowId, w: number, h: number): void {
  const k = Math.min(1.9, (h * 0.5) / 8.4);
  const tip = 10;
  paintArrow(ctx, type, tip, h / 2, Math.PI, k, (w - tip - 6) / k, false);
}
