import { darken, lighten, luminance, mix } from '../core/color';
import { Game } from '../core/game';
import { roundRectPath } from '../gfx/draw';
import type { Ctx2D } from '../gfx/types';
import type { PointerEvt } from '../scene/node';
import { animateUI } from './anim';
import { Badge } from './decor';
import { uiEvents } from './events';
import { uiIconName, UIIcon, type UIIconSource } from './icon';
import { Label } from './label';
import type { UISpacing } from './layout';
import { uiColor, uiRadius, type UIColor, type UIColorToken, type UIRadius } from './theme';
import { UIView, type UINodeProps } from './view';

/** Minimum tap target (design units) enforced by widgets via hitPadding and checked by lintUI. */
export const UI_MIN_TAP = 88;

export type UIButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'neutral' | 'ghost' | 'plain';
export type UIButtonSize = 'sm' | 'md' | 'lg' | 'xl';

interface SizeSpec {
  h: number;
  font: number;
  padX: number;
  edge: number;
  minW: number;
  icon: number;
  radius: number;
  gap: number;
}

const SIZES: Record<UIButtonSize, SizeSpec> = {
  sm: { h: 64, font: 26, padX: 24, edge: 6, minW: 112, icon: 30, radius: 22, gap: 8 },
  md: { h: 88, font: 32, padX: 36, edge: 8, minW: 180, icon: 38, radius: 30, gap: 10 },
  lg: { h: 108, font: 38, padX: 48, edge: 10, minW: 280, icon: 46, radius: 36, gap: 12 },
  xl: { h: 128, font: 46, padX: 60, edge: 12, minW: 380, icon: 56, radius: 44, gap: 14 },
};

const FACE: Record<UIButtonVariant, UIColorToken | null> = {
  primary: 'primary',
  secondary: 'secondary',
  success: 'success',
  danger: 'danger',
  warning: 'warning',
  neutral: 'surfaceAlt',
  ghost: null,
  plain: null,
};

const ON: Record<UIButtonVariant, UIColorToken> = {
  primary: 'onPrimary',
  secondary: 'onSecondary',
  success: 'onSuccess',
  danger: 'onDanger',
  warning: 'onWarning',
  neutral: 'text',
  ghost: 'text',
  plain: 'text',
};

/** Current tap slop (design units) of the running game. */
export function uiTapSlop(): number {
  return Game.current?.config.tapSlop ?? 24;
}

export interface ButtonProps extends UINodeProps {
  text?: string;
  icon?: UIIconSource;
  iconSize?: number;
  iconRight?: boolean;
  /** Default 'primary'. */
  variant?: UIButtonVariant;
  /** Default 'md' (88 tall). */
  size?: UIButtonSize;
  disabled?: boolean;
  /** Corner badge: a count, or true/'dot' for a dot. */
  badge?: number | boolean | 'dot';
  /** Face color override (token or raw). */
  color?: UIColor;
  textColor?: UIColor;
  radius?: UIRadius;
  gap?: number;
  padding?: UISpacing;
}

/**
 * Casual-game button: 3D face with a darker bottom edge, press feedback (scale + sink), variants and sizes,
 * optional icon and badge. Taps are ignored while disabled. hitPadding grows automatically to reach 88x88.
 */
export class Button extends UIView {
  variant: UIButtonVariant;
  readonly buttonSize: UIButtonSize;
  color: UIColor | null;
  textColor: UIColor | null;
  label: Label | null = null;
  readonly icon: UIIcon | null;
  badge: Badge | null = null;
  pressed = false;
  /** Animated sink of the face while pressed (design units). */
  pressDepth = 0;
  protected readonly spec: SizeSpec;
  protected minHit: number;
  private _disabled: boolean;
  private baseScale = 1;

