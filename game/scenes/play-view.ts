import { Node, roundRectPath, type Ctx2D, type NodeOptions } from '@engine';

/**
 * Full-scene background: warm gradient sky with soft bokeh, the glass jar, and the wooden floor under it.
 * Sized to the scene; `jar` is the jar interior rect and `floorY` the floor top, in the node's space.
 */
export class Backdrop extends Node {
  jar = { x: 0, y: 0, w: 0, h: 0 };
  showJar = true;

  override get kind(): string {
    return 'Backdrop';
  }

  override draw(ctx: Ctx2D): void {
    const w = this.width;
    const j = this.jar;
    const floorY = j.y + j.h;

    const sky = ctx.createLinearGradient(0, 0, 0, floorY);
    sky.addColorStop(0, '#fff6d8');
    sky.addColorStop(0.55, '#ffe6a3');
    sky.addColorStop(1, '#ffd27a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, floorY);

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (const [bx, by, br] of BOKEH) {
      ctx.beginPath();
      ctx.arc(bx * w, by * floorY, br, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.showJar) this.drawJar(ctx);
    this.drawFloor(ctx, floorY);
  }

  /** Frosted glass with a rim highlight; the physics walls are its inner edges. */
  private drawJar(ctx: Ctx2D): void {
    const j = this.jar;
    const pad = 10;
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, j.x - pad, j.y - 26, j.w + pad * 2, j.h + 26 + pad, [34, 34, 18, 18]);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(j.x + 14, j.y + 20, 10, j.h - 60);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(j.x + 32, j.y + 40, 5, j.h * 0.45);
  }

  private drawFloor(ctx: Ctx2D, floorY: number): void {
    const w = this.width;
    const h = this.height;
    const wood = ctx.createLinearGradient(0, floorY, 0, h);
    wood.addColorStop(0, '#c9834a');
    wood.addColorStop(0.2, '#b06c38');
    wood.addColorStop(1, '#8a4f24');
    ctx.fillStyle = wood;
    ctx.fillRect(0, floorY, w, h - floorY);
    ctx.fillStyle = '#e3a468';
    ctx.fillRect(0, floorY, w, 8);
    ctx.fillStyle = 'rgba(90,45,15,0.35)';
    ctx.fillRect(0, floorY + 8, w, 4);
    ctx.strokeStyle = 'rgba(90,45,15,0.25)';
    ctx.lineWidth = 3;
    for (let x = -40, i = 0; x < w; x += 170, i++) {
      const y0 = floorY + 12;
      ctx.beginPath();
      ctx.moveTo(x + (i % 2) * 85, y0);
      ctx.lineTo(x + (i % 2) * 85, h);
      ctx.stroke();
    }
  }
}

/** [x, y fraction of the area, radius] */
const BOKEH: readonly (readonly [number, number, number])[] = [
  [0.08, 0.12, 60],
  [0.9, 0.08, 90],
  [0.75, 0.35, 40],
  [0.15, 0.5, 70],
  [0.95, 0.62, 55],
  [0.4, 0.22, 26],
  [0.55, 0.78, 80],
  [0.05, 0.85, 45],
];

/** Dashed danger line across the jar. `alert` 0..1 makes it red and thick (blinking is driven by the scene). */
export class DangerLine extends Node {
  alert = 0;

  constructor(width: number, opts?: NodeOptions) {
    super();
    this.setSize(width, 8);
    if (opts) this.set(opts);
  }

  override get kind(): string {
    return 'DangerLine';
  }

  override draw(ctx: Ctx2D): void {
    const a = this.alert;
    ctx.fillStyle = a > 0 ? `rgba(235,52,52,${0.35 + 0.65 * a})` : 'rgba(214,92,60,0.35)';
    const dash = 26;
    const th = 4 + 3 * a;
    for (let x = 0; x < this.width; x += dash * 1.7) {
      ctx.fillRect(x, (this.height - th) / 2, Math.min(dash, this.width - x), th);
    }
  }

  override describe() {
    return { ...super.describe(), alert: this.alert > 0 || undefined };
  }
}

/** Vertical aim guide from the waiting fruit down to the floor. */
export class AimGuide extends Node {
  strength = 0.5;

  override get kind(): string {
    return 'AimGuide';
  }

  override draw(ctx: Ctx2D): void {
    if (this.height <= 0) return;
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.45 * this.strength})`;
    for (let y = 0; y < this.height; y += 34) ctx.fillRect(-3, y, 6, Math.min(20, this.height - y));
  }
}

/** Expanding ring for merge flashes: tween `progress` 0 -> 1. */
export class Ring extends Node {
  progress = 0;

  constructor(
    private readonly r0: number,
    private readonly r1: number,
    private readonly color: string,
    opts?: NodeOptions,
  ) {
    super();
    if (opts) this.set(opts);
  }

  override get kind(): string {
    return 'Ring';
  }

  override draw(ctx: Ctx2D): void {
    const t = this.progress;
    const r = this.r0 + (this.r1 - this.r0) * (1 - (1 - t) * (1 - t));
    ctx.globalAlpha *= 1 - t;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = Math.max(2, 14 * (1 - t));
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}
