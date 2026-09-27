import { bakeTexture, Node, Rng, type Ctx2D, type NodeOptions, type Texture } from '@engine';
import { FRUIT_TEX_PAD, FRUITS, fruit } from '../fruits';

/**
 * Fruit art. Placeholder implementation: flat circles with a highlight and a dot face.
 * The public API below is the contract used by the play scene; keep the signatures.
 */

export type FruitFace = 'idle' | 'blink' | 'happy' | 'surprised' | 'worried';

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
  const size = FRUIT_TEX_PAD * 2 * f.radius;
  t = bakeTexture(
    size,
    size,
    (ctx, w, h) => {
      const r = f.radius;
      ctx.translate(w / 2, h / 2);
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(-r * 0.35, -r * 0.4, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    },
    { resolution: bakedResolution, key: `fruit:${f.key}` },
  );
  cache.set(level, t);
  return t;
}

/** Draws a level's face centred at (0, 0) for a fruit of radius r (the caller has applied the fruit's rotation). */
export function drawFruitFace(ctx: Ctx2D, _level: number, r: number, face: FruitFace): void {
  const eyeY = -r * 0.05;
  const eyeX = r * 0.3;
  const er = Math.max(1.5, r * 0.08);
  ctx.fillStyle = '#3a2418';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    if (face === 'blink' || face === 'happy') ctx.rect(sx * eyeX - er, eyeY - er * 0.25, er * 2, er * 0.5);
    else ctx.arc(sx * eyeX, eyeY, face === 'surprised' ? er * 1.3 : er, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#3a2418';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath();
  if (face === 'surprised') ctx.arc(0, r * 0.28, r * 0.1, 0, Math.PI * 2);
  else if (face === 'worried') ctx.arc(0, r * 0.4, r * 0.15, Math.PI * 1.15, Math.PI * 1.85);
  else ctx.arc(0, r * 0.18, r * 0.15, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
}

const blinkRng = new Rng(7);

/**
 * A fruit on screen. (x, y) is the fruit centre (anchor 0.5), rotation is the physics angle. `radius` scales body and
 * face together (grow / pop animations); it defaults to the level's radius. `face` is the expression; idle fruits
 * blink by themselves.
 */
export class FruitNode extends Node {
  readonly level: number;
  face: FruitFace = 'idle';
  private _radius: number;
  private blinkIn = blinkRng.float(1.5, 5);
  private blinkLeft = 0;

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

  override update(dt: number): void {
    if (this.blinkLeft > 0) {
      this.blinkLeft -= dt;
    } else if ((this.blinkIn -= dt) <= 0) {
      this.blinkLeft = 0.12;
      this.blinkIn = blinkRng.float(2, 6);
    }
  }

  override draw(ctx: Ctx2D): void {
    const r = this._radius;
    if (r <= 0) return;
    const tex = fruitTexture(this.level);
    const size = FRUIT_TEX_PAD * 2 * r;
    tex.draw(ctx, r - size / 2, r - size / 2, size, size);
    ctx.save();
    ctx.translate(r, r);
    drawFruitFace(ctx, this.level, r, this.face === 'idle' && this.blinkLeft > 0 ? 'blink' : this.face);
    ctx.restore();
  }

  override describe() {
    return { ...super.describe(), level: this.level, fruit: fruit(this.level).key, face: this.face };
  }
}
