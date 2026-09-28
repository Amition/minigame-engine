import { ballisticPosition, Node, Scene, Text, type Ctx2D, type NodeOptions } from '@engine';
import { drawApple, drawArrow, drawBackdrop, drawExplosion, drawFighter, drawLightning, drawPlatform } from '../art/index';
import { COLORS } from '../config';
import { ARROW_GRAVITY } from '../model';
import type { AppleView, ArrowView, FighterView, PlatformView, Vec } from '../types';

/** Full-view background: the art's dark void with drifting dust. */
export class Backdrop extends Node {
  time = 0;

  override get kind(): string {
    return 'Backdrop';
  }

  override update(dt: number): void {
    this.time += dt;
  }

  override draw(ctx: Ctx2D): void {
    drawBackdrop(ctx, this.width, this.height, this.time, !this.overGameClear());
  }

  /** Nothing but the game's clear colour lies under it (a scene fading in still has the old one below). */
  private overGameClear(): boolean {
    const scene = this.parent;
    if (!(scene instanceof Scene) || scene.children[0] !== this) return false;
    return scene.parent?.children[0] === scene && scene.game.background === COLORS.bg;
  }
}

/** One stick-man archer (world units, inside #field). */
export class FighterNode extends Node {
  constructor(
    readonly view: FighterView,
    opts?: NodeOptions,
  ) {
    super(opts);
  }

  override get kind(): string {
    return 'Fighter';
  }

  override draw(ctx: Ctx2D): void {
    drawFighter(ctx, this.view);
  }

  override describe() {
    const f = this.view;
    return {
      ...super.describe(),
      side: f.side,
      hp: Math.ceil(f.hp),
      alive: f.alive,
      boss: f.boss || undefined,
      stuck: f.stuck.length || undefined,
      balloons: f.balloons || undefined,
    };
  }
}

/**
 * Tower or floating block with the arrows stuck in it. Its box is the platform's rectangle (centre anchor, rotated)
 * and follows it every frame, so HUD can track it with followNode / pinToNode.
 */
export class PlatformNode extends Node {
  constructor(
    readonly view: PlatformView,
    opts?: NodeOptions,
  ) {
    super();
    this.anchorX = this.anchorY = 0.5;
    this.fit();
    if (opts) this.set(opts);
  }

  override get kind(): string {
    return 'Platform';
  }

  override update(): void {
    this.fit();
  }

  private fit(): void {
    const p = this.view;
    this.x = p.x;
    this.y = p.y;
    this.width = p.w;
    this.height = p.h;
    this.rotation = p.angle;
  }

  override draw(ctx: Ctx2D): void {
    // drawPlatform paints in field units: undo this node's own transform
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.rotate(-this.rotation);
    ctx.translate(-this.x, -this.y);
    drawPlatform(ctx, this.view);
    ctx.restore();
  }

  override describe() {
    return { ...super.describe(), platform: this.view.kind, stuck: this.view.stuck.length || undefined };
  }
}

/** Every arrow in flight, with a faint streak behind it. */
export class ArrowLayer extends Node {
  constructor(
    private readonly source: () => readonly ArrowView[],
    opts?: NodeOptions,
  ) {
    super(opts);
  }

  override get kind(): string {
    return 'Arrows';
  }

  override draw(ctx: Ctx2D): void {
    const arrows = this.source();
    if (arrows.length === 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    for (const a of arrows) {
      if (a.type === 'axe') continue;
      const len = Math.min(170, 60 + a.age * 400);
      const tx = a.x - Math.cos(a.angle) * len;
      const ty = a.y - Math.sin(a.angle) * len;
      const g = ctx.createLinearGradient(tx, ty, a.x, a.y);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, a.type === 'missile' ? 'rgba(255,170,80,0.55)' : 'rgba(255,255,255,0.28)');
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();
    }
    ctx.restore();
    for (const a of arrows) drawArrow(ctx, a.type, a.x, a.y, a.angle);
  }

  override describe() {
    return { ...super.describe(), count: this.source().length };
  }
}

/** Apples flying across the sky. */
export class AppleLayer extends Node {
  constructor(
    private readonly source: () => readonly AppleView[],
    opts?: NodeOptions,
  ) {
    super(opts);
  }

  override get kind(): string {
    return 'Apples';
  }

  override draw(ctx: Ctx2D): void {
    for (const a of this.source()) drawApple(ctx, a.kind, a.x, a.y, a.r, a.angle);
  }

  override describe() {
    return { ...super.describe(), count: this.source().length };
  }
}

/** Explosion flash (world units): tween `progress` 0 -> 1. */
export class ExplosionNode extends Node {
  progress = 0;

  constructor(
    readonly radius: number,
    opts?: NodeOptions,
  ) {
    super(opts);
  }

  override get kind(): string {
    return 'Explosion';
  }

  override draw(ctx: Ctx2D): void {
    drawExplosion(ctx, 0, 0, this.radius, this.progress);
  }
}

/** Short-lived electric arcs around a point (electric hits). */
export class LightningNode extends Node {
  life = 0.35;
  private age = 0;
  private seed = 1;

  constructor(
    readonly radius: number,
    opts?: NodeOptions,
  ) {
    super(opts);
  }

  override get kind(): string {
    return 'Lightning';
  }

