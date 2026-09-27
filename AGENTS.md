# AGENTS.md — project guide for coding agents

A self-written TypeScript 2D/2.5D game engine plus games built on it. Targets: WeChat (wx), Douyin (tt),
TapTap (tap) mini-games, 233乐园 (wx package converted by the Tuanjie converter) and the web (dev/testing).
Rendering is Canvas 2D. An AI agent writes all code, art, music and UI; the human only tests and gives feedback.
So every feature must be inspectable from code: text dumps, lint reports, headless screenshots you can Read.

## Commands (Windows / PowerShell, pnpm)

- `pnpm typecheck` — TypeScript 7 (`tsc --noEmit`). Must be clean.
- `pnpm test` — Vitest (node env). Tests live next to code (`*.test.ts`) or in `tests/`.
- `pnpm check` — typecheck + test.
- `pnpm shot --scene <name> [--device iphone-se,ipad|all] [--tap "<selector>"] [--wait 0.5] [--seconds 1]
  [--params '<json>'] [--dump] [--lint] [--bounds]` — headless screenshot of a sandbox scene into `.shots/`.
  Read the PNG to look at it. `--dump` prints the node tree, `--lint` prints the UI lint report (exit 1 on
  errors), `--bounds` writes an extra `-bounds.png` with hit areas / text boxes / issues drawn on top.
- `pnpm shot:browser --scene <name> [--device ...] [--tap ...]` — same in real Chrome (falls back to Edge);
  exits 1 on page console errors.
- `pnpm dev [--port 5173]` — dev server with live reload; `/frame` shows 3 phones side by side; LAN URLs for phones.
  In dev web builds `window.__engine` has `tap(selector)`, `dump()`, `go(scene)`, ...; URL `?scene=<name>`.
- `pnpm build --target web|wx|tt|tap|233|all [--minify]` — packages into `dist/<target>/` and prints a size
  table. Fails if wx/tt main package > 4 MB or game.js references node modules. 233 needs the converter in
  `%TEMP%\minihost-converter` (or `MINIHOST_CONVERTER`), otherwise it is skipped with instructions.
- `pnpm audio [--only coin,menu] [--preview]` — renders `<app>/audio/index.ts` (sfx params + songs) to mp3 +
  manifest in `<app>/assets/audio/`; `--preview` writes waveform/spectrogram/piano-roll PNGs to `.shots/audio/`.
- `pnpm art:preview [--only icons,shapes] [--svg file.svg]` — contact sheets of the art toolkit in `.shots/art-*.png`.
- If `node_modules` is missing: `pnpm install --frozen-lockfile --prefer-offline`.
- GitHub needs the local proxy: `git -c http.proxy=http://127.0.0.1:7890 ...` (npm registry works directly).

## Layout

```
engine/            runtime engine, imported as '@engine' (engine/index.ts). Bundled into builds:
                   no node:*, no @napi-rs/canvas, no DOM/window/wx access outside engine/platform/.
  core/            math, emitter, rng (seeded), color, game (loop/scaling/input), app (defineApp/runApp)
  gfx/             Ctx2D/Surface types, Texture, textures registry, bakeTexture, draw helpers
  platform/        Platform interface (types.ts), current platform, adapters web / minigame (wx, tt, tap)
  scene/           Node, selector, dump, Sprite, Box, Text, Scene/SceneManager
  runtime/         tweens + easing, timers, juice (shake/punch/popIn/countTo...), gestures, joystick,
                   assets + atlas loading, LoadingScene, SaveStore/settings, pools, StateMachine, fixedUpdate, events
  display/         Graphics (vector drawing), AnimatedSprite, NineSlice, TilingSprite, ParticleEmitter +
                   particlePresets/spawnParticles, MaskContainer, CacheContainer, Trail, ShadowBlob, Line, ArcProgress
  world/           World (camera container with culling) + Camera2D (follow/deadzone/shake), ParallaxLayer,
                   TileMap (ASCII maps, autotile, chunk prerender), IsoMap/IsoObject (heights, picking),
                   DepthSortLayer, GroundObject (z + shadow), PerspectiveRoad, PhysicsWorld/ArcadeBody,
                   findGridPath (A*), distance fields, PathFollower
  ui/              flexbox layout, `ui.*` builder + buildUI(spec), widgets, modal/dialog/toast, themes,
                   inspectUI / lintUI / formatLint / drawUIBounds
  art/             palettes + colour ramps, pixelSprite, SVG parser/renderer (svgTexture), 22 shapes, 46 icons
                   (registerIcons -> 'icon:<name>'), noise + tileable patterns, bake effects, creatures, TextureAtlas
  audio/           synth + DSP, sfxPresets/renderSfx, text music notation + songs, WAV, analysis, AudioManager
  testing/         Node-only: HeadlessPlatform, createTestGame harness, devices ('@engine/testing')
sandbox/           engine showcase app = compatibility test pack; scenes/<module>.ts per module,
                   audio/index.ts (sound definitions), app.json (store metadata, appids, ad unit ids)
game/              the actual game (later)
tools/             node CLIs: shot, build, dev, audio, art
tests/             cross-module tests
```

