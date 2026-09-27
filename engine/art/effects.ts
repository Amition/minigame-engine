import { parseColor, type Color } from '../core/color';
import { bakeTexture, ScaledTexture, type Texture } from '../gfx/texture';
import type { Ctx2D, Surface } from '../gfx/types';

const resOf = (tex: Texture) => (tex instanceof ScaledTexture ? tex.resolution : 1);

function bakeLike(tex: Texture, w: number, h: number, draw: (ctx: Ctx2D) => void): Texture {
  return bakeTexture(w, h, draw, { resolution: resOf(tex) });
}

/** RGBA pixels of a texture at its backing resolution (copies it first, so any image source works). */
export function texturePixels(tex: Texture): { data: Uint8ClampedArray; width: number; height: number } {
  const copy = bakeLike(tex, tex.width, tex.height, (ctx) => tex.draw(ctx, 0, 0));
  const s = copy.source as Surface;
  const img = s.getContext('2d').getImageData(0, 0, s.width, s.height);
  return { data: img.data, width: s.width, height: s.height };
}

/**
 * Colours a texture. 'fill' (default) paints `color` over opaque pixels with `amount` opacity (flash / tint);
 * 'multiply' multiplies the colours (keeps shading; needs globalCompositeOperation 'multiply').
 */
export function tintTexture(tex: Texture, color: Color, opts: { amount?: number; mode?: 'fill' | 'multiply' } = {}): Texture {
  return bakeLike(tex, tex.width, tex.height, (ctx) => {
    tex.draw(ctx, 0, 0);
    if (opts.mode === 'multiply') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = opts.amount ?? 1;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, tex.width, tex.height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-in';
      tex.draw(ctx, 0, 0);
    } else {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = opts.amount ?? 1;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, tex.width, tex.height);
    }
  });
}

/** Solid single-colour copy of the texture's shape (shadows, hit flashes, locked items). */
export function silhouetteTexture(tex: Texture, color: Color = '#000000'): Texture {
  return tintTexture(tex, color, { amount: 1 });
}

/** Adds an outline around opaque pixels; the result is `width` px larger on every side. */
export function outlineTexture(tex: Texture, opts: { color?: Color; width?: number } = {}): Texture {
  const t = opts.width ?? 2;
  const sil = silhouetteTexture(tex, opts.color ?? '#000000');
  const steps = Math.max(12, Math.ceil(t * 8));
  return bakeLike(tex, tex.width + t * 2, tex.height + t * 2, (ctx) => {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      sil.draw(ctx, t + Math.cos(a) * t, t + Math.sin(a) * t);
    }
    if (t > 2) for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      sil.draw(ctx, t + Math.cos(a) * t * 0.5, t + Math.sin(a) * t * 0.5);
    }
    tex.draw(ctx, t, t);
  });
}

/** Adds a (blurred) drop shadow; the texture grows to fit it. The sprite keeps its position at (pad.left, pad.top). */
export function dropShadowTexture(
  tex: Texture,
  opts: { color?: Color; blur?: number; x?: number; y?: number } = {},
): Texture {
  const blur = opts.blur ?? 6;
  const ox = opts.x ?? 0;
  const oy = opts.y ?? 4;
  const res = resOf(tex);
  const left = Math.ceil(Math.max(0, blur - ox));
  const right = Math.ceil(Math.max(0, blur + ox));
  const top = Math.ceil(Math.max(0, blur - oy));
  const bottom = Math.ceil(Math.max(0, blur + oy));
  return bakeLike(tex, tex.width + left + right, tex.height + top + bottom, (ctx) => {
    ctx.shadowColor = opts.color ?? 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = blur * res;
    ctx.shadowOffsetX = ox * res;
    ctx.shadowOffsetY = oy * res;
    tex.draw(ctx, left, top);
  });
}

/** Soft coloured glow around the shape (power-ups, selection); grows by `blur` px per side. */
export function glowTexture(tex: Texture, opts: { color?: Color; blur?: number; strength?: number } = {}): Texture {
  const blur = opts.blur ?? 10;
  const pad = Math.ceil(blur);
  const res = resOf(tex);
  const w = tex.width + pad * 2;
  const h = tex.height + pad * 2;
  const shift = w + 16;
  return bakeLike(tex, w, h, (ctx) => {
    ctx.save();
    ctx.shadowColor = opts.color ?? '#fff3a0';
    ctx.shadowBlur = blur * res;
    ctx.shadowOffsetX = shift * res;
    const n = Math.max(1, Math.round(opts.strength ?? 2));
    for (let i = 0; i < n; i++) tex.draw(ctx, pad - shift, pad);
    ctx.restore();
    tex.draw(ctx, pad, pad);
  });
}

/**
 * Palette swap: replaces exact colours (RGB within `tolerance`, alpha kept).
 * `recolorTexture(hero, { '#e43b44': '#3b5dc9', '#a22633': '#29366f' })`.
 */
export function recolorTexture(tex: Texture, map: Record<Color, Color>, opts: { tolerance?: number } = {}): Texture {
  const tol = opts.tolerance ?? 0;
  const pairs = Object.entries(map).map(([from, to]) => [parseColor(from), parseColor(to)] as const);
  const out = bakeLike(tex, tex.width, tex.height, (ctx) => tex.draw(ctx, 0, 0));
  const s = out.source as Surface;
  const ctx = s.getContext('2d');
  const img = ctx.getImageData(0, 0, s.width, s.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    for (const [a, b] of pairs) {
      if (Math.abs(d[i]! - a.r) <= tol && Math.abs(d[i + 1]! - a.g) <= tol && Math.abs(d[i + 2]! - a.b) <= tol) {
        d[i] = b.r;
        d[i + 1] = b.g;
        d[i + 2] = b.b;
        d[i + 3] = d[i + 3]! * b.a;
        break;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Mirrored copy: 'x' = horizontal flip, 'y' = vertical, 'xy' = both. */
export function flipTexture(tex: Texture, axis: 'x' | 'y' | 'xy' = 'x'): Texture {
  return bakeLike(tex, tex.width, tex.height, (ctx) => {
    const fx = axis !== 'y';
    const fy = axis !== 'x';
    ctx.translate(fx ? tex.width : 0, fy ? tex.height : 0);
    ctx.scale(fx ? -1 : 1, fy ? -1 : 1);
    tex.draw(ctx, 0, 0);
  });
}

/** Rescaled copy; smooth=false keeps pixel art crisp (nearest neighbour). */
export function resampleTexture(tex: Texture, scale: number, opts: { smooth?: boolean } = {}): Texture {
  return bakeLike(tex, tex.width * scale, tex.height * scale, (ctx) => {
    ctx.imageSmoothingEnabled = opts.smooth ?? false;
    tex.draw(ctx, 0, 0, tex.width * scale, tex.height * scale);
  });
}
