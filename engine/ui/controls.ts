import { clamp, damp } from '../core/math';
import { roundRectPath } from '../gfx/draw';
import type { Ctx2D } from '../gfx/types';
import type { PointerEvt } from '../scene/node';
import { animateUI } from './anim';
import { UI_MIN_TAP } from './button';
import { uiEvents } from './events';
import { Label } from './label';
import type { Size } from './layout';
import { UIGradientCache, uiShade } from './paint';
import { uiColor, type UIColor } from './theme';
import { UIView, type UINodeProps } from './view';

function autoHit(n: UIView, min = 0): void {
  n.hitPadding = Math.max(min, Math.ceil(Math.max(0, UI_MIN_TAP - Math.min(n.width, n.height)) / 2));
}

function pill(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, Math.min(w, h) / 2);
}

// ---------------------------------------------------------------- ProgressBar

export interface ProgressBarProps extends UINodeProps {
  /** 0..1, or 0..max when max is set. */
  value?: number;
  max?: number;
  color?: UIColor;
  trackColor?: UIColor;
  /** Text inside the bar; true = '75%' (or 'value/max' when max is set). */
  label?: string | boolean;
  /** Bar height (default 32, at least 36 with a label). */
  thickness?: number;
  /** Ease the fill toward new values (default true). */
  animate?: boolean;
}

/** Horizontal progress bar with an optional centered label. */
export class ProgressBar extends UIView {
  color: UIColor;
  trackColor: UIColor;
  max: number;
  animate: boolean;
  readonly label: Label | null;
  private _value: number;
  private shown: number;
  private labelMode: string | boolean;
  private thickness: number;
  private readonly fillGradient = new UIGradientCache();

  constructor(props: ProgressBarProps = {}) {
    const hasLabel = !!props.label;
    const thickness = Math.max(props.thickness ?? 32, hasLabel ? 36 : 0);
    super({ direction: 'stack', align: 'center', ...props }, 'ProgressBar');
    this.thickness = thickness;
    this.color = props.color ?? 'success';
    this.trackColor = props.trackColor ?? 'track';
    this.max = props.max ?? 1;
    this.animate = props.animate ?? true;
    this._value = clamp(props.value ?? 0, 0, this.max);
    this.shown = this._value;
    this.labelMode = props.label ?? false;
    this.label = hasLabel
      ? this.add(
          new Label('', {
            size: Math.max(20, Math.round(thickness * 0.6)),
            weight: 'bold',
            color: '#ffffff',
            stroke: { color: 'rgba(0,0,0,0.55)', width: 5 },
            lineHeight: 1.1,
          }),
        )
      : null;
    this.syncLabel();
  }

  get value(): number {
    return this._value;
  }

  set value(v: number) {
    this._value = clamp(v, 0, this.max);
    if (!this.animate) this.shown = this._value;
    this.syncLabel();
  }

  private syncLabel(): void {
    if (!this.label) return;
    const m = this.labelMode;
    this.label.text =
      typeof m === 'string' ? m : this.max === 1 ? `${Math.round(this._value * 100)}%` : `${Math.round(this._value)}/${this.max}`;
  }

  override measureContent(_w: number, _h: number): Size {
    const lw = this.label ? this.label.measureNatural().width + 32 : 0;
    return { w: Math.max(240, lw), h: this.thickness };
  }

  override minContentWidth(): number {
    return this.label ? this.label.minContentWidth() + 32 : 60;
  }

  override update(dt: number): void {
    if (this.shown !== this._value) {
      this.shown += (this._value - this.shown) * damp(10, dt);
      if (Math.abs(this.shown - this._value) < this.max * 0.001) this.shown = this._value;
    }
  }

  override uiBackground() {
    return { color: uiColor(this.trackColor), approx: true };
  }

