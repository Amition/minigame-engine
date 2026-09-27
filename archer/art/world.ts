import { darken, mix, Rng, roundRectPath, TAU, type Ctx2D } from '@engine';
import { APPLES, COLORS, type AppleKind } from '../config';
import type { PlatformView } from '../types';
import { drawStuckArrow } from './arrows';
import { hash01, setArtTime } from './common';

// ---------------------------------------------------------------- backdrop

/** Speck classes: radius, colour, alpha, drift speed factor, share of all specks. */
const DUST_CLASSES = [
  { r: 1.3, color: COLORS.dust, alpha: 1, speed: 0.7, share: 0.44 },
  { r: 2.1, color: COLORS.dust, alpha: 1, speed: 1, share: 0.26 },
  { r: 1.5, color: COLORS.dustLight, alpha: 0.85, speed: 1.2, share: 0.22 },
  { r: 2.7, color: COLORS.dustLight, alpha: 0.45, speed: 1.5, share: 0.08 },
] as const;
const DUST_MARGIN = 12;
const SQUARE_FILL = ['rgba(255,255,255,0.032)', 'rgba(255,255,255,0.042)'] as const;

interface DustField {
  w: number;
  h: number;
  /** Index ranges per class: [start, end) = classStart[c], classStart[c + 1]. */
  classStart: Int32Array;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** Big faint squares: centre x, y, half size, angle, spin. */
  sq: Float32Array;
}

let dust: DustField | null = null;

function dustField(w: number, h: number): DustField {
  if (dust && dust.w === w && dust.h === h) return dust;
  const rng = new Rng(0xa5c11e);
  const n = Math.max(24, Math.round((w * h) / 7000));
  const classStart = new Int32Array(DUST_CLASSES.length + 1);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  let i = 0;
  DUST_CLASSES.forEach((c, ci) => {
    classStart[ci] = i;
    const end = ci === DUST_CLASSES.length - 1 ? n : Math.min(n, i + Math.round(n * c.share));
    for (; i < end; i++) {
      x[i] = rng.float(0, w + 2 * DUST_MARGIN);
      y[i] = rng.float(0, h + 2 * DUST_MARGIN);
      vx[i] = -rng.float(2, 6) * c.speed;
      vy[i] = rng.float(-1.6, 1.6) * c.speed;
    }
  });
  classStart[DUST_CLASSES.length] = n;
  const spots = [
    [0.13, 0.52, 0.34],
    [0.43, 0.95, 0.3],
    [0.72, 0.18, 0.27],
    [0.96, 0.7, 0.33],
  ] as const;
  const sq = new Float32Array(spots.length * 5);
  spots.forEach(([fx, fy, fs], k) => {
    sq[k * 5] = fx * w + rng.float(-30, 30);
    sq[k * 5 + 1] = fy * h + rng.float(-30, 30);
    sq[k * 5 + 2] = fs * Math.max(h, w * 0.5);
    sq[k * 5 + 3] = rng.float(0, Math.PI / 2);
    sq[k * 5 + 4] = (k % 2 ? 1 : -1) * rng.float(0.004, 0.009);
  });
  dust = { w, h, classStart, x, y, vx, vy, sq };
  return dust;
}

const wrap = (v: number, m: number) => ((v % m) + m) % m;