  constructor(props: ButtonProps = {}, kind = 'Button') {
    const sz = SIZES[props.size ?? 'md'];
    const hasText = props.text !== undefined && props.text !== '';
    super(
      {
        direction: 'row',
        align: 'center',
        justify: 'center',
        gap: sz.gap,
        padding: [6, sz.padX, 6 + sz.edge, sz.padX],
        minHeight: sz.h,
        ...(hasText ? { minWidth: sz.minW } : {}),
        anchor: 0.5,
        radius: sz.radius,
        ...props,
      },
      kind,
    );
    this.spec = sz;
    this.variant = props.variant ?? 'primary';
    this.buttonSize = props.size ?? 'md';
    this.color = props.color ?? null;
    this.textColor = props.textColor ?? null;
    this.minHit = props.hitPadding ?? 0;
    this._disabled = !!props.disabled;
    this.icon = props.icon
      ? new UIIcon({ src: props.icon, size: props.iconSize ?? sz.icon, color: this.labelColor(), shrink: 0 })
      : null;
    if (this.icon && !props.iconRight) this.add(this.icon);
    if (hasText) this.ensureLabel(props.text!);
    if (this.icon && props.iconRight) this.add(this.icon);
    if (props.badge !== undefined && props.badge !== false) this.setBadge(props.badge);
    this.interactive = true;
    this.on('pointerdown', () => {
      if (!this._disabled) this.setPressed(true);
    });
    this.on('pointerup', () => this.setPressed(false));
    this.on('pointercancel', () => this.setPressed(false));
    this.on('pointermove', (e: PointerEvt) => {
      if (this.pressed && Math.hypot(e.x - e.startX, e.y - e.startY) > uiTapSlop()) this.setPressed(false);
    });
    this.on('tap', () => {
      if (!this._disabled) uiEvents.emit('tap', this);
    });
  }

  /** Registers a tap handler that is skipped while the button is disabled. */
  override onTap(fn: (e: PointerEvt) => void): () => void {
    this.interactive = true;
    return this.on('tap', (e: PointerEvt) => {
      if (!this._disabled) fn(e);
    });
  }

  get text(): string {
    return this.label?.text ?? '';
  }

  set text(v: string) {
    if (this.label) this.label.text = v;
    else if (v) this.ensureLabel(v);
  }

  get disabled(): boolean {
    return this._disabled;
  }

  set disabled(v: boolean) {
    if (v === this._disabled) return;
    this._disabled = v;
    if (v) this.setPressed(false);
    this.syncColors();
  }

  setVariant(v: UIButtonVariant): this {
    this.variant = v;
    this.syncColors();
    return this;
  }

  /** Sets (count / true / 'dot') or removes (false / 0) the corner badge. */
  setBadge(b: number | boolean | 'dot'): this {
    const dot = b === true || b === 'dot';
    const count = typeof b === 'number' ? b : 0;
    if (this.badge && this.badge.dot !== dot) {
      this.badge.destroy();
      this.badge = null;
    }
    if (b === false || (!dot && count <= 0)) {
      if (this.badge) this.badge.count = 0;
      if (this.badge && this.badge.dot) this.badge.visible = false;
      return this;
    }
    if (!this.badge) {
      const off = this.radius === 'full' ? -4 : -12;
      this.badge = this.add(new Badge({ dot, count, position: 'absolute', top: off, right: off }));
    } else {
      this.badge.visible = true;
      this.badge.count = count;
    }
    return this;
  }

  private ensureLabel(text: string): void {
    const f = this.spec.font;
    const onLight = luminance(uiColor(this.labelColor())) > 0.5;
    this.label = new Label(text, {
      variant: 'button',
      size: f,
      color: this.labelColor(),
      align: 'center',
      autoFit: Math.max(20, Math.round(f * 0.72)),
      shadow: FACE[this.variant] ? { color: onLight ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.35)', blur: 0, y: 2 } : null,
    });
    const idx = this.icon && this.icon.parent === this ? this.children.indexOf(this.icon) + 1 : 0;
    this.addAt(this.label, idx);
  }

  protected labelColor(): UIColor {
    if (this._disabled) return 'textDim';
    return this.textColor ?? ON[this.variant];
  }

  protected syncColors(): void {
    const c = this.labelColor();
    this.label?.restyle({ color: c });
    if (this.icon) this.icon.color = c;
  }

  /** Face color, or null for ghost/plain. */
  faceColor(): string | null {
    const token = this.color ?? FACE[this.variant];
    if (!token) return null;
    const base = uiColor(token);
    return this._disabled ? mix(base, uiColor('surfaceAlt'), 0.7) : base;
  }

