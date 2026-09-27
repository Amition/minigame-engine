import {
  bakeTexture,
  Box,
  creatureFrames,
  duotoneTexture,
  iconTexture,
  mirrorRows,
  palettes,
  patternTexture,
  pixelFrames,
  pixelSprite,
  shapeTexture,
  Sprite,
  svgTexture,
  Text,
  textureStats,
  tintTexture,
  ui,
  type ArtShapeOptions,
  type ArtShape,
  type CreatureAnim,
  type CreatureOptions,
  type IconName,
  type PatternName,
  type PixelPalette,
  type SceneFactory,
  type Texture,
} from '@engine';
import { DemoScene } from '../common';

/** Palette for the sample pixel sprites (one character per colour). */
export const pixelPalette: PixelPalette = {
  k: '#1a1c2c',
  w: '#f4f4f4',
  r: '#e43b44',
  y: '#feae34',
  Y: '#fee761',
  g: '#63c74d',
  b: '#0099db',
  c: '#9ff3ff',
  p: '#b55088',
  P: '#f6757a',
  n: '#733e39',
  N: '#b86f50',
};

/** Sample pixel sprites (text grids). Symmetric ones are written as left halves and mirrored. */
export const pixelSamples: Record<string, string[]> = {
  heart: ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
  mushroom: mirrorRows(
    ['....rr', '..rrrr', '.rrwwr', 'rrrwwr', 'rrrrrr', 'rwwrrr', '.rrrrr', '...www', '...wkw', '...www', '....ww'],
    'x',
  ),
  slime: mirrorRows(['.....g', '...ggg', '..gggg', '.ggggg', '.gkwgg', '.gkkgg', 'gPgggg', 'gggggg', '.ggggg'], 'x'),
  ghost: mirrorRows(['...www', '.wwwww', '.wwwww', 'wwkkww', 'wwkkww', 'wwwwww', 'wPwwww', 'wwwwww', 'wwwwww', 'ww.ww.'], 'x'),
  potion: [
    '....NN....',
    '....nn....',
    '....cc....',
    '....cc....',
    '...cccc...',
    '..cwcccc..',
    '.cwpppppc.',
    '.cppppppc.',
    '.cppPpppc.',
    '..cppppc..',
    '...cccc...',
  ],
};

/** Spinning coin: frames of different widths (pixelFrames pads them to one size). */
export const coinFrames: string[][] = [
  ['..yyyy..', '.yyyyyy.', 'yyyYyyyy', 'yyyYyyyy', 'yyyYyyyy', 'yyyYyyyy', '.yyyyyy.', '..yyyy..'],
  ['.yyyy.', 'yyyyyy', 'yyYyyy', 'yyYyyy', 'yyYyyy', 'yyYyyy', 'yyyyyy', '.yyyy.'],
  ['yy', 'yy', 'yy', 'yy', 'yy', 'yy', 'yy', 'yy'],
  ['.yyyy.', 'yyyyyy', 'yyyYyy', 'yyyYyy', 'yyyYyy', 'yyyYyy', 'yyyyyy', '.yyyy.'],
];

