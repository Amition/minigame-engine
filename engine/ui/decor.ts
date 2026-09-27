import { clamp } from '../core/math';
import { darken, lighten } from '../core/color';
import type { Ctx2D } from '../gfx/types';
import { starPath } from './icon';
import { Label } from './label';
import type { Size } from './layout';
import { uiColor, type UIColor } from './theme';
import { UIView, type UINodeProps } from './view';

export interface BadgeProps extends UINodeProps {
  /** Number shown (hidden at 0 unless showZero). */
  count?: number;
  /** Small dot without a number. */
  dot?: boolean;
  /** Above this, shows 'max+' (default 99). */
  max?: number;
  color?: UIColor;
  textColor?: UIColor;
  showZero?: boolean;
}

/** Notification badge: red pill with a count, or a dot. Usually placed absolute on a corner (Button `badge` prop). */
export class Badge extends UIView {
  readonly label: Label | null;
  readonly dot: boolean;
  max: number;
  showZero: boolean;
  private _count: number;

  constructor(props: BadgeProps = {}) {
    const dot = !!props.dot;
    super(
      {
        direction: 'row',
        align: 'center',
        justify: 'center',
        padding: dot ? 0 : [0, 10],
        minWidth: dot ? 22 : 40,
        height: dot ? 22 : 40,
        radius: 'full',
        fill: props.color ?? 'danger',
        border: { color: '#ffffff', width: 3 },
        ...props,
      },
      'Badge',
    );
    this.dot = dot;
    this.max = props.max ?? 99;
    this.showZero = !!props.showZero;
    this._count = props.count ?? 0;
    this.label = dot ? null : this.add(new Label('', { size: 22, weight: 'bold', color: props.textColor ?? 'onDanger', lineHeight: 1.1 }));
    this.sync();
  }

  get count(): number {
    return this._count;
  }

  set count(n: number) {
    this._count = n;
    this.sync();
  }

  private sync(): void {
    if (this.label) this.label.text = this._count > this.max ? `${this.max}+` : String(this._count);
    this.visible = this.dot || this._count > 0 || this.showZero;
  }

  override describe() {
    return { ...super.describe(), count: this.dot ? undefined : this._count, dot: this.dot || undefined };
  }
}

export interface StarRatingProps extends UINodeProps {
  /** Filled stars (0..max). */
  value?: number;
  /** Default 3. */
  max?: number;
  /** Star size in design units (default 72). */
  size?: number;
  gap?: number;
  /** Level-result style: middle star bigger and raised. */
  arc?: boolean;
  /** Pop the filled stars in one by one. */
  animate?: boolean;
  color?: UIColor;
}

const popEase = (t: number) => {
  const c = 2.2;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

/** 0-3 stars (level results). */
export class StarRating extends UIView {
  max: number;
  size: number;
  gapPx: number;
  arc: boolean;
  color: UIColor;
  private _value: number;
  private t = 99;

  constructor(props: StarRatingProps = {}) {
    super(props, 'StarRating');
    this.max = props.max ?? 3;
    this.size = props.size ?? 72;
    this.gapPx = props.gap ?? Math.round(this.size * 0.12);
    this.arc = !!props.arc;
    this.color = props.color ?? 'gold';
    this._value = clamp(props.value ?? 0, 0, this.max);
    if (props.animate) this.t = 0;
  }

  get value(): number {
    return this._value;
  }

  set value(v: number) {
    this._value = clamp(v, 0, this.max);
  }

  /** Replays the pop-in animation. */
  play(): void {
    this.t = 0;
  }

  private starSize(i: number): number {
    return this.arc && this.max === 3 && i === 1 ? this.size * 1.3 : this.size;
  }

  override measureContent(): Size {
    let w = 0;
    for (let i = 0; i < this.max; i++) w += this.starSize(i);
    w += this.gapPx * Math.max(0, this.max - 1);
    const big = this.arc && this.max === 3 ? this.size * 1.3 : this.size;
    return { w, h: big + (this.arc ? this.size * 0.12 : 0) };
  }

  override minContentWidth(): number {
    return this.measureContent().w;
  }

  override update(dt: number): void {
    if (this.t < 10) this.t += dt;
  }

  override draw(ctx: Ctx2D): void {
    super.draw(ctx);
    const c = this.measureContent();
    let x = (this.width - c.w) / 2;
    const base = uiColor(this.color);
    for (let i = 0; i < this.max; i++) {
      const s = this.starSize(i);
      const lowered = this.arc && this.max === 3 && i !== 1;
      const cy = (this.height - c.h) / 2 + (lowered ? c.h - s / 2 : s / 2);
      const cx = x + s / 2;
      const r = s / 2;
      this.drawStar(ctx, cx, cy, r, false, base);
      if (i < this._value) {
        const k = popEase(clamp((this.t - i * 0.22) / 0.32, 0, 1));
        if (k > 0.01) this.drawStar(ctx, cx, cy, r * k, true, base);
      }
      x += s + this.gapPx;
    }
  }

  private drawStar(ctx: Ctx2D, cx: number, cy: number, r: number, filled: boolean, base: string): void {
    starPath(ctx, cx, cy + r * 0.06, r, r * 0.5);
    ctx.lineJoin = 'round';
    if (filled) {
      const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
      g.addColorStop(0, lighten(base, 0.18));
      g.addColorStop(1, darken(base, 0.06));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.12);
      ctx.strokeStyle = darken(base, 0.25);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.2, cy - r * 0.22, r * 0.2, r * 0.11, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.1);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.stroke();
    }
  }

  override describe() {
    return { ...super.describe(), value: this._value, max: this.max };
  }
}