  setPressed(p: boolean): void {
    if (this.pressed === p) return;
    this.pressed = p;
    if (p) {
      this.baseScale = this.scaleX;
      animateUI(this, { scale: this.baseScale * 0.95, pressDepth: this.spec.edge * 0.6 }, { duration: 0.06 });
    } else {
      animateUI(this, { scale: this.baseScale, pressDepth: 0 }, { duration: 0.2, ease: 'outBack' });
    }
  }

  override onLayout(): void {
    const need = Math.ceil(Math.max(0, UI_MIN_TAP - Math.min(this.width, this.height)) / 2);
    this.hitPadding = Math.max(this.minHit, need);
  }

  override uiBackground() {
    const f = this.faceColor();
    return f ? { color: f, approx: false } : null;
  }

  override draw(ctx: Ctx2D): void {
    const w = this.width;
    const h = this.height;
    if (w <= 0 || h <= 0) return;
    const base = this.faceColor();
    const r = uiRadius(this.radius, w, h);
    const d = this.pressDepth;
    if (base) {
      const e = this.spec.edge;
      const fh = h - e;
      ctx.beginPath();
      roundRectPath(ctx, 0, e, w, fh, r);
      ctx.fillStyle = darken(base, 0.18);
      ctx.fill();
      ctx.beginPath();
      roundRectPath(ctx, 0, d, w, fh, r);
      const g = ctx.createLinearGradient(0, d, 0, d + fh);
      g.addColorStop(0, lighten(base, 0.09));
      g.addColorStop(1, base);
      ctx.fillStyle = g;
      ctx.fill();
      const inset = Math.min(8, fh * 0.1);
      const rr = typeof r === 'number' ? Math.max(0, r - inset) : r;
      ctx.beginPath();
      roundRectPath(ctx, inset, d + inset * 0.7, w - inset * 2, fh * 0.42, rr);
      ctx.fillStyle = 'rgba(255,255,255,0.17)';
      ctx.fill();
    } else if (this.variant === 'ghost') {
      ctx.beginPath();
      roundRectPath(ctx, 1.5, d + 1.5, w - 3, h - 3, r);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = uiColor('border');
      ctx.stroke();
    }
  }

  protected override renderChildren(ctx: Ctx2D): void {
    if (this.pressDepth === 0) {
      super.renderChildren(ctx);
      return;
    }
    ctx.save();
    ctx.translate(0, this.pressDepth);
    super.renderChildren(ctx);
    ctx.restore();
  }

  override describe() {
    return {
      ...super.describe(),
      text: this.label?.text || undefined,
      variant: this.variant,
      size: this.buttonSize,
      disabled: this._disabled || undefined,
      pressed: this.pressed || undefined,
    };
  }
}

export interface IconButtonProps extends Omit<ButtonProps, 'text' | 'iconRight' | 'size' | 'icon'> {
  icon: UIIconSource;
  /** Accessible name, shown in dumps and selectors: `IconButton[label=设置]`. */
  label?: string;
  /** 'sm' 72, 'md' 88 (default), 'lg' 104, or design units. */
  size?: 'sm' | 'md' | 'lg' | number;
  /** Default 'circle'. */
  shape?: 'circle' | 'rounded';
}

/** Round (or rounded-square) icon-only button. Default variant 'neutral'. */
export class IconButton extends Button {
  readonly labelText: string;

  constructor(props: IconButtonProps) {
    const px = typeof props.size === 'number' ? props.size : { sm: 72, md: 88, lg: 104 }[props.size ?? 'md'];
    const size: UIButtonSize = px <= 76 ? 'sm' : px <= 96 ? 'md' : 'lg';
    const variant = props.variant ?? 'neutral';
    const edge = FACE[variant] ? SIZES[size].edge : 0;
    const { size: _s, label: _l, shape: _sh, ...rest } = props;
    super(
      {
        variant,
        iconSize: Math.round((px - edge) * (FACE[variant] ? 0.52 : 0.62)),
        width: px,
        height: px,
        padding: [0, 0, edge, 0],
        radius: (props.shape ?? 'circle') === 'circle' ? 'full' : Math.round(px * 0.3),
        ...rest,
        size,
      },
      'IconButton',
    );
    this.labelText = props.label ?? '';
  }

  override describe() {
    return { ...super.describe(), label: this.labelText || undefined, icon: uiIconName(this.icon?.src) };
  }
}
