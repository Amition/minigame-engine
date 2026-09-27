/**
 * Renders labelled contact sheets of the art toolkit so an AI can Read the PNGs and review the art.
 *
 *   pnpm art:preview                          -> .shots/art-<section>.png for every section
 *   pnpm art:preview --only icons,shapes      -> just those sections
 *   pnpm art:preview --svg path/to/file.svg   -> .shots/art-svg-<file>.png (sizes, backgrounds, warnings)
 *   pnpm art:preview --only pixel --out .shots/pixel.png
 *
 * Sections: palettes, icons, shapes, pixel, svg, noise, creatures, effects, atlas.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  artShapes,
  colorRamp,
  creatureFrames,
  creatureTexture,
  drawArtShape,
  dropShadowTexture,
  flipTexture,
  glowTexture,
  colorHarmony,
  iconNames,
  iconTexture,
  noiseTexture,
  outlineTexture,
  paletteRoles,
  palettes,
  parseSvg,
  patternNames,
  patternTexture,
  pixelFrames,
  pixelSprite,
  recolorTexture,
  resampleTexture,
  setPlatform,
  shapeTexture,
  silhouetteTexture,
  svgTexture,
  TextureAtlas,
  tintTexture,
  type ArtShape,
  type ArtShapeOptions,
  type Color,
  type Ctx2D,
  type ColorHarmonyKind,
  type PaletteName,
  type PaletteRoles,
  type Texture,
} from '@engine';
import { HEADLESS_FONT, HeadlessPlatform } from '@engine/testing';
import { coinFrames, pixelPalette, pixelSamples, svgSamples } from '../../sandbox/scenes/art';
import { svgFeatureSamples } from './samples';

type Bg = 'dark' | 'light' | 'checker' | 'checker-light' | Color;

interface Cell {
  label: string;
  tex?: Texture;
  draw?: (ctx: Ctx2D, x: number, y: number, w: number, h: number) => void;
  pixelated?: boolean;
  bg?: Bg;
}

interface Group {
  title: string;
  cellW: number;
  cellH: number;
  bg: Bg;
  cells: Cell[];
}

const W = 1200;
const M = 24;
const GAP = 12;
const LABEL = 22;

class Sheet {
  readonly groups: Group[] = [];
  readonly notes: string[] = [];

  constructor(readonly title: string) {}

  group(title: string, cellW: number, cellH: number, bg: Bg = 'checker'): Group {
    const g: Group = { title, cellW, cellH, bg, cells: [] };
    this.groups.push(g);
    return g;
  }

  private layout(g: Group) {
    const cols = Math.max(1, Math.floor((W - 2 * M + GAP) / (g.cellW + GAP)));
    const rows = Math.ceil(g.cells.length / cols);
    return { cols, rows, h: 34 + rows * (g.cellH + LABEL + GAP) };
  }

  render(): Buffer {
    let H = M + 48;
    for (const g of this.groups) H += this.layout(g).h + 8;
    H += this.notes.length * 20 + M;
    const canvas = new HeadlessPlatform().createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#171a22';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 28px ${HEADLESS_FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillText(this.title, M, M);
    let y = M + 48;
    for (const g of this.groups) {
      const { cols } = this.layout(g);
      ctx.fillStyle = '#9aa3b8';
      ctx.font = `bold 17px ${HEADLESS_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(g.title, M, y + 6);
      y += 34;
      g.cells.forEach((c, i) => {
        const cx = M + (i % cols) * (g.cellW + GAP);
        const cy = y + Math.floor(i / cols) * (g.cellH + LABEL + GAP);
        drawBg(ctx, c.bg ?? g.bg, cx, cy, g.cellW, g.cellH);
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx, cy, g.cellW, g.cellH);
        ctx.clip();
        if (c.draw) c.draw(ctx, cx, cy, g.cellW, g.cellH);
        if (c.tex) {
          const pad = 6;
          const s = Math.min(1, (g.cellW - pad * 2) / c.tex.width, (g.cellH - pad * 2) / c.tex.height);
          const tw = c.tex.width * s;
          const th = c.tex.height * s;
          ctx.imageSmoothingEnabled = !c.pixelated;
          c.tex.draw(ctx, Math.round(cx + (g.cellW - tw) / 2), Math.round(cy + (g.cellH - th) / 2), tw, th);
          ctx.imageSmoothingEnabled = true;
        }
        ctx.restore();
        ctx.fillStyle = '#c9cfdd';
        ctx.font = `13px ${HEADLESS_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        let label = c.label;
        while (label.length > 3 && ctx.measureText(label).width > g.cellW + GAP - 2) label = label.slice(0, -2) + '…';
        ctx.fillText(label, cx + g.cellW / 2, cy + g.cellH + 4);
      });
      y += this.layout(g).h - 34 + 8;
    }
    ctx.textAlign = 'left';
    ctx.font = `14px ${HEADLESS_FONT}`;
    ctx.fillStyle = '#ffcf6b';
    for (const n of this.notes) {
      ctx.fillText(n, M, y);
      y += 20;
    }
    return (canvas as unknown as { toBuffer(type: 'image/png'): Buffer }).toBuffer('image/png');
  }
}

function drawBg(ctx: Ctx2D, bg: Bg, x: number, y: number, w: number, h: number): void {
  if (bg === 'checker' || bg === 'checker-light') {
    const [a, b] = bg === 'checker' ? ['#262a36', '#2e3342'] : ['#e9ecf3', '#f7f8fb'];
    ctx.fillStyle = a;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = b;
    for (let yy = 0; yy < h; yy += 8) {
      for (let xx = (yy / 8) % 2 ? 8 : 0; xx < w; xx += 16) ctx.fillRect(x + xx, y + yy, Math.min(8, w - xx), Math.min(8, h - yy));
    }
    return;
  }
  ctx.fillStyle = bg === 'dark' ? '#232733' : bg === 'light' ? '#f3f5f9' : bg;
  ctx.fillRect(x, y, w, h);
}

function swatches(colors: readonly Color[], labels = false) {
  return (ctx: Ctx2D, x: number, y: number, w: number, h: number) => {
    const sw = w / colors.length;
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(x + i * sw, y, Math.ceil(sw), h);
      if (labels && sw > 44) {
        ctx.font = `11px ${HEADLESS_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = luminanceOf(c) > 0.5 ? '#1a1c2c' : '#ffffff';
        ctx.fillText(c, x + i * sw + sw / 2, y + h - 3);
      }
    });
  };
}

function luminanceOf(c: Color): number {
  const n = parseInt(c.slice(1, 7), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// ---------------------------------------------------------------- sections

function palettesSheet(): Sheet {
  const sh = new Sheet('Palettes · colorRamp · colorHarmony · paletteRoles');
  const g = sh.group('palettes', W - 2 * M, 44, 'dark');
  for (const name of Object.keys(palettes) as PaletteName[]) {
    g.cells.push({ label: `${name} (${palettes[name].length})`, draw: swatches(palettes[name], true) });
  }
  const r = sh.group('colorRamp(base, 7): cool dark shadows → warm light highlights', 560, 40, 'dark');
  for (const base of ['#ff5d73', '#ffc93c', '#3fbf6f', '#3fa7f5', '#b57bff', '#8b93a3', '#e07a5f', '#2ec4b6']) {
    r.cells.push({ label: base, draw: swatches(colorRamp(base, 7)) });
  }
  const hm = sh.group('colorHarmony(#3fa7f5, kind)', 360, 40, 'dark');
  for (const k of ['complementary', 'analogous', 'triadic', 'split', 'tetradic', 'monochrome'] as ColorHarmonyKind[]) {
    hm.cells.push({ label: k, draw: swatches(colorHarmony('#3fa7f5', k, { count: 5 })) });
  }
  const roles = sh.group('paletteRoles (casual palettes curated, others derived)', 560, 64, 'dark');
  for (const name of ['sunny', 'jelly', 'cozy', 'pico8', 'endesga32', 'sweetie16'] as PaletteName[]) {
    const pr = paletteRoles(name);
    roles.cells.push({
      label: name,
      draw: (ctx, x, y, w, h) => {
        const keys = Object.keys(pr) as (keyof PaletteRoles)[];
        const sw = w / keys.length;
        keys.forEach((k, i) => {
          ctx.fillStyle = pr[k];
          ctx.fillRect(x + i * sw, y, Math.ceil(sw), h);
          ctx.save();
          ctx.translate(x + i * sw + sw / 2, y + h - 4);
          ctx.rotate(-Math.PI / 2);
          ctx.font = `10px ${HEADLESS_FONT}`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillStyle = luminanceOf(pr[k]) > 0.55 ? '#1a1c2c' : '#ffffff';
          ctx.fillText(k, 0, 0);
          ctx.restore();
        });
      },
    });
  }
  return sh;
}

function iconsSheet(): Sheet {
  const sh = new Sheet(`Icons (${iconNames.length}) · 24×24 grid · currentColor`);
  const big = sh.group('iconTexture(name, { size: 56 }) white on dark', 92, 76, 'dark');
  for (const n of iconNames) big.cells.push({ label: n, tex: iconTexture(n, { size: 56, resolution: 2 }) });
  const small = sh.group('24 px, gold', 60, 40, 'dark');
  for (const n of iconNames) small.cells.push({ label: n, tex: iconTexture(n, { size: 24, color: '#ffd23f', resolution: 2 }) });
  const light = sh.group('40 px, ink on light', 60, 56, 'light');
  for (const n of iconNames) light.cells.push({ label: n, tex: iconTexture(n, { size: 40, color: '#1f2440', resolution: 2 }) });
  return sh;
}

const SHAPE_FILLS: Partial<Record<ArtShape, ArtShapeOptions>> = {
  star: { fill: '#ffc93c' },
  polygon: { fill: '#3fbf6f' },
  heart: { fill: '#ff5d73' },
  gem: { fill: '#4dabf7' },
  coin: { fill: '#ffc93c' },
  blob: { fill: '#b57bff', seed: 3 },
  cloud: { fill: '#ffffff' },
  leaf: { fill: '#63c75a' },
  drop: { fill: '#3fa7f5' },
  bolt: { fill: '#ffd43b' },
  arrow: { fill: '#3fbf6f' },
  bubble: { fill: '#ffffff' },
  ribbon: { fill: '#ff5d73' },
  shield: { fill: '#748ffc' },
  badge: { fill: '#ff9f1c' },
  rays: { fill: '#ffe066' },
  sparkle: { fill: '#fff3a0' },
  burst: { fill: '#ff7a45' },
  moon: { fill: '#ffe066' },
  circle: { fill: '#2ec4b6' },
  roundRect: { fill: '#ff9f1c' },
  pill: { fill: '#3fa7f5' },
};

function shapesSheet(): Sheet {
  const sh = new Sheet('Shapes · shapeTexture(name, opts)');
  const casual = sh.group("casual: { stroke: 'auto', shine: true, shadow: true }", 128, 120, 'checker');
  for (const n of artShapes) {
    const o = SHAPE_FILLS[n] ?? {};
    const size = n === 'ribbon' || n === 'arrow' || n === 'pill' || n === 'bubble' ? { width: 120, height: 84 } : { size: 110 };
    casual.cells.push({ label: n, tex: shapeTexture(n, { ...size, ...o, stroke: 'auto', shine: true, shadow: true, resolution: 2 }) });
  }
  const flat = sh.group('flat fill + shade: true', 92, 92, 'checker-light');
  for (const n of artShapes) {
    const o = SHAPE_FILLS[n] ?? {};
    flat.cells.push({ label: n, tex: shapeTexture(n, { size: 84, ...o, shade: true, resolution: 2 }) });
  }
  const v = sh.group('variants', 128, 110, 'checker');
  const add = (label: string, n: ArtShape, o: Parameters<typeof shapeTexture>[1]) =>
    v.cells.push({ label, tex: shapeTexture(n, { size: 100, stroke: 'auto', shine: true, ...o, resolution: 2 }) });
  add('star points:4', 'star', { points: 4, inner: 0.45, fill: '#ffd43b' });
  add('star points:6', 'star', { points: 6, inner: 0.6, fill: '#ff9f1c' });
  add('star radius:8', 'star', { radius: 8, fill: '#ffc93c' });
  add('polygon sides:3', 'polygon', { sides: 3, fill: '#ff5d73' });
  add('polygon sides:8', 'polygon', { sides: 8, fill: '#748ffc' });
  add('arrow up', 'arrow', { direction: 'up', fill: '#3fbf6f' });
  add('arrow left', 'arrow', { direction: 'left', fill: '#3fa7f5', width: 110, height: 80 });
  add("bubble tail:right", 'bubble', { tail: 'right', fill: '#fff7e6', width: 120, height: 90 });
  add('blob seed:1', 'blob', { seed: 1, fill: '#8ce99a' });
  add('blob seed:9', 'blob', { seed: 9, wobble: 0.35, fill: '#f783ac' });
  add('cloud seed:4', 'cloud', { seed: 4, fill: '#eaf6ff', width: 120, height: 80 });
  add('fill: [a, b]', 'heart', { fill: ['#ff9ab0', '#e03060'] });
  add('radial fill', 'circle', { fill: { type: 'radial', colors: ['#fff6b0', '#ffb12b', '#e0761c'] } });
  add('linear 0°', 'roundRect', { fill: { type: 'linear', colors: ['#b57bff', '#3fa7f5'], angle: 0 } });
  add('shadow blur', 'gem', { fill: '#2ec4b6', shadow: { blur: 8, y: 5, color: 'rgba(0,0,0,0.5)' } });
  add('no details', 'coin', { fill: '#ffc93c', details: false });
  return sh;
}

function pixelSheet(): Sheet {
  const sh = new Sheet('Pixel art · pixelSprite(rows, palette, opts)');
  const a = sh.group("{ scale: 8, outline: '#1a1c2c', shade: true }", 130, 130, 'checker');
  for (const [n, rows] of Object.entries(pixelSamples)) {
    a.cells.push({ label: n, tex: pixelSprite(rows, pixelPalette, { scale: 8, outline: '#1a1c2c', shade: true }), pixelated: true });
  }
  const b = sh.group('raw { scale: 8 }', 130, 130, 'checker');
  for (const [n, rows] of Object.entries(pixelSamples)) {
    b.cells.push({ label: n, tex: pixelSprite(rows, pixelPalette, { scale: 8 }), pixelated: true });
  }
  const c = sh.group("outlineMode: 'square', white outline", 130, 130, 'dark');
  for (const [n, rows] of Object.entries(pixelSamples)) {
    c.cells.push({
      label: n,
      tex: pixelSprite(rows, pixelPalette, { scale: 8, outline: '#ffffff', outlineMode: 'square' }),
      pixelated: true,
    });
  }
  const f = sh.group('pixelFrames(coinFrames) → frames padded to one size', 100, 100, 'checker');
  pixelFrames(coinFrames, pixelPalette, { scale: 8, outline: '#1a1c2c', shade: true }).forEach((t, i) =>
    f.cells.push({ label: `coin #${i} ${t.width}x${t.height}`, tex: t, pixelated: true }),
  );
  const m = sh.group("mirrorX: 'odd' from a left half + default pico8 palette", 130, 130, 'checker');
  m.cells.push({
    label: 'invader (mirrorX odd)',
    tex: pixelSprite(['..b...', '...b..', '..bbbb', '.bb.bb', 'bbbbbb', 'b.bbbb', 'b.b...', '...bb.'].map((r) => r.slice(0, 6)), { b: '#8ce99a' }, {
      scale: 8,
      mirrorX: 'odd',
      outline: '#1a1c2c',
    }),
    pixelated: true,
  });
  m.cells.push({
    label: 'pico8 hex keys',
    tex: pixelSprite(`
      ..8888..
      .88ee88.
      8877e788
      88888888
      .8.88.8.
    `, undefined, { scale: 8, shade: true, outline: '#000000' }),
    pixelated: true,
  });
  return sh;
}

function svgSheet(): Sheet {
  const sh = new Sheet('SVG · svgTexture(markup, { width, height })');
  const a = sh.group('sandbox sprites', 260, 170, 'checker');
  for (const [n, svg] of Object.entries(svgSamples)) a.cells.push({ label: n, tex: svgTexture(svg, { height: 150, resolution: 2 }) });
  const b = sh.group('feature coverage', 180, 180, 'checker');
  for (const [n, svg] of Object.entries(svgFeatureSamples)) {
    b.cells.push({ label: n, tex: svgTexture(svg, { width: 170, height: 170, resolution: 2 }) });
    const warn = parseSvg(svg).warnings;
    if (warn.length) sh.notes.push(`${n}: ${warn.join('; ')}`);
  }
  return sh;
}

async function svgFileSheet(file: string): Promise<Sheet> {
  const markup = await readFile(file, 'utf8');
  const doc = parseSvg(markup);
  const sh = new Sheet(`${basename(file)} · intrinsic ${+doc.width.toFixed(1)}×${+doc.height.toFixed(1)}`);
  const sizes = [32, 64, 128, 256];
  for (const bg of ['checker', 'dark', 'light'] as Bg[]) {
    const g = sh.group(`background: ${bg}`, 270, 270, bg);
    for (const s of sizes) {
      const scale = s / Math.max(doc.width, doc.height);
      g.cells.push({ label: `${Math.round(doc.width * scale)}×${Math.round(doc.height * scale)}`, tex: svgTexture(markup, { width: doc.width * scale, height: doc.height * scale, resolution: 1 }) });
    }
  }
  sh.notes.push(doc.warnings.length ? `warnings: ${doc.warnings.join('; ')}` : 'no unsupported features detected');
  return sh;
}

function noiseSheet(): Sheet {
  const sh = new Sheet('Noise · noiseTexture · patternTexture');
  const k = sh.group('noiseTexture(128, 128, { kind, scale: 32, octaves: 4 })', 140, 140, 'dark');
  for (const kind of ['value', 'perlin', 'simplex', 'worley'] as const) {
    k.cells.push({ label: kind, tex: noiseTexture(128, 128, { kind, seed: 3, octaves: kind === 'worley' ? 1 : 4 }) });
  }
  k.cells.push({ label: "mode: 'ridged'", tex: noiseTexture(128, 128, { seed: 3, mode: 'ridged', octaves: 5 }) });
  k.cells.push({ label: "mode: 'turbulence'", tex: noiseTexture(128, 128, { seed: 3, mode: 'turbulence', octaves: 5 }) });
  k.cells.push({ label: "ramp: 'ocean'", tex: noiseTexture(128, 128, { seed: 5, ramp: 'ocean', octaves: 5 }) });
  k.cells.push({ label: 'terrain ramp, steps: 6', tex: noiseTexture(128, 128, { seed: 8, scale: 48, octaves: 5, steps: 6, ramp: ['#1b4f9c', '#3fa7f5', '#f2cc8f', '#63c74d', '#2f7d3a', '#8b93a3', '#ffffff'] }) });
  const p = sh.group('patternTexture(name, { width: 128 })', 140, 140, 'checker');
  for (const n of patternNames) p.cells.push({ label: n, tex: patternTexture(n, { width: 128, height: 128, seed: 2 }) });
  const t = sh.group('tiling check: 2×2 copies (seams would show as lines)', 200, 200, 'dark');
  const tiled = (tex: Texture) => (ctx: Ctx2D, x: number, y: number, w: number, h: number) => {
    const s = Math.min(w, h) / 2;
    for (let i = 0; i < 4; i++) tex.draw(ctx, x + (i % 2) * s, y + Math.floor(i / 2) * s, s, s);
  };
  for (const n of ['grass', 'water', 'stone', 'wood', 'bricks', 'sand', 'clouds', 'starfield', 'stripes', 'dots'] as const) {
    t.cells.push({ label: n, draw: tiled(patternTexture(n, { width: 96, height: 96, seed: 4 })) });
  }
  t.cells.push({ label: 'noise tileable', draw: tiled(noiseTexture(96, 96, { seed: 2, scale: 24, tileable: true, ramp: 'forest', steps: 5 })) });
  return sh;
}

function creaturesSheet(): Sheet {
  const sh = new Sheet('Creatures · creatureTexture({ seed, body, color, eyes, mouth, cheeks, accessory })');
  const s = sh.group('seeds 1–18 (everything picked by seed)', 130, 130, 'checker-light');
  for (let i = 1; i <= 18; i++) s.cells.push({ label: `seed ${i}`, tex: creatureTexture({ seed: i, size: 124, resolution: 2 }) });
  const e = sh.group('eyes / mouths / bodies / accessories', 110, 110, 'checker-light');
  for (const eyes of ['dot', 'round', 'happy', 'sleepy', 'wink', 'angry', 'sparkle', 'cyclops'] as const) {
    e.cells.push({ label: `eyes ${eyes}`, tex: creatureTexture({ body: 'round', color: '#4dabf7', eyes, mouth: 'smile', accessory: 'none', size: 104, resolution: 2 }) });
  }
  for (const mouth of ['smile', 'open', 'cat', 'flat', 'o', 'fang'] as const) {
    e.cells.push({ label: `mouth ${mouth}`, tex: creatureTexture({ body: 'square', color: '#ffa94d', eyes: 'round', mouth, accessory: 'none', size: 104, resolution: 2 }) });
  }
  for (const body of ['blob', 'round', 'square', 'bean'] as const) {
    e.cells.push({ label: `body ${body}`, tex: creatureTexture({ body, color: '#8ce99a', eyes: 'round', mouth: 'smile', accessory: 'none', cheeks: true, size: 104, resolution: 2 }) });
  }
  for (const accessory of ['leaf', 'crown', 'bow', 'hat', 'horns', 'antenna'] as const) {
    e.cells.push({ label: accessory, tex: creatureTexture({ body: 'round', color: '#f783ac', eyes: 'round', mouth: 'smile', accessory, size: 104, resolution: 2 }) });
  }
  const opts = { seed: 5, body: 'blob' as const, color: '#66d9e8', eyes: 'round' as const, mouth: 'open' as const, accessory: 'leaf' as const, size: 104, resolution: 2 };
  for (const [anim, n] of [['idle', 8], ['squash', 8], ['bounce', 8], ['blink', 8]] as const) {
    const g = sh.group(`creatureFrames(opts, '${anim}', ${n})`, 110, 110, 'checker-light');
    creatureFrames(opts, anim, n).forEach((t, i) => g.cells.push({ label: `#${i}`, tex: t }));
  }
  return sh;
}

function effectsSheet(): Sheet {
  const sh = new Sheet('Effects (bake-time)');
  const base = creatureTexture({ seed: 2, body: 'round', color: '#ffa94d', eyes: 'round', mouth: 'smile', accessory: 'crown', size: 110, resolution: 2 });
  const star = shapeTexture('star', { size: 100, fill: '#ffc93c', stroke: 'auto', resolution: 2 });
  const slime = pixelSprite(pixelSamples.slime!, pixelPalette, { scale: 6, outline: '#1a1c2c', shade: true });
  const g = sh.group('texture effects', 150, 150, 'checker');
  g.cells.push({ label: 'original', tex: base });
  g.cells.push({ label: "tint fill #ff3b3b .6", tex: tintTexture(base, '#ff3b3b', { mode: 'fill', amount: 0.6 }) });
  g.cells.push({ label: "tint multiply #7ad0ff", tex: tintTexture(base, '#7ad0ff', { mode: 'multiply' }) });
  g.cells.push({ label: 'silhouetteTexture', tex: silhouetteTexture(base, '#1a1c2c') });
  g.cells.push({ label: 'outlineTexture white 4', tex: outlineTexture(base, { color: '#ffffff', width: 4 }) });
  g.cells.push({ label: 'dropShadowTexture', tex: dropShadowTexture(base, { blur: 8, y: 6 }) });
  g.cells.push({ label: 'glowTexture', tex: glowTexture(star, { color: '#fff08a', blur: 14, strength: 3 }) });
  g.cells.push({ label: 'flipTexture x', tex: flipTexture(base, 'x') });
  g.cells.push({ label: 'flipTexture y', tex: flipTexture(base, 'y') });
  const p = sh.group('pixel sprite: recolor (palette swap) and resample', 150, 150, 'checker');
  p.cells.push({ label: 'slime', tex: slime, pixelated: true });
  const green = pixelPalette.g!;
  p.cells.push({
    label: 'recolor g→blue',
    tex: pixelSprite(pixelSamples.slime!, { ...pixelPalette, g: '#4dabf7' }, { scale: 6, outline: '#1a1c2c', shade: true }),
    pixelated: true,
  });
  p.cells.push({ label: `recolorTexture ${green}→#b57bff`, tex: recolorTexture(pixelSprite(pixelSamples.slime!, pixelPalette, { scale: 6 }), { [green]: '#b57bff' }), pixelated: true });
  p.cells.push({ label: 'resampleTexture x2 (crisp)', tex: resampleTexture(pixelSprite(pixelSamples.heart!, pixelPalette, { scale: 3, outline: '#1a1c2c' }), 2), pixelated: true });
  p.cells.push({ label: 'outlineTexture (pixel) 3', tex: outlineTexture(slime, { color: '#ffffff', width: 3 }), pixelated: true });
  return sh;
}

function atlasSheet(): Sheet {
  const sh = new Sheet('TextureAtlas · skyline packing');
  const atlas = new TextureAtlas({ width: 512, height: 512, padding: 2, register: false });
  const shapes = artShapes.filter((s) => s !== 'rays');
  let i = 0;
  for (const n of iconNames) atlas.addTexture(`icon-${n}`, iconTexture(n, { size: 32 + (i++ % 3) * 12, color: '#ffffff' }));
  shapes.forEach((n, k) => {
    const w = 40 + ((k * 37) % 50);
    const h = 36 + ((k * 53) % 44);
    atlas.add(`shape-${n}`, w, h, (ctx, ww, hh) =>
      drawArtShape(ctx, n, 3, 3, ww - 6, hh - 6, { ...(SHAPE_FILLS[n] ?? {}), stroke: 'auto' }),
    );
  });
  for (let c = 0; c < 6; c++) atlas.addTexture(`creature-${c}`, creatureTexture({ seed: c + 1, size: 64 + c * 8 }));
  const g = sh.group(`${atlas.list().length} entries on ${atlas.pages.length} page(s), occupancy ${(atlas.occupancy * 100).toFixed(0)}%`, 520, 520, 'checker');
  atlas.pages.forEach((_, p) =>
    g.cells.push({
      label: `page ${p}`,
      draw: (ctx, x, y) => {
        atlas.pageTexture(p).draw(ctx, x + 4, y + 4);
        ctx.strokeStyle = 'rgba(255,80,120,0.5)';
        ctx.lineWidth = 1;
        for (const e of atlas.list()) if (e.page === p) ctx.strokeRect(x + 4 + e.x + 0.5, y + 4 + e.y + 0.5, e.w - 1, e.h - 1);
      },
    }),
  );
  return sh;
}

// ---------------------------------------------------------------- main

const SECTIONS: Record<string, () => Sheet> = {
  palettes: palettesSheet,
  icons: iconsSheet,
  shapes: shapesSheet,
  pixel: pixelSheet,
  svg: svgSheet,
  noise: noiseSheet,
  creatures: creaturesSheet,
  effects: effectsSheet,
  atlas: atlasSheet,
};

async function save(sheet: Sheet, file: string): Promise<void> {
  const path = resolve(file);
  await mkdir(dirname(path), { recursive: true });
  const t0 = Date.now();
  const png = sheet.render();
  await writeFile(path, png);
  console.log(`art: ${path} (${Math.round(png.length / 1024)} KB, ${Date.now() - t0} ms)`);
  for (const n of sheet.notes) console.log(`  note: ${n}`);
}

async function main() {
  const argv = process.argv.slice(2);
  let only: string[] | null = null;
  let svgFile: string | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = () => {
      const val = argv[++i];
      if (val === undefined) throw new Error(`missing value for ${k}`);
      return val;
    };
    if (k === '--only') only = [...(only ?? []), ...v().split(/[\s,]+/).filter(Boolean)];
    else if (k === '--svg') svgFile = v();
    else if (k === '--out') out = v();
    else throw new Error(`unknown option ${k} (use --only <${Object.keys(SECTIONS).join('|')}>, --svg <file>, --out <file>)`);
  }
  setPlatform(new HeadlessPlatform());
  if (svgFile) {
    const name = basename(svgFile).replace(/\.svg$/i, '');
    await save(await svgFileSheet(svgFile), out ?? `.shots/art-svg-${name}.png`);
    if (!only) return;
  }
  const list = only ?? Object.keys(SECTIONS);
  for (const s of list) {
    const make = SECTIONS[s];
    if (!make) throw new Error(`unknown section "${s}" (have: ${Object.keys(SECTIONS).join(', ')})`);
    await save(make(), out && list.length === 1 ? out : `.shots/art-${s}.png`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