/** Sample SVG sprites an AI would write. */
export const svgSamples: Record<string, string> = {
  sun: `<svg viewBox="0 0 100 100">
  <defs>
    <radialGradient id="g" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#fff6b0"/><stop offset="1" stop-color="#ffb12b"/>
    </radialGradient>
  </defs>
  <path d="M50 5v13M50 82v13M5 50h13M82 50h13M18 18l9 9M73 73l9 9M18 82l9-9M73 27l9-9"
        stroke="#f08c1e" stroke-width="7" stroke-linecap="round"/>
  <circle cx="50" cy="50" r="28" fill="url(#g)" stroke="#e0761c" stroke-width="4"/>
  <circle cx="41" cy="47" r="3.6" fill="#6b3a12"/><circle cx="59" cy="47" r="3.6" fill="#6b3a12"/>
  <path d="M42 57q8 7 16 0" fill="none" stroke="#6b3a12" stroke-width="3.5" stroke-linecap="round"/>
  <ellipse cx="35" cy="56" rx="4.5" ry="2.8" fill="#ff6a4d" opacity=".45"/>
  <ellipse cx="65" cy="56" rx="4.5" ry="2.8" fill="#ff6a4d" opacity=".45"/>
</svg>`,
  potion: `<svg viewBox="0 0 100 120">
  <defs>
    <linearGradient id="liq" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff7ad9"/><stop offset="1" stop-color="#a3128e"/>
    </linearGradient>
    <path id="flask" d="M39 36V18h22v18c15 6 25 20 25 37a36 36 0 0 1-72 0c0-17 10-31 25-37z"/>
    <clipPath id="inside"><use href="#flask"/></clipPath>
  </defs>
  <use href="#flask" fill="#e6f7ff" fill-opacity=".7"/>
  <g clip-path="url(#inside)">
    <rect x="0" y="64" width="100" height="60" fill="url(#liq)"/>
    <path d="M0 64q12.5-7 25 0t25 0 25 0 25 0v5H0z" fill="#ffc2f0"/>
    <circle cx="40" cy="90" r="4" fill="#fff" opacity=".6"/><circle cx="58" cy="80" r="2.5" fill="#fff" opacity=".6"/>
    <circle cx="52" cy="98" r="3" fill="#fff" opacity=".5"/>
  </g>
  <path d="M26 64c2-9 8-16 16-20" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".8"/>
  <use href="#flask" fill="none" stroke="#3b1f4a" stroke-width="4" stroke-linejoin="round"/>
  <rect x="34" y="6" width="32" height="14" rx="5" fill="#b0763f" stroke="#3b1f4a" stroke-width="4"/>
</svg>`,
  banner: `<svg viewBox="0 0 200 70">
  <style>.ink{stroke:#5a1d1d;stroke-width:4;stroke-linejoin:round}</style>
  <defs><linearGradient id="red" x2="0" y2="1"><stop offset="0" stop-color="#ff6b6b"/><stop offset="1" stop-color="#d63d3d"/></linearGradient></defs>
  <path class="ink" d="M8 22h40v40H8l12-20z" fill="#b83232"/>
  <path class="ink" d="M192 22h-40v40h40l-12-20z" fill="#b83232"/>
  <path class="ink" d="M30 8h140v44H30z" fill="url(#red)"/>
  <path d="M34 14h132" stroke="#fff" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/>
  <text x="100" y="40" font-size="22" font-weight="bold" text-anchor="middle" fill="#fff" stroke="#5a1d1d"
        stroke-width="4" paint-order="stroke">LEVEL UP</text>
</svg>`,
};

const GALLERY_ICONS: IconName[] = ['play', 'pause', 'settings', 'home', 'sound-on', 'star', 'heart', 'coin', 'gift', 'trophy'];
const ICON_BG = ['#3fa7f5', '#ff9f1c', '#8b93a3', '#3fbf6f', '#b57bff', '#ffc93c', '#ff5d73', '#ffb400', '#ff6f9f', '#ffb52e'];

const GALLERY_SHAPES: [ArtShape, ArtShapeOptions][] = [
  ['star', { fill: '#ffc93c' }],
  ['heart', { fill: '#ff5d73' }],
  ['gem', { fill: '#4dabf7' }],
  ['coin', { fill: '#ffc93c' }],
  ['shield', { fill: '#748ffc' }],
  ['bolt', { fill: '#ffd43b' }],
];

const GALLERY_CREATURES: [CreatureOptions, CreatureAnim][] = [
  [{ seed: 1, body: 'blob', color: '#8ce99a', eyes: 'round', mouth: 'smile', accessory: 'leaf', cheeks: true }, 'squash'],
  [{ seed: 2, body: 'round', color: '#ffa94d', eyes: 'sparkle', mouth: 'open', accessory: 'crown', cheeks: true }, 'idle'],
  [{ seed: 3, body: 'bean', color: '#b197fc', eyes: 'happy', mouth: 'cat', accessory: 'bow', cheeks: true }, 'bounce'],
  [{ seed: 4, body: 'square', color: '#66d9e8', eyes: 'round', mouth: 'fang', accessory: 'horns', cheeks: false }, 'idle'],
];

/** Curated art showcase: palettes, icons, shapes, creatures, pixel sprites, SVG sprites, tileable patterns. */
class ArtGalleryScene extends DemoScene {
  readonly title = 'Art Gallery';

