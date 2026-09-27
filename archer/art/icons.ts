import { roundRectPath, TAU, type Ctx2D } from '@engine';
import { COLORS } from '../config';

/**
 * Menu / HUD icon painters, drawn into a size x size box at the origin (baked once by bakeArcherArt). Eye sockets,
 * gear holes and similar cut-outs are punched through with destination-out so the icons sit on any background.
 */

const WHITE = '#ffffff';
const INK = '#2f2f33';

function punch(ctx: Ctx2D, draw: () => void): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  draw();
  ctx.restore();
}

/** White skull (the skull currency). */
export function paintSkullIcon(ctx: Ctx2D, size: number): void {
  const u = size / 48;
  ctx.save();
  ctx.scale(u, u);
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.arc(24, 20.5, 17, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  roundRectPath(ctx, 13.5, 26, 21, 16.5, 5);
  ctx.fill();
  punch(ctx, () => {
    ctx.beginPath();
    ctx.ellipse(17, 23, 5.4, 5.8, 0.15, 0, TAU);
    ctx.moveTo(36.4, 23);
    ctx.ellipse(31, 23, 5.4, 5.8, -0.15, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(24, 28.5);
    ctx.lineTo(21.6, 32.6);
    ctx.lineTo(26.4, 32.6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(19.8, 37);
    ctx.lineTo(19.8, 42.5);
    ctx.moveTo(24, 37.4);
    ctx.lineTo(24, 42.5);
    ctx.moveTo(28.2, 37);
    ctx.lineTo(28.2, 42.5);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.stroke();
  });
  ctx.restore();
}

/** White padlock; the body is left plain so the menu can print the unlock price on it. */
export function paintLockIcon(ctx: Ctx2D, size: number): void {
  const u = size / 48;
  ctx.save();
  ctx.scale(u, u);
  ctx.beginPath();
  ctx.moveTo(14, 23);
  ctx.lineTo(14, 16);
  ctx.arc(24, 16, 10, Math.PI, 0);
  ctx.lineTo(34, 23);
  ctx.lineWidth = 5;
  ctx.strokeStyle = WHITE;
  ctx.stroke();
  ctx.beginPath();
  roundRectPath(ctx, 6, 21, 36, 24, 5);
  ctx.fillStyle = WHITE;
  ctx.fill();
  ctx.fillStyle = '#d9d9de';
  ctx.fillRect(6, 40, 36, 1);
  ctx.beginPath();
  roundRectPath(ctx, 6, 41, 36, 4, [0, 0, 5, 5]);
  ctx.fill();
  ctx.restore();
}

/** Yellow film strip with a play triangle (rewarded-ad marker). */
export function paintFilmIcon(ctx: Ctx2D, size: number): void {
  const u = size / 48;
  ctx.save();
  ctx.scale(u, u);
  ctx.beginPath();
  roundRectPath(ctx, 5, 7, 38, 34, 5);
  ctx.fillStyle = COLORS.cardTrial;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  for (let i = 0; i < 5; i++) {
    const x = 9.5 + i * 6.6;
    ctx.fillRect(x, 10, 3.4, 3.4);
    ctx.fillRect(x, 34.6, 3.4, 3.4);
  }
  ctx.fillRect(5, 16.2, 38, 1.8);
  ctx.fillRect(5, 30, 38, 1.8);
  ctx.beginPath();
  ctx.moveTo(20, 19);
  ctx.lineTo(20, 29);
  ctx.lineTo(29, 24);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.6;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** White settings gear with eight teeth and a punched hub. */
export function paintGearIcon(ctx: Ctx2D, size: number): void {
  const u = size / 48;
  ctx.save();
  ctx.scale(u, u);
  ctx.translate(24, 24);
  const teeth = 8;
  const rIn = 15;
  const rOut = 20.5;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU;
    const pts = [
      [rIn, a - 0.3],
      [rOut, a - 0.19],
      [rOut, a + 0.19],
      [rIn, a + 0.3],
    ] as const;
    pts.forEach(([r, t], j) => {
      if (i === 0 && j === 0) ctx.moveTo(Math.cos(t) * r, Math.sin(t) * r);
      else ctx.lineTo(Math.cos(t) * r, Math.sin(t) * r);
    });
    ctx.arc(0, 0, rIn, a + 0.3, a + TAU / teeth - 0.3);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = WHITE;
  ctx.strokeStyle = WHITE;
  ctx.fill();
  ctx.stroke();
  punch(ctx, () => {
    ctx.beginPath();
    ctx.arc(0, 0, 6.5, 0, TAU);
    ctx.fill();
  });
  ctx.restore();
}

/** One cheering figure (arms up) standing with its feet at (x, feet); k scales it. */
function cheer(ctx: Ctx2D, x: number, feet: number, k: number): void {
  const hip = feet - 11 * k;
  const sh = hip - 11 * k;
  ctx.beginPath();
  ctx.moveTo(x - 2.4 * k, feet);
  ctx.lineTo(x - 1.8 * k, hip);
  ctx.moveTo(x + 2.4 * k, feet);
  ctx.lineTo(x + 1.8 * k, hip);
  ctx.moveTo(x - 3.4 * k, sh + 1 * k);
  ctx.lineTo(x - 6.5 * k, sh - 5 * k);
  ctx.lineTo(x - 6 * k, sh - 10 * k);
  ctx.moveTo(x + 3.4 * k, sh + 1 * k);
  ctx.lineTo(x + 6.5 * k, sh - 5 * k);
  ctx.lineTo(x + 6 * k, sh - 10 * k);
  ctx.lineWidth = 2.8 * k;
  ctx.stroke();
  ctx.beginPath();
  roundRectPath(ctx, x - 4.2 * k, sh - 0.5 * k, 8.4 * k, 12.5 * k, 2.6 * k);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, sh - 5.6 * k, 3.6 * k, 0, TAU);
  ctx.fill();
}

/** Leaderboard: three cheering people with medals on a stepped podium. */
export function paintPodiumIcon(ctx: Ctx2D, size: number): void {
  const u = size / 64;
  ctx.save();
  ctx.scale(u, u);
  ctx.fillStyle = WHITE;
  ctx.strokeStyle = WHITE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  roundRectPath(ctx, 22, 43, 20, 19, [2.5, 2.5, 0, 0]);
  roundRectPath(ctx, 4, 50, 19, 12, [2.5, 0, 0, 0]);
  roundRectPath(ctx, 41, 53, 19, 9, [0, 2.5, 0, 0]);
  ctx.fill();
  cheer(ctx, 32, 43, 1);
  cheer(ctx, 13.5, 50, 0.86);
  cheer(ctx, 50.5, 53, 0.82);
  punch(ctx, () => {
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [x, sh, k] of [
      [32, 21, 1],
      [13.5, 31.1, 0.86],
      [50.5, 35, 0.82],
    ] as const) {
      ctx.moveTo(x - 3 * k, sh);
      ctx.lineTo(x, sh + 5 * k);
      ctx.lineTo(x + 3 * k, sh);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 27.6, 1.8, 0, TAU);
    ctx.moveTo(13.5 + 1.6, 36.6);
    ctx.arc(13.5, 36.6, 1.6, 0, TAU);
    ctx.moveTo(50.5 + 1.5, 40.2);
    ctx.arc(50.5, 40.2, 1.5, 0, TAU);
    ctx.fill();
    ctx.fillRect(22.6, 43, 0.9, 19);
    ctx.fillRect(40.5, 43, 0.9, 19);
  });
  ctx.restore();
}
