import { parseColor, toCss, type Color, type RGBA } from '../core/color';
import type { Ctx2D } from '../gfx/types';

/** Gradient color stops: `[[0, '#fff'], [1, '#000']]` (offsets 0..1, ascending). */
export type GradientStops = readonly (readonly [number, Color])[];

/** Linear gradient from (x0, y0) to (x1, y1), in the local coordinates of the node that draws it. */
export interface LinearGradientStyle {
  type: 'linear';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stops: GradientStops;
}

/**
 * Radial gradient centered at (x, y) with outer radius r, in local coordinates.
 * Optional inner radius r0 (default 0) and focal point (fx, fy) (default the center).
 */
export interface RadialGradientStyle {
  type: 'radial';
  x: number;
  y: number;
  r: number;
  r0?: number;
  fx?: number;
  fy?: number;
  stops: GradientStops;
}

export type GradientStyle = LinearGradientStyle | RadialGradientStyle;

/** A CSS color or a gradient descriptor. Descriptors are cached per object: replace them instead of mutating. */
export type PaintStyle = Color | GradientStyle;

/** Creates a CanvasGradient for a descriptor (no caching). */
export function createCanvasGradient(ctx: Ctx2D, g: GradientStyle): CanvasGradient {
  const grad =
    g.type === 'linear'
      ? ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1)
      : ctx.createRadialGradient(g.fx ?? g.x, g.fy ?? g.y, Math.max(0, g.r0 ?? 0), g.x, g.y, Math.max(0.0001, g.r));
  for (const [offset, color] of g.stops) grad.addColorStop(Math.min(1, Math.max(0, offset)), color);
  return grad;
}

const gradientCache = new WeakMap<GradientStyle, { ctx: Ctx2D; grad: CanvasGradient }>();

/** Turns a PaintStyle into a value for fillStyle/strokeStyle. Gradients are cached per descriptor and context. */
export function resolvePaintStyle(ctx: Ctx2D, style: PaintStyle): string | CanvasGradient {
  if (typeof style === 'string') return style;
  const hit = gradientCache.get(style);
  if (hit && hit.ctx === ctx) return hit.grad;
  const grad = createCanvasGradient(ctx, style);
  gradientCache.set(style, { ctx, grad });
  return grad;
}

/** Short text for dumps: the color itself or `linear(3)` / `radial(2)`. */
export function describePaintStyle(style: PaintStyle | null | undefined): string | undefined {
  if (style == null) return undefined;
  return typeof style === 'string' ? style : `${style.type}(${style.stops.length})`;
}

/** Interpolated color of gradient stops at t (0..1) as RGBA. */
export function sampleGradientStops(stops: GradientStops, t: number): RGBA {
  if (stops.length === 0) return { r: 255, g: 255, b: 255, a: 1 };
  const first = stops[0]!;
  if (stops.length === 1 || t <= first[0]) return parseColor(first[1]);
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!;
    if (t <= b[0]) {
      const a = stops[i - 1]!;
      const k = b[0] === a[0] ? 1 : (t - a[0]) / (b[0] - a[0]);
      const ca = parseColor(a[1]);
      const cb = parseColor(b[1]);
      return {
        r: ca.r + (cb.r - ca.r) * k,
        g: ca.g + (cb.g - ca.g) * k,
        b: ca.b + (cb.b - ca.b) * k,
        a: ca.a + (cb.a - ca.a) * k,
      };
    }
  }
  return parseColor(stops[stops.length - 1]![1]);
}

/** Precomputed CSS colors of gradient stops at n evenly spaced points (lookup tables for per-frame use). */
export function gradientColorTable(stops: GradientStops, n = 32): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(toCss(sampleGradientStops(stops, n === 1 ? 0 : i / (n - 1))));
  return out;
}
