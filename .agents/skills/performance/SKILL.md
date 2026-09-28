---
name: performance
description: Measure and fix runtime performance of games on this TypeScript Canvas 2D engine (WeChat / Douyin / TapTap mini-games and web). Covers fps and frame time (game.stats, update/render ms, worst frame), node and particle counts, texture memory (textureStats, bakeTexture resolution 'auto', atlases, releaseTexture), the headless `pnpm bench` benchmark, the debug overlay (showDebugOverlay, ?stats=1 / ?debug=1, node bounds, hit areas) and one-frame debugDraw for physics and gameplay debugging, plus mini-game budgets, costly canvas operations and a release checklist. Use when a game stutters, drops frames or overheats (性能, 卡顿, 掉帧), uses too much memory or crashes on low-end Android (内存, 贴图内存), before a release, when baking textures or picking a resolution, when adding many nodes or particles, or when you need profiling numbers or on-screen debug drawing.
---

# Performance: measure, budget, fix

Targets are memory-sensitive: low-end Android phones running WeChat / Douyin mini-games kill the process when
memory runs out and have slow CPUs for Canvas 2D. Always measure before and after a change. Three tools:

| Tool | What it tells you | Where |
| --- | --- | --- |
| `pnpm bench` | update / render ms (avg, p95, max), nodes, particles, texture MB, heap delta, headless | terminal |
| `game.stats` + `textureStats()` | the same numbers from code (tests, logs, `window.__engine`) | any code |
| `showDebugOverlay(game)` | on-screen panel with fps, worst frame, ms graph, bounds, hit areas, debugDraw | device / browser / shots |

## Budgets (mini-games, low-end Android first)

- **Package**: wx / tt main package <= 4 MB (`pnpm build --target wx` fails above it and prints a size table).
  Code-generated art and audio keep the package small; heavy assets go to subpackages.
- **Texture memory** (decoded RGBA = 4 bytes per backing pixel, `textureStats().mb`):
  aim for <= 30 MB of baked + loaded textures in total, treat 50 MB as the hard ceiling on 2-3 GB Android
  phones. The screen canvas itself is extra (1080x2400 backing = ~10 MB). Keep single canvases <= 2048 px
  per side. A 1024x1024 texture is 4 MB; baking it at resolution 2 makes it 16 MB.
- **Frame time**: 16.7 ms per frame at 60 fps includes the host's own work, so keep JS time
  (`game.stats.frameMs`, update + render) <= 8 ms on a mid phone. Worst frame (`intervalMs.max`) above
  ~50 ms is a visible hitch (usually GC from per-frame allocations, or a synchronous bake mid-game).
- **Nodes**: every drawn node costs save / transform / draw / restore. Keep drawn nodes per frame
  (`stats.drawnNodes`) under ~500-800 on low-end phones; cull off-screen content (World culls children),
  cache static groups (CacheContainer).
- **Particles**: each live particle is a draw call. Keep live particles (`stats.particles`) under ~300 in
  total; `maxParticles` defaults to 200 per emitter, lower it for ambient effects.

## Measure

### pnpm bench (headless, relative numbers)

```
pnpm bench --app game --scene play --taps random --seconds 20
pnpm bench --app sandbox --scene debug-overlay --device ipad --json
```

Options: `--app <dir>` (default: package.json `engine.app`), `--scene`, `--params '<json>'`,
`--device <name|WxH@dpr>` (default iphone-14), `--seconds 10`, `--warmup 1`, `--taps none|random`
(random taps in the lower 2/3 of the view), `--tap-every 0.8`, `--seed 1`, `--json`.
`NODE_OPTIONS=--expose-gc` makes the heap delta steadier.

It runs the scene frame by frame with `game.update(1/60)` + `game.render()` and prints update / render /
frame ms (avg, p95, max), nodes, drawn nodes, particles, texture count + MB with the five largest textures, and
the heap delta. Rendering is @napi-rs/canvas on the CPU, so **numbers are relative**: compare runs of the same
command on the same machine (before / after a change). They are not device fps. Texture MB, node and particle
counts are exact and platform independent.

### game.stats (from code)

The Game loop fills `game.stats` every frame; `update()` and `render()` are timed separately, so harnesses that
call them one by one still get numbers. Reading is cheap (summaries are computed on demand).