/** Full-screen background (view-sized, scene coordinates): dark void, drifting dust, faint big squares. */
export function drawBackdrop(ctx: Ctx2D, w: number, h: number, time: number): void {
  setArtTime(time);
  const d = dustField(w, h);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);

  for (let k = 0; k < d.sq.length; k += 5) {
    const cx = d.sq[k]!;
    const cy = d.sq[k + 1]!;
    const r = d.sq[k + 2]!;
    const a = d.sq[k + 3]! + d.sq[k + 4]! * time;
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    ctx.beginPath();
    ctx.moveTo(cx + c - s, cy + s + c);
    ctx.lineTo(cx - c - s, cy - s + c);
    ctx.lineTo(cx - c + s, cy - s - c);
    ctx.lineTo(cx + c + s, cy + s - c);
    ctx.closePath();
    ctx.fillStyle = SQUARE_FILL[(k / 5) % 2]!;
    ctx.fill();
  }

  const W = w + 2 * DUST_MARGIN;
  const H = h + 2 * DUST_MARGIN;
  for (let ci = 0; ci < DUST_CLASSES.length; ci++) {
    const c = DUST_CLASSES[ci]!;
    ctx.beginPath();
    for (let i = d.classStart[ci]!; i < d.classStart[ci + 1]!; i++) {
      const x = wrap(d.x[i]! + d.vx[i]! * time, W) - DUST_MARGIN;
      const y = wrap(d.y[i]! + d.vy[i]! * time, H) - DUST_MARGIN;
      ctx.moveTo(x + c.r, y);
      ctx.arc(x, y, c.r, 0, TAU);
    }
    ctx.globalAlpha = c.alpha;
    ctx.fillStyle = c.color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- platforms

const STONE_LIT = 'rgba(255,255,255,0.055)';
const STONE_DIM = 'rgba(0,0,0,0.06)';
const STONE_BEVEL = 'rgba(255,255,255,0.07)';
const STONE_FOOT = 'rgba(0,0,0,0.07)';
const BLOCK_LIGHT = { x: -0.55, y: -0.83 };
const BLOCK_DARK = 'rgba(0,0,0,0.16)';

/** Tower (crenellated stone, player's floor on top) or floating block (enemy stand), plus arrows stuck in it. */
export function drawPlatform(ctx: Ctx2D, p: PlatformView): void {
  for (let i = 0; i < p.stuck.length; i++) {
    const st = p.stuck[i]!;
    drawStuckArrow(ctx, st.type, st.x, st.y, st.angle);
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  if (p.kind === 'tower') paintTower(ctx, p);
  else paintBlock(ctx, p);
  ctx.restore();
}

function paintTower(ctx: Ctx2D, p: PlatformView): void {
  const { w, h } = p;
  const left = -w / 2;
  const top = -h / 2;
  const cols = w >= 150 ? 3 : 2;
  const bw = w / cols;
  const bh = bw * 0.9;
  const rows = Math.ceil(h / bh);
  const mw = Math.max(14, w * 0.1);
  const mh = Math.max(12, w * 0.085);

  // merlons on the two top corners
  ctx.beginPath();
  roundRectPath(ctx, left, top - mh, mw, mh + 4, [3, 3, 0, 0]);
  roundRectPath(ctx, left + w - mw, top - mh, mw, mh + 4, [3, 3, 0, 0]);
  ctx.fillStyle = COLORS.stone;
  ctx.fill();
  ctx.fillStyle = COLORS.stoneLight;
  ctx.fillRect(left, top - mh, mw, 3);
  ctx.fillRect(left + w - mw, top - mh, mw, 3);

  ctx.fillStyle = COLORS.stone;
  ctx.fillRect(left, top, w, h);

  // per-block tone and bevel
  ctx.beginPath();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (hash01(r * 31 + c * 7 + p.id * 101) < 0.3) ctx.rect(left + c * bw, top + r * bh, bw, Math.min(bh, h - r * bh));
    }
  }
  ctx.fillStyle = STONE_LIT;
  ctx.fill();
  ctx.beginPath();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (hash01(r * 31 + c * 7 + p.id * 101) > 0.78) ctx.rect(left + c * bw, top + r * bh, bw, Math.min(bh, h - r * bh));
    }
  }
  ctx.fillStyle = STONE_DIM;
  ctx.fill();
  ctx.beginPath();
  for (let r = 0; r < rows; r++) ctx.rect(left, top + r * bh + 1.5, w, 3);
  ctx.fillStyle = STONE_BEVEL;
  ctx.fill();
  ctx.beginPath();
  for (let r = 0; r < rows; r++) {
    const y = top + Math.min(h, (r + 1) * bh);
    ctx.rect(left, y - 4.5, w, 3.5);
  }
  ctx.fillStyle = STONE_FOOT;
  ctx.fill();

  // seams
  ctx.beginPath();
  for (let r = 1; r < rows; r++) {
    ctx.moveTo(left, top + r * bh);
    ctx.lineTo(left + w, top + r * bh);
  }
  for (let c = 1; c < cols; c++) {
    ctx.moveTo(left + c * bw, top);
    ctx.lineTo(left + c * bw, top + h);
  }
  ctx.moveTo(left + mw, top - mh + 4);
  ctx.lineTo(left + mw, top);
  ctx.moveTo(left + w - mw, top - mh + 4);
  ctx.lineTo(left + w - mw, top);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = COLORS.stoneDark;
  ctx.stroke();

  // the floor edge
  ctx.fillStyle = COLORS.stoneLight;
  ctx.fillRect(left, top, w, 4);
}

