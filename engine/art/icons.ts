import type { Color } from '../core/color';
import type { Texture } from '../gfx/texture';
import { textures } from '../gfx/textures';
import { svgTexture } from './svg';

// Icons are SVG fragments on a 24×24 grid, drawn with currentColor. Filled glyphs cut details out with
// fill-rule="evenodd" so every icon stays a single colour and reads well at 24–96 px.

const f = (d: string, extra = '') => `<path d="${d}"${extra}/>`;
const fe = (d: string) => `<path fill-rule="evenodd" d="${d}"/>`;
const s = (d: string, w = 2.6) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const circle = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const rect = (x: number, y: number, w: number, h: number, r: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const disc = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${2 * r}a${r} ${r} 0 1 0 0 ${-2 * r}z`;

const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** Star with rounded tips as path data. */
function starD(cx: number, cy: number, R: number, r: number, points: number, round: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rad = i % 2 ? r : R;
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  let d = '';
  pts.forEach((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length]!;
    const next = pts[(i + 1) % pts.length]!;
    const k = (q: [number, number]) => {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const t = Math.min(0.45, round / len);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    const [ax, ay] = k(prev);
    const [bx, by] = k(next);
    d += `${i === 0 ? 'M' : 'L'}${n2(ax!)} ${n2(ay!)}Q${n2(p[0])} ${n2(p[1])} ${n2(bx!)} ${n2(by!)}`;
  });
  return d + 'Z';
}

/** Gear outline with a round hole as path data (use with fill-rule evenodd). */
function gearD(cx: number, cy: number, rOut: number, rIn: number, teeth: number, hole: number): string {
  const step = (Math.PI * 2) / teeth;
  const pt = (r: number, a: number) => `${n2(cx + Math.cos(a) * r)} ${n2(cy + Math.sin(a) * r)}`;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = -Math.PI / 2 + i * step;
    const a0 = a - step * 0.24;
    const a1 = a - step * 0.14;
    const a2 = a + step * 0.14;
    const a3 = a + step * 0.24;
    d += i === 0 ? `M${pt(rIn, a0)}` : `A${rIn} ${rIn} 0 0 1 ${pt(rIn, a0)}`;
    d += `L${pt(rOut, a1)}A${rOut} ${rOut} 0 0 1 ${pt(rOut, a2)}L${pt(rIn, a3)}`;
  }
  d += `A${rIn} ${rIn} 0 0 1 ${pt(rIn, -Math.PI / 2 - step * 0.24)}Z`;
  return d + disc(cx, cy, hole);
}

const SPEAKER = f('M3.5 9.8v4.4c0 .7.5 1.2 1.2 1.2h2.9l4.5 3.8c.7.6 1.9.1 1.9-.9V5.7c0-1-1.2-1.5-1.9-.9L7.6 8.6H4.7c-.7 0-1.2.5-1.2 1.2z');
const NOTE = s('M9 17.5V6.6l11-2.6v11.5', 2.2) + f('M9 6.6l11-2.6v3.4L9 10z') + circle(6.3, 17.5, 2.9) + circle(17.3, 15.5, 2.9);
const LOCK_BODY = fe(
  'M7 10h10a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 1-2.5-2.5v-6A2.5 2.5 0 0 1 7 10z' +
    'M12 13.3a1.6 1.6 0 0 0-.8 3v1.6h1.6v-1.6a1.6 1.6 0 0 0-.8-3z',
);
const HEART_D =
  'M12 20.5c-.3 0-.6-.1-.8-.3C6.7 16.4 3 13.3 3 9.2 3 6.3 5.2 4 8 4c1.7 0 3.1.8 4 2.1C12.9 4.8 14.3 4 16 4c2.8 0 5 2.3 5 5.2 0 4.1-3.7 7.2-8.2 11-.2.2-.5.3-.8.3z';

const ICONS = {
  play: f('M8 5.6c0-.9 1-1.4 1.7-.9l9.6 6.4c.7.4.7 1.4 0 1.8l-9.6 6.4c-.7.5-1.7 0-1.7-.9z'),
  pause: rect(6, 4.5, 4.2, 15, 1.6) + rect(13.8, 4.5, 4.2, 15, 1.6),
  stop: rect(5.5, 5.5, 13, 13, 2.6),
  settings: `<path fill-rule="evenodd" stroke="currentColor" stroke-width="1" stroke-linejoin="round" d="${gearD(12, 12, 10, 7.2, 8, 3.1)}"/>`,
  home: f(
    'M10.9 3.6a1.7 1.7 0 0 1 2.2 0l8 7.1c.6.5.2 1.5-.6 1.5H19v7.3c0 .8-.7 1.5-1.5 1.5h-3v-5.5a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1V21h-3c-.8 0-1.5-.7-1.5-1.5v-7.3H3.4c-.8 0-1.2-1-.6-1.5z',
  ),
  back: s('M19 12H5.5M11.5 5.5L5 12l6.5 6.5', 2.8),
  forward: s('M5 12h13.5M12.5 5.5L19 12l-6.5 6.5', 2.8),
  'chevron-left': s('M15 4.5L7.5 12l7.5 7.5', 3),
  'chevron-right': s('M9 4.5l7.5 7.5L9 19.5', 3),
  close: s('M6.5 6.5l11 11M17.5 6.5l-11 11', 3),
  check: s('M4.5 12.5l5 5 10-10.5', 3),
  plus: s('M12 5v14M5 12h14', 3),
  minus: s('M5 12h14', 3),
  restart: s('M18.75 15.9A7.8 7.8 0 1 1 18.75 8.1') + s('M19.9 3.75L18.75 8.1 14.4 6.94'),
  'sound-on': SPEAKER + s('M16.8 9.2a4 4 0 0 1 0 5.6M19.2 6.6a7.6 7.6 0 0 1 0 10.8', 2),
  'sound-off': SPEAKER + s('M16.8 9.5l5 5M21.8 9.5l-5 5', 2.2),
  music: NOTE,
  'music-off': NOTE + s('M3.5 3.5l17 17', 2.2),
  vibrate:
    fe('M9 2.5h6a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM9 5v13h6V5z') +
    s('M4.2 8.5v7M19.8 8.5v7M1.8 10.3v3.4M22.2 10.3v3.4', 1.8),
  star: f(starD(12, 12.9, 10.8, 5.2, 5, 1.7)),
  'star-outline': s(starD(12, 12.9, 9.6, 4.7, 5, 1.2), 2.1),
  heart: f(HEART_D),
  'heart-outline': s(HEART_D, 2.1),
  lock: s('M8 10.5V7.8a4 4 0 0 1 8 0v2.7', 2.4) + LOCK_BODY,
  unlock: s('M8 10.5V7.3a4 4 0 0 1 7.6-1.7', 2.4) + LOCK_BODY,
  coin: fe(disc(12, 12, 9.6) + disc(12, 12, 7.4) + disc(12, 12, 6.3) + starD(12, 12.4, 4.2, 2, 5, 0.5)),
  gem: f('M7 3.5h10l4.5 5.3h-19z', ' opacity=".7"') + f('M2.5 10.2h19L12 21z'),
  trophy: fe(
    'M7 3h10v2h3a1 1 0 0 1 1 1v1.5c0 2.6-2 4.7-4.6 5A5.5 5.5 0 0 1 13 15.8V18h3a1 1 0 0 1 1 1v2H7v-2a1 1 0 0 1 1-1h3v-2.2A5.5 5.5 0 0 1 7.6 12.5C5 12.2 3 10.1 3 7.5V6a1 1 0 0 1 1-1h3z' +
      'M17 7h2v.5c0 1.4-.8 2.6-2 3.1zM7 7H5v.5c0 1.4.8 2.6 2 3.1z',
  ),
  crown:
    `<path stroke="currentColor" stroke-width="1" stroke-linejoin="round" d="M3.2 8.2l4.6 3.9L12 5.6l4.2 6.5 4.6-3.9-1.8 9.6H5z"/>` +
    rect(5, 19, 14, 2.2, 1.1) + circle(3.2, 7.4, 1.6) + circle(12, 4.6, 1.7) + circle(20.8, 7.4, 1.6),
  share: circle(17.5, 5.5, 2.9) + circle(6.5, 12, 2.9) + circle(17.5, 18.5, 2.9) + s('M8.8 10.7l6.4-3.9M8.8 13.3l6.4 3.9', 2),
  'video-ad': fe(
    'M5 4.5h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3z' +
      'M10 8.6v6.8c0 .6.6.9 1.1.6l5.3-3.4c.5-.3.5-1 0-1.3L11.1 8c-.5-.3-1.1 0-1.1.6z',
  ),
  gift:
    rect(3, 8.2, 8, 4.2, 1) + rect(13, 8.2, 8, 4.2, 1) + rect(4.4, 13.4, 6.6, 8, 1) + rect(13, 13.4, 6.6, 8, 1) +
    f('M11.4 8C9 8 6.6 7.5 6.6 5.6c0-1.5 1.7-2.2 3-1.2 1.1.8 1.7 2.2 1.8 3.6zM12.6 8c2.4 0 4.8-.5 4.8-2.4 0-1.5-1.7-2.2-3-1.2-1.1.8-1.7 2.2-1.8 3.6z'),
  info: fe(disc(12, 12, 9.6) + disc(12, 7.7, 1.5) + 'M10.8 11.6a1.2 1.2 0 0 1 2.4 0v5.2a1.2 1.2 0 0 1-2.4 0z'),
  question: fe(
    disc(12, 12, 9.6) +
      'M8.4 9.2A3.6 3.6 0 1 1 14.76 11.51L13.2 12.8V14H10.8V12.8C10.8 11.7 11.8 10.9 13.07 10.1A1.4 1.4 0 1 0 10.6 9.2A1.1 1.1 0 0 1 8.4 9.2Z' +
      disc(12, 17, 1.4),
  ),
  warning: fe(
    'M10.3 3.9c.8-1.3 2.6-1.3 3.4 0l7.9 13.6c.8 1.3-.2 3-1.7 3H4.1c-1.5 0-2.5-1.7-1.7-3z' +
      'M10.9 9.4a1.1 1.1 0 0 1 2.2 0v4.4a1.1 1.1 0 0 1-2.2 0z' +
      disc(12, 16.8, 1.3),
  ),
  menu: s('M4.5 6.5h15M4.5 12h15M4.5 17.5h15', 2.8),
  shop:
    fe(
      'M5.6 8h12.8c.6 0 1 .4 1.1 1l1 11c.1.8-.6 1.5-1.4 1.5H4.9c-.8 0-1.5-.7-1.4-1.5l1-11c.1-.6.5-1 1.1-1z' +
        disc(8.6, 10.8, 1) + disc(15.4, 10.8, 1),
    ) + s('M8.6 9.4V7a3.4 3.4 0 0 1 6.8 0v2.4', 2),
  user: circle(12, 7.8, 4.3) + f('M3.8 20.2c0-4.2 3.7-7 8.2-7s8.2 2.8 8.2 7c0 .6-.4 1-1 1H4.8c-.6 0-1-.4-1-1z'),
  clock: fe(disc(12, 12, 9.6) + 'M11 6.8a1 1 0 0 1 2 0v4.7l3.1 1.9a1 1 0 1 1-1 1.7l-3.6-2.2a1 1 0 0 1-.5-.9z'),
  lightning: f('M13.5 2 5 13.2c-.4.5 0 1.3.7 1.3H11l-1.5 7.2c-.1.6.6.9 1 .4L19 10.8c.4-.5 0-1.3-.7-1.3H13l1.5-7.1c.1-.6-.7-.9-1-.4z'),
  fire: fe(
    'M12 2.3c.6 3.2-3.3 5-5 8.5-1.3 2.7-1.1 6.2 1.3 8.5 1.1 1.1 2.4 1.7 3.7 1.7 3.9 0 7-2.9 7-6.9 0-2.7-1.2-4.4-2.5-5.7-.1 1.5-.8 2.6-2 3.1.5-3.4-.7-6.9-2.5-9.2z' +
      'M12 19.8c-1.6 0-2.9-1.2-2.9-2.8 0-1.9 1.5-2.7 2.3-4.4 1 1.3 3.5 2.6 3.5 4.6 0 1.5-1.3 2.6-2.9 2.6z',
  ),
  shield: f('M12 2.3l7.6 2.9c.5.2.9.7.9 1.3v5c0 4.7-3.3 8.6-8 10.2-.3.1-.7.1-1 0-4.7-1.6-8-5.5-8-10.2v-5c0-.6.4-1.1.9-1.3z'),
  hint:
    f('M12 2.5a6.6 6.6 0 0 0-3.9 11.9c.6.4.9 1.1.9 1.8v.3h6v-.3c0-.7.3-1.4.9-1.8A6.6 6.6 0 0 0 12 2.5z') +
    rect(9, 17.6, 6, 1.8, 0.9) + f('M10 20.4h4a2 2 0 0 1-4 0z'),
  mail: fe(
    'M4.5 5h15A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16.5v-9A2.5 2.5 0 0 1 4.5 5z' +
      'M4.3 7.6 12 12.9l7.7-5.3v1.8L12 14.7 4.3 9.4z',
  ),
  rank: rect(2.5, 12, 6, 9, 1.2) + rect(9, 5.5, 6, 15.5, 1.2) + rect(15.5, 9, 6, 12, 1.2),
  bomb: circle(10.5, 14, 7) + s('M15.2 9.3l2.4-2.4', 2.6) + f('M19.5 1.6l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z'),
} satisfies Record<string, string>;

export type IconName = keyof typeof ICONS;

/** All icon names (play, pause, settings, coin, …). */
export const iconNames = Object.keys(ICONS) as IconName[];

/** Full SVG markup of an icon (24×24 viewBox, currentColor = `color`, default black). */
export function iconSvg(name: IconName, color?: Color): string {
  const body = ICONS[name];
  if (body === undefined) throw new Error(`unknown icon "${name}" (have: ${iconNames.join(', ')})`);
  const c = color ? ` color="${color}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor"${c}>${body}</svg>`;
}

export interface IconTextureOptions {
  /** Logical size in px (default 48). */
  size?: number;
  /** Icon colour (default white). */
  color?: Color;
  resolution?: number;
  /** Register under this key too. */
  key?: string;
}

/** Bakes an icon (cached). `iconTexture('coin', { size: 64, color: '#ffd23f' })`. */
export function iconTexture(name: IconName, opts: IconTextureOptions = {}): Texture {
  const size = opts.size ?? 48;
  const o: Parameters<typeof svgTexture>[1] = { width: size, height: size, color: opts.color ?? '#ffffff' };
  if (opts.resolution !== undefined) o.resolution = opts.resolution;
  if (opts.key !== undefined) o.key = opts.key;
  return svgTexture(iconSvg(name), o);
}

/**
 * Registers icons in the `textures` registry as `${prefix}${name}` (default 'icon:play', 'icon:coin', …),
 * which is where the UI module looks them up. Returns the registered keys.
 */
export function registerIcons(
  opts: IconTextureOptions & { prefix?: string; names?: readonly IconName[] } = {},
): string[] {
  const prefix = opts.prefix ?? 'icon:';
  const keys: string[] = [];
  for (const name of opts.names ?? iconNames) {
    const key = prefix + name;
    const o: IconTextureOptions = { ...opts };
    delete o.key;
    textures.set(key, iconTexture(name, o));
    keys.push(key);
  }
  return keys;
}
