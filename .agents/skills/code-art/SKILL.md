---
name: code-art
description: Creates game art entirely in code with the engine's art module and reviews it visually - SVG markup to textures (svgTexture), 22 styled shapes (shapeTexture), 46 vector icons (iconTexture, registerIcons), text pixel art (pixelSprite, pixelFrames), procedural creatures, palettes and hue-shifted color ramps (paletteRoles, colorRamp), noise and seamless patterns, texture effects (outline, glow, drop shadow, tint, recolor), custom painters baked with bakeTexture, TextureAtlas, and review loops with pnpm art:preview, gallery scenes and screenshots. Use when a game needs sprites, characters, items, backgrounds, icons, logos, particles or any visual asset without image files, when art looks blurry, flat, inconsistent or off-palette, or when reviewing art ("art", "sprite", "graphics", "draw", "icon", "pixel art", "SVG", "texture", "palette", "background", "美术", "画", "图标", "像素画", "贴图", "素材", "配色", "背景").
---

# Code art

No image files needed: every texture below is generated at boot, registered by key and drawn with
`new Sprite('key')`. Everything is exported from `'@engine'` (source `engine/art/`, `engine/gfx/texture.ts`).
Worked example: the Suika fruits (`game/art/fruit-bodies.ts` painters, `game/art/fruit-art.ts` baking + live
faces, `game/scenes/gallery.ts` review scene). Toolkit showcase: sandbox scene `art-gallery` (`sandbox/scenes/art.ts`).

## Workflow

1. **Pick a palette and roles first.** `paletteRoles('sunny')` (curated for `sunny`, `jelly`, `cozy`; derived
   for the others) gives `background surface outline text primary secondary accent success warning danger
   highlight shadow`. Shade every base color with `colorRamp(base, 5)` (darkest to lightest, base in the middle,
   hue-shifted shadows); use ramp[0] or `hueShade(base, -0.6)` for outlines. One light direction (upper left).
2. **Choose the cheapest tool that looks right** (table below). Prefer shapes/icons/SVG for UI and items,
   painters (`bakeTexture`) for hero objects, `pixelSprite` for retro, `creatureTexture` for instant characters.
3. **Bake once at boot, at display size, `resolution: 2`**, registered under a key (`key` option or
   `textures.set`). Never bake inside `update()`/`draw()`; scaling a small bake up blurs it.
4. **Review by looking**: `pnpm art:preview --only shapes,icons` or a gallery scene +
   `pnpm shot --app <app> --scene gallery`, then Read the PNGs. Check silhouettes on dark and light
   backgrounds, readability at real size, and that the set shares outline width, light and palette.
5. Test what matters for gameplay (texture size, silhouette vs physics body) like `game/art/fruit-art.test.ts`.

| Need | Use |
|---|---|
| Logo, item, UI art you can describe as vector | `svgTexture(markup, { width, resolution, key })` |
| Star, coin, gem, heart, cloud, bubble, ribbon, badge, burst... | `shapeTexture(shape, { size, fill, stroke: 'auto', shine, shadow })` |
| UI/system icon (play, coin, lock, trophy...) | `iconTexture(name, { size, color })` |
| Retro sprite, tiles, frame animation | `pixelSprite(rows, palette, { scale, outline, shade, mirrorX })`, `pixelFrames` |
| Cute character / enemy in one line | `creatureTexture({ seed, body, eyes, accessory })`, `creatureFrames(opts, 'idle', 8)` |
| Ground, water, wood, sky, stars, noise backdrop | `patternTexture(name, { width, height, size, seed })`, `noiseTexture(w, h, { ramp, steps, tileable })` |
| Hero object with custom look | painter `(ctx, ...) => void` + `bakeTexture(w, h, draw, { resolution: 2 })` |
| Same art in several colours (team colours, ink on light buttons, locked grey) | `tintTexture`, `duotoneTexture`, `Sprite.tint`, `ui.icon(key, { tint / duotone })` (below) |
| Variants of an existing texture | `outlineTexture`, `glowTexture`, `dropShadowTexture`, `silhouetteTexture`, `recolorTexture`, `flipTexture` |
| Many small textures | `TextureAtlas` (`atlas.add(key, w, h, draw)`) |

## Bake at boot

