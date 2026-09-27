import { parseColor, rgbToHsl, type Color } from '../core/color';
import { Rng } from '../core/rng';
import { roundRectPath } from '../gfx/draw';
import { bakeTexture, type Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import type { Ctx2D } from '../gfx/types';
import { hueShade } from './palette';
import { roundPolygonPath, traceArtShape } from './shapes';

export type CreatureBody = 'blob' | 'round' | 'square' | 'bean';
export type CreatureEyes = 'dot' | 'round' | 'happy' | 'sleepy' | 'wink' | 'angry' | 'sparkle' | 'cyclops';
export type CreatureMouth = 'smile' | 'open' | 'cat' | 'flat' | 'o' | 'fang' | 'none';
export type CreatureAccessory = 'none' | 'leaf' | 'crown' | 'bow' | 'hat' | 'horns' | 'antenna';

export interface CreatureOptions {
  /** Picks every option you leave out (body, colour, eyes, …) deterministically. */
  seed?: number;
  body?: CreatureBody;
  color?: Color;
  eyes?: CreatureEyes;
  mouth?: CreatureMouth;
  cheeks?: boolean;
  accessory?: CreatureAccessory;
  /** Lighter belly patch. */
  belly?: boolean;
  /** Texture size in px (square, default 128). */
  size?: number;
  /** Outline colour (default: dark shade of the body colour). */
  outline?: Color;
  /** Soft ground shadow (default true). */
  shadow?: boolean;
  resolution?: number;
  key?: string;
}

/** Per-frame pose: bob lifts the body (fraction of size), sx/sy squash around the feet, blink 0..1. */
export interface CreaturePose {
  bob?: number;
  sx?: number;
  sy?: number;
  blink?: number;
  /** Eye/face offset -1..1 (look left/right). */
  look?: number;
}

export const creatureColors: readonly Color[] = [
  '#ff6b6b', '#ffa94d', '#ffd43b', '#8ce99a', '#38d9a9', '#4dabf7', '#748ffc', '#b197fc', '#f783ac', '#66d9e8',
];

type Resolved = Required<Omit<CreatureOptions, 'seed' | 'key' | 'resolution' | 'outline'>> & { outline: Color };

/** Fills in the options the seed decides. */
export function resolveCreature(opts: CreatureOptions = {}): Resolved {
  const rng = new Rng((opts.seed ?? 1) * 7717 + 13);
  const body = opts.body ?? rng.pick(['blob', 'round', 'square', 'bean'] as const);
  const color = opts.color ?? rng.pick(creatureColors);
  const eyes = opts.eyes ?? rng.pick(['round', 'round', 'sparkle', 'dot', 'happy', 'wink', 'sleepy', 'angry', 'cyclops'] as const);
  const mouth = opts.mouth ?? rng.pick(['smile', 'smile', 'open', 'cat', 'fang', 'o', 'flat'] as const);
  const cheeks = opts.cheeks ?? rng.chance(0.7);
  const accessory = opts.accessory ?? rng.pick(['none', 'leaf', 'crown', 'bow', 'hat', 'horns', 'antenna'] as const);
  const belly = opts.belly ?? rng.chance(0.4);
  return {
    body,
    color,
    eyes,
    mouth,
    cheeks,
    accessory,
    belly,
    size: opts.size ?? 128,
    shadow: opts.shadow ?? true,
    outline: opts.outline ?? hueShade(color, -0.75, { range: 0.6 }),
  };
}

function bodyDims(body: CreatureBody, S: number): { bw: number; bh: number } {
  switch (body) {
    case 'blob':
      return { bw: S * 0.7, bh: S * 0.54 };
    case 'square':
      return { bw: S * 0.62, bh: S * 0.58 };
    case 'bean':
      return { bw: S * 0.5, bh: S * 0.66 };
    default:
      return { bw: S * 0.64, bh: S * 0.62 };
  }
}

function bodyPath(ctx: Ctx2D, body: CreatureBody, bw: number, bh: number): void {
  const hw = bw / 2;
  switch (body) {
    case 'blob':
      ctx.moveTo(-hw, -bh * 0.12);
      ctx.bezierCurveTo(-hw, -bh * 0.78, -bw * 0.3, -bh, 0, -bh);
      ctx.bezierCurveTo(bw * 0.3, -bh, hw, -bh * 0.78, hw, -bh * 0.12);
      ctx.quadraticCurveTo(hw, 0, hw - bw * 0.1, 0);
      ctx.quadraticCurveTo(bw * 0.28, -bh * 0.08, bw * 0.18, 0);
      ctx.lineTo(-bw * 0.08, 0);
      ctx.quadraticCurveTo(-bw * 0.2, -bh * 0.1, -bw * 0.3, 0);
      ctx.lineTo(-hw + bw * 0.1, 0);
      ctx.quadraticCurveTo(-hw, 0, -hw, -bh * 0.12);
      ctx.closePath();
      break;
    case 'square':
      roundRectPath(ctx, -hw, -bh, bw, bh, Math.min(bw, bh) * 0.3);
      break;
    case 'bean':
      ctx.moveTo(0, -bh);
      ctx.bezierCurveTo(hw * 1.05, -bh, hw, -bh * 0.55, hw * 0.98, -bh * 0.35);
      ctx.bezierCurveTo(hw * 0.95, -bh * 0.05, hw * 0.6, 0, 0, 0);
      ctx.bezierCurveTo(-hw * 0.6, 0, -hw * 0.95, -bh * 0.05, -hw * 0.98, -bh * 0.35);
      ctx.bezierCurveTo(-hw, -bh * 0.55, -hw * 1.05, -bh, 0, -bh);
      ctx.closePath();
      break;
    default:
      ctx.ellipse(0, -bh / 2, hw, bh / 2, 0, 0, Math.PI * 2);
  }
}

function eye(ctx: Ctx2D, kind: CreatureEyes, x: number, y: number, r: number, lw: number, ink: Color, closed: boolean, side: -1 | 1): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  const open = !closed;
  if (kind === 'happy' || (kind === 'wink' && side === 1)) {
    ctx.beginPath();
    ctx.arc(x, y + r * 0.35, r * 0.75, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    return;
  }
  if (kind === 'sleepy') {
    ctx.beginPath();
    ctx.arc(x, y - r * 0.3, r * 0.7, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    return;
  }
  if (!open) {
    ctx.beginPath();
    ctx.moveTo(x - r * 0.8, y + r * 0.1);
    ctx.quadraticCurveTo(x, y + r * 0.55, x + r * 0.8, y + r * 0.1);
    ctx.stroke();
    return;
  }
  if (kind === 'dot') {
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.5, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const big = kind === 'sparkle' ? 1.2 : 1;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.85 * big, r * big, 0, 0, Math.PI * 2);
  ctx.fill();
  if (kind === 'sparkle') {
    const g = ctx.createLinearGradient(0, y - r * big, 0, y + r * big);
    g.addColorStop(0.45, 'rgba(90,120,255,0)');
    g.addColorStop(1, 'rgba(120,150,255,0.85)');
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x + r * 0.32 * big, y - r * 0.38 * big, r * 0.34 * big, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.3 * big, y + r * 0.4 * big, r * (kind === 'sparkle' ? 0.2 : 0.14) * big, 0, Math.PI * 2);
  ctx.fill();
  if (kind === 'angry') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw * 1.1;
    ctx.beginPath();
    ctx.moveTo(x - r * 1.0 * side, y - r * 1.75);
    ctx.lineTo(x + r * 0.9 * side, y - r * 1.2);
    ctx.stroke();
  }
}

function cyclopsEye(ctx: Ctx2D, x: number, y: number, r: number, lw: number, ink: Color, closed: boolean): void {
  if (closed) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.quadraticCurveTo(x, y + r * 0.6, x + r, y);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.08, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x + r * 0.2, y - r * 0.18, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function mouth(ctx: Ctx2D, kind: CreatureMouth, x: number, y: number, m: number, lw: number, ink: Color): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw;
  switch (kind) {
    case 'smile':
      ctx.beginPath();
      ctx.arc(x, y - m * 0.35, m * 0.6, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
      break;
    case 'open': {
      ctx.beginPath();
      ctx.moveTo(x - m * 0.7, y - m * 0.25);
      ctx.quadraticCurveTo(x, y - m * 0.05, x + m * 0.7, y - m * 0.25);
      ctx.quadraticCurveTo(x + m * 0.6, y + m * 0.85, x, y + m * 0.85);
      ctx.quadraticCurveTo(x - m * 0.6, y + m * 0.85, x - m * 0.7, y - m * 0.25);
      ctx.closePath();
      ctx.fillStyle = '#7a1f3d';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#ff7a93';
      ctx.beginPath();
      ctx.ellipse(x, y + m * 0.85, m * 0.5, m * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = lw * 0.8;
      ctx.stroke();
      break;
    }
    case 'cat':
      ctx.beginPath();
      ctx.arc(x - m * 0.3, y - m * 0.1, m * 0.3, Math.PI * 0.1, Math.PI * 0.95);
      ctx.moveTo(x + m * 0.6, y - m * 0.05);
      ctx.arc(x + m * 0.3, y - m * 0.1, m * 0.3, Math.PI * 0.05, Math.PI * 0.9);
      ctx.stroke();
      break;
    case 'flat':
      ctx.beginPath();
      ctx.moveTo(x - m * 0.35, y);
      ctx.lineTo(x + m * 0.35, y);
      ctx.stroke();
      break;
    case 'o':
      ctx.fillStyle = '#7a1f3d';
      ctx.beginPath();
      ctx.ellipse(x, y + m * 0.1, m * 0.26, m * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = lw * 0.7;
      ctx.stroke();
      break;
    case 'fang':
      ctx.beginPath();
      ctx.arc(x, y - m * 0.4, m * 0.62, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x + m * 0.12, y + m * 0.14);
      ctx.lineTo(x + m * 0.42, y + m * 0.06);
      ctx.lineTo(x + m * 0.3, y + m * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = lw * 0.5;
      ctx.stroke();
      break;
    case 'none':
      break;
  }
}

function accessory(ctx: Ctx2D, kind: CreatureAccessory, top: number, bw: number, S: number, lw: number, ink: Color, body: Color): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const outline = (fill: Color | CanvasGradient) => {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw;
    ctx.stroke();
  };
  switch (kind) {
    case 'leaf': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(0, top + S * 0.02);
      ctx.quadraticCurveTo(S * 0.01, top - S * 0.06, 0, top - S * 0.1);
      ctx.stroke();
      for (const side of [-1, 1] as const) {
        ctx.save();
        ctx.translate(0, top - S * 0.09);
        ctx.rotate(side * 1.05);
        ctx.beginPath();
        traceArtShape(ctx, 'leaf', -S * 0.055, -S * 0.17, S * 0.11, S * 0.17);
        outline(side < 0 ? '#63c75a' : '#7ad86b');
        ctx.restore();
      }
      break;
    }
    case 'crown': {
      const w = bw * 0.46;
      const h = S * 0.13;
      const y0 = top + S * 0.035;
      const pts: [number, number][] = [
        [-w / 2, y0], [w / 2, y0], [w / 2 + w * 0.04, y0 - h], [w * 0.22, y0 - h * 0.5],
        [0, y0 - h * 1.12], [-w * 0.22, y0 - h * 0.5], [-w / 2 - w * 0.04, y0 - h],
      ];
      ctx.beginPath();
      roundPolygonPath(ctx, pts, lw * 0.8);
      const g = ctx.createLinearGradient(0, y0 - h, 0, y0);
      g.addColorStop(0, '#fff09a');
      g.addColorStop(1, '#ffb52e');
      outline(g);
      ctx.fillStyle = '#ff5d8f';
      ctx.beginPath();
      ctx.arc(0, y0 - h * 0.32, S * 0.018, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bow': {
      const cx = bw * 0.26;
      const cy = top + S * 0.06;
      const r = S * 0.075;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(0.35);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(side * r * 0.6, -r * 1.2, side * r * 1.7, -r * 0.8, side * r * 1.5, 0);
        ctx.bezierCurveTo(side * r * 1.7, r * 0.8, side * r * 0.6, r * 1.2, 0, 0);
        ctx.closePath();
        outline('#ff6f9f');
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.45, r * 0.5, 0, 0, Math.PI * 2);
      outline('#ff8fb4');
      ctx.restore();
      break;
    }
    case 'hat': {
      ctx.save();
      ctx.translate(bw * 0.08, top + S * 0.04);
      ctx.rotate(0.22);
      const w = S * 0.2;
      const h = S * 0.24;
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.quadraticCurveTo(0, -h * 0.04 + S * 0.02, w / 2, 0);
      ctx.lineTo(S * 0.012, -h);
      ctx.lineTo(-S * 0.012, -h);
      ctx.closePath();
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, '#6c8cff');
      g.addColorStop(1, '#4a63e0');
      outline(g);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#ffd43b';
      for (const t of [0.3, 0.62]) {
        ctx.beginPath();
        ctx.ellipse(0, -h * t, w, S * 0.018, -0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(0, -h, S * 0.03, 0, Math.PI * 2);
      outline('#ff6b6b');
      ctx.restore();
      break;
    }
    case 'horns': {
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        const bx = side * bw * 0.22;
        ctx.moveTo(bx - side * S * 0.05, top + S * 0.05);
        ctx.quadraticCurveTo(bx - side * S * 0.03, top - S * 0.08, bx + side * S * 0.06, top - S * 0.11);
        ctx.quadraticCurveTo(bx + side * S * 0.035, top - S * 0.02, bx + side * S * 0.05, top + S * 0.06);
        ctx.closePath();
        outline('#fff1d6');
      }
      break;
    }
    case 'antenna': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(0, top + S * 0.02);
      ctx.quadraticCurveTo(S * 0.05, top - S * 0.06, S * 0.03, top - S * 0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(S * 0.03, top - S * 0.14, S * 0.035, 0, Math.PI * 2);
      outline(hueShade(body, 0.3));
      break;
    }
    case 'none':
      break;
  }
}

/**
 * Draws a creature standing at (cx, groundY) in a box of `size` px (the texture helpers use cx = size/2,
 * groundY = size * 0.9).
 */
export function drawCreature(ctx: Ctx2D, cx: number, groundY: number, opts: CreatureOptions = {}, pose: CreaturePose = {}): void {
  const o = resolveCreature(opts);
  const S = o.size;
  const { bw, bh } = bodyDims(o.body, S);
  const sx = pose.sx ?? 1;
  const sy = pose.sy ?? 1;
  const bob = (pose.bob ?? 0) * S;
  const lw = Math.max(1.5, S * 0.028);
  const ink = o.outline;
  const closed = (pose.blink ?? 0) >= 0.5;
  const look = (pose.look ?? 0) * bw * 0.06;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (o.shadow) {
    const k = Math.max(0.55, 1 - bob / (S * 0.3));
    ctx.fillStyle = 'rgba(30,20,50,0.18)';
    ctx.beginPath();
    ctx.ellipse(cx, groundY, bw * 0.46 * sx * k, S * 0.04 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.translate(cx, groundY - bob);
  ctx.scale(sx, sy);

  const dark = hueShade(o.color, -0.3);
  if (o.body !== 'blob') {
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.ellipse(side * bw * 0.2, -S * 0.012, bw * 0.12, S * 0.05, 0, 0, Math.PI * 2);
      ctx.fillStyle = dark;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.ellipse(side * bw * 0.5, -bh * 0.42, S * 0.045, S * 0.065, side * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = o.color;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }

  const top = -bh;
  if (o.accessory === 'horns' || o.accessory === 'antenna') accessory(ctx, o.accessory, top, bw, S, lw, ink, o.color);

  ctx.beginPath();
  bodyPath(ctx, o.body, bw, bh);
  const g = ctx.createLinearGradient(0, -bh, 0, 0);
  g.addColorStop(0, hueShade(o.color, 0.3));
  g.addColorStop(0.5, o.color);
  g.addColorStop(1, hueShade(o.color, -0.22));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.clip();
  if (o.belly) {
    ctx.fillStyle = hueShade(o.color, 0.55);
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.ellipse(0, -bh * 0.22, bw * 0.3, bh * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, -bh * 1.02, bw * 0.62, bh * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.save();
  ctx.translate(-bw * 0.26, -bh * 0.8);
  ctx.rotate(-0.6);
  ctx.beginPath();
  ctx.ellipse(0, 0, bw * 0.09, bh * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  ctx.beginPath();
  bodyPath(ctx, o.body, bw, bh);
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw;
  ctx.stroke();

  const eyeY = -bh * (o.body === 'bean' ? 0.64 : o.body === 'blob' ? 0.58 : 0.56);
  const er = S * 0.052;
  const dx = bw * (o.body === 'bean' ? 0.2 : 0.19);
  const faceInk = hueShade(o.color, -0.85, { range: 0.7 });
  if (o.cheeks) {
    const { h, s } = rgbToHsl(parseColor(o.color));
    const warm = s < 0.15 || h >= 290 || h <= 40;
    ctx.fillStyle = warm ? 'rgba(255,70,120,0.36)' : 'rgba(255,150,180,0.72)';
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.ellipse(look + side * (dx + er * 1.25), eyeY + er * 1.45, er * 0.95, er * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (o.eyes === 'cyclops') cyclopsEye(ctx, look, eyeY, er * 1.75, lw, faceInk, closed);
  else for (const side of [-1, 1] as const) eye(ctx, o.eyes, look + side * dx, eyeY, er, lw * 0.95, faceInk, closed, side);
  mouth(ctx, o.mouth, look, eyeY + er * 1.9, S * 0.075, lw * 0.9, faceInk);

  if (o.accessory !== 'horns' && o.accessory !== 'antenna') accessory(ctx, o.accessory, top, bw, S, lw, ink, o.color);
  ctx.restore();
}

/**
 * A cute casual-game mascot. Omitted options come from the seed.
 *
 *     const slime = creatureTexture({ seed: 4, body: 'blob', color: '#8ce99a', accessory: 'leaf', size: 128 });
 */
export function creatureTexture(opts: CreatureOptions = {}, pose: CreaturePose = {}): Texture {
  const S = opts.size ?? 128;
  const tex = bakeTexture(S, S, (ctx) => drawCreature(ctx, S / 2, S * 0.9, opts, pose), {
    resolution: opts.resolution ?? 1,
  });
  if (opts.key) textures.set(opts.key, tex);
  return tex;
}

export type CreatureAnim = 'idle' | 'blink' | 'squash' | 'bounce';

/** Pose of an animation at phase t (0..1). */
export function creaturePose(anim: CreatureAnim, t: number): CreaturePose {
  const s = Math.sin(t * Math.PI * 2);
  switch (anim) {
    case 'idle':
      return { bob: Math.max(0, s) * 0.015, sx: 1 - s * 0.035, sy: 1 + s * 0.035 };
    case 'blink':
      return { blink: t >= 0.7 && t < 0.85 ? 1 : 0 };
    case 'squash': {
      const keys: [number, CreaturePose][] = [
        [0, { sx: 1.16, sy: 0.84, bob: 0 }],
        [0.2, { sx: 0.9, sy: 1.12, bob: 0.06 }],
        [0.45, { sx: 1, sy: 1, bob: 0.13 }],
        [0.7, { sx: 0.94, sy: 1.08, bob: 0.05 }],
        [0.85, { sx: 1.1, sy: 0.9, bob: 0 }],
        [1, { sx: 1.16, sy: 0.84, bob: 0 }],
      ];
      let i = 0;
      while (i < keys.length - 2 && t > keys[i + 1]![0]) i++;
      const [t0, a] = keys[i]!;
      const [t1, b] = keys[i + 1]!;
      const k = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
      const e = k * k * (3 - 2 * k);
      const L = (p: number | undefined, q: number | undefined) => (p ?? 0) + ((q ?? 0) - (p ?? 0)) * e;
      return { sx: L(a.sx, b.sx), sy: L(a.sy, b.sy), bob: L(a.bob, b.bob) };
    }
    case 'bounce': {
      const hop = Math.abs(Math.sin(t * Math.PI));
      const contact = 1 - Math.min(1, hop * 4);
      return { bob: hop * 0.12, sx: 1 + contact * 0.12 - hop * 0.04, sy: 1 - contact * 0.12 + hop * 0.05 };
    }
  }
}

/**
 * Animation frames on one canvas (sub-textures): 'idle' breathing bob, 'blink', 'squash' (jump-in-place squash
 * & stretch) or 'bounce' (hop loop). Loop them with any frame animator (e.g. 8–12 fps).
 */
export function creatureFrames(opts: CreatureOptions = {}, anim: CreatureAnim = 'idle', frames = 8): Texture[] {
  const S = opts.size ?? 128;
  const n = Math.max(1, Math.floor(frames));
  const strip = bakeTexture(
    S * n,
    S,
    (ctx) => {
      for (let i = 0; i < n; i++) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(i * S, 0, S, S);
        ctx.clip();
        drawCreature(ctx, i * S + S / 2, S * 0.9, opts, creaturePose(anim, i / n));
        ctx.restore();
      }
    },
    { resolution: opts.resolution ?? 1 },
  );
  const out: Texture[] = [];
  for (let i = 0; i < n; i++) out.push(strip.sub(i * S, 0, S, S));
  if (opts.key) {
    textures.set(opts.key, strip);
    out.forEach((t, i) => textures.set(`${opts.key}#${i}`, t));
  }
  return out;
}