  protected build(): void {
    const { x: x0, y: y0, w } = this.content;
    let y = y0 + 24;
    const heading = (label: string) => {
      this.add(new Text(label, { fontSize: 24, color: '#8a90a2' }, { x: x0 + 32, y }));
      y += 40;
    };
    const animate = (sprite: Sprite, frames: Texture[], fps: number) => {
      let t = 0;
      sprite.onUpdate((dt) => {
        t += dt;
        sprite.setTexture(frames[Math.floor(t * fps) % frames.length]!, false);
      });
    };

    heading('palettes');
    const pals = ['sunny', 'jelly', 'cozy', 'pico8'] as const;
    const sw = (w - 64) / pals.length;
    pals.forEach((name, i) => {
      const cols = palettes[name];
      const cw = (sw - 16) / cols.length;
      cols.forEach((c, k) => {
        this.add(new Box(cw, 36, { fill: c }, { x: x0 + 32 + i * sw + k * cw, y, id: k === 0 ? `pal-${name}` : '' }));
      });
    });
    y += 64;

    heading('icons');
    const iconStep = (w - 64) / GALLERY_ICONS.length;
    GALLERY_ICONS.forEach((name, i) => {
      const cx = x0 + 32 + iconStep * (i + 0.5);
      this.add(new Box(60, 60, { fill: ICON_BG[i]!, radius: 30, shadow: { color: '#0006', blur: 6, y: 3 } }, { x: cx, y: y + 30, anchor: 0.5 }));
      this.add(new Sprite(iconTexture(name, { size: 36, resolution: 2 }), { id: `icon-${name}`, x: cx, y: y + 30, anchor: 0.5 }));
    });
    y += 96;

    heading('shapes');
    const shapeStep = (w - 64) / GALLERY_SHAPES.length;
    GALLERY_SHAPES.forEach(([name, o], i) => {
      const tex = shapeTexture(name, { size: 88, stroke: 'auto', shine: true, shadow: true, resolution: 2, ...o });
      this.add(new Sprite(tex, { id: `shape-${name}`, x: x0 + 32 + shapeStep * (i + 0.5), y: y + 44, anchor: 0.5 }));
    });
    y += 112;

    heading('creatures');
    const cStep = (w - 64) / GALLERY_CREATURES.length;
    GALLERY_CREATURES.forEach(([o, anim], i) => {
      const frames = creatureFrames({ ...o, size: 150, resolution: 2 }, anim, anim === 'idle' ? 12 : 10);
      const s = this.add(new Sprite(frames[0]!, { id: `creature-${i}`, x: x0 + 32 + cStep * (i + 0.5), y: y + 75, anchor: 0.5 }));
      animate(s, frames, anim === 'idle' ? 8 : 12);
    });
    y += 170;

    heading('pixel art');
    const px = Object.entries(pixelSamples);
    const pStep = (w - 64) / (px.length + 1);
    px.forEach(([name, rows], i) => {
      const tex = pixelSprite(rows, pixelPalette, { scale: 6, outline: '#1a1c2c', shade: true });
      this.add(new Sprite(tex, { id: `pixel-${name}`, x: x0 + 32 + pStep * (i + 0.5), y: y + 45, anchor: 0.5 }));
    });
    const coin = pixelFrames(coinFrames, pixelPalette, { scale: 6, outline: '#1a1c2c', shade: true });
    const coinSprite = this.add(new Sprite(coin[0]!, { id: 'pixel-coin', x: x0 + 32 + pStep * (px.length + 0.5), y: y + 45, anchor: 0.5 }));
    animate(coinSprite, coin, 8);
    y += 112;

    heading('svg');
    const svgs: [string, { width?: number; height?: number }][] = [
      ['sun', { height: 110 }],
      ['potion', { height: 110 }],
      ['banner', { width: 280 }],
    ];
    let sx = x0 + 32;
    for (const [name, size] of svgs) {
      const tex = svgTexture(svgSamples[name]!, { ...size, resolution: 2 });
      this.add(new Sprite(tex, { id: `svg-${name}`, x: sx, y: y + (120 - tex.height) / 2 }));
      sx += tex.width + 40;
    }
    y += 140;

    heading('patterns (tileable)');
    const pats: PatternName[] = ['grass', 'water', 'stone', 'wood', 'bricks'];
    const tile = 64;
    const pw = (w - 64) / pats.length;
    pats.forEach((name, i) => {
      const tex = patternTexture(name, { width: tile, height: tile, size: name === 'bricks' ? 16 : 32, seed: 3, resolution: 2 });
      const quad = bakeTexture(tile * 2, tile * 2, (ctx) => {
        for (let k = 0; k < 4; k++) tex.draw(ctx, (k % 2) * tile, Math.floor(k / 2) * tile);
      }, { resolution: 2 });
      this.add(new Sprite(quad, { id: `pattern-${name}`, x: x0 + 32 + pw * i + (pw - tile * 2) / 2, y }));
    });
  }
}

/** White-on-transparent art with painted details (dark eye sockets, grey nose and teeth) to recolour. */
const TINT_SKULL = `<svg viewBox="0 0 48 48">
  <path d="M24 3C13 3 5 10.5 5 21c0 6.5 3.2 10.6 7.5 12.8V41a3 3 0 0 0 3 3h17a3 3 0 0 0 3-3v-7.2C39.8 31.6 43 27.5 43 21 43 10.5 35 3 24 3z" fill="#ffffff"/>
  <ellipse cx="16.5" cy="22" rx="5.5" ry="6" fill="#000000"/><ellipse cx="31.5" cy="22" rx="5.5" ry="6" fill="#000000"/>
  <path d="M24 28l-3.5 6h7z" fill="#5c5c5c"/>
  <path d="M19 37v6M24 37v6M29 37v6" stroke="#8c8c8c" stroke-width="2.4"/>
</svg>`;

const TINT_COLORS = ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7'];

