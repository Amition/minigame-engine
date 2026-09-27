# Art catalog

All functions are exported from `'@engine'`. Every texture generator accepts `resolution` (backing-store
multiplier, default 1) and most accept `key` (register in `textures`). Sources: `engine/art/*.ts`.

## Shapes: `shapeTexture(shape, opts)` / `drawArtShape(ctx, shape, x, y, w, h, opts, pixelScale?)`

Shapes (22, `artShapes`): `star polygon heart gem coin blob cloud leaf drop bolt arrow bubble ribbon shield
badge rays sparkle burst moon circle roundRect pill`.

Style: `fill` (color, color list = vertical gradient, or `{ type: 'linear' | 'radial', colors, angle }`),
`stroke` (color or `'auto'` = darker hue-shifted fill), `strokeWidth`, `shade` (soft top-light/bottom-dark from
one color), `shine` (`true`, `'spot'`, `'band'` or highlight alpha), `shadow` (`true` or `{ color, x, y, blur }`),
`details` (gem facets, coin face, leaf vein, ribbon folds; default true).

Params: `points` (star/sparkle/burst/rays/badge), `inner` (star/burst inner radius fraction), `sides`
(polygon), `radius` (corner rounding), `rotation` (degrees), `seed` (blob/cloud/burst variation), `wobble`
(blob 0..1), `direction` (arrow: right/left/up/down), `tail` (bubble: left/right/center/none).

Size: `size` (square, default 64) or `width`/`height`; the shape is inset so outline and shadow fit. Cached by
options. `drawArtShape` draws the same styled shape directly (inside painters or atlas entries).

## Icons: `iconTexture(name, { size: 48, color: '#ffffff', resolution, key })`

46 names (`iconNames`): `play pause stop settings home back forward chevron-left chevron-right close check plus
minus restart sound-on sound-off music music-off vibrate star star-outline heart heart-outline lock unlock coin
gem trophy crown share video-ad gift info question warning menu shop user clock lightning fire shield hint mail
rank bomb`. `iconSvg(name, color?)` returns the 24x24 SVG markup. `registerIcons({ prefix, names, size, color,
resolution })` registers `${prefix}${name}` for many icons and returns the keys (default prefix `icon:` also
overrides UI glyphs of the same name).

## SVG: `svgTexture(markup, { width, height, resolution, key, color, aspect })`

One of width/height keeps the aspect ratio; default is the intrinsic size. `color` = `currentColor`, `aspect`
overrides `preserveAspectRatio` (`'none'` stretches). `drawSvg(ctx, svg, x, y, w, h, { color, opacity, aspect,
clip })` draws without baking. `svgSize(svg, w?, h?)`, `parseSvg(markup)` (`.warnings`), `clearSvgCache()`.

## Pixel art: `pixelSprite(rows, palette, opts)`

`rows`: string array or one multi-line template string (common indentation removed). Each character is a
palette key; `.` and space are transparent; unknown characters throw. Default palette: pico8 by hex digit
(`paletteMap('pico8')`: `0` black ... `7` white, `8` red ... `f` peach).

Options: `scale` (logical px per cell, default 1), `outline` (1-cell outline color), `outlineMode` (`round` |
`square`), `shade` (auto top highlight / bottom-right shadow), `mirrorX` / `mirrorY` (`true` or `'odd'` to share
the middle column/row), `padding` (transparent cells), `resolution`, `key`.

`pixelFrames(frames, palette, opts)` bakes several frames on one strip and returns one texture per frame
(padded to the largest, bottom-centred; `key#i` registered). Helpers: `pixelRows`, `mirrorRows(rows, 'x' | 'y',
odd)`, `pixelGrid`, `drawPixelGrid(ctx, grid, x, y, scale)`, `paletteMap(palette, keys?)`.

## Creatures: `creatureTexture(opts, pose?)`, `creatureFrames(opts, anim, frames = 8)`