function paintBlock(ctx: Ctx2D, p: PlatformView): void {
  const { w, h } = p;
  const m = Math.min(w, h);
  const r = m * 0.07;
  const b = m * 0.08;
  ctx.beginPath();
  roundRectPath(ctx, -w / 2, -h / 2, w, h, r);
  ctx.fillStyle = COLORS.block;
  ctx.fill();
  // bevel lit from the upper left in world space, whatever the block's angle
  ctx.save();
  ctx.clip();
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  for (let e = 0; e < 4; e++) {
    // local outward normals: up, right, down, left
    const nx = e === 1 ? 1 : e === 3 ? -1 : 0;
    const ny = e === 0 ? -1 : e === 2 ? 1 : 0;
    const lit = (nx * c - ny * s) * BLOCK_LIGHT.x + (nx * s + ny * c) * BLOCK_LIGHT.y;
    if (Math.abs(lit) < 0.2) continue;
    const hx = w / 2;
    const hy = h / 2;
    ctx.beginPath();
    if (e === 0) {
      ctx.moveTo(-hx, -hy);
      ctx.lineTo(hx, -hy);
      ctx.lineTo(hx - b, -hy + b);
      ctx.lineTo(-hx + b, -hy + b);
    } else if (e === 1) {
      ctx.moveTo(hx, -hy);
      ctx.lineTo(hx, hy);
      ctx.lineTo(hx - b, hy - b);
      ctx.lineTo(hx - b, -hy + b);
    } else if (e === 2) {
      ctx.moveTo(hx, hy);
      ctx.lineTo(-hx, hy);
      ctx.lineTo(-hx + b, hy - b);
      ctx.lineTo(hx - b, hy - b);
    } else {
      ctx.moveTo(-hx, hy);
      ctx.lineTo(-hx, -hy);
      ctx.lineTo(-hx + b, -hy + b);
      ctx.lineTo(-hx + b, hy - b);
    }
    ctx.closePath();
    ctx.globalAlpha = Math.min(1, Math.abs(lit));
    ctx.fillStyle = lit > 0 ? COLORS.blockLight : BLOCK_DARK;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------------------------------------------------------------- apples

interface AppleInk {
  base: string;
  light: string;
  leaf: string;
  leafDark: string;
}

const STEM = '#7b5a3c';
const APPLE_SHINE = 'rgba(255,255,255,0.55)';
const APPLE_INK = {} as Record<AppleKind, AppleInk>;
for (const a of APPLES) {
  const leaf = a.kind === 'green' ? '#4f9e3a' : '#62b347';
  APPLE_INK[a.kind] = { base: a.color, light: mix(a.color, '#ffffff', 0.22), leaf, leafDark: darken(leaf, 0.12) };
}

/** Right half of the apple outline from the top dimple to the bottom dimple (x mirrored by sx). */
function appleSide(ctx: Ctx2D, r: number, sx: number): void {
  ctx.bezierCurveTo(sx * 0.3 * r, -0.95 * r, sx * 1.02 * r, -0.92 * r, sx * 0.98 * r, -0.12 * r);
  ctx.bezierCurveTo(sx * 0.95 * r, 0.55 * r, sx * 0.58 * r, 1.0 * r, sx * 0.22 * r, 0.94 * r);
  ctx.quadraticCurveTo(sx * 0.1 * r, 0.88 * r, 0, 0.86 * r);
}

/** Apple of radius r centred at (x, y). */
export function drawApple(ctx: Ctx2D, kind: AppleKind, x: number, y: number, r: number, angle: number): void {
  const k = APPLE_INK[kind];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // stem and leaf behind the top dimple
  ctx.beginPath();
  ctx.moveTo(-0.02 * r, -0.6 * r);
  ctx.quadraticCurveTo(0.02 * r, -0.95 * r, 0.24 * r, -1.14 * r);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, 0.13 * r);
  ctx.strokeStyle = STEM;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.06 * r, -0.86 * r);
  ctx.quadraticCurveTo(0.34 * r, -1.28 * r, 0.8 * r, -1.1 * r);
  ctx.quadraticCurveTo(0.5 * r, -0.72 * r, 0.06 * r, -0.86 * r);
  ctx.closePath();
  ctx.fillStyle = k.leaf;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.14 * r, -0.88 * r);
  ctx.quadraticCurveTo(0.45 * r, -1.02 * r, 0.72 * r, -1.08 * r);
  ctx.lineWidth = Math.max(0.8, 0.045 * r);
  ctx.strokeStyle = k.leafDark;
  ctx.stroke();
  // body: light upper cap over the base colour, like the original's two-tone flat apples
  ctx.beginPath();
  ctx.moveTo(0, -0.62 * r);
  appleSide(ctx, r, 1);
  ctx.moveTo(0, -0.62 * r);
  appleSide(ctx, r, -1);
  ctx.fillStyle = k.light;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.98 * r, -0.12 * r);
  ctx.bezierCurveTo(0.95 * r, 0.55 * r, 0.58 * r, 1.0 * r, 0.22 * r, 0.94 * r);
  ctx.quadraticCurveTo(0.1 * r, 0.88 * r, 0, 0.86 * r);
  ctx.quadraticCurveTo(-0.1 * r, 0.88 * r, -0.22 * r, 0.94 * r);
  ctx.bezierCurveTo(-0.58 * r, 1.0 * r, -0.95 * r, 0.55 * r, -0.98 * r, -0.12 * r);
  ctx.quadraticCurveTo(-0.5 * r, 0.12 * r, 0, 0.1 * r);
  ctx.quadraticCurveTo(0.5 * r, 0.12 * r, 0.98 * r, -0.12 * r);
  ctx.closePath();
  ctx.fillStyle = k.base;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-0.45 * r, -0.4 * r, 0.2 * r, 0.12 * r, -0.7, 0, TAU);
  ctx.fillStyle = APPLE_SHINE;
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- effects

