import { bakeTexture, Node, Rng, type Ctx2D, type NodeOptions, type Texture } from '@engine';
import { FRUIT_TEX_PAD, FRUITS, fruit } from '../fruits';
import { fruitPainters } from './fruit-bodies';

/**
 * Fruit art: baked body textures (fruit-bodies.ts) plus live kawaii faces.
 * The public API below is the contract used by the play scene; keep the signatures.
 */

export type FruitFace = 'idle' | 'blink' | 'happy' | 'surprised' | 'worried';

const TAU = Math.PI * 2;
const cache = new Map<number, Texture>();
let bakedResolution = 2;

/** Bakes body textures for every level (cached; call again with another resolution to rebake). */
export function bakeFruitArt(resolution = 2): void {
  if (resolution !== bakedResolution) cache.clear();
  bakedResolution = resolution;
  for (const f of FRUITS) fruitTexture(f.level);
}

/** Body texture of a level: FRUIT_TEX_PAD * 2r square, fruit circle centred. Bakes on first use. */
export function fruitTexture(level: number): Texture {
  let t = cache.get(level);
  if (t) return t;
  const f = fruit(level);
  const paint = fruitPainters[level]!;
  const size = FRUIT_TEX_PAD * 2 * f.radius;
  t = bakeTexture(
    size,
    size,
    (ctx, w, h) => {
      ctx.translate(w / 2, h / 2);
      paint(ctx, f.radius);
    },
    { resolution: bakedResolution, key: `fruit:${f.key}` },
  );
  cache.set(level, t);
  return t;
}

const BLUSH = 'rgba(255,105,130,0.5)';
const BLUSH_ON_RED = 'rgba(255,190,200,0.6)';
const BLUSH_ON_GREEN = 'rgba(255,150,178,0.88)';

/** Where the face sits on each level, in units of r: centre offset (x, y), face size k and cheek colour. */
const FACE_SPOTS: readonly { x: number; y: number; k: number; blush: string }[] = [
  { x: 0, y: 0.1, k: 1, blush: 'rgba(255,140,190,0.6)' }, // grape
  { x: 0, y: 0.12, k: 0.95, blush: BLUSH_ON_RED }, // cherry: below the stem
  { x: 0, y: 0.1, k: 0.9, blush: BLUSH }, // orange
  { x: 0, y: 0.06, k: 0.86, blush: BLUSH }, // lemon
  { x: 0, y: 0, k: 0.66, blush: BLUSH }, // kiwi: on the pale core, inside the seed ring
  { x: 0, y: 0.14, k: 0.8, blush: BLUSH_ON_RED }, // tomato: below the calyx
  { x: -0.1, y: 0.12, k: 0.78, blush: BLUSH }, // peach: left of the crease
  { x: 0, y: 0.1, k: 0.72, blush: BLUSH }, // pineapple
  { x: 0, y: 0.02, k: 0.66, blush: BLUSH }, // coconut: in the hollow
  { x: 0, y: 0, k: 0.6, blush: BLUSH_ON_RED }, // half melon: on the flesh inside the seed ring
  { x: 0, y: 0.08, k: 0.6, blush: BLUSH_ON_GREEN }, // watermelon: between the front stripes
];

const INK = '#2e1a12';
const MOUTH = '#7a2324';
const TONGUE = '#ff7d8e';
const SWEAT = 'rgba(140,210,255,0.9)';