```ts
import { AnimatedSprite, creatureFrames, iconTexture, patternTexture, pixelSprite, shapeTexture, Sprite, svgTexture, TilingSprite, type Node } from '@engine';

const LOGO = `<svg viewBox="0 0 200 80"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#ff9f1c"/></linearGradient></defs>
  <rect x="4" y="4" width="192" height="72" rx="36" fill="url(#g)" stroke="#7a3e00" stroke-width="6"/></svg>`;

const HERO = ['..kkk', '.kbbb', 'kbwbk', 'kbbbb', '.kbbb', '..k.k'];

export function bakeArt(): void {
  const res = 2;
  svgTexture(LOGO, { width: 400, resolution: res, key: 'logo' });
  shapeTexture('star', { size: 96, fill: '#ffc93c', stroke: 'auto', shine: true, shadow: true, resolution: res, key: 'star' });
  shapeTexture('gem', { size: 72, fill: ['#8fdcff', '#3fa7f5'], stroke: 'auto', resolution: res, key: 'gem' });
  iconTexture('lock', { size: 64, color: '#1f2440', resolution: res, key: 'lock' });
  patternTexture('grass', { width: 256, height: 256, size: 32, seed: 3, key: 'bg:grass' });
  pixelSprite(HERO, { k: '#1f2440', b: '#3fa7f5', w: '#ffffff' }, { scale: 8, mirrorX: 'odd', shade: true, key: 'hero' });
  creatureFrames({ seed: 4, body: 'blob', color: '#8ce99a', size: 128, resolution: res, key: 'slime' }, 'idle', 8);
}

// later, in a scene's onEnter (bakeArt() ran in the app's boot()):
export function placeArt(scene: Node): void {
  scene.add(new TilingSprite('bg:grass', scene.width, scene.height));
  scene.add(new Sprite('star', { x: 375, y: 300, anchor: 0.5 }));
  scene.add(new AnimatedSprite(['slime#0', 'slime#1', 'slime#2', 'slime#3', 'slime#4', 'slime#5', 'slime#6', 'slime#7'], { fps: 10, x: 375, y: 700, anchor: 0.5 }));
}
```

Which calls register what: `svgTexture`, `shapeTexture`, `iconTexture`, `pixelSprite`, `creatureTexture`,
`noiseTexture`, `patternTexture` register under `key`; `pixelFrames` / `creatureFrames` also register
`key#0..n-1`; `TextureAtlas.add` registers by default. **`bakeTexture(..., { key })` does NOT register** (it
only names the texture): use `textures.set(key, tex)` or `textures.getOrCreate(key, () => bakeTexture(...))`.

## Painters (the fruit pattern)

Write a pure function that draws centred at (0, 0) for a size parameter, then bake it once. Keep the main
silhouette exactly the gameplay shape (the fruit disc equals the physics circle; stems may stick out, so the
texture is padded) and share helpers (outline width, highlight, rim shade) across the set so it matches.

```ts
import { bakeTexture, colorRamp, textures, type Ctx2D, type Texture } from '@engine';

function paintOrb(ctx: Ctx2D, r: number, base: string): void {
  const [dark, shade, mid, light, hi] = colorRamp(base, 5) as [string, string, string, string, string];
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, light);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, shade);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.strokeStyle = dark;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-r * 0.35, -r * 0.45, r * 0.28, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = hi;
  ctx.globalAlpha = 0.8;
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function orbTexture(base: string, r = 40): Texture {
  const pad = 1.15;
  return textures.getOrCreate(`orb:${base}:${r}`, () =>
    bakeTexture(2 * r * pad, 2 * r * pad, (ctx, w, h) => {
      ctx.translate(w / 2, h / 2);
      paintOrb(ctx, r, base);
    }, { resolution: 2 }),
  );
}
```

Things that change every frame (eyes blinking, squash, expressions) are drawn live on top of the baked body in
the node's `draw(ctx)`, like `FruitNode` does with `drawFruitFace`. Keep live drawing to a few paths.

Use only the portable Canvas subset (`engine/gfx/types.ts`): paths, arc/arcTo/ellipse/bezier, linear/radial
gradients, shadows, `globalCompositeOperation`, `drawImage`, text, `get/putImageData`. No `Path2D`,
`ctx.filter`, `ctx.roundRect`, conic gradients or DOM APIs (they break on WeChat/Douyin/headless).

## Tinting and recolouring textures

Paint neutral art once (white or light grey on transparent, details in darker greys) and recolour it instead of
baking one copy per colour by hand. Source `engine/gfx/tint.ts`, demo scene `art-tint` (`sandbox/scenes/art.ts`).

```ts
import { duotoneTexture, Sprite, tintTexture, ui } from '@engine';

tintTexture('art:skull', '#e03131');                          // multiply: white -> colour, shading and dark details kept
tintTexture(hero, '#1e1e22', { mode: 'fill' });               // flat silhouette, alpha kept (locked / shadow)
tintTexture(hero, '#ffffff', { mode: 'fill', amount: 0.6 });  // 60 % white flash
duotoneTexture('art:skull', '#d9d9de', '#1e1e22');            // black -> dark, white -> light: ink on a light button

new Sprite('enemy', { tint: '#4dabf7' });                     // or sprite.tint = '#4dabf7' / null; tintMode: 'fill'
ui.icon('art:skull', { size: 30, tint: 'danger' });           // theme tokens resolve; tintMode like Sprite
ui.icon('art:gear', { size: 40, duotone: ['surface', 'text'] });   // [dark, light]; ui.image takes the same props
```