  override draw(ctx: Ctx2D): void {
    const w = this.width;
    const h = this.height;
    if (w <= 0 || h <= 0) return;
    pill(ctx, 0, 0, w, h);
    ctx.fillStyle = uiColor(this.trackColor);
    ctx.fill();
    const k = this.max > 0 ? clamp(this.shown / this.max, 0, 1) : 0;
    if (k > 0) {
      const pad = Math.max(3, Math.round(h * 0.12));
      const ih = h - pad * 2;
      const fw = Math.max(ih, (w - pad * 2) * k);
      const base = uiColor(this.color);
      pill(ctx, pad, pad, fw, ih);
      ctx.fillStyle = this.fillGradient.get2(ctx, 0, pad, 0, pad + ih, uiShade(base, 0.12), uiShade(base, -0.04));
      ctx.fill();
      pill(ctx, pad + ih * 0.25, pad + ih * 0.14, Math.max(0, fw - ih * 0.5), ih * 0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fill();
    }
  }

  override describe() {
    return { ...super.describe(), value: +this._value.toFixed(3), max: this.max !== 1 ? this.max : undefined, text: this.label?.text };
  }
}

// ---------------------------------------------------------------- Slider

export interface SliderProps extends UINodeProps {
  value?: number;
  min?: number;
  max?: number;
  /** Snap step (0 = continuous). */
  step?: number;
  color?: UIColor;
  disabled?: boolean;
  onChange?: (value: number) => void;
}

/** Horizontal slider; drag or tap anywhere on the track. Captures the drag (parent ScrollViews don't scroll). */
export class Slider extends UIView {
  min: number;
  max: number;
  step: number;
  color: UIColor;
  disabled: boolean;
  onChange: ((v: number) => void) | null;
  private _value: number;
  private dragging: number | null = null;

  constructor(props: SliderProps = {}) {
    super(props, 'Slider');
    this.min = props.min ?? 0;
    this.max = props.max ?? 1;
    this.step = props.step ?? 0;
    this.color = props.color ?? 'primary';
    this.disabled = !!props.disabled;
    this.onChange = props.onChange ?? null;
    this._value = this.snap(props.value ?? this.min);
    this.interactive = true;
    this.on('pointerdown', (e: PointerEvt) => {
      if (this.disabled) return;
      this.dragging = e.pointerId;
      this.setFromPointer(e);
    });
    this.on('pointermove', (e: PointerEvt) => {
      if (this.dragging !== e.pointerId) return;
      e.stopPropagation();
      this.setFromPointer(e);
    });
    const end = (e: PointerEvt) => {
      if (this.dragging === e.pointerId) this.dragging = null;
    };
    this.on('pointerup', end);
    this.on('pointercancel', end);
  }

  get value(): number {
    return this._value;
  }

  set value(v: number) {
    this._value = this.snap(v);
  }

  private snap(v: number): number {
    let x = clamp(v, Math.min(this.min, this.max), Math.max(this.min, this.max));
    if (this.step > 0) x = this.min + Math.round((x - this.min) / this.step) * this.step;
    return +x.toFixed(6);
  }

  private get thumbR(): number {
    return Math.min(26, this.height / 2);
  }

  private setFromPointer(e: PointerEvt): void {
    const p = this.toLocal(e.x, e.y);
    const r = this.thumbR;
    const k = clamp((p.x - r) / Math.max(1, this.width - 2 * r), 0, 1);
    const v = this.snap(this.min + (this.max - this.min) * k);
    if (v !== this._value) {
      this._value = v;
      this.onChange?.(v);
      uiEvents.emit('change', { node: this, value: v });
    }
  }

  override measureContent(): Size {
    return { w: 360, h: 64 };
  }

  override minContentWidth(): number {
    return 120;
  }

  override onLayout(): void {
    autoHit(this);
  }