/** tintTexture / duotoneTexture, Sprite.tint and ui.icon tint / duotone on one white icon and a shaded white star. */
class ArtTintScene extends DemoScene {
  readonly title = 'Art · Tint + duotone';

  protected build(): void {
    const { x: x0, y: y0, w } = this.content;
    const skull = svgTexture(TINT_SKULL, { width: 72, resolution: 2, key: 'tint-demo:skull' });
    const star = shapeTexture('star', { size: 72, fill: '#ffffff', stroke: 'auto', shine: true, resolution: 2, key: 'tint-demo:star' });
    const step = Math.min(110, (w - 64) / 6);
    let y = y0 + 24;
    const heading = (label: string) => {
      this.add(new Text(label, { fontSize: 24, color: '#8a90a2' }, { x: x0 + 32, y }));
      y += 40;
    };
    const cellX = (i: number) => x0 + 32 + step * (i + 0.5);
    const place = (i: number, tex: Texture, id: string, backdrop?: string) => {
      if (backdrop) this.add(new Box(96, 96, { fill: backdrop, radius: 18 }, { x: cellX(i), y: y + 48, anchor: 0.5 }));
      return this.add(new Sprite(tex, { id, x: cellX(i), y: y + 48, anchor: 0.5 }));
    };

    heading('source: white art with painted details');
    place(0, skull, 'tint-source-skull');
    place(1, star, 'tint-source-star');
    place(2, skull, 'tint-source-skull-light', '#d9d9de');
    y += 112;

    heading("tintTexture(src, color): 'multiply' keeps shading");
    TINT_COLORS.forEach((c, i) => place(i, tintTexture(skull, c), `tint-multiply-${i}`));
    place(4, tintTexture(star, '#ff922b'), 'tint-multiply-star-0');
    place(5, tintTexture(star, '#b197fc'), 'tint-multiply-star-1');
    y += 112;

    heading("mode 'fill' (silhouette) and amount");
    place(0, tintTexture(skull, '#ff6b6b', { mode: 'fill' }), 'tint-fill-0');
    place(1, tintTexture(skull, '#1e1e22', { mode: 'fill' }), 'tint-fill-1', '#d9d9de');
    place(2, tintTexture(skull, '#4dabf7', { mode: 'fill', amount: 0.5 }), 'tint-fill-half');
    place(3, tintTexture(star, '#ffffff', { mode: 'fill', amount: 0.6 }), 'tint-fill-flash');
    place(4, tintTexture(star, '#69db7c', { amount: 0.5 }), 'tint-multiply-half');
    y += 112;

    heading('duotoneTexture(src, dark, light): ink on buttons');
    const duos: [string, string][] = [
      ['#d9d9de', '#1e1e22'],
      ['#ffb627', '#4a2500'],
      ['#1e3a8a', '#bfdbfe'],
      ['#2b1d0e', '#ffe8a3'],
    ];
    duos.forEach(([dark, light], i) => place(i, duotoneTexture(skull, dark, light), `tint-duotone-${i}`, dark));
    y += 112;

    heading('Sprite.tint and ui.icon tint / duotone (theme tokens)');
    this.add(new Sprite(skull, { id: 'tint-sprite', x: cellX(0), y: y + 48, anchor: 0.5, tint: '#ff922b' }));
    this.add(new Sprite(star, { id: 'tint-sprite-fill', x: cellX(1), y: y + 48, anchor: 0.5, tint: '#ffd43b', tintMode: 'fill' }));
    const icons = [
      ui.icon('tint-demo:skull', { id: 'tint-icon', size: 72, tint: 'primary' }),
      ui.icon('tint-demo:skull', { id: 'tint-icon-duotone', size: 72, duotone: ['danger', 'onDanger'] }),
      ui.icon('lock', { id: 'tint-icon-glyph', size: 72, tint: 'success' }),
    ];
    icons.forEach((icon, i) => {
      icon.x = cellX(i + 2) - 36;
      icon.y = y + 12;
      this.add(icon);
    });
    y += 112;

    const caption = this.add(new Text('textureStats', { fontSize: 22, color: '#8a90a2' }, { id: 'tint-stats', x: x0 + 32, y: y + 8 }));
    let frame = 0;
    caption.onUpdate(() => {
      // Sprite / ui.icon tints bake on their first draw, so count after rendering started.
      if (frame++ % 30 !== 1) return;
      const stats = textureStats({ top: 500 }).top.filter((e) => e.key.startsWith('tint:') || e.key.startsWith('duotone:'));
      const kb = stats.reduce((s, e) => s + e.bytes, 0) / 1024;
      caption.text = `${stats.length} recoloured textures, ${kb.toFixed(0)} KB (textureStats)`;
    });
  }
}

export const scenes: Record<string, SceneFactory> = {
  'art-gallery': () => new ArtGalleryScene(),
  'art-tint': () => new ArtTintScene(),
};