```ts
import { formatGameStats } from '@engine';

const s = game.stats;
s.fps;                                   // smoothed over ~0.5 s of frame intervals
s.frameMs.avg; s.frameMs.max;            // JS ms per frame (update + render), rolling 120-frame window
s.updateMs.percentile(0.95); s.renderMs.max;
s.intervalMs.max;                        // worst frame interval in the window (hitches)
s.nodes; s.drawnNodes; s.particles;      // stage nodes, nodes drawn last frame, live particles
s.textureCount; s.textureMB;             // tracked textures (process wide)
console.log(formatGameStats(s));         // one line: fps 60.0 | frame 1.20 ms (max 3.40) | ...
JSON.stringify(s.snapshot());            // plain object for logs / automation
s.reset();                               // start a fresh window (e.g. after a scene change)
```

In tests (`createTestGame`) fps follows the simulated dt (60) and ms come from `performance.now()`.
The harness draws only the last frame of each `step`/`advance` call by default, so render counts
(`renderMs.count`, `drawnNodes` per frame) need `createTestGame({ render: 'every' })`.

### textureStats (texture memory)

```ts
import { textureStats, textureMemory } from '@engine';

const t = textureStats({ top: 10 });     // { count, pixels, bytes, mb, top: [{ key, kind, width, height, bytes }] }
console.log(t.mb.toFixed(1), t.top.map((e) => `${e.key} ${e.width}x${e.height}`));
textureMemory.bytes;                     // O(1) running total
```

Tracked automatically: `bakeTexture` (kind 'baked', and everything built on it: `Graphics.bake`, `svgTexture`,
shapes, `pixelSprite`, patterns, creatures), loaded images (kind 'image', keyed by path, counted once even when
used by several keys or sheets) and textures put in the `textures` registry (atlas pages show as `page(<key>)`).
Baking again with the same `key` replaces the old entry. `textures.delete(key)` / `textures.clear()` stop
counting a source once no registered texture uses it; garbage-collected sources drop out where the runtime has
FinalizationRegistry. Canvases you create yourself: `trackTexture(canvas, 'my-key')` / `untrackTexture(canvas)`.
Not tracked: CacheContainer and TileMap chunk canvases (their size is roughly the cached area at screen
resolution).

Free a big texture right away when a scene no longer needs it (mini-game canvases are slow to be collected):

```ts
import { releaseTexture, textures } from '@engine';

releaseTexture(bigBackground);           // untrack + shrink its canvas to 1x1; nothing may draw it afterwards
textures.delete('level-3-map');          // registry textures: unregister (untracks when unused)
```

### Debug overlay

```ts
import { hideDebugOverlay, showDebugOverlay, toggleDebugOverlay } from '@engine';

showDebugOverlay(game);                                   // stats panel only (default)
showDebugOverlay(game, { stats: true, bounds: true, hits: true, corner: 'bottom-left' });
showDebugOverlay(game, { bounds: false });                // reconfigure the existing overlay
toggleDebugOverlay(game);
hideDebugOverlay(game);
```

Options: `stats` (panel: fps + worst frame, frame / update / render ms avg + max, nodes + drawn, particles,
textures + MB, CPU frame-time graph with a 16.7 ms line; default true), `bounds` (rotated content box of every
rendered node), `hits` (tap areas incl. `hitPadding` of nodes that currently receive input: invisible blockers
and too-small buttons show up at once), `draw` (debugDraw requests, default true), `corner`, `fontSize` (22),
`refresh` (panel text interval, 0.25 s).

The overlay is a `DebugOverlay` node at the top of `game.overlay`: never hit-tested (not interactive, no
interactive children), tagged `lint-ignore` + `debug` so UI lint skips it, shown in dumps as
`DebugOverlay[stats=true]...`. It draws in design space after the rest of the stage.

- Dev web builds: `?stats=1` shows the panel, `?debug=1` panel + hit areas + debugDraw, `?debug=all` adds
  bounds, `?debug=stats,bounds,hits,draw` picks parts. The entry calls `applyDebugQuery(game, location.search)`;
  `applyDebugQuery(game, launchQueryObject)` works the same with a mini-game launch query.
- In a headless shot or test: `showDebugOverlay(t.game, { hits: true })`, then `t.screenshot(...)` and Read it.
- Sandbox demo: `pnpm shot --app sandbox --scene debug-overlay --device iphone-se,iphone-14,ipad --lint`.

### debugDraw (one-frame debug drawing)