- **Modes**: `'multiply'` (default) multiplies every colour by the tint, keeps alpha and shading; black stays
  black. `'fill'` paints the tint over the opaque pixels (a silhouette at `amount` 1). `amount` (0..1) and the
  colour's own alpha fade the effect in. `duotoneTexture` maps Rec. 601 brightness black -> `dark`,
  white -> `light` (alpha kept, scaled by the colours' alpha): the tool for white art on light buttons, where
  multiply would leave painted holes black.
- **Cache**: results are cached per source Texture object + params (a WeakMap, so nothing leaks with the source)
  and baked at the source's resolution (`resolution` overrides, `'auto'` allowed). Re-registering a key
  (`textures.set`) gives a new Texture, so the next call bakes a fresh tint. Keep up to 16 variants per source:
  baking a 17th releases the oldest (its canvas shrinks to 1x1), so a Texture you stored from `tintTexture`
  goes blank if 16 newer colours of the same source were baked after it (and `Sprite.tint` with more colours
  than that re-bakes constantly). For more colours of one art, bake them once with `bakeTexture` into your own
  keys (`textures.set`). Every distinct colour
  is a separate canvas, so do not animate `tint` through many colours (flash with `alpha`, a fixed `fill` tint
  or a second sprite). `clearTintCache()` forgets everything (tests, theme switch; `game.memoryWarning()`).
  A white multiply (or `amount` 0) returns the source itself.
- **Keys**: strings resolve through `textures`; an unregistered key returns a 1x1 transparent placeholder named
  `missing:<key>` (not cached). Widgets resolve the key themselves, so `ui.icon(key, { tint })` keeps the glyph
  fallback and the `missing-texture` lint; prefer that over `ui.icon(tintTexture(key, ...))`.
- **Memory**: each variant costs what its source costs (`textureStats()` lists them as
  `tint:<key>~<color>[~fill][~amount][@<res>x]` and `duotone:<key>~<dark>~<light>`).
- **Runtimes**: multiply bakes with `globalCompositeOperation` ('multiply' then 'destination-in'), fill with
  'source-atop'; where 'multiply' is missing (probed once, `tintMultiplySupported()`) it falls back to a
  getImageData loop. Duotone always reads pixels at bake time. `method: 'pixels'` forces the loop (exact colours
  on semi-transparent edges, where the composite path lightens dark soft edges slightly).
- Dumps and selectors: `Sprite[tint=#ff0000]`, `Sprite[tintMode=fill]`, `Icon[duotone=surface/text]`.

## SVG

`svgTexture` supports paths, basic shapes, groups/transforms, `<use>`, linear/radial gradients, `clipPath`,
`<style>` class/id/tag rules, `currentColor` (`color` option) and `<text>`. Not supported (skipped with a
warning): `mask`, `pattern`, `image`, `marker`, `foreignObject`, `textPath`, animation elements; filters are only
approximated as drop shadows. Check a file with `pnpm art:preview --svg path/to/file.svg` (sizes, backgrounds,
warnings) or `parseSvg(markup).warnings`. Results are cached by markup + size + resolution + color.

## Review loop

```powershell
pnpm art:preview                                  # .shots/art-<section>.png for every section
pnpm art:preview --only "shapes,icons,palettes"   # quote comma lists in PowerShell
pnpm art:preview --svg game/art/logo.svg
pnpm shot --app game --scene gallery --device iphone-14
```

Sections: `palettes icons shapes pixel svg noise creatures effects atlas`. For your own game, add a `gallery`
scene that shows every asset at real size, all states side by side, on the real background (see
`game/scenes/gallery.ts`), and Read its screenshot after each art change. Look for: blur (baked too small or
`resolution: 1`), jaggies, outlines of different widths, mismatched light direction, colors outside the palette,
details lost at real size, silhouettes that don't match hit/physics shapes.

## Pitfalls

- `bakeTexture` `key` does not register (see above). A `new Sprite('x')` on an unregistered key throws with the
  list of registered keys.
- Textures from `svgTexture`/`shapeTexture`/`iconTexture` are cached and shared; effects return new textures,
  so never draw into a returned texture's source.
- `pixelSprite` is not cached and throws on characters missing from the palette (`.` and space are
  transparent); build it once at boot.
- `registerIcons()` with the default `icon:` prefix replaces the UI kit's built-in glyphs in every button
  (drawn untinted). Use `registerIcons({ prefix: 'art:' })` unless that is intended (see the `ui-screens` skill).
- Effects (`outlineTexture`, `glowTexture`, `recolorTexture`...) read pixels: bake them once, not per frame.
  `tintTexture` / `duotoneTexture` are cached, so calling them in `draw()` is fine for a few fixed colours.
- Pass `seed` to `creatureTexture`, `shapeTexture('blob' | 'cloud' | 'burst')`, `noiseTexture`, `patternTexture`
  so art is identical across runs, tests and screenshots.
- Texture memory and `resolution` trade-offs (including the adaptive resolution option and texture stats) are
  covered by the `performance` skill; read it before baking many large textures.

Full option lists (shapes, icons, palettes, patterns, noise, effects, creatures, atlas): `references/catalog.md`.
