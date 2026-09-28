import { adjustHsl, mix, type Color } from '../core/color';
import type { Ctx2D } from '../gfx/types';

// Widgets redraw every frame, so colour maths and gradients are cached instead of rebuilt in draw().

const SHADE_LIMIT = 256;
const AMOUNT_LIMIT = 32;
const shades = new Map<number, Map<Color, Color>>();
const mixes = new Map<number, Map<Color, Map<Color, Color>>>();

function bucket<V>(outer: Map<number, V>, key: number, make: () => V): V {
  let m = outer.get(key);
  if (m === undefined) {
    if (outer.size >= AMOUNT_LIMIT) outer.clear();
    outer.set(key, (m = make()));
  }
  return m;
}

/**
 * `lighten(c, amount)` for amount > 0, `darken(c, -amount)` for amount < 0 (same result as the core helpers), from a
 * bounded cache: `uiShade(base, -0.18)` in draw() costs a map lookup instead of an HSL round trip.
 */
export function uiShade(c: Color, amount: number): Color {
  const m = bucket(shades, amount, () => new Map<Color, Color>());
  let v = m.get(c);
  if (v === undefined) {
    if (m.size >= SHADE_LIMIT) m.clear();
    v = adjustHsl(c, 0, 0, amount);
    m.set(c, v);
  }
  return v;
}

/** `mix(a, b, t)` from a bounded cache. */
export function uiMix(a: Color, b: Color, t: number): Color {
  const byA = bucket(mixes, t, () => new Map<Color, Map<Color, Color>>());
  let byB = byA.get(a);
  if (byB === undefined) {
    if (byA.size >= SHADE_LIMIT) byA.clear();
    byA.set(a, (byB = new Map()));
  }
  let v = byB.get(b);
  if (v === undefined) {
    if (byB.size >= SHADE_LIMIT) byB.clear();
    v = mix(a, b, t);
    byB.set(b, v);
  }
  return v;
}

/** Drops the colour caches (tests; themes don't need it: new colours are new keys). */
export function clearUIPaintCaches(): void {
  shades.clear();
  mixes.clear();
}

/**
 * One linear gradient kept by a widget and rebuilt only when the context, the geometry or a colour changes,
 * so a static widget creates no CanvasGradient per frame. Memory: one gradient per cache.
 */
export class UIGradientCache {
  private ctx: Ctx2D | null = null;
  private grad: CanvasGradient | null = null;
  private x0 = 0;
  private y0 = 0;
  private x1 = 0;
  private y1 = 0;
  private readonly cols: Color[] = [];
  /** Gradients created so far (tests). */
  builds = 0;

  private hit(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, n: number): boolean {
    return this.grad !== null && this.ctx === ctx && this.x0 === x0 && this.y0 === y0 && this.x1 === x1 && this.y1 === y1 && this.cols.length === n;
  }

  private make(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    this.ctx = ctx;
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
    this.builds++;
    return ctx.createLinearGradient(x0, y0, x1, y1);
  }

  /** Two stops: c0 at 0, c1 at 1. */
  get2(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, c0: Color, c1: Color): CanvasGradient {
    if (this.hit(ctx, x0, y0, x1, y1, 2) && this.cols[0] === c0 && this.cols[1] === c1) return this.grad!;
    const g = this.make(ctx, x0, y0, x1, y1);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    this.cols.length = 2;
    this.cols[0] = c0;
    this.cols[1] = c1;
    return (this.grad = g);
  }

  /** `n` evenly spaced stops from `cols[0..n)` (one colour = a flat gradient). `cols` is not kept. */
  getN(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, cols: readonly Color[], n: number): CanvasGradient {
    if (this.hit(ctx, x0, y0, x1, y1, n)) {
      let same = true;
      for (let i = 0; i < n; i++) if (this.cols[i] !== cols[i]) same = false;
      if (same) return this.grad!;
    }
    const g = this.make(ctx, x0, y0, x1, y1);
    this.cols.length = n;
    for (let i = 0; i < n; i++) {
      g.addColorStop(n === 1 ? 0 : i / (n - 1), cols[i]!);
      this.cols[i] = cols[i]!;
    }
    return (this.grad = g);
  }

  /** Forgets the gradient (and the context it belongs to). */
  reset(): void {
    this.ctx = null;
    this.grad = null;
    this.cols.length = 0;
  }
}