Like Excalibur's `ex.Debug`: call it from `update()`, systems or physics; the overlay draws the requests on top
and drops them at the start of the next frame (requests made between frames, e.g. in input handlers, are drawn
once first). Calls cost nothing but a branch while no overlay with `draw` is shown.

```ts
import { debugDraw, type DebugDrawOptions } from '@engine';

// Styles built once: a colour string or a reused options object allocates nothing per frame.
const vel: DebugDrawOptions = { color: '#4ade80', width: 3, space: world };   // coords in world's local space
const range: DebugDrawOptions = { color: '#f87171', space: world };
node.onUpdate(() => {
  if (!debugDraw.enabled) return;                                    // skip debug work when nobody draws
  for (const b of bodies) debugDraw.arrow(b.x, b.y, b.x + b.vx * 0.2, b.y + b.vy * 0.2, vel);
  debugDraw.circle(player.x, player.y, attackRange, range);
  debugDraw.text(`contacts ${contacts.length}`, 20, 200, '#ffffff');  // stage (design) space
});
debugDraw.point(tap.x, tap.y, { color: '#f472b6', size: 14, duration: 1 }); // in a tap handler: keep 1 s
```

Shapes: `line`, `arrow`, `rect(x, y, w, h)`, `circle(x, y, r)`, `point`, `text(text, x, y)`,
`polygon([x0, y0, x1, y1, ...])`. Options: `color`, `width` (line width, 2), `size` (point / text size),
`fill`, `space` (a Node whose local coordinates you pass; text stays upright), `duration` (seconds).

## Resolution 'auto' (the biggest memory win)

Backing pixels per design unit = `game.pixelRatio * game.scale`. With the default `maxPixelRatio` 2 that is
~1.0 on an iPhone SE / iPhone 14 / 720p Android and ~1.5 on an iPad. Baking at a fixed resolution 2 stores 4x
the pixels a phone can show.

```ts
import { autoTextureResolution, bakeTexture } from '@engine';

bakeTexture(w, h, paint, { resolution: 'auto', key: 'fruit:apple' });          // 1 on phones, 1.5 on iPad
bakeTexture(w, h, paint, { resolution: 'auto', maxResolution: 1.5, key: 'bg' }); // cap big art
const res = autoTextureResolution();      // same number, for caches or APIs that take a number
const atlas = new TextureAtlas({ width: 1024, height: 1024, resolution: autoTextureResolution() });
bakeFruitArt(autoTextureResolution());    // game code that caches per resolution takes the number
```

'auto' rounds to 0.25 steps, clamps to [0.5, maxResolution] (default max 2) and is valid from the Game
constructor on, so it works inside `boot()`. It is evaluated at bake time: textures baked at boot keep their
resolution after a web window resize. Art that is usually drawn larger than its logical size (camera zoom,
big pop-in scales) can ask for a margin with a plain number: `resolution: autoTextureResolution(3) * 1.25`.

## Fewer, cheaper draws

- **Atlases**: many small baked images belong on one `TextureAtlas` page (`atlas.add(key, w, h, paint)` then
  `new Sprite(key)`): one canvas instead of dozens, less memory overhead per canvas. Check `atlas.occupancy`.
- **CacheContainer** for static groups (map decorations, complex Graphics, many labels): renders the subtree
  once and blits it; call `markDirty()` after changing children, `releaseCache()` when hidden for long.
  `new CacheContainer(w, h)` follows the screen resolution by default.
- **Bake vector art**: a `Graphics` with gradients / many paths redrawn every frame is slower than
  `new Sprite(g.bake(autoTextureResolution()))`.
- **Hide, cull, flatten**: `visible = false` skips a whole subtree; `World` culls off-screen children; each
  drawn node costs one `setTransform` (plus `globalAlpha` only when it changes); only `clip` / `blend` /
  `isolate` nodes add a save/restore.
- **Pools** (`Pool`, `NodePool`) for bullets, fruits, floating texts instead of create/destroy every frame.
- **Frame rate**: `game.setFrameRate(30)` on menus, pause and result screens (20 for a static title), back to 60
  for gameplay; saves battery and heat. dt stays real time.

## Costly canvas operations

- **shadowBlur / shadows**: very slow on CPU canvases and mini-game runtimes, worst when animated or on large
  shapes. Bake shadows into textures (Box / Graphics shadow once, then `bake`) or use `ShadowBlob`.