/** Fireball / smoke blobs as flat (angle, distance, size) triples. */
const BLOBS: readonly number[] = [0, 0, 1, 0.8, 0.35, 0.62, 2.3, 0.4, 0.58, 3.4, 0.32, 0.66, 4.5, 0.42, 0.55, 5.5, 0.36, 0.6];
const FIRE_MID = '#ffb347';
const FIRE_LAYERS = ['#f97316', FIRE_MID, '#fff1b8'] as const;
const SMOKE = '#5e5e63';
const SHOCK = '#ffffff';

/** Explosion flash for the explosive arrow: progress 0..1 over its lifetime. */
export function drawExplosion(ctx: Ctx2D, x: number, y: number, radius: number, progress: number): void {
  const p = Math.min(1, Math.max(0, progress));
  const e = 1 - (1 - p) * (1 - p) * (1 - p);
  const R = radius;
  ctx.save();
  // smoke puffs linger
  if (p > 0.15) {
    ctx.globalAlpha = 0.55 * (1 - p);
    ctx.beginPath();
    for (let i = 0; i < BLOBS.length; i += 3) {
      const a = BLOBS[i]! + 0.5;
      const d = BLOBS[i + 1]! * R * (0.6 + 0.6 * e);
      const br = BLOBS[i + 2]! * R * (0.3 + 0.35 * e);
      const bx = x + Math.cos(a) * d;
      const by = y + Math.sin(a) * d - p * R * 0.25;
      ctx.moveTo(bx + br, by);
      ctx.arc(bx, by, br, 0, TAU);
    }
    ctx.fillStyle = SMOKE;
    ctx.fill();
  }
  // fireball: outer orange, mid, core, shrinking as it burns out
  const fire = p < 0.75 ? 1 - p / 0.75 : 0;
  if (fire > 0) {
    ctx.globalAlpha = Math.min(1, fire * 1.6);
    for (let l = 0; l < 3; l++) {
      const shrink = 1 - l * 0.3;
      ctx.beginPath();
      for (let i = 0; i < BLOBS.length; i += 3) {
        const a = BLOBS[i]!;
        const d = BLOBS[i + 1]! * R * 0.8 * e;
        const br = BLOBS[i + 2]! * R * (0.28 + 0.4 * e) * shrink * (0.45 + 0.55 * fire);
        const bx = x + Math.cos(a) * d;
        const by = y + Math.sin(a) * d;
        ctx.moveTo(bx + br, by);
        ctx.arc(bx, by, br, 0, TAU);
      }
      ctx.fillStyle = FIRE_LAYERS[l]!;
      ctx.fill();
    }
  }
  // shock ring and spark streaks
  if (p < 0.6) {
    const q = p / 0.6;
    ctx.globalAlpha = 1 - q;
    ctx.beginPath();
    ctx.arc(x, y, R * (0.35 + 0.8 * e), 0, TAU);
    ctx.lineWidth = Math.max(1, R * 0.07 * (1 - q));
    ctx.strokeStyle = SHOCK;
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.3;
      const r0 = R * (0.3 + 0.95 * e);
      const r1 = r0 + R * 0.22 * (1 - q);
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, R * 0.045);
    ctx.strokeStyle = FIRE_MID;
    ctx.stroke();
  }
  ctx.restore();
}