  override update(dt: number): void {
    this.age += dt;
    this.seed++;
    if (this.age >= this.life) this.destroy();
  }

  override draw(ctx: Ctx2D): void {
    ctx.globalAlpha *= Math.max(0, 1 - this.age / this.life);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + this.seed * 0.7;
      drawLightning(ctx, 0, 0, Math.cos(a) * this.radius, Math.sin(a) * this.radius, this.seed * 13 + i);
    }
  }
}

/** Dotted preview of the first moments of the arrow's flight from the bow (world units). */
const dot: Vec = { x: 0, y: 0 };

export class TrajectoryPreview extends Node {
  origin: Vec = { x: 0, y: 0 };
  angle = 0;
  speed = 0;
  /** Seconds of flight shown. */
  span = 0.3;
  strength = 1;

  override get kind(): string {
    return 'Trajectory';
  }

  override draw(ctx: Ctx2D): void {
    if (this.speed <= 0) return;
    const vx = Math.cos(this.angle) * this.speed;
    const vy = Math.sin(this.angle) * this.speed;
    const n = 9;
    ctx.fillStyle = '#ffffff';
    for (let i = 1; i <= n; i++) {
      const p = ballisticPosition(this.origin.x, this.origin.y, vx, vy, ARROW_GRAVITY, (i / n) * this.span, dot);
      ctx.globalAlpha = this.strength * (1 - i / (n + 2)) * 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5 - i * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Screen-space slingshot indicator like the original: a thick grey rounded rod from the press point to the finger, a
 * white dot where the touch started and a dotted line from it in the shooting direction.
 */
export class AimIndicator extends Node {
  active = false;
  start: Vec = { x: 0, y: 0 };
  finger: Vec = { x: 0, y: 0 };
  /** 0..1 current draw (dots get longer / brighter). */
  power = 0;

  override get kind(): string {
    return 'AimIndicator';
  }

  override draw(ctx: Ctx2D): void {
    if (!this.active) return;
    const s = this.start;
    const f = this.finger;
    const dx = f.x - s.x;
    const dy = f.y - s.y;
    const d = Math.hypot(dx, dy);
    ctx.save();
    ctx.lineCap = 'round';
    if (d > 4) {
      ctx.strokeStyle = 'rgba(40,40,44,0.55)';
      ctx.lineWidth = 46;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(f.x, f.y);
      ctx.stroke();
      ctx.strokeStyle = COLORS.stoneLight;
      ctx.lineWidth = 38;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 3;
      for (const k of [0.3, 0.42]) {
        const px = s.x + dx * k;
        const py = s.y + dy * k;
        const nx = (-dy / d) * 14;
        const ny = (dx / d) * 14;
        ctx.beginPath();
        ctx.moveTo(px - nx, py - ny);
        ctx.lineTo(px + nx, py + ny);
        ctx.stroke();
      }
      const ux = -dx / d;
      const uy = -dy / d;
      const count = 4 + Math.round(this.power * 8);
      ctx.fillStyle = '#ffffff';
      for (let i = 1; i <= count; i++) {
        ctx.globalAlpha = 0.95 - (i / (count + 1)) * 0.6;
        ctx.beginPath();
        ctx.arc(s.x + ux * (26 + i * 18), s.y + uy * (26 + i * 18), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Small HUD bar (hp / stamina) with its number; `low` makes it blink. */
export class StatBar extends Node {
  value = 1;
  max = 1;
  low = false;
  flashTime = 0;
  private shown = 1;
  private clock = 0;
  readonly label: Text;

  constructor(
    readonly color: string,
    opts?: NodeOptions,
  ) {
    super(opts);
    this.label = this.add(
      new Text('', { fontSize: 20, fontWeight: 'bold', color: '#ffffff', stroke: { color: 'rgba(0,0,0,0.55)', width: 3 }, align: 'center' }),
    );
    this.label.anchorX = this.label.anchorY = 0.5;
  }

  override get kind(): string {
    return 'StatBar';
  }

  setValue(value: number, max: number): void {
    this.value = value;
    this.max = max;
    const t = String(Math.max(0, Math.ceil(value)));
    if (this.label.text !== t) this.label.text = t;
  }

  override update(dt: number): void {
    this.clock += dt;
    this.flashTime = Math.max(0, this.flashTime - dt);
    const target = this.max > 0 ? Math.max(0, Math.min(1, this.value / this.max)) : 0;
    this.shown += (target - this.shown) * Math.min(1, dt * 12);
    this.label.x = this.width / 2;
    this.label.y = this.height / 2;
  }

  override draw(ctx: Ctx2D): void {
    const w = this.width;
    const h = this.height;
    ctx.fillStyle = COLORS.barTrack;
    ctx.fillRect(0, 0, w, h);
    const blink = this.low ? 0.55 + 0.45 * Math.sin(this.clock * 12) : 1;
    ctx.globalAlpha *= blink;
    ctx.fillStyle = this.flashTime > 0 ? '#ffffff' : this.color;
    ctx.fillRect(0, 0, w * this.shown, h);
    ctx.globalAlpha /= blink;
    if (this.low || this.flashTime > 0) {
      ctx.strokeStyle = this.flashTime > 0 ? '#ff5a5a' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
    }
  }

  override describe() {
    return { ...super.describe(), value: Math.ceil(this.value), max: Math.round(this.max), low: this.low || undefined };
  }
}
