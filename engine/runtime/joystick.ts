import type { Color } from '../core/color';
import type { Vec2 } from '../core/math';
import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions, type PointerEvt } from '../scene/node';

export interface JoystickOptions extends NodeOptions {
  /** 'fixed': base stays at the zone center. 'floating' (default): base appears where the zone is touched. */
  mode?: 'fixed' | 'floating';
  /** Base radius in design units (default 110). */
  radius?: number;
  /** Knob radius (default 0.45 * radius). */
  knobRadius?: number;
  /** Magnitudes below this fraction read as 0 (default 0.12). */
  deadZone?: number;
  baseColor?: Color;
  knobColor?: Color;
  /** Alpha of the stick while untouched (default 0.5; 0 hides it). */
  idleAlpha?: number;
  /** Floating mode: where the idle stick is drawn, local to the zone (default: zone center). */
  rest?: Vec2;
  /** Called whenever the value changes. */
  onChange?: (stick: VirtualJoystick) => void;
}

/**
 * On-screen analog stick for action games. The node's box is the touch zone (fixed mode defaults to 2*radius).
 * Read `value` (-1..1 per axis, dead zone applied), `direction` (unit vector), `magnitude` (0..1) each frame:
 *
 *     const stick = scene.add(new VirtualJoystick({ width: 375, height: 600, y: view.height - 600 }));
 *     hero.onUpdate((dt) => { hero.x += stick.value.x * 400 * dt; hero.y += stick.value.y * 400 * dt; });
 */
export class VirtualJoystick extends Node {
  mode: 'fixed' | 'floating';
  radius: number;
  knobRadius: number;
  deadZone: number;
  baseColor: Color;
  knobColor: Color;
  idleAlpha: number;
  rest: Vec2 | null;
  onChange: ((stick: VirtualJoystick) => void) | null;
  /** Direction * magnitude, each axis in -1..1 (y grows downward). */
  readonly value: Vec2 = { x: 0, y: 0 };
  /** Unit vector of the stick (0,0 when idle or inside the dead zone). */
  readonly direction: Vec2 = { x: 0, y: 0 };
  /** 0..1 after the dead zone. */
  magnitude = 0;
  /** True while a pointer holds the stick. */
  active = false;
  private pid = -1;
  private readonly center: Vec2 = { x: 0, y: 0 };
  private readonly knob: Vec2 = { x: 0, y: 0 };

  constructor(opts: JoystickOptions = {}) {
    super();
    this.mode = opts.mode ?? 'floating';
    this.radius = opts.radius ?? 110;
    this.knobRadius = opts.knobRadius ?? this.radius * 0.45;
    this.deadZone = opts.deadZone ?? 0.12;
    this.baseColor = opts.baseColor ?? 'rgba(255,255,255,0.18)';
    this.knobColor = opts.knobColor ?? 'rgba(255,255,255,0.75)';
    this.idleAlpha = opts.idleAlpha ?? 0.5;
    this.rest = opts.rest ?? null;
    this.onChange = opts.onChange ?? null;
    this.width = this.height = this.radius * 2;
    this.interactive = true;
    this.set(opts);
    this.on('pointerdown', (e) => this.handleDown(e));
    this.on('pointermove', (e) => this.handleMove(e));
    this.on('pointerup', (e) => this.handleUp(e));
    this.on('pointercancel', (e) => this.handleUp(e));
  }

  override get kind(): string {
    return 'VirtualJoystick';
  }

  /** Stick angle in radians (0 = right, PI/2 = down). */
  get angle(): number {
    return Math.atan2(this.direction.y, this.direction.x);
  }

  /** Dominant 4-way direction, or null inside the dead zone. */
  get dir4(): 'left' | 'right' | 'up' | 'down' | null {
    if (this.magnitude <= 0) return null;
    const { x, y } = this.direction;
    return Math.abs(x) >= Math.abs(y) ? (x < 0 ? 'left' : 'right') : y < 0 ? 'up' : 'down';
  }

  /** Releases the stick (e.g. when the game pauses). */
  reset(): void {
    const changed = this.active || this.magnitude !== 0;
    this.pid = -1;
    this.active = false;
    this.knob.x = this.knob.y = 0;
    this.magnitude = 0;
    this.value.x = this.value.y = this.direction.x = this.direction.y = 0;
    if (changed) this.onChange?.(this);
  }

  private handleDown(e: PointerEvt): void {
    if (this.pid >= 0) return;
    e.stopPropagation();
    this.pid = e.pointerId;
    this.active = true;
    const p = this.toLocal(e.x, e.y);
    if (this.mode === 'floating') {
      this.center.x = p.x;
      this.center.y = p.y;
    } else {
      this.center.x = this.width / 2;
      this.center.y = this.height / 2;
    }
    this.moveKnob(p);
  }

  private handleMove(e: PointerEvt): void {
    if (e.pointerId !== this.pid) return;
    this.moveKnob(this.toLocal(e.x, e.y));
  }

  private handleUp(e: PointerEvt): void {
    if (e.pointerId !== this.pid) return;
    this.reset();
  }

  private moveKnob(p: Vec2): void {
    let dx = p.x - this.center.x;
    let dy = p.y - this.center.y;
    const len = Math.hypot(dx, dy);
    const r = Math.max(1, this.radius);
    if (len > r) {
      dx = (dx / len) * r;
      dy = (dy / len) * r;
    }
    this.knob.x = dx;
    this.knob.y = dy;
    const raw = Math.min(1, len / r);
    const dz = Math.min(0.99, Math.max(0, this.deadZone));
    this.magnitude = raw <= dz ? 0 : (raw - dz) / (1 - dz);
    this.direction.x = this.magnitude > 0 ? dx / Math.hypot(dx, dy) : 0;
    this.direction.y = this.magnitude > 0 ? dy / Math.hypot(dx, dy) : 0;
    this.value.x = this.direction.x * this.magnitude;
    this.value.y = this.direction.y * this.magnitude;
    this.onChange?.(this);
  }

  override draw(ctx: Ctx2D): void {
    if (!this.active && this.idleAlpha <= 0) return;
    const rest = this.mode === 'fixed' ? { x: this.width / 2, y: this.height / 2 } : (this.rest ?? { x: this.width / 2, y: this.height / 2 });
    const cx = this.active ? this.center.x : rest.x;
    const cy = this.active ? this.center.y : rest.y;
    ctx.save();
    if (!this.active) ctx.globalAlpha *= this.idleAlpha;
    ctx.fillStyle = this.baseColor;
    ctx.beginPath();
    ctx.arc(cx, cy, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.knobColor;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = this.knobColor;
    ctx.beginPath();
    ctx.arc(cx + this.knob.x, cy + this.knob.y, this.knobRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  override describe() {
    return {
      ...super.describe(),
      mode: this.mode,
      active: this.active || undefined,
      value: `${+this.value.x.toFixed(2)},${+this.value.y.toFixed(2)}`,
    };
  }
}
