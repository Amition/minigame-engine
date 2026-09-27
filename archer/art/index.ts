import { bakeTexture, textures, type Ctx2D } from '@engine';
import { appleDef, ARROWS, arrowDef, COLORS, type AppleKind, type ArrowId } from '../config';
import { BODY, BONES, J, type FighterView, type PlatformView } from '../types';

/**
 * ART CONTRACT (signatures frozen; the art worker replaces the placeholder bodies).
 *
 * World painters draw in world units (see types.ts) straight onto the given context; the battle scene calls them from
 * its nodes' draw(). They must not allocate textures per call.
 *
 * bakeArcherArt() runs once in boot() and registers these textures (use `textures.set(key, bakeTexture(...))`,
 * sizes in design units, resolution 'auto'):
 *   'archer:skull'            48 x 48   white skull (currency icon)
 *   'archer:lock'             48 x 48   white padlock
 *   'archer:film'             48 x 48   yellow/black film-strip ad icon (单次体验 / +100)
 *   'archer:gear'             48 x 48   white settings gear
 *   'archer:podium'           64 x 64   leaderboard icon (three people on a podium)
 *   'archer:apple-<kind>'     64 x 64   red / green / gold apple
 *   'archer:arrow-<id>'      300 x 56   arrow of each type lying horizontally, TIP ON THE LEFT (menu list cards)
 */
export const ART_KEYS = {
  skull: 'archer:skull',
  lock: 'archer:lock',
  film: 'archer:film',
  gear: 'archer:gear',
  podium: 'archer:podium',
  apple: (kind: AppleKind) => `archer:apple-${kind}`,
  arrow: (id: ArrowId) => `archer:arrow-${id}`,
} as const;

/** Bakes and registers every texture listed above. Safe to call again (re-registers). */
export function bakeArcherArt(): void {
  const icon = (key: string, size: number, draw: (ctx: Ctx2D, w: number, h: number) => void) =>
    textures.set(key, bakeTexture(size, size, draw, { resolution: 'auto', key }));
  icon(ART_KEYS.skull, 48, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(24, 21, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(15, 30, 18, 12);
  });
  icon(ART_KEYS.lock, 48, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(10, 22, 28, 20);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(24, 20, 9, Math.PI, 0);
    ctx.stroke();
  });
  icon(ART_KEYS.film, 48, (ctx) => {
    ctx.fillStyle = '#2f2f33';
    ctx.fillRect(6, 10, 36, 28);
    ctx.fillStyle = '#f5b82e';
    ctx.fillRect(14, 16, 20, 16);
  });
  icon(ART_KEYS.gear, 48, (ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(24, 24, 12, 0, Math.PI * 2);
    ctx.stroke();
  });
  icon(ART_KEYS.podium, 64, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, 40, 18, 20);
    ctx.fillRect(23, 30, 18, 30);
    ctx.fillRect(42, 44, 18, 16);
  });
  for (const kind of ['red', 'green', 'gold'] as const) {
    icon(ART_KEYS.apple(kind), 64, (ctx) => drawApple(ctx, kind, 32, 34, 24, 0));
  }
  for (const a of ARROWS) {
    textures.set(
      ART_KEYS.arrow(a.id),
      bakeTexture(300, 56, (ctx) => drawArrow(ctx, a.id, 12, 28, Math.PI, 3.3), { resolution: 'auto', key: ART_KEYS.arrow(a.id) }),
    );
  }
}

/** Full-screen background (view-sized, scene coordinates): dark void, drifting dust, faint big squares. */
export function drawBackdrop(ctx: Ctx2D, w: number, h: number, _time: number): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
}

