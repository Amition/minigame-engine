import { clamp01, mix, type Ctx2D } from '@engine';

let clock = 0;

/**
 * Animation clock (seconds) for painters that get no time argument (balloon bob, poison bubbles, stun sparks).
 * drawBackdrop() sets it every frame from its `time`; call this directly when a scene draws no backdrop.
 */
export function setArtTime(seconds: number): void {
  clock = seconds;
}

export function artTime(): number {
  return clock;
}

/** Deterministic hash of an integer to [0, 1) (mulberry32 step): per-frame jitter without an Rng or allocations. */
export function hash01(n: number): number {
  let t = (n | 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** steps + 1 colours from a to b, built once so painters can tint without formatting strings per frame. */
export function colorSteps(a: string, b: string, steps: number): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i <= steps; i++) out.push(mix(a, b, i / steps));
  return out;
}

export function pickStep(steps: readonly string[], t: number): string {
  return steps[Math.round(clamp01(t) * (steps.length - 1))]!;
}

/** roundRectPath without its per-call arrays, for painters that run every frame: left and right corner radii. */
export function rrect(ctx: Ctx2D, x: number, y: number, w: number, h: number, rl: number, rr = rl): void {
  const m = Math.min(w, h) / 2;
  const a = Math.max(0, Math.min(rl, m));
  const b = Math.max(0, Math.min(rr, m));
  ctx.moveTo(x + a, y);
  ctx.lineTo(x + w - b, y);
  if (b) ctx.arcTo(x + w, y, x + w, y + b, b);
  else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - b);
  if (b) ctx.arcTo(x + w, y + h, x + w - b, y + h, b);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + a, y + h);
  if (a) ctx.arcTo(x, y + h, x, y + h - a, a);
  else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + a);
  if (a) ctx.arcTo(x, y, x + a, y, a);
  else ctx.lineTo(x, y);
  ctx.closePath();
}