  override draw(ctx: Ctx2D): void {
    const w = this.width;
    const h = this.height;
    if (w <= 0 || h <= 0) return;
    const r = this.thumbR;
    const th = 14;
    const cy = h / 2;
    const k = this.max === this.min ? 0 : (this._value - this.min) / (this.max - this.min);
    const tx = r + (w - 2 * r) * k;
    const base = this.disabled ? uiColor('border') : uiColor(this.color);
    pill(ctx, 0, cy - th / 2, w, th);
    ctx.fillStyle = uiColor('track');
    ctx.fill();
    if (tx > 0) {
      pill(ctx, 0, cy - th / 2, Math.max(th, tx), th);
      ctx.fillStyle = base;
      ctx.fill();
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.arc(tx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(tx, cy, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = base;
    ctx.fill();
  }

  override describe() {
    return { ...super.describe(), value: this._value, min: this.min, max: this.max, disabled: this.disabled || undefined };
  }
}

// ---------------------------------------------------------------- Toggle

export interface ToggleProps extends UINodeProps {
  value?: boolean;
  color?: UIColor;
  disabled?: boolean;
  onChange?: (on: boolean) => void;
}

/** On/off switch (tap to flip, knob slides). */
export class Toggle extends UIView {
  color: UIColor;
  disabled: boolean;
  onChange: ((v: boolean) => void) | null;
  /** Animated knob position 0..1. */
  knob: number;
  private _value: boolean;

  constructor(props: ToggleProps = {}) {
    super(props, 'Toggle');
    this.color = props.color ?? 'success';
    this.disabled = !!props.disabled;
    this.onChange = props.onChange ?? null;
    this._value = !!props.value;
    this.knob = this._value ? 1 : 0;
    this.interactive = true;
    this.on('tap', () => {
      if (this.disabled) return;
      this.value = !this._value;
      this.onChange?.(this._value);
      uiEvents.emit('change', { node: this, value: this._value });
      uiEvents.emit('tap', this);
    });
  }

  get value(): boolean {
    return this._value;
  }

  set value(v: boolean) {
    if (v === this._value) return;
    this._value = v;
    animateUI(this, { knob: v ? 1 : 0 }, { duration: 0.18, ease: 'outBack' });
  }

  override measureContent(): Size {
    return { w: 104, h: 60 };
  }

  override minContentWidth(): number {
    return 104;
  }

  override onLayout(): void {
    autoHit(this);
  }

  override draw(ctx: Ctx2D): void {
    const w = this.width;
    const h = this.height;
    if (w <= 0 || h <= 0) return;
    const on = uiColor(this.disabled ? 'border' : this.color);
    const off = uiColor('track');
    const k = clamp(this.knob, 0, 1);
    pill(ctx, 0, 0, w, h);
    ctx.fillStyle = k > 0.5 ? on : off;
    ctx.fill();
    if (k <= 0.5) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = uiColor('border');
      ctx.stroke();
    }
    const pad = 6;
    const r = h / 2 - pad;
    const x = pad + r + (w - 2 * pad - 2 * r) * this.knob;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(x, h / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }

  override describe() {
    return { ...super.describe(), on: this._value, disabled: this.disabled || undefined };
  }
}

// ---------------------------------------------------------------- Checkbox

export interface CheckboxProps extends UINodeProps {
  checked?: boolean;
  text?: string;
  color?: UIColor;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

const BOX = 48;

/** Checkbox with an optional label; the whole row is tappable. */
export class Checkbox extends UIView {
  color: UIColor;
  disabled: boolean;
  onChange: ((v: boolean) => void) | null;
  readonly label: Label | null;
  private _checked: boolean;

  constructor(props: CheckboxProps = {}) {
    super({ direction: 'row', align: 'center', minHeight: 64, minWidth: BOX, padding: [0, 0, 0, props.text ? BOX + 20 : BOX], ...props }, 'Checkbox');
    this.color = props.color ?? 'primary';
    this.disabled = !!props.disabled;
    this.onChange = props.onChange ?? null;
    this._checked = !!props.checked;
    this.label = props.text ? this.add(new Label(props.text, { variant: 'body' })) : null;
    this.interactive = true;
    this.on('tap', () => {
      if (this.disabled) return;
      this._checked = !this._checked;
      this.onChange?.(this._checked);
      uiEvents.emit('change', { node: this, value: this._checked });
      uiEvents.emit('tap', this);
    });
  }

  get checked(): boolean {
    return this._checked;
  }

  set checked(v: boolean) {
    this._checked = v;
  }

  override onLayout(): void {
    autoHit(this);
  }

  override draw(ctx: Ctx2D): void {
    const y = (this.height - BOX) / 2;
    ctx.beginPath();
    roundRectPath(ctx, 0, y, BOX, BOX, 12);
    if (this._checked) {
      ctx.fillStyle = uiColor(this.disabled ? 'border' : this.color);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(11, y + 25);
      ctx.lineTo(21, y + 35);
      ctx.lineTo(38, y + 14);
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
    } else {
      ctx.fillStyle = uiColor('track');
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = uiColor('border');
      ctx.stroke();
    }
  }

  override describe() {
    return { ...super.describe(), checked: this._checked, text: this.label?.text, disabled: this.disabled || undefined };
  }
}

// ---------------------------------------------------------------- SegmentedControl

/** One option of a SegmentedControl (tap target). */
export class Segment extends UIView {
  readonly label: Label;
  selected = false;

  constructor(text: string, readonly index: number) {
    super({ direction: 'row', align: 'center', justify: 'center', grow: 1, basis: 0, minHeight: 64, padding: [0, 12] }, 'Segment');
    this.label = this.add(new Label(text, { size: 28, weight: 'bold', color: 'textDim', align: 'center', autoFit: 20 }));
    this.interactive = true;
  }

  setSelected(v: boolean, on: UIColor): void {
    this.selected = v;
    this.label.restyle({ color: v ? on : 'textDim' });
  }

  override onLayout(): void {
    autoHit(this);
  }

  override describe() {
    return { ...super.describe(), text: this.label.text, selected: this.selected || undefined };
  }
}

export interface SegmentedControlProps extends UINodeProps {
  options: string[];
  selected?: number;
  /** Highlight color (default 'primary'). */
  color?: UIColor;
  onChange?: (index: number, option: string) => void;
}

const ON_TOKEN: Record<string, UIColor> = {
  primary: 'onPrimary',
  secondary: 'onSecondary',
  success: 'onSuccess',
  danger: 'onDanger',
  warning: 'onWarning',
};

/** Pill with mutually exclusive options and a sliding highlight. */
export class SegmentedControl extends UIView {
  readonly segments: Segment[] = [];
  color: UIColor;
  onChange: ((i: number, o: string) => void) | null;
  /** Animated highlight position (segment index, fractional while sliding). */
  slide: number;
  private _selected: number;

  constructor(props: SegmentedControlProps) {
    super({ direction: 'row', align: 'stretch', padding: 6, radius: 'full', fill: 'track', ...props }, 'SegmentedControl');
    this.color = props.color ?? 'primary';
    this.onChange = props.onChange ?? null;
    this._selected = clamp(props.selected ?? 0, 0, Math.max(0, props.options.length - 1));
    this.slide = this._selected;
    props.options.forEach((o, i) => {
      const s = this.add(new Segment(o, i));
      s.on('tap', () => this.select(i, true));
      this.segments.push(s);
    });
    this.syncSegments();
  }

  get selected(): number {
    return this._selected;
  }

  get selectedOption(): string {
    return this.segments[this._selected]?.label.text ?? '';
  }

  /** Selects an option (notify = call onChange / emit uiEvents). */
  select(i: number, notify = false): void {
    if (i < 0 || i >= this.segments.length || i === this._selected) return;
    this._selected = i;
    animateUI(this, { slide: i }, { duration: 0.2, ease: 'outCubic' });
    this.syncSegments();
    if (notify) {
      this.onChange?.(i, this.selectedOption);
      uiEvents.emit('change', { node: this, value: i });
      uiEvents.emit('tap', this);
    }
  }

  private syncSegments(): void {
    const on = typeof this.color === 'string' && ON_TOKEN[this.color] ? ON_TOKEN[this.color]! : '#ffffff';
    this.segments.forEach((s, i) => s.setSelected(i === this._selected, on));
  }

  /** Lint helper: the highlight color under the selected segment, else the track. */
  uiBackgroundAt(x: number, y: number): { color: string; approx: boolean } | null {
    const s = this.segments[this._selected];
    if (s) {
      const b = s.worldBounds();
      if (x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h) return { color: uiColor(this.color), approx: false };
    }
    return this.uiBackground();
  }

  override draw(ctx: Ctx2D): void {
    super.draw(ctx);
    const n = this.segments.length;
    if (n === 0) return;
    const a = this.segments[Math.floor(clamp(this.slide, 0, n - 1))]!;
    const b = this.segments[Math.ceil(clamp(this.slide, 0, n - 1))]!;
    const t = this.slide - Math.floor(this.slide);
    const x = a.x + (b.x - a.x) * t - a.anchorX * a.width;
    const w = a.width + (b.width - a.width) * t;
    const y = a.y - a.anchorY * a.height;
    const base = uiColor(this.color);
    pill(ctx, x, y + 3, w, a.height);
    ctx.fillStyle = uiShade(base, -0.18);
    ctx.fill();
    pill(ctx, x, y, w, a.height - 1);
    ctx.fillStyle = base;
    ctx.fill();
  }

  override describe() {
    return { ...super.describe(), selected: this.selectedOption, index: this._selected };
  }
}
