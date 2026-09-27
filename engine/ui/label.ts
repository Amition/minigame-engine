import type { ShadowStyle } from '../scene/box';
import { Text, type TextStyle } from '../scene/text';
import { markUILayoutDirty, uiLayout, type UILayoutStyle } from './layout';
import { uiColor, uiFontFamily, uiTheme, uiThemeVersion, type UIColor, type UITextVariant } from './theme';
import { applyUINodeProps, type UINodeProps } from './view';

export interface LabelProps extends UINodeProps {
  /** Typography token (default 'body'). */
  variant?: UITextVariant;
  color?: UIColor;
  /** Font size override. */
  size?: number;
  weight?: 'normal' | 'bold' | number;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Multiple of the font size. */
  lineHeight?: number;
  /** Max lines (0 = unlimited); overflow ends with '…'. */
  maxLines?: number;
  /** Outline, e.g. `{ color: '#5b2bb5', width: 8 }` (keeps text readable on busy backgrounds). */
  stroke?: { color: UIColor; width: number } | null;
  shadow?: ShadowStyle | null;
  /** Shrink the font to fit the available width (true = down to 18, or a min size) instead of wrapping. */
  autoFit?: boolean | number;
}

function labelStyle(p: LabelProps): Partial<TextStyle> {
  const ty = uiTheme().typography[p.variant ?? 'body'];
  const size = p.size ?? ty.size;
  const stroke = p.stroke !== undefined ? p.stroke : (ty.stroke ?? null);
  const ff = uiFontFamily();
  return {
    fontSize: size,
    fontWeight: p.weight ?? ty.weight,
    fontStyle: p.italic ? 'italic' : 'normal',
    color: uiColor(p.color ?? ty.color),
    align: p.align ?? 'left',
    lineHeight: p.lineHeight ?? ty.lineHeight ?? 1.3,
    maxLines: p.maxLines ?? (p.autoFit ? 1 : 0),
    stroke: stroke ? { color: uiColor(stroke.color), width: stroke.width } : null,
    shadow: p.shadow !== undefined ? p.shadow : (ty.shadow ?? null),
    minFontSize: p.autoFit ? Math.min(size, typeof p.autoFit === 'number' ? p.autoFit : 18) : 0,
    ...(ff ? { fontFamily: ff } : {}),
  };
}

/**
 * Themed text: typography variant + color token. Wraps to the width its container gives it (or shrinks with
 * `autoFit`). Setting `text` re-lays out the surrounding UI.
 */
export class Label extends Text {
  private lp: LabelProps;
  private themeVer: number;

  constructor(text: string | number = '', props: LabelProps = {}) {
    super(text, labelStyle(props));
    this.lp = { ...props };
    this.themeVer = uiThemeVersion();
    applyUINodeProps(this, props);
  }

  override get kind(): string {
    return 'Label';
  }

  get variant(): UITextVariant {
    return this.lp.variant ?? 'body';
  }

  /** Layout style (same object as `uiLayout(label)`). */
  get layout(): UILayoutStyle {
    return uiLayout(this);
  }

  override get text(): string {
    return super.text;
  }

  override set text(v: string | number) {
    const before = super.text;
    super.text = v;
    if (super.text !== before) markUILayoutDirty(this);
  }

  /** Updates label props (variant, color, size...) and re-lays out. */
  restyle(p: Partial<Omit<LabelProps, keyof UINodeProps>>): this {
    Object.assign(this.lp, p);
    this.setStyle(labelStyle(this.lp));
    markUILayoutDirty(this);
    return this;
  }

  /** @internal Re-applies theme tokens after setUITheme(); returns true if anything changed. */
  uiSync(): boolean {
    const v = uiThemeVersion();
    if (v === this.themeVer) return false;
    this.themeVer = v;
    this.setStyle(labelStyle(this.lp));
    return true;
  }

  override describe() {
    return { ...super.describe(), variant: this.lp.variant };
  }
}