/** Draws a level's face centred at (0, 0) for a fruit of radius r (the caller has applied the fruit's rotation). */
export function drawFruitFace(ctx: Ctx2D, level: number, r: number, face: FruitFace): void {
  const spot = FACE_SPOTS[level] ?? FACE_SPOTS[0]!;
  const u = r * spot.k;
  if (u <= 0) return;
  const cx = r * spot.x;
  const cy = r * spot.y;
  const small = u < 34;
  const ex = 0.3 * u;
  const ey = cy - 0.06 * u;
  const erx = Math.max(1.8, 0.075 * u);
  const ery = Math.max(2.3, 0.1 * u);
  const lw = Math.max(1.3, 0.04 * u);
  const my = cy + 0.15 * u;
  const lx = cx - ex;
  const rx = cx + ex;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // cheeks
  const bx = 0.47 * u;
  const by = cy + 0.1 * u;
  const brx = 0.12 * u;
  const bry = 0.07 * u;
  ctx.fillStyle = spot.blush;
  ctx.beginPath();
  ctx.ellipse(cx - bx, by, brx, bry, 0, 0, TAU);
  ctx.moveTo(cx + bx + brx, by);
  ctx.ellipse(cx + bx, by, brx, bry, 0, 0, TAU);
  ctx.fill();

  // eyes
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  if (face === 'blink' || face === 'happy') {
    ctx.lineWidth = lw * 1.1;
    ctx.beginPath();
    if (face === 'blink') {
      const k = erx * 1.25;
      const oy = ey - k * 0.35;
      ctx.moveTo(lx + Math.cos(0.15 * Math.PI) * k, oy + Math.sin(0.15 * Math.PI) * k);
      ctx.arc(lx, oy, k, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.moveTo(rx + Math.cos(0.15 * Math.PI) * k, oy + Math.sin(0.15 * Math.PI) * k);
      ctx.arc(rx, oy, k, 0.15 * Math.PI, 0.85 * Math.PI);
    } else {
      const k = erx * 1.35;
      const oy = ey + k * 0.55;
      ctx.moveTo(lx + Math.cos(1.15 * Math.PI) * k, oy + Math.sin(1.15 * Math.PI) * k);
      ctx.arc(lx, oy, k, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.moveTo(rx + Math.cos(1.15 * Math.PI) * k, oy + Math.sin(1.15 * Math.PI) * k);
      ctx.arc(rx, oy, k, 1.15 * Math.PI, 1.85 * Math.PI);
    }
    ctx.stroke();
  } else {
    const s = face === 'surprised' ? 1.12 : face === 'worried' ? 0.92 : 1;
    const ryE = ery * s;
    const rxE = face === 'surprised' ? ryE * 0.92 : erx * s;
    ctx.beginPath();
    ctx.ellipse(lx, ey, rxE, ryE, 0, 0, TAU);
    ctx.moveTo(rx + rxE, ey);
    ctx.ellipse(rx, ey, rxE, ryE, 0, 0, TAU);
    ctx.fill();
    const hr = Math.max(0.75, 0.036 * u * s);
    const hx = -rxE * 0.3;
    const hy = ey - ryE * 0.38;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(lx + hx, hy, hr, 0, TAU);
    ctx.moveTo(rx + hx + hr, hy);
    ctx.arc(rx + hx, hy, hr, 0, TAU);
    ctx.fill();
    if (face === 'worried') {
      ctx.lineWidth = lw * 0.9;
      ctx.beginPath();
      ctx.moveTo(lx - 0.1 * u, ey - 0.17 * u);
      ctx.lineTo(lx + 0.07 * u, ey - 0.25 * u);
      ctx.moveTo(rx + 0.1 * u, ey - 0.17 * u);
      ctx.lineTo(rx - 0.07 * u, ey - 0.25 * u);
      ctx.stroke();
    }
  }

  // mouth
  ctx.lineWidth = lw;
  if (face === 'happy') {
    const w = Math.max(3, 0.13 * u);
    const d = Math.max(3.2, 0.2 * u);
    const top = my - 0.04 * u;
    ctx.fillStyle = MOUTH;
    ctx.beginPath();
    ctx.moveTo(cx - w, top);
    ctx.lineTo(cx + w, top);
    ctx.bezierCurveTo(cx + w, top + d, cx - w, top + d, cx - w, top);
    ctx.fill();
    if (!small) {
      ctx.fillStyle = TONGUE;
      ctx.beginPath();
      ctx.ellipse(cx, top + d * 0.53, w * 0.42, d * 0.16, 0, 0, TAU);
      ctx.fill();
    }
  } else if (face === 'surprised') {
    ctx.fillStyle = MOUTH;
    ctx.beginPath();
    ctx.ellipse(cx, my + 0.02 * u, Math.max(1.8, 0.055 * u), Math.max(2.3, 0.072 * u), 0, 0, TAU);
    ctx.fill();
  } else if (face === 'worried') {
    const w = Math.max(3, 0.12 * u);
    const a = Math.max(1, 0.05 * u);
    ctx.beginPath();
    ctx.moveTo(cx - w, my + a * 0.3);
    ctx.quadraticCurveTo(cx - w * 0.5, my - a, cx, my + a * 0.3);
    ctx.quadraticCurveTo(cx + w * 0.5, my + a * 1.6, cx + w, my + a * 0.3);
    ctx.stroke();
    if (!small) {
      const x = rx + 0.26 * u;
      const y = ey - 0.14 * u;
      const h = 0.09 * u;
      ctx.fillStyle = SWEAT;
      ctx.beginPath();
      ctx.moveTo(x, y - h * 1.3);
      ctx.bezierCurveTo(x + h * 0.8, y - h * 0.1, x + h * 0.75, y + h * 0.8, x, y + h * 0.8);
      ctx.bezierCurveTo(x - h * 0.75, y + h * 0.8, x - h * 0.8, y - h * 0.1, x, y - h * 1.3);
      ctx.fill();
    }
  } else {
    const k = Math.max(2.4, 0.09 * u);
    const oy = my - k * 0.7;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(0.2 * Math.PI) * k, oy + Math.sin(0.2 * Math.PI) * k);
    ctx.arc(cx, oy, k, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }
}

const blinkRng = new Rng(7);

/** Squash spring: angular frequency (period 0.2 s), damping ratio and velocity added per unit of strength. */
const SQUASH_W = TAU / 0.2;
const SQUASH_DAMP = 0.32;
const SQUASH_KICK = 9;

/**
 * A fruit on screen. (x, y) is the fruit centre (anchor 0.5), rotation is the physics angle. `radius` scales body and
 * face together (grow / pop animations); it defaults to the level's radius. `face` is the expression; idle fruits
 * blink by themselves. `squash()` plays a short screen-space squash-and-stretch wobble.
 */
export class FruitNode extends Node {
  readonly level: number;
  face: FruitFace = 'idle';
  private _radius: number;
  private blinkIn = blinkRng.float(1.5, 5);
  private blinkLeft = 0;
  /** Squash amount (+ = flattened, - = stretched) and its velocity. */
  private squashA = 0;
  private squashV = 0;

  constructor(level: number, opts?: NodeOptions) {
    super();
    this.level = level;
    this._radius = fruit(level).radius;
    this.setSize(this._radius * 2, this._radius * 2);
    this.anchorX = this.anchorY = 0.5;
    if (opts) this.set(opts);
  }

  override get kind(): string {
    return 'Fruit';
  }

  get radius(): number {
    return this._radius;
  }

  set radius(r: number) {
    this._radius = Math.max(0, r);
    this.setSize(this._radius * 2, this._radius * 2);
  }

  /** Squash-and-stretch wobble (~0.3 s). strength 1 flattens by about 19%; repeated hits add up (capped). */
  squash(strength = 1): void {
    this.squashV += SQUASH_KICK * Math.max(0, Math.min(2, strength));
  }

  override update(dt: number): void {
    if (this.blinkLeft > 0) {
      this.blinkLeft -= dt;
    } else if ((this.blinkIn -= dt) <= 0) {
      this.blinkLeft = 0.12;
      this.blinkIn = blinkRng.float(2, 6);
    }
    if (this.squashA !== 0 || this.squashV !== 0) {
      let left = Math.min(dt, 0.1);
      while (left > 1e-6) {
        const h = Math.min(left, 1 / 60);
        this.squashV -= (SQUASH_W * SQUASH_W * this.squashA + 2 * SQUASH_DAMP * SQUASH_W * this.squashV) * h;
        this.squashA += this.squashV * h;
        left -= h;
      }
      if (Math.abs(this.squashA) < 1e-3 && Math.abs(this.squashV) < 0.05) this.squashA = this.squashV = 0;
    }
  }

  override draw(ctx: Ctx2D): void {
    const r = this._radius;
    if (r <= 0) return;
    const tex = fruitTexture(this.level);
    const half = FRUIT_TEX_PAD * r;
    ctx.save();
    ctx.translate(r, r);
    const a = Math.max(-0.3, Math.min(0.35, this.squashA));
    if (a !== 0) {
      ctx.rotate(-this.rotation);
      ctx.scale(1 + a, 1 - a);
      ctx.rotate(this.rotation);
    }
    tex.draw(ctx, -half, -half, half * 2, half * 2);
    drawFruitFace(ctx, this.level, r, this.face === 'idle' && this.blinkLeft > 0 ? 'blink' : this.face);
    ctx.restore();
  }

  override describe() {
    return { ...super.describe(), level: this.level, fruit: fruit(this.level).key, face: this.face };
  }
}
