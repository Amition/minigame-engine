import type { Color } from '../core/color';
import type { ShadowStyle } from '../scene/box';

/** Color tokens. Every widget color prop accepts a token name or a raw CSS color. */
export interface UIColors {
  bg: Color;
  surface: Color;
  surfaceAlt: Color;
  primary: Color;
  onPrimary: Color;
  secondary: Color;
  onSecondary: Color;
  success: Color;
  onSuccess: Color;
  danger: Color;
  onDanger: Color;
  warning: Color;
  onWarning: Color;
  text: Color;
  textDim: Color;
  border: Color;
  /** Modal backdrop. */
  backdrop: Color;
  /** Inset tracks (progress bars, sliders, switches). */
  track: Color;
  /** Stars, coins, rewards. */
  gold: Color;
}

export type UIColorToken = keyof UIColors;
/** Token name ('primary', 'textDim', ...) or any CSS color ('#f55', 'rgba(...)'). */
export type UIColor = UIColorToken | (string & {});

export type UISpaceToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
/** Design units or a spacing token. */
export type UISpace = number | UISpaceToken;

export type UIRadiusToken = 'sm' | 'md' | 'lg' | 'xl' | 'full';
/** Corner radius: design units, a token ('full' = pill/circle) or [topLeft, topRight, bottomRight, bottomLeft]. */
export type UIRadius = number | UIRadiusToken | [number, number, number, number];

export type UIShadowToken = 'sm' | 'md' | 'lg';
export type UIShadow = UIShadowToken | ShadowStyle;

export type UITextVariant = 'title' | 'h1' | 'h2' | 'body' | 'caption' | 'button';

export interface UITypeStyle {
  size: number;
  weight: 'normal' | 'bold' | number;
  color: UIColor;
  lineHeight?: number;
  stroke?: { color: UIColor; width: number } | null;
  shadow?: ShadowStyle | null;
}

export interface UITheme {
  name: string;
  colors: UIColors;
  radii: Record<Exclude<UIRadiusToken, 'full'>, number>;
  spacing: Record<UISpaceToken, number>;
  typography: Record<UITextVariant, UITypeStyle>;
  shadows: Record<UIShadowToken, ShadowStyle>;
  /** Optional font-family override (default: the platform font stack). */
  fontFamily?: string;
}

const radii = { sm: 12, md: 20, lg: 32, xl: 44 };
const spacing = { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 };

/** Default theme: deep indigo night with candy-colored controls. */
export const darkUITheme: UITheme = {
  name: 'dark',
  colors: {
    bg: '#1a1b3d',
    surface: '#2a2c5e',
    surfaceAlt: '#3a3d7a',
    primary: '#ffb627',
    onPrimary: '#4a2500',
    secondary: '#3d8bfd',
    onSecondary: '#ffffff',
    success: '#1e9e52',
    onSuccess: '#ffffff',
    danger: '#f04a5a',
    onDanger: '#ffffff',
    warning: '#ff8f1f',
    onWarning: '#3d1c00',
    text: '#ffffff',
    textDim: '#aeb3e6',
    border: '#4b4f96',
    backdrop: 'rgba(8,8,24,0.66)',
    track: '#15163a',
    gold: '#ffc83d',
  },
  radii,
  spacing,
  typography: {
    title: {
      size: 84,
      weight: 'bold',
      color: '#ffffff',
      lineHeight: 1.15,
      stroke: { color: '#5b2bb5', width: 12 },
      shadow: { color: 'rgba(0,0,0,0.35)', blur: 0, y: 8 },
    },
    h1: { size: 52, weight: 'bold', color: 'text', lineHeight: 1.2 },
    h2: { size: 38, weight: 'bold', color: 'text', lineHeight: 1.25 },
    body: { size: 30, weight: 'normal', color: 'text', lineHeight: 1.4 },
    caption: { size: 24, weight: 'normal', color: 'textDim', lineHeight: 1.35 },
    button: { size: 34, weight: 'bold', color: 'text', lineHeight: 1.2 },
  },
  shadows: {
    sm: { color: 'rgba(0,0,0,0.25)', blur: 8, y: 3 },
    md: { color: 'rgba(0,0,0,0.32)', blur: 20, y: 8 },
    lg: { color: 'rgba(0,0,0,0.42)', blur: 40, y: 16 },
  },
};