/** A stick-man archer: limbs, torso, head, bow with string and nocked arrow, stuck arrows, balloons, status fx. */
export function drawFighter(ctx: Ctx2D, f: FighterView): void {
  const s = f.scale;
  const p = f.joints;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = f.flash > 0.5 ? '#ffb3b3' : COLORS.figure;
  for (const [a, b] of BONES) {
    ctx.lineWidth = (a === J.neck && b === J.pelvis ? BODY.torsoW : BODY.limbW) * s;
    ctx.beginPath();
    ctx.moveTo(p[a]!.x, p[a]!.y);
    ctx.lineTo(p[b]!.x, p[b]!.y);
    ctx.stroke();
  }
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.arc(p[J.head]!.x, p[J.head]!.y, BODY.headR * s, 0, Math.PI * 2);
  ctx.fill();
  const hand = p[J.handF]!;
  const c = Math.cos(f.aimAngle);
  const sn = Math.sin(f.aimAngle);
  ctx.strokeStyle = COLORS.bow;
  ctx.lineWidth = 5 * s;
  ctx.beginPath();
  ctx.moveTo(hand.x - sn * BODY.bowHalf * s, hand.y + c * BODY.bowHalf * s);
  ctx.quadraticCurveTo(hand.x + c * BODY.bowBulge * 2 * s, hand.y + sn * BODY.bowBulge * 2 * s, hand.x + sn * BODY.bowHalf * s, hand.y - c * BODY.bowHalf * s);
  ctx.stroke();
  if (f.nocked) drawArrow(ctx, f.nocked, hand.x + c * (BODY.arrowLen * (1 - f.draw * 0.5)) * s * 0.6, hand.y + sn * (BODY.arrowLen * (1 - f.draw * 0.5)) * s * 0.6, f.aimAngle, s);
  for (const st of f.stuck) drawArrow(ctx, st.type, st.x, st.y, st.angle, s);
  ctx.restore();
  if (f.side === 'enemy' && f.alive) drawHpBar(ctx, f);
}

/** The red health bar floating above an enemy's head. */
export function drawHpBar(ctx: Ctx2D, f: FighterView): void {
  const head = f.joints[J.head]!;
  const w = 60 * f.scale;
  const y = head.y - (BODY.headR + 22) * f.scale;
  ctx.fillStyle = COLORS.barTrack;
  ctx.fillRect(head.x - w / 2, y, w, 10);
  ctx.fillStyle = COLORS.hp;
  ctx.fillRect(head.x - w / 2, y, (w * Math.max(0, f.hp)) / f.maxHp, 10);
}

/** An arrow with its TIP at (x, y), pointing along angle; the shaft extends BODY.arrowLen * scale behind the tip. */
export function drawArrow(ctx: Ctx2D, type: ArrowId, x: number, y: number, angle: number, scale = 1): void {
  const d = arrowDef(type);
  const len = BODY.arrowLen * scale;
  const bx = x - Math.cos(angle) * len;
  const by = y - Math.sin(angle) * len;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = d.shaft;
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.fillStyle = d.head;
  ctx.beginPath();
  ctx.arc(x, y, 4 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = d.fletch;
  ctx.beginPath();
  ctx.arc(bx, by, 4 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Tower (crenellated stone, player's floor on top) or floating block (enemy stand), plus arrows stuck in it. */
export function drawPlatform(ctx: Ctx2D, p: PlatformView): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.fillStyle = p.kind === 'tower' ? COLORS.stone : COLORS.block;
  ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  ctx.restore();
  for (const st of p.stuck) drawArrow(ctx, st.type, st.x, st.y, st.angle);
}

/** Apple of radius r centred at (x, y). */
export function drawApple(ctx: Ctx2D, kind: AppleKind, x: number, y: number, r: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = appleDef(kind).color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Explosion flash for the explosive arrow: progress 0..1 over its lifetime. */
export function drawExplosion(ctx: Ctx2D, x: number, y: number, radius: number, progress: number): void {
  ctx.save();
  ctx.globalAlpha = 1 - progress;
  ctx.fillStyle = '#ffb347';
  ctx.beginPath();
  ctx.arc(x, y, radius * (0.4 + 0.6 * progress), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Electric arc between two points (electric arrow hit, stunned enemy); seed varies the zigzag. */
export function drawLightning(ctx: Ctx2D, x1: number, y1: number, x2: number, y2: number, seed: number): void {
  ctx.save();
  ctx.strokeStyle = COLORS.electric;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  const mx = (x1 + x2) / 2 + ((seed * 37) % 20) - 10;
  const my = (y1 + y2) / 2 + ((seed * 53) % 20) - 10;
  ctx.lineTo(mx, my);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}