const BOLT_GLOW = 'rgba(127,212,255,0.3)';
const BOLT_CORE = '#f2fbff';

function boltPath(ctx: Ctx2D, x1: number, y1: number, x2: number, y2: number, seed: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const n = Math.max(3, Math.min(14, Math.round(len / 16)));
  const nx = len > 0 ? -dy / len : 0;
  const ny = len > 0 ? dx / len : 0;
  const amp = Math.min(16, len * 0.16);
  ctx.moveTo(x1, y1);
  let bx = 0;
  let by = 0;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const off = (hash01(seed * 977 + i * 31) - 0.5) * 2 * amp;
    const px = x1 + dx * t + nx * off;
    const py = y1 + dy * t + ny * off;
    ctx.lineTo(px, py);
    if (i === Math.floor(n / 2)) {
      bx = px;
      by = py;
    }
  }
  ctx.lineTo(x2, y2);
  // one short fork from the middle
  if (len > 30) {
    const side = hash01(seed * 13 + 5) < 0.5 ? -1 : 1;
    let fx = bx;
    let fy = by;
    ctx.moveTo(fx, fy);
    for (let j = 1; j <= 3; j++) {
      const off = side * amp * (0.5 + j * 0.35) + (hash01(seed * 71 + j) - 0.5) * amp * 0.6;
      fx = bx + dx * 0.09 * j + nx * off;
      fy = by + dy * 0.09 * j + ny * off;
      ctx.lineTo(fx, fy);
    }
  }
}

/** Electric arc between two points (electric arrow hit, stunned enemy); seed varies the zigzag. */
export function drawLightning(ctx: Ctx2D, x1: number, y1: number, x2: number, y2: number, seed: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  boltPath(ctx, x1, y1, x2, y2, seed);
  ctx.lineWidth = 7;
  ctx.strokeStyle = BOLT_GLOW;
  ctx.stroke();
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = COLORS.electric;
  ctx.stroke();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = BOLT_CORE;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x1, y1, 4, 0, TAU);
  ctx.moveTo(x2 + 4, y2);
  ctx.arc(x2, y2, 4, 0, TAU);
  ctx.fillStyle = BOLT_GLOW;
  ctx.fill();
  ctx.restore();
}