/** Warm cream daylight theme. */
export const lightUITheme: UITheme = {
  name: 'light',
  colors: {
    bg: '#fff3dc',
    surface: '#ffffff',
    surfaceAlt: '#ffe8c2',
    primary: '#ff9f1c',
    onPrimary: '#4a2500',
    secondary: '#2f80ed',
    onSecondary: '#ffffff',
    success: '#1e9e52',
    onSuccess: '#ffffff',
    danger: '#e5484d',
    onDanger: '#ffffff',
    warning: '#f59e0b',
    onWarning: '#3d1c00',
    text: '#3b2716',
    textDim: '#7d6450',
    border: '#f0d3a4',
    backdrop: 'rgba(40,24,8,0.5)',
    track: '#f3dcb8',
    gold: '#ffb800',
  },
  radii,
  spacing,
  typography: {
    title: {
      size: 84,
      weight: 'bold',
      color: '#ffffff',
      lineHeight: 1.15,
      stroke: { color: '#d9480f', width: 12 },
      shadow: { color: 'rgba(120,50,0,0.3)', blur: 0, y: 8 },
    },
    h1: { size: 52, weight: 'bold', color: 'text', lineHeight: 1.2 },
    h2: { size: 38, weight: 'bold', color: 'text', lineHeight: 1.25 },
    body: { size: 30, weight: 'normal', color: 'text', lineHeight: 1.4 },
    caption: { size: 24, weight: 'normal', color: 'textDim', lineHeight: 1.35 },
    button: { size: 34, weight: 'bold', color: 'text', lineHeight: 1.2 },
  },
  shadows: {
    sm: { color: 'rgba(120,70,20,0.18)', blur: 8, y: 3 },
    md: { color: 'rgba(120,70,20,0.22)', blur: 20, y: 8 },
    lg: { color: 'rgba(120,70,20,0.3)', blur: 40, y: 16 },
  },
};

let current: UITheme = darkUITheme;
let version = 1;

/** The active UI theme. */
export function uiTheme(): UITheme {
  return current;
}

/** Incremented on every setUITheme(); widgets use it to refresh cached colors and fonts. */
export function uiThemeVersion(): number {
  return version;
}

/** Switches the UI theme. Widgets pick it up on the next frame (colors are resolved at draw time). */
export function setUITheme(theme: UITheme | 'dark' | 'light'): void {
  current = theme === 'dark' ? darkUITheme : theme === 'light' ? lightUITheme : theme;
  version++;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** A theme derived from `base` with some tokens replaced: `createUITheme(darkUITheme, { colors: { primary: '#0c8' } })`. */
export function createUITheme(base: UITheme, overrides: DeepPartial<UITheme> & { name?: string }): UITheme {
  const o = overrides;
  const typography = { ...base.typography };
  for (const k of Object.keys(o.typography ?? {}) as UITextVariant[]) {
    typography[k] = { ...base.typography[k], ...(o.typography![k] as Partial<UITypeStyle>) };
  }
  return {
    ...base,
    ...(o.name ? { name: o.name } : {}),
    ...(o.fontFamily ? { fontFamily: o.fontFamily } : {}),
    colors: { ...base.colors, ...(o.colors as Partial<UIColors>) },
    radii: { ...base.radii, ...(o.radii as Partial<UITheme['radii']>) },
    spacing: { ...base.spacing, ...(o.spacing as Partial<UITheme['spacing']>) },
    shadows: { ...base.shadows, ...(o.shadows as Partial<UITheme['shadows']>) },
    typography,
  };
}

/** Resolves a color token ('primary') or passes a raw color through. */
export function uiColor(c: UIColor): Color;
export function uiColor(c: UIColor | null | undefined): Color | null;
export function uiColor(c: UIColor | null | undefined): Color | null {
  if (c === null || c === undefined || c === '') return null;
  return (current.colors as unknown as Record<string, Color>)[c] ?? c;
}

/** Resolves a spacing token to design units. */
export function uiSpace(v: UISpace | undefined): number {
  if (v === undefined) return 0;
  return typeof v === 'number' ? v : current.spacing[v] ?? 0;
}

/** Resolves a radius for a box of size w x h. */
export function uiRadius(v: UIRadius | undefined, w: number, h: number): number | [number, number, number, number] {
  if (v === undefined) return 0;
  if (typeof v === 'number' || Array.isArray(v)) return v;
  if (v === 'full') return Math.min(w, h) / 2;
  return current.radii[v] ?? 0;
}

export function uiShadow(v: UIShadow | null | undefined): ShadowStyle | null {
  if (!v) return null;
  return typeof v === 'string' ? current.shadows[v] ?? null : v;
}

/** Font family for UI text: theme override or the platform default (undefined). */
export function uiFontFamily(): string | undefined {
  return current.fontFamily;
}