`CreatureOptions`: `seed` (fills every option you leave out), `body` (`blob round square bean`), `color`,
`eyes` (`dot round happy sleepy wink angry sparkle cyclops`), `mouth` (`smile open cat flat o fang none`),
`cheeks`, `accessory` (`none leaf crown bow hat horns antenna`), `belly`, `size` (square, default 128),
`outline` (color), `shadow` (default true), `resolution`, `key`.
Pose: `{ bob, sx, sy, blink, look }`. Animations: `idle blink squash bounce` (`creaturePose(anim, t)`).
`drawCreature(ctx, cx, groundY, opts, pose)` draws live.

## Palettes and color

Palettes (`palettes`): `pico8 sweetie16 endesga32 gameboy grayscale pastel candy forest ocean desert neon sunny
jelly cozy`. `paletteColors(name)`, `paletteRoles(name | colors)` (curated for sunny/jelly/cozy),
`nearestColor(c, palette)` (snap to palette), `colorRamp(base, steps = 5, { hueShift, range })` (dark to light,
base in the middle), `hueShade(c, amount -1..1)`, `rampColor(ramp, t)`, `colorHarmony(c, kind, { count,
spread })` with kinds `complementary analogous triadic split tetradic monochrome`.

## Noise and patterns

`noiseTexture(w, h, { kind, seed, scale: 32, octaves, lacunarity, gain, mode, ramp, steps, tileable, normalize,
resolution, key })`: kinds `perlin value simplex worley`; modes `fbm ridged turbulence`; `ramp` = colors or a
palette name; `steps` posterizes into flat bands (cel look); `tileable` for seamless tiles.
Raw noise: `makeNoise2D(kind, seed)` returns `(x, y) => value`; `fbmNoise(noise, x, y, { octaves, mode, ... })`.

`patternTexture(name, { width: 128, height, size, colors, seed, angle, resolution, key })`: patterns
`checker stripes dots grass water wood stone bricks sand clouds starfield sky` (mostly seamless; tile exactly
when width/height are multiples of `size`). Default colors: `patternDefaults[name]`. Show with
`new TilingSprite(texOrKey, width, height, { tileScale, scrollX, scrollY })`.

## Effects (each returns a new texture; bake once)

| Function | Options |
|---|---|
| `outlineTexture(tex, { color, width: 2 })` | outline around opaque pixels |
| `glowTexture(tex, { color, blur: 10, strength })` | soft glow (texture grows by blur) |
| `dropShadowTexture(tex, { color, blur, x, y })` | shadow under the sprite |
| `tintTexture(tex, color, { amount, mode: 'fill' | 'multiply' })` | color overlay |
| `silhouetteTexture(tex, color = '#000000')` | flat shape (hit flashes, shadows, locked items) |
| `recolorTexture(tex, { '#from': '#to' }, { tolerance })` | palette swaps (team colors, skins) |
| `flipTexture(tex, 'x' | 'y' | 'xy')`, `resampleTexture(tex, scale, { smooth })` | mirror / crisp pixel upscale |
| `texturePixels(tex)` | `{ data, width, height }` RGBA for tests |

## Baking and atlases

`bakeTexture(width, height, (ctx, w, h) => ..., { resolution, key })` draws in logical units; with
`resolution` other than 1 it returns a `ScaledTexture` whose `width/height` stay logical. Does not register.

`new TextureAtlas({ width: 1024, height: 1024, padding: 2, resolution, register: true })`:
`add(key, w, h, draw)`, `addTexture(key, tex)`, `get(key)`, `has(key)`, `list()`, `pageTexture(i)`,
`occupancy`. Entries are registered under their keys by default.

Registry: `textures.set(key, tex)`, `get(key)` (throws with known keys), `tryGet`, `has`, `delete`, `keys()`,
`getOrCreate(key, create)`. Image files instead: `loadAssets({ images: { hero: 'img/hero.png' } })`.
Frame animation: `new AnimatedSprite(frames | { clip: { frames, fps, loop, next } }, { fps, loop, ... })`.