## Core conventions

- Design resolution 750x1334 portrait, scale mode 'expand': `game.view` is the visible size in design units,
  `game.safe` the safe rect. Lay out against these, never against raw screen pixels.
- Node local space: origin at the content box top-left; (x, y) positions the anchor; anchor is the pivot.
  Subclasses override `draw(ctx)` and `describe()` (props shown in dumps / usable in selectors) and `kind`.
- Selectors: `Kind#id.tag[key=value][key*=sub]`, descendant `A B`, child `A > B`.
  `describe()` keys are attributes, e.g. `Text[text=开始]`.
- Input: `node.onTap(fn)`; events bubble; `game.on('pointerdown', ...)` for stage-level input.
- Per-frame: override `update(dt)` or use `node.onUpdate(fn)`; global systems via `game.addSystem()`.
- Deterministic: use `rng` / `new Rng(seed)` from '@engine', never `Math.random()` in engine or game logic.
- Portable canvas subset only (see engine/gfx/types.ts): no Path2D (use `svgPath`), ctx.filter, ctx.roundRect
  (use `roundRectPath`), letterSpacing, OffscreenCanvas, DOM.
- `import type` for type-only imports (verbatimModuleSyntax). Avoid generic export names that could clash
  across barrels (`export *` conflicts are type errors); prefix with the module (`drawArtShape`, `pcmFilter`).
- Keep game rules pure (no rendering) so they can be unit-tested.

## UI: build with `ui.*`, verify with lint

- Screens: `mountScreen(scene, ui.column({...}, [...]), { safeArea: true })`. Layout is flexbox
  (`direction`, `justify`, `align`, `gap`, `padding`, `grow`, `%` sizes); tokens `xs..xxl` for spacing.
- Every screen must pass `pnpm shot --scene <s> --device iphone-se,iphone-14,ipad --lint` with 0 errors.
  Rules cover overlaps, off-screen / outside safe area, truncation, contrast (min 3:1), tap size (min 88),
  font size (min 20). Tune per call with `lintUI(root, game, { rules: { 'small-font': 'off' } })`.
- Plain nodes can declare a lint role by tag: `tags: ['lint-blocker']` for a hand-made backdrop (content under
  it is skipped), also `lint-decor`, `lint-surface`, `lint-control`. UI widgets set this themselves.
  `lint-ignore` skips a whole subtree; every `World` has it (game-world content is not UI).

## Art and audio are code

- Art: prefer SVG strings (`svgTexture`), shapes, pixel grids (`pixelSprite`) and generated creatures, baked
  once at load into textures (use a `TextureAtlas` for many small ones). Review with `pnpm art:preview` or a
  sandbox scene screenshot. Colours from `palettes` / `paletteRoles` / `colorRamp` keep a game consistent.
- Audio: sound effects are `SfxParams` (start from `sfxPresets`), music is `defineSong` with text notation.
  Render with `pnpm audio`; check the analysis table and `--preview` PNGs (loudness, clipping, key) instead
  of listening. Play at runtime through `AudioManager` (`createAudioManager(game)`).

## Pitfalls

- PowerShell 5: `Set-Content -Encoding utf8` writes a BOM; write files with the file tools or
  `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))`.
- If an edit tool turns CJK characters into `?`, write them as `\u` escapes (see engine/scene/text.ts).
- Mini-game runtimes: no DOM, `performance.now()` is in microseconds on wx/tt (adapters convert), fonts default
  to `'sans-serif'`. Only real devtools/phones prove a platform works; the headless and browser shots do not.
