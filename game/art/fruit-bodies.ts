import { Rng, withAlpha, type Ctx2D } from '@engine';

/**
 * Body painters for the 11 fruits, drawn once into textures by fruit-art.ts. Each painter draws centred at (0, 0)
 * for a fruit of radius r: the main silhouette is exactly the circle of radius r (physics body); stems, leaves and
 * crowns may reach up to 1.28r. Shared look: light from the upper left, soft radial shading, darker rim, lighter
 * bounce light in the lower right, a glossy highlight and a darker outline of the skin colour.
 */
export type FruitPainter = (ctx: Ctx2D, r: number) => void;

const TAU = Math.PI * 2;

interface Skin {
  light: string;
  base: string;
  shade: string;
  /** Rim darkening colour. */
  rim: string;
  /** Outline colour. */
  line: string;
}

function circle(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

/** Outline width for a fruit of radius r (also used for stems and leaves so the whole set matches). */
export function fruitLineWidth(r: number): number {
  return Math.max(1.6, 1.1 + r * 0.016);
}

function outline(ctx: Ctx2D, r: number, color: string): void {
  const lw = fruitLineWidth(r);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  circle(ctx, 0, 0, r - lw / 2);
  ctx.stroke();
}

/** Sphere fill lit from the upper left. */
function ball(ctx: Ctx2D, r: number, s: Skin): void {
  const g = ctx.createRadialGradient(-0.36 * r, -0.42 * r, 0.02 * r, -0.08 * r, -0.1 * r, 1.13 * r);
  g.addColorStop(0, s.light);
  g.addColorStop(0.45, s.base);
  g.addColorStop(1, s.shade);
  ctx.fillStyle = g;
  circle(ctx, 0, 0, r);
  ctx.fill();
}

/** Darker band along the rim so the disc reads as a ball. */
function rimShade(ctx: Ctx2D, r: number, color: string, alpha: number, from = 0.68): void {
  const g = ctx.createRadialGradient(-0.05 * r, -0.07 * r, from * r, 0, 0, r);
  g.addColorStop(0, withAlpha(color, 0));
  g.addColorStop(1, withAlpha(color, alpha));
  ctx.fillStyle = g;
  circle(ctx, 0, 0, r);
  ctx.fill();
}

/** Reflected light: a soft lighter glow along the lower-right rim. */
function bounceLight(ctx: Ctx2D, r: number, color: string, alpha: number): void {
  const g = ctx.createRadialGradient(-0.28 * r, -0.34 * r, 1.1 * r, -0.28 * r, -0.34 * r, 1.44 * r);
  g.addColorStop(0, withAlpha(color, 0));
  g.addColorStop(1, withAlpha(color, alpha));
  ctx.fillStyle = g;
  circle(ctx, 0, 0, r);
  ctx.fill();
}

/** Glossy highlight: soft sheen, a crisp streak hugging the upper-left rim and a small dot. */
function gloss(ctx: Ctx2D, r: number, alpha = 0.9, sheen = 0.45, dot = true): void {
  const cx = -0.36 * r;
  const cy = -0.42 * r;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.46 * r);
  g.addColorStop(0, `rgba(255,255,255,${sheen * alpha})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  circle(ctx, cx, cy, 0.46 * r);
  ctx.fill();
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = 0.1 * r;
  ctx.beginPath();
  ctx.arc(0, 0, 0.72 * r, Math.PI * 1.1, Math.PI * 1.34);
  ctx.stroke();
  if (dot) {
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    const a = Math.PI * 1.44;
    circle(ctx, Math.cos(a) * 0.72 * r, Math.sin(a) * 0.72 * r, 0.052 * r);
    ctx.fill();
  }
  ctx.restore();
}

/** Stroked curve with a darker edge (stems). pts = x0 y0 c1x c1y c2x c2y x1 y1. */
function tube(ctx: Ctx2D, pts: readonly number[], w: number, color: string, edge: string, edgeW: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of [0, 1]) {
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    ctx.bezierCurveTo(pts[2]!, pts[3]!, pts[4]!, pts[5]!, pts[6]!, pts[7]!);
    ctx.strokeStyle = pass === 0 ? edge : color;
    ctx.lineWidth = pass === 0 ? w + 2 * edgeW : w;
    ctx.stroke();
  }
  ctx.restore();
}

interface LeafStyle {
  light: string;
  dark: string;
  edge: string;
}

const GREEN_LEAF: LeafStyle = { light: '#8fe05a', dark: '#3f9e34', edge: '#2a6e22' };

/** A leaf from (x, y) pointing along `angle`: len long, about `wid` wide. */
function leaf(ctx: Ctx2D, x: number, y: number, angle: number, len: number, wid: number, s: LeafStyle, lw: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.22, -wid * 0.75, len * 0.68, -wid * 0.62, len, 0);
  ctx.bezierCurveTo(len * 0.7, wid * 0.55, len * 0.25, wid * 0.62, 0, 0);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -wid * 0.5, 0, wid * 0.5);
  g.addColorStop(0, s.light);
  g.addColorStop(1, s.dark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.edge;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(len * 0.12, 0);
  ctx.quadraticCurveTo(len * 0.5, -wid * 0.1, len * 0.84, -wid * 0.02);
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = lw * 0.7;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

/** Tiny dots scattered over the disc (pores, grain), smaller towards the rim. */
function speckle(ctx: Ctx2D, r: number, rng: Rng, count: number, maxD: number, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const a = rng.float(0, TAU);
    const d = Math.sqrt(rng.next()) * maxD;
    const x = Math.cos(a) * d * r;
    const y = Math.sin(a) * d * r;
    const s = size * r * (1 - 0.55 * d * d) * rng.float(0.7, 1.2);
    ctx.moveTo(x + s, y);
    ctx.arc(x, y, s, 0, TAU);
  }
  ctx.fill();
}

/** Seed shape pointing along +x (round end outward). */
function seedPath(ctx: Ctx2D, len: number, wid: number): void {
  ctx.beginPath();
  ctx.moveTo(-len, 0);
  ctx.bezierCurveTo(-len * 0.4, -wid * 0.9, len, -wid * 1.15, len, 0);
  ctx.bezierCurveTo(len, wid * 1.15, -len * 0.4, wid * 0.9, -len, 0);
  ctx.closePath();
}

interface P3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Orthographic projection of the sphere point (lon, lat), north pole up and tipped `tilt` radians towards the
 * viewer. z > 0 = visible.
 */
function sphere(r: number, lon: number, lat: number, tilt: number, out: P3): P3 {
  const cl = Math.cos(lat);
  const x = cl * Math.sin(lon);
  const y = -Math.sin(lat);
  const z = cl * Math.cos(lon);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  out.x = x * r;
  out.y = (y * ct + z * st) * r;
  out.z = -y * st + z * ct;
  return out;
}

// ---------------------------------------------------------------- fruits

const grapeSkin: Skin = { light: '#d7b0ff', base: '#9656d6', shade: '#55208f', rim: '#3a0f6e', line: '#3f1573' };

function grape(ctx: Ctx2D, r: number): void {
  const lw = fruitLineWidth(r);
  tube(ctx, [0.02 * r, -0.8 * r, 0.02 * r, -1.0 * r, 0.1 * r, -1.1 * r, 0.16 * r, -1.2 * r], 0.13 * r, '#9a6a3c', '#5a3718', lw * 0.8);
  leaf(ctx, 0.1 * r, -0.98 * r, -0.42, 0.62 * r, 0.34 * r, GREEN_LEAF, lw * 0.8);
  ball(ctx, r, grapeSkin);
  const rng = new Rng(11);
  speckle(ctx, r, rng, 14, 0.8, 0.03, 'rgba(235,215,255,0.28)');
  rimShade(ctx, r, grapeSkin.rim, 0.55);
  bounceLight(ctx, r, '#c69af2', 0.55);
  gloss(ctx, r, 0.9);
  outline(ctx, r, grapeSkin.line);
}

const cherrySkin: Skin = { light: '#ff9aa6', base: '#ec2440', shade: '#a20a26', rim: '#6d0418', line: '#7c0a20' };

function cherry(ctx: Ctx2D, r: number): void {
  const lw = fruitLineWidth(r);
  ball(ctx, r, cherrySkin);
  rimShade(ctx, r, cherrySkin.rim, 0.55);
  bounceLight(ctx, r, '#ff6f86', 0.6);
  // stem dimple
  const g = ctx.createRadialGradient(0.04 * r, -0.8 * r, 0, 0.04 * r, -0.8 * r, 0.26 * r);
  g.addColorStop(0, 'rgba(110,4,24,0.55)');
  g.addColorStop(1, 'rgba(110,4,24,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0.04 * r, -0.8 * r, 0.26 * r, 0.12 * r, 0, 0, TAU);
  ctx.fill();
  gloss(ctx, r, 0.95);
  outline(ctx, r, cherrySkin.line);
  tube(ctx, [0.04 * r, -0.8 * r, 0.06 * r, -1.02 * r, 0.2 * r, -1.16 * r, 0.4 * r, -1.2 * r], 0.085 * r, '#7fae3a', '#3e6218', lw * 0.8);
  leaf(ctx, 0.36 * r, -1.2 * r, 0.12, 0.66 * r, 0.34 * r, GREEN_LEAF, lw * 0.8);
}

const orangeSkin: Skin = { light: '#ffd27a', base: '#ff9322', shade: '#e8620a', rim: '#b8420a', line: '#b54808' };

function orange(ctx: Ctx2D, r: number): void {
  const lw = fruitLineWidth(r);
  ball(ctx, r, orangeSkin);
  const rng = new Rng(23);
  speckle(ctx, r, rng, 90, 0.92, 0.022, 'rgba(214,92,0,0.3)');
  speckle(ctx, r, rng, 50, 0.9, 0.018, 'rgba(255,236,180,0.35)');
  rimShade(ctx, r, orangeSkin.rim, 0.5);
  bounceLight(ctx, r, '#ffb35a', 0.6);
  // stem end: a small dimple with a green star
  ctx.fillStyle = 'rgba(170,70,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, -0.84 * r, 0.16 * r, 0.07 * r, 0, 0, TAU);
  ctx.fill();
  gloss(ctx, r, 0.85);
  outline(ctx, r, orangeSkin.line);
  ctx.fillStyle = '#5f9a2c';
  ctx.strokeStyle = '#2f5e14';
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU - Math.PI / 2;
    const d = (i % 2 ? 0.05 : 0.11) * r;
    const x = Math.cos(a) * d;
    const y = -0.85 * r + Math.sin(a) * d * 0.55;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  tube(ctx, [0, -0.86 * r, 0, -0.94 * r, 0.02 * r, -0.99 * r, 0.04 * r, -1.03 * r], 0.07 * r, '#6c9a32', '#35561a', lw * 0.7);
  leaf(ctx, 0.04 * r, -0.98 * r, -0.5, 0.56 * r, 0.3 * r, GREEN_LEAF, lw * 0.8);
}

const lemonSkin: Skin = { light: '#fffbd0', base: '#ffe03a', shade: '#f2b000', rim: '#c48a00', line: '#b98a02' };

/**
 * Circle with two nipple tips at angle a and a + PI reaching `tip` * r. The radius gets a wide low bump (the body
 * tapering into the tip, under 3% off the circle) plus a narrow one (the rounded nipple); away from the tips the
 * outline stays on the circle.
 */
function lemonPath(ctx: Ctx2D, r: number, a: number, tip: number): void {
  const n = 240;
  const taper = 0.55 * (tip - 1);
  const nub = tip - 1 - taper;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TAU;
    let d = Math.abs(t - a) % Math.PI;
    d = Math.min(d, Math.PI - d);
    const k = 1 + taper * Math.exp(-((d / 0.34) ** 2)) + nub * Math.exp(-((d / 0.075) ** 2));
    const x = Math.cos(t) * k * r;
    const y = Math.sin(t) * k * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function lemon(ctx: Ctx2D, r: number): void {
  const a = -0.62;
  ctx.save();
  lemonPath(ctx, r, a, 1.17);
  ctx.clip();
  ctx.save();
  ctx.scale(1.17, 1.17);
  ball(ctx, r, lemonSkin);
  ctx.restore();
  const rng = new Rng(31);
  speckle(ctx, r, rng, 110, 0.93, 0.018, 'rgba(214,150,0,0.28)');
  speckle(ctx, r, rng, 50, 0.9, 0.016, 'rgba(255,255,230,0.45)');
  ctx.save();
  ctx.scale(1.15, 1.15);
  rimShade(ctx, r, lemonSkin.rim, 0.45, 0.72);
  ctx.restore();
  bounceLight(ctx, r, '#fff07a', 0.7);
  // tip nubs a bit greener
  for (const t of [a, a + Math.PI]) {
    const x = Math.cos(t) * 1.1 * r;
    const y = Math.sin(t) * 1.1 * r;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 0.2 * r);
    g.addColorStop(0, 'rgba(170,180,30,0.5)');
    g.addColorStop(1, 'rgba(170,180,30,0)');
    ctx.fillStyle = g;
    circle(ctx, x, y, 0.2 * r);
    ctx.fill();
  }
  gloss(ctx, r, 0.9);
  ctx.restore();
  const lw = fruitLineWidth(r);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = lemonSkin.line;
  ctx.lineWidth = lw;
  ctx.scale(1 - lw / (2 * r), 1 - lw / (2 * r));
  lemonPath(ctx, r, a, 1.17);
  ctx.stroke();
  ctx.restore();
}

function kiwi(ctx: Ctx2D, r: number): void {
  const rng = new Rng(41);
  // skin
  let g = ctx.createRadialGradient(-0.2 * r, -0.2 * r, 0.6 * r, 0, 0, r);
  g.addColorStop(0, '#a87440');
  g.addColorStop(1, '#6b4220');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, r);
  ctx.fill();
  // fuzz
  ctx.strokeStyle = 'rgba(200,150,90,0.55)';
  ctx.lineWidth = Math.max(0.8, 0.012 * r);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 70; i++) {
    const a = rng.float(0, TAU);
    const d0 = rng.float(0.91, 0.95) * r;
    const d1 = d0 + rng.float(0.03, 0.05) * r;
    const t = rng.float(-0.06, 0.06);
    ctx.moveTo(Math.cos(a) * d0, Math.sin(a) * d0);
    ctx.lineTo(Math.cos(a + t) * d1, Math.sin(a + t) * d1);
  }
  ctx.stroke();
  // flesh
  const fr = 0.9 * r;
  g = ctx.createRadialGradient(0, 0, 0.2 * r, 0, 0, fr);
  g.addColorStop(0, '#d9f28a');
  g.addColorStop(0.35, '#a6d94a');
  g.addColorStop(0.8, '#7cc230');
  g.addColorStop(1, '#5a9a1c');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, fr);
  ctx.fill();
  // radial fibres
  ctx.strokeStyle = 'rgba(235,255,190,0.35)';
  ctx.lineWidth = Math.max(0.8, 0.014 * r);
  ctx.beginPath();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU + rng.float(-0.04, 0.04);
    const d0 = rng.float(0.36, 0.42) * r;
    const d1 = rng.float(0.66, 0.84) * r;
    ctx.moveTo(Math.cos(a) * d0, Math.sin(a) * d0);
    ctx.lineTo(Math.cos(a) * d1, Math.sin(a) * d1);
  }
  ctx.stroke();
  // pale core with a soft star edge
  ctx.beginPath();
  const n = 18;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * TAU;
    const d = (i % 2 ? 0.36 : 0.3) * r * rng.float(0.95, 1.05);
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.38 * r);
  g.addColorStop(0, '#fdfde8');
  g.addColorStop(0.7, '#f1f7c4');
  g.addColorStop(1, 'rgba(214,238,140,0.2)');
  ctx.fillStyle = g;
  ctx.fill();
  // seeds
  const seeds = 30;
  for (let i = 0; i < seeds; i++) {
    const a = (i / seeds) * TAU + rng.float(-0.05, 0.05);
    const d = (i % 2 ? 0.44 : 0.5) * r + rng.float(-0.012, 0.012) * r;
    ctx.save();
    ctx.translate(Math.cos(a) * d, Math.sin(a) * d);
    ctx.rotate(a);
    seedPath(ctx, 0.05 * r, 0.026 * r);
    ctx.fillStyle = '#23180f';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(0.012 * r, -0.008 * r, 0.014 * r, 0.006 * r, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // skin / flesh boundary
  ctx.strokeStyle = 'rgba(60,110,20,0.6)';
  ctx.lineWidth = Math.max(1, 0.018 * r);
  circle(ctx, 0, 0, fr);
  ctx.stroke();
  gloss(ctx, r, 0.55, 0.35);
  outline(ctx, r, '#4a2c12');
}

const tomatoSkin: Skin = { light: '#ff9a82', base: '#f23b2a', shade: '#b0160c', rim: '#720c05', line: '#8a1208' };

function tomato(ctx: Ctx2D, r: number): void {
  const lw = fruitLineWidth(r);
  ball(ctx, r, tomatoSkin);
  // lobes
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(140,10,0,0.18)';
  ctx.lineWidth = 0.05 * r;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 0.12 * r, -0.72 * r);
    ctx.bezierCurveTo(s * 0.5 * r, -0.55 * r, s * 0.62 * r, -0.1 * r, s * 0.5 * r, 0.35 * r);
    ctx.stroke();
  }
  ctx.restore();
  rimShade(ctx, r, tomatoSkin.rim, 0.5);
  bounceLight(ctx, r, '#ff7a5e', 0.6);
  gloss(ctx, r, 0.95);
  outline(ctx, r, tomatoSkin.line);
  // calyx: a flattened green star lying on top (back sepals first)
  ctx.save();
  ctx.translate(0, -0.8 * r);
  const sepals = [-90, -18, 54, 126, 198].map((d) => (d * Math.PI) / 180 + 0.2);
  sepals.sort((p, q) => Math.sin(p) - Math.sin(q));
  for (const a of sepals) {
    const len = 0.46 * r;
    const w = 0.11 * r;
    ctx.save();
    ctx.scale(1, 0.5);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -w);
    ctx.bezierCurveTo(len * 0.35, -w * 1.1, len * 0.7, -w * 0.2, len, w * 0.25);
    ctx.bezierCurveTo(len * 0.65, w * 0.55, len * 0.35, w * 1.05, 0, w);
    ctx.closePath();
    ctx.restore();
    const g = ctx.createLinearGradient(0, -0.2 * r, 0, 0.2 * r);
    g.addColorStop(0, '#86dc5e');
    g.addColorStop(1, '#2f8a2c');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#1f5e1c';
    ctx.lineWidth = lw * 0.8;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  const cg = ctx.createRadialGradient(-0.03 * r, -0.03 * r, 0, 0, 0, 0.12 * r);
  cg.addColorStop(0, '#8ee068');
  cg.addColorStop(1, '#3c9a34');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.11 * r, 0.06 * r, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  tube(ctx, [0, -0.8 * r, 0, -0.88 * r, 0.005 * r, -0.95 * r, 0.03 * r, -1.02 * r], 0.075 * r, '#5aa83a', '#1f5e1c', lw * 0.8);
  ctx.fillStyle = '#9ae070';
  ctx.strokeStyle = '#1f5e1c';
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  ctx.ellipse(0.03 * r, -1.02 * r, 0.045 * r, 0.025 * r, -0.35, 0, TAU);
  ctx.fill();
  ctx.stroke();
}

function peach(ctx: Ctx2D, r: number): void {
  const lw = fruitLineWidth(r);
  tube(ctx, [0.02 * r, -0.86 * r, 0.02 * r, -0.96 * r, 0.03 * r, -1.02 * r, 0.05 * r, -1.08 * r], 0.07 * r, '#8a5a30', '#4e2f14', lw * 0.8);
  leaf(ctx, 0.02 * r, -1.02 * r, -2.72, 0.56 * r, 0.32 * r, GREEN_LEAF, lw * 0.8);
  leaf(ctx, 0.06 * r, -1.03 * r, -0.62, 0.42 * r, 0.26 * r, GREEN_LEAF, lw * 0.8);
  // warm base, cream in the lower left, rosy in the upper right
  let g = ctx.createRadialGradient(-0.35 * r, 0.4 * r, 0.05 * r, -0.1 * r, 0.1 * r, 1.25 * r);
  g.addColorStop(0, '#ffe9b0');
  g.addColorStop(0.45, '#ffbe92');
  g.addColorStop(1, '#ff8a8e');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, r);
  ctx.fill();
  g = ctx.createRadialGradient(0.35 * r, -0.35 * r, 0, 0.35 * r, -0.35 * r, 0.85 * r);
  g.addColorStop(0, 'rgba(255,70,105,0.55)');
  g.addColorStop(1, 'rgba(255,70,105,0)');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, r);
  ctx.fill();
  rimShade(ctx, r, '#d0405a', 0.4);
  bounceLight(ctx, r, '#ffd0b0', 0.55);
  // crease from the stem down the right side: groove + lit ridge
  ctx.save();
  ctx.lineCap = 'round';
  const crease = (dx: number) => {
    ctx.beginPath();
    ctx.moveTo(0.04 * r + dx, -0.93 * r);
    ctx.bezierCurveTo(0.42 * r + dx, -0.74 * r, 0.62 * r + dx, -0.3 * r, 0.56 * r + dx, 0.3 * r);
  };
  g = ctx.createLinearGradient(0, -0.95 * r, 0, 0.35 * r);
  g.addColorStop(0, 'rgba(200,50,80,0.6)');
  g.addColorStop(0.7, 'rgba(200,50,80,0.35)');
  g.addColorStop(1, 'rgba(200,50,80,0)');
  crease(0);
  ctx.strokeStyle = g;
  ctx.lineWidth = 0.045 * r;
  ctx.stroke();
  g = ctx.createLinearGradient(0, -0.95 * r, 0, 0.35 * r);
  g.addColorStop(0, 'rgba(255,240,230,0.5)');
  g.addColorStop(1, 'rgba(255,240,230,0)');
  crease(-0.06 * r);
  ctx.strokeStyle = g;
  ctx.lineWidth = 0.04 * r;
  ctx.stroke();
  ctx.restore();
  // stem dimple
  g = ctx.createRadialGradient(0.03 * r, -0.9 * r, 0, 0.03 * r, -0.9 * r, 0.2 * r);
  g.addColorStop(0, 'rgba(170,40,60,0.45)');
  g.addColorStop(1, 'rgba(170,40,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0.03 * r, -0.9 * r, 0.2 * r, 0.08 * r, 0, 0, TAU);
  ctx.fill();
  gloss(ctx, r, 0.7, 0.5);
  outline(ctx, r, '#cc4f63');
}

const pineSkin: Skin = { light: '#fff0a0', base: '#f9c42e', shade: '#d98a0a', rim: '#9a5606', line: '#9c6006' };

/** A pointed crown leaf from (x, y) at `deg` degrees from vertical, slightly bent outwards. */
function crownLeaf(ctx: Ctx2D, r: number, x: number, y: number, deg: number, len: number, wid: number, front: boolean, lw: number): void {
  const a = (deg * Math.PI) / 180;
  const bend = Math.sign(deg) * 0.06 * r;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a - Math.PI / 2);
  const L = len * r;
  const W = wid * r * 0.5;
  ctx.beginPath();
  ctx.moveTo(0, -W);
  ctx.bezierCurveTo(L * 0.4, -W * 1.05, L * 0.75, -W * 0.5 + bend, L, bend * 1.6);
  ctx.bezierCurveTo(L * 0.75, W * 0.35 + bend, L * 0.4, W * 0.95, 0, W);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -W, 0, W);
  g.addColorStop(0, front ? '#a6ee70' : '#72cc4c');
  g.addColorStop(1, front ? '#3aa338' : '#26782c');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#1b5520';
  ctx.lineWidth = lw * 0.8;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(L * 0.08, 0);
  ctx.quadraticCurveTo(L * 0.5, bend * 0.4, L * 0.8, bend * 1.1);
  ctx.strokeStyle = front ? 'rgba(230,255,200,0.55)' : 'rgba(200,245,160,0.4)';
  ctx.lineWidth = lw * 0.6;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

function pineapple(ctx: Ctx2D, r: number): void {
  const lw = fruitLineWidth(r);
  // crown: back fan behind the body
  const back: [deg: number, len: number, wid: number][] = [
    [-58, 0.44, 0.18],
    [58, 0.44, 0.18],
    [-40, 0.49, 0.19],
    [40, 0.49, 0.19],
    [-20, 0.53, 0.19],
    [20, 0.53, 0.19],
    [0, 0.55, 0.19],
  ];
  for (const [deg, len, wid] of back) {
    const s = Math.sin((deg * Math.PI) / 180);
    crownLeaf(ctx, r, s * 0.16 * r, -(0.72 + 0.1 * Math.abs(s)) * r, deg, len, wid, false, lw);
  }
  ball(ctx, r, pineSkin);
  bounceLight(ctx, r, '#ffe070', 0.7);
  // diamond lattice on the sphere
  ctx.save();
  circle(ctx, 0, 0, r);
  ctx.clip();
  const tilt = 0.12;
  const step = Math.PI / 7;
  const p: P3 = { x: 0, y: 0, z: 0 };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(176,104,6,0.75)';
  ctx.lineWidth = Math.max(1, 0.022 * r);
  ctx.beginPath();
  for (const sgn of [1, -1]) {
    for (let k = -8; k <= 8; k++) {
      const c = k * step;
      let pen = false;
      for (let i = 0; i <= 48; i++) {
        const lon = -Math.PI / 2 + (i / 48) * Math.PI;
        const lat = sgn * (c - lon);
        if (Math.abs(lat) > Math.PI / 2) {
          pen = false;
          continue;
        }
        sphere(r, lon, lat, tilt, p);
        if (p.z < 0) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        pen = true;
      }
    }
  }
  ctx.stroke();
  // eyes at the diamond centres
  for (let i = -8; i <= 8; i++) {
    for (let j = -8; j <= 8; j++) {
      const c1 = (i + 0.5) * step;
      const c2 = (j + 0.5) * step;
      const lon = (c1 + c2) / 2;
      const lat = (c1 - c2) / 2;
      if (Math.abs(lon) > Math.PI / 2 || Math.abs(lat) > Math.PI / 2) continue;
      sphere(r, lon, lat, tilt, p);
      if (p.z < 0.15) continue;
      const s = 0.034 * r * (0.35 + 0.65 * p.z);
      ctx.fillStyle = 'rgba(255,248,200,0.5)';
      ctx.beginPath();
      ctx.ellipse(p.x - s * 0.3, p.y - s * 0.9, s * 1.5, s * 0.9, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#8a4e06';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, s, s * 0.8, 0, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
  rimShade(ctx, r, pineSkin.rim, 0.5);
  gloss(ctx, r, 0.85, 0.45, false);
  outline(ctx, r, pineSkin.line);
  // crown: front leaves rooted just inside the top edge
  const front: [deg: number, len: number, wid: number][] = [
    [-46, 0.34, 0.17],
    [46, 0.34, 0.17],
    [-22, 0.42, 0.18],
    [22, 0.42, 0.18],
    [0, 0.46, 0.19],
  ];
  for (const [deg, len, wid] of front) crownLeaf(ctx, r, Math.sin((deg * Math.PI) / 180) * 0.12 * r, -0.8 * r, deg, len, wid, true, lw);
}

function coconut(ctx: Ctx2D, r: number): void {
  const rng = new Rng(83);
  // husk
  let g = ctx.createRadialGradient(-0.25 * r, -0.3 * r, 0.5 * r, 0, 0, r);
  g.addColorStop(0, '#a8703a');
  g.addColorStop(1, '#6a3c18');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, r);
  ctx.fill();
  // fibres running around the husk
  ctx.save();
  circle(ctx, 0, 0, r * 1.03);
  ctx.clip();
  ctx.lineCap = 'round';
  for (const [color, count, w] of [
    ['rgba(72,38,14,0.55)', 150, 0.011],
    ['rgba(205,150,90,0.6)', 170, 0.009],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.8, w * r);
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const a = rng.float(0, TAU);
      const d = rng.float(0.86, 0.975) * r;
      const span = rng.float(0.08, 0.2) * (r / d);
      const drift = rng.float(-0.025, 0.025) * r;
      const a1 = a + span;
      ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d);
      ctx.quadraticCurveTo(
        Math.cos(a + span / 2) * (d + drift),
        Math.sin(a + span / 2) * (d + drift),
        Math.cos(a1) * (d + drift * 0.5),
        Math.sin(a1) * (d + drift * 0.5),
      );
    }
    ctx.stroke();
  }
  outline(ctx, r, '#4a2a10');
  // stray hairs over the rim
  ctx.strokeStyle = 'rgba(120,72,30,0.9)';
  ctx.lineWidth = Math.max(0.8, 0.008 * r);
  ctx.beginPath();
  for (let i = 0; i < 70; i++) {
    const a = rng.float(0, TAU);
    const d0 = rng.float(0.94, 0.98) * r;
    const d1 = rng.float(1.0, 1.03) * r;
    const t = a + rng.float(-0.12, 0.12);
    ctx.moveTo(Math.cos(a) * d0, Math.sin(a) * d0);
    ctx.lineTo(Math.cos(t) * d1, Math.sin(t) * d1);
  }
  ctx.stroke();
  ctx.restore();
  // shell
  ctx.fillStyle = '#3e220c';
  circle(ctx, 0, 0, 0.845 * r);
  ctx.fill();
  // white meat ring
  g = ctx.createRadialGradient(-0.1 * r, -0.1 * r, 0.45 * r, 0, 0, 0.81 * r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.8, '#fdfbf6');
  g.addColorStop(1, '#eee4cf');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, 0.81 * r);
  ctx.fill();
  // hollow: creamy bowl, its upper-left wall in shade (concave)
  const hr = 0.62 * r;
  g = ctx.createRadialGradient(0.14 * r, 0.16 * r, 0.25 * r, 0.1 * r, 0.12 * r, 0.8 * r);
  g.addColorStop(0, '#fffaf0');
  g.addColorStop(0.55, '#fcf2dc');
  g.addColorStop(1, '#e6cfa6');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, hr);
  ctx.fill();
  ctx.strokeStyle = 'rgba(214,190,150,0.8)';
  ctx.lineWidth = Math.max(1, 0.01 * r);
  circle(ctx, 0, 0, hr);
  ctx.stroke();
  // highlights on the meat
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 0.05 * r;
  ctx.beginPath();
  ctx.arc(0, 0, 0.715 * r, Math.PI * 1.1, Math.PI * 1.3);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  circle(ctx, Math.cos(Math.PI * 1.39) * 0.715 * r, Math.sin(Math.PI * 1.39) * 0.715 * r, 0.026 * r);
  ctx.fill();
  ctx.lineWidth = 0.035 * r;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(0, 0, 0.55 * r, Math.PI * 0.15, Math.PI * 0.35);
  ctx.stroke();
  ctx.restore();
}

function halfMelon(ctx: Ctx2D, r: number): void {
  const rng = new Rng(97);
  // rind
  let g = ctx.createRadialGradient(-0.2 * r, -0.2 * r, 0.7 * r, 0, 0, r);
  g.addColorStop(0, '#3ea846');
  g.addColorStop(1, '#1d6e2a');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, r);
  ctx.fill();
  ctx.strokeStyle = '#7fd35e';
  ctx.lineWidth = 0.025 * r;
  circle(ctx, 0, 0, 0.915 * r);
  ctx.stroke();
  // white band
  g = ctx.createRadialGradient(0, 0, 0.8 * r, 0, 0, 0.9 * r);
  g.addColorStop(0, '#fbfff2');
  g.addColorStop(1, '#cdeeb0');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, 0.895 * r);
  ctx.fill();
  // flesh
  g = ctx.createRadialGradient(-0.1 * r, -0.12 * r, 0.05 * r, 0, 0, 0.83 * r);
  g.addColorStop(0, '#ff7a86');
  g.addColorStop(0.6, '#f5404f');
  g.addColorStop(1, '#e02a3c');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, 0.83 * r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,190,190,0.7)';
  ctx.lineWidth = Math.max(1, 0.012 * r);
  circle(ctx, 0, 0, 0.83 * r);
  ctx.stroke();
  // juicy grain
  speckle(ctx, r, rng, 90, 0.8, 0.012, 'rgba(255,200,205,0.35)');
  speckle(ctx, r, rng, 50, 0.8, 0.012, 'rgba(190,20,40,0.2)');
  // seeds in a ring, clear of the face
  const seeds = 12;
  for (let i = 0; i < seeds; i++) {
    const a = (i / seeds) * TAU + 0.26 + rng.float(-0.08, 0.08);
    const d = rng.float(0.58, 0.68) * r;
    ctx.save();
    ctx.translate(Math.cos(a) * d, Math.sin(a) * d);
    ctx.rotate(a);
    seedPath(ctx, 0.055 * r, 0.032 * r);
    ctx.fillStyle = '#2a1812';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(0.015 * r, -0.01 * r, 0.018 * r, 0.007 * r, -0.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  gloss(ctx, r, 0.6, 0.3);
  outline(ctx, r, '#14531f');
}

const melonSkin: Skin = { light: '#a6ec84', base: '#4cbc4c', shade: '#1f7a2e', rim: '#0f4a1a', line: '#145a22' };

function watermelon(ctx: Ctx2D, r: number): void {
  const lw = fruitLineWidth(r);
  ball(ctx, r, melonSkin);
  // dark wavy stripes converging at the stem
  ctx.save();
  circle(ctx, 0, 0, r);
  ctx.clip();
  const tilt = 0.4;
  const p: P3 = { x: 0, y: 0, z: 0 };
  const stripes = 8;
  const n = 64;
  const push = (lon: number, lat: number, first: boolean) => {
    sphere(r, lon, lat, tilt, p);
    let { x, y } = p;
    if (p.z < 0) {
      const k = (1.06 * r) / Math.max(1e-6, Math.hypot(x, y));
      x *= k;
      y *= k;
    }
    if (first) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  };
  ctx.fillStyle = 'rgba(22,96,36,0.92)';
  ctx.beginPath();
  for (let s = 0; s < stripes; s++) {
    const phi = ((s + 0.5) / stripes) * TAU;
    const w = 0.13;
    for (let i = 0; i <= n; i++) {
      const lat = -Math.PI / 2 + (i / n) * Math.PI;
      const wav = 0.06 * Math.sin(lat * 15 + s * 1.7) * Math.cos(lat);
      push(phi - w * Math.cos(lat * 0.5) + wav, lat, i === 0);
    }
    for (let i = n; i >= 0; i--) {
      const lat = -Math.PI / 2 + (i / n) * Math.PI;
      const wav = 0.06 * Math.sin(lat * 15 + s * 1.7 + 2.2) * Math.cos(lat);
      push(phi + w * Math.cos(lat * 0.5) + wav, lat, false);
    }
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
  rimShade(ctx, r, melonSkin.rim, 0.55);
  bounceLight(ctx, r, '#8ad86a', 0.5);
  gloss(ctx, r, 0.85);
  outline(ctx, r, melonSkin.line);
  // stem at the (tipped) north pole
  sphere(r, 0, Math.PI / 2, tilt, p);
  ctx.fillStyle = 'rgba(90,70,20,0.5)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 0.07 * r, 0.035 * r, 0, 0, TAU);
  ctx.fill();
  tube(ctx, [p.x, p.y, p.x, p.y - 0.08 * r, p.x + 0.06 * r, p.y - 0.14 * r, p.x + 0.12 * r, p.y - 0.16 * r], 0.05 * r, '#8a6a34', '#4e3a14', lw * 0.7);
}

/** Painters by level (0 = grape .. 10 = watermelon). */
export const fruitPainters: readonly FruitPainter[] = [
  grape,
  cherry,
  orange,
  lemon,
  kiwi,
  tomato,
  peach,
  pineapple,
  coconut,
  halfMelon,
  watermelon,
];
