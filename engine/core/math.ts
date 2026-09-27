export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const rect = (x = 0, y = 0, w = 0, h = 0): Rect => ({ x, y, w, h });
export const insets = (top = 0, right = 0, bottom = 0, left = 0): Insets => ({ top, right, bottom, left });

export const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v: number, a0: number, a1: number, b0: number, b1: number): number =>
  lerp(b0, b1, invLerp(a0, a1, v));
export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;

/** Moves `v` toward `target` by at most `step`. */
export const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

/** Wraps `v` into [min, max). */
export const wrap = (v: number, min: number, max: number): number => {
  const r = max - min;
  return r === 0 ? min : ((((v - min) % r) + r) % r) + min;
};

/** Frame-rate independent exponential smoothing factor: `lerp(a, b, damp(10, dt))`. */
export const damp = (lambda: number, dt: number): number => 1 - Math.exp(-lambda * dt);

export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);
export const distSq = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};
export const angleTo = (ax: number, ay: number, bx: number, by: number): number => Math.atan2(by - ay, bx - ax);
/** Shortest signed angle difference b - a in (-PI, PI]. */
export const angleDiff = (a: number, b: number): number => wrap(b - a + Math.PI, 0, TAU) - Math.PI;

export const rectContains = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
export const rectIntersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const rectIntersection = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null;
};
export const rectUnion = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
export const rectInset = (r: Rect, i: Insets): Rect => ({
  x: r.x + i.left,
  y: r.y + i.top,
  w: Math.max(0, r.w - i.left - i.right),
  h: Math.max(0, r.h - i.top - i.bottom),
});

/** 2D affine matrix [a c e; b d f; 0 0 1], same layout as CanvasRenderingContext2D.transform. */
export class Mat2D {
  constructor(
    public a = 1,
    public b = 0,
    public c = 0,
    public d = 1,
    public e = 0,
    public f = 0,
  ) {}

  identity(): this {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
    return this;
  }

  set(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  copyFrom(m: Mat2D): this {
    return this.set(m.a, m.b, m.c, m.d, m.e, m.f);
  }

  clone(): Mat2D {
    return new Mat2D(this.a, this.b, this.c, this.d, this.e, this.f);
  }

  /** this = this * m (m applied first). */
  multiply(m: Mat2D): this {
    const { a, b, c, d, e, f } = this;
    this.a = a * m.a + c * m.b;
    this.b = b * m.a + d * m.b;
    this.c = a * m.c + c * m.d;
    this.d = b * m.c + d * m.d;
    this.e = a * m.e + c * m.f + e;
    this.f = b * m.e + d * m.f + f;
    return this;
  }

  translate(x: number, y: number): this {
    this.e += this.a * x + this.c * y;
    this.f += this.b * x + this.d * y;
    return this;
  }

  scale(sx: number, sy: number): this {
    this.a *= sx;
    this.b *= sx;
    this.c *= sy;
    this.d *= sy;
    return this;
  }

  rotate(rad: number): this {
    if (rad === 0) return this;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const { a, b, c, d } = this;
    this.a = a * cos + c * sin;
    this.b = b * cos + d * sin;
    this.c = c * cos - a * sin;
    this.d = d * cos - b * sin;
    return this;
  }

  invert(): this {
    const { a, b, c, d, e, f } = this;
    const det = a * d - b * c;
    if (det === 0) return this.identity();
    const id = 1 / det;
    this.a = d * id;
    this.b = -b * id;
    this.c = -c * id;
    this.d = a * id;
    this.e = (c * f - d * e) * id;
    this.f = (b * e - a * f) * id;
    return this;
  }

  apply(x: number, y: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = this.a * x + this.c * y + this.e;
    out.y = this.b * x + this.d * y + this.f;
    return out;
  }

  /** Axis-aligned bounds of a local rect after transformation. */
  applyRect(r: Rect): Rect {
    const p = { x: 0, y: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const xs = [r.x, r.x + r.w];
    const ys = [r.y, r.y + r.h];
    for (const x of xs) {
      for (const y of ys) {
        this.apply(x, y, p);
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
}