- **Text**: layout and measurement are memoized per text + style, so repeated `measure*` calls are free, but a
  new string re-wraps. Update labels only when the value changes (not every frame to an equal-looking string)
  and avoid many different font sizes. `TextStyle.cache` (default `'auto'`) draws stroked / shadowed labels and
  labels unchanged for 30 frames from a shared bitmap, and counters directly; force `'none'` for per-frame
  values, `'bitmap'` for big stroked titles. Bitmaps show as `text:*` in `textureStats()`; `textBitmapStats()`,
  budget `setTextBitmapBudget(px)` (1.5 M px, LRU). Change styles with `setStyle`, not by mutating the object.
- **UI relayout**: a label change that keeps its measured size (timers, fixed or grow width) does not relayout
  the screen; a size change relayouts the root once. Change UI children via add/remove or `markUILayoutDirty`.
- **Per-frame allocations**: object / array literals, `slice` / `map` / `filter`, closures and template strings
  in `update()` or `draw()` feed the GC and show up as worst-frame spikes. Reuse objects, keep scratch arrays,
  prebuild debugDraw styles, format numbers only when they change. For per-frame scratch arrays write by
  index and keep a count: `arr.length = 0` makes V8 drop the backing store (see `SpatialHash.queryInto`).
  Copy `this.count` into a local before a hot loop. Engine helpers take `out` params (`worldMatrix(out)`,
  `toLocal(x, y, out)`, `input.vector(..., out)`, `followNode(...).into(space, out)`); colour strings from
  `toCss` are cached.
- **Hot numeric code**: doubles passed to or returned from calls V8 does not inline get boxed (allocated); use
  scratch objects. No `Math.hypot` in hot paths (it allocates in V8 and rounds differently across engines):
  `Math.sqrt(x * x + y * y)`.
- **save / restore and state changes**: rendering is flat `setTransform`; save/restore only for `clip`, `blend`
  or `isolate`, so `draw()` must reset the canvas state it changes (shadows, line dash, lineCap / lineJoin,
  composite op) or set `isolate: true`. Clips (Node `clip`, MaskContainer), blends and alpha changes add up.
- **Gradients**: create them once (bake or cache), not in every `draw()`. Widgets: `uiShade` / `uiMix` /
  `UIGradientCache` instead of `darken` / `lighten` / `createLinearGradient` per frame; pass `drawUIBox` the same
  props object every frame.
- **Scaling big images down every frame**: bake at display size instead.
- **getImageData / putImageData / toDataURL**: synchronous GPU readback, never per frame.
- **Baking mid-game**: bakes are synchronous; bake at boot or on scene enter, not on the first spawn.

## Workflow for "it stutters" / "memory is high"

1. Reproduce headless: `pnpm bench --app <app> --scene <scene> --taps random --seconds 20` and note
   frame p95 / max, nodes, particles, texture MB.
2. Look at the scene with the overlay: `showDebugOverlay(t.game, { bounds: true, hits: true })` in a test
   or shot, or `?debug=1` in the dev server; on a phone watch fps and the worst frame.
3. Memory: `textureStats({ top: 10 })`; switch fixed resolutions to `'auto'`, pack small textures into an
   atlas, release scene-specific textures on exit. Handle `game.on('memorywarning', ...)`: the engine already
   dropped tint and text-bitmap caches and asks the host for a GC; free what the game can rebuild
   (`releaseTexture`, `TileMap.releaseChunks`, `CacheContainer.releaseCache`). Music streams and unloads 4 s
   after it stops; sfx preload at boot.
4. CPU: cut drawn nodes (cull, cache, bake), particles (`maxParticles`), shadows, per-frame allocations.
5. Re-run the same bench command; keep the before / after numbers in the commit message.

## Release checklist

- [ ] `pnpm build --target wx` (and tt): main package <= 4 MB.
- [ ] `pnpm bench` of the main gameplay scene: frame p95 not worse than the last release; no max spikes
      that grow with time (leaks); heap delta small with `--expose-gc`.
- [ ] `textureStats()` in the heaviest scene <= 30 MB; baked art uses `resolution: 'auto'`; the top list has
      no surprise (old re-bakes, forgotten debug textures).
- [ ] Drawn nodes and live particles within budget in the busiest moment (`stats.drawnNodes`, `stats.particles`).
- [ ] Real low-end Android with the stats panel: >= 55 fps in gameplay, worst frame < 50 ms, no growth of
      texture MB across scene changes.
- [ ] No debug overlay in release builds: `showDebugOverlay` only behind a dev flag / launch query; heavy
      debug geometry behind `if (debugDraw.enabled)`.
