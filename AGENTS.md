# AGENTS.md — project guide for coding agents

A self-written TypeScript 2D/2.5D game engine plus games built on it. Targets: WeChat (wx), Douyin (tt),
TapTap (tap) mini-games, 233乐园 (wx package converted by the Tuanjie converter) and the web (dev/testing).
Rendering is Canvas 2D. An AI agent writes all code, art, music and UI; the human only tests and gives feedback.
So every feature must be inspectable from code: text dumps, lint reports, headless screenshots you can Read.

## Commands (Windows / PowerShell, pnpm)

- `pnpm typecheck` — TypeScript 7 (`tsc --noEmit`). Must be clean.
- `pnpm test` — Vitest (node env). Tests live next to code (`*.test.ts`) or in `tests/`.
- `pnpm check` — typecheck + encoding lint + test.
- `pnpm lint:encoding [--fix]` — tracked text files must be UTF-8 without BOM, no U+FFFD, no mangled CJK (`??`)
  or mojibake; prints file:line:col, exits 1 on issues (`--fix` only strips BOMs).
- Every CLI below takes `--app <dir>`; the default is package.json `"engine": { "app": "game" }`. Pass
  `--app sandbox` for engine demo scenes.
- `pnpm shot [--app <dir>] --scene <name> [--device "iphone-se,iphone-14,ipad"|all] [--tap <selector|x,y>]
  [--drag "<a>|<b>"] [--wait 0.5] [--seconds 1] [--seed 1] [--params '<json>'] [--dump] [--lint] [--bounds]` —
  headless screenshot into `.shots/`; `--tap/--drag/--wait` repeat and run in order. Read the PNG to look at it.
  Landscape apps (app.json `"orientation": "landscape"`) use `iphone-se-land, iphone-14-land, android-land, ipad-land`;
  shot/bench/dev default to them and `--device all` picks the profiles of the app's orientation.
  `--dump` prints the node tree, `--lint` prints the UI lint report (exit 1 on errors), `--bounds` writes an
  extra `-bounds.png` with hit areas / text boxes / issues drawn on top. `--help` lists everything.
- `pnpm shot:browser` — same options in real Chrome (falls back to Edge), plus `--input engine|touch|mouse`,
  `--browser`, `--timeout`; exits 1 on page console errors.
- `pnpm dev [--port 5173]` — dev server with live reload; `/frame` shows 3 phones side by side; LAN URLs for phones.
  In dev web builds `window.__engine` has `tap/drag(target)`, `point`, `dump()`, `go(scene)`, `lint()`,
  `bounds(on)`, `stats()`, `statsLine()`, `textures()`, `debug(opts)`; URL `?scene=<name>&seed=<n>`,
  `&stats=1` (stats panel) or `&debug=1` / `&debug=all` (debug overlay).
- `pnpm build --target web|wx|tt|tap|233|all [--minify]` — packages into `dist/<target>/` and prints a size
  table. Fails if wx/tt main package > 4 MB or game.js references node modules. 233 needs the converter in
  `%TEMP%\minihost-converter` (or `MINIHOST_CONVERTER`), otherwise it is skipped with instructions.
- `pnpm audio [--only coin,menu] [--preview]` — renders `<app>/audio/index.ts` (sfx params + songs) to mp3 +
  manifest in `<app>/assets/audio/`; `--preview` writes waveform/spectrogram/piano-roll PNGs to `.shots/audio/`.
- `pnpm art:preview [--only icons,shapes] [--svg file.svg]` — contact sheets of the art toolkit in `.shots/art-*.png`.
- `pnpm bench [--scene play] [--device iphone-14] [--seconds 10] [--taps none|random] [--tap-every 0.8] [--seed 1]
  [--params '<json>'] [--json]` — headless frame-time / node / particle / texture-memory / heap benchmark. Numbers
  are relative (compare runs on the same machine), not device fps. Runtime: `game.stats`, `formatGameStats()`,
  `textureStats()`, `showDebugOverlay(game, { stats, bounds, hits })`, one-frame `debugDraw.line/rect/circle/text`.
  Bake art with `bakeTexture(w, h, draw, { resolution: 'auto', key })` instead of a fixed resolution.
- If `node_modules` is missing: `pnpm install --frozen-lockfile --prefer-offline`.
- GitHub needs the local proxy: `git -c http.proxy=http://127.0.0.1:7890 ...` (npm registry works directly).
  GitHub CLI: `gh` (portable install in `%LOCALAPPDATA%\Programs\gh\bin`, on the user PATH).

## Skills (read the matching one before starting a task)

Detailed how-to guides live in `.agents/skills/<name>/SKILL.md` (auto-discovered by Cursor and other agents).
This file stays the short index; each skill holds the API cheat-sheet, recipes, pitfalls and verification steps.

| Skill | Use it when |
|---|---|
| `make-a-game` | starting or extending a game: app layout, rules model, scenes, art/audio, playtest, build (worked example: `game/`) |
| `ui-screens` | building HUDs, menus, dialogs with `ui.*`; fixing UI lint errors |
| `code-art` | drawing sprites/icons/backgrounds as code (SVG, shapes, pixel art), baking textures, review galleries |
| `audio-design` | sound effects and music as code, `pnpm audio`, AudioManager |
| `game-feel` | juice (shake/punch/springs/squash), aim gesture, node fixed-step, scene restart, sound shortcuts, ads helper |
| `physics` | collisions and bodies: arcade `PhysicsWorld` vs rotating/stacking `RigidWorld`, contact events |
| `input-and-i18n` | touch/keyboard/gamepad input, input actions, localization |
| `testing-and-shots` | headless tests that play the game, screenshots, lint runs, CLI options |
| `performance` | fps/frame time/memory, debug overlay, `pnpm bench`, texture memory and resolution |
| `release-platforms` | building for wx/tt/tap/233/web, app.json, size limits, real-device checklist |
| `engine-extend` | adding or changing an engine module (conventions, sandbox scene, tests, docs) |

When you change an engine API, update the matching skill in the same change.

## Layout

```
engine/            runtime engine, imported as '@engine' (engine/index.ts). Bundled into builds:
                   no node:*, no @napi-rs/canvas, no DOM/window/wx access outside engine/platform/.
  core/            math, emitter, rng (seeded), color, game (loop/scaling/input), app (defineApp/runApp)
  gfx/             Ctx2D/Surface types, Texture, textures registry, bakeTexture, draw helpers
  platform/        Platform interface (types.ts), current platform, adapters web / minigame (wx, tt, tap),
                   ads helper (configureAds / canShowAd / showRewardedAd, typed AppJsonConfig)
  scene/           Node, selector, dump, Sprite, Box, Text, Scene/SceneManager
  runtime/         tweens + easing, timers, juice (shake/punch/popIn/countTo...), springs (createSpring,
                   squashSpring, wobble, springProp), gestures (draggable, onSwipe, onAim...), joystick,
                   assets + atlas loading, LoadingScene, SaveStore/settings, pools, StateMachine,
                   fixedUpdate (Game or Node), events, keyboard/gamepad + input actions (input.ts), i18n (tr)
  display/         Graphics (vector drawing), AnimatedSprite, NineSlice, TilingSprite, ParticleEmitter +
                   particlePresets/spawnParticles, MaskContainer, CacheContainer, Trail, ShadowBlob, Line, ArcProgress
  world/           World (camera container with culling) + Camera2D (follow/deadzone/shake), ParallaxLayer,
                   TileMap (ASCII maps, autotile, chunk prerender), IsoMap/IsoObject (heights, picking),
                   DepthSortLayer, GroundObject (z + shadow), PerspectiveRoad, PhysicsWorld/ArcadeBody,
                   RigidWorld/RigidBody (rigid*.ts: rotating circles + convex polygons, stacking, sleeping,
                   contact events, sensors, raycast; bindRigidNode, drawRigidWorld, RigidDebugView),
                   findGridPath (A*), distance fields, PathFollower
  ui/              flexbox layout, `ui.*` builder + buildUI(spec), widgets, modal/dialog/toast, themes,
                   inspectUI / lintUI / formatLint / drawUIBounds
  art/             palettes + colour ramps, pixelSprite, SVG parser/renderer (svgTexture), 22 shapes, 46 icons
                   (registerIcons -> 'icon:<name>'), noise + tileable patterns, bake effects, creatures, TextureAtlas
  audio/           synth + DSP, sfxPresets/renderSfx, text music notation + songs, WAV, analysis, AudioManager,
                   shortcuts that no-op without a manager (playSound / playSong / stopSong / setAudioMuted)
  testing/         Node-only: HeadlessPlatform, createTestGame harness, devices ('@engine/testing')
sandbox/           engine showcase app = compatibility test pack; scenes/<module>.ts per module,
                   audio/index.ts (sound definitions), app.json (store metadata, appids, ad unit ids)
game/              合成大西瓜 (Suika-style merge game), the default app for CLIs (package.json "engine.app") and
                   the worked example in the `make-a-game` skill
archer/            布偶弓箭手 (Ragdoll Archers clone), landscape 1334x750: Verlet ragdoll, archery duel, upgrades menu,
                   armored enemies, local two-player versus / co-op (scenes/duo.ts, two onAim halves)
tools/             node CLIs: shot, build, dev, audio, art
tests/             cross-module tests
```

## Core conventions

- Design resolution 750x1334 portrait (1334x750 for landscape apps), scale mode 'expand': `game.view` is the visible
  size in design units, `game.safe` the safe rect. Lay out against these, never against raw screen pixels.
- Node local space: origin at the content box top-left; (x, y) positions the anchor; anchor is the pivot.
  Subclasses override `draw(ctx)` and `describe()` (props shown in dumps / usable in selectors) and `kind`.
- Selectors: `Kind#id.tag[key=value][key*=sub]`, descendant `A B`, child `A > B`.
  `describe()` keys are attributes, e.g. `Text[text=开始]`.
- Input: `node.onTap(fn)`; events bubble; `game.on('pointerdown', ...)` for stage-level input.
  Press-slide-release aiming: `onAim(zone, { start, move, release }, { space, enabled })`, not hand-tracked pointers.
  Keys / gamepad: `createInputActions(scene, { jump: ['Space', 'PadA'] })`, then `pressed('jump')` /
  `axis('left', 'right')`; bind on-screen buttons with `bindHold`. Phones have no keyboard: always ship touch controls.
- Per-frame: override `update(dt)` or use `node.onUpdate(fn)`; global systems via `game.addSystem()`.
  Gameplay simulation: `fixedUpdate(this, 60, (step) => ...)` with a node target (stops on destroy, pauses with
  the node); never hand-roll an accumulator. Restart a level with `game.scenes.restart({ transition: 'fade' })`.
- Physics: `PhysicsWorld`/`ArcadeBody` for tile-map characters (platformer, top-down); `RigidWorld` for anything
  that stacks, rolls or rotates (crates, balls, merge games). Game rules read `world.touches` / contact events;
  add/remove inside callbacks is deferred to the end of the step. See the `physics` skill.
- Sounds from game code: `playSound('merge', { rate })`, `playSong('bgm', { fadeMs })`, not `getAudioManager()?.`.
- Ads: `configureAds(appJson.ads)` at boot, then `canShowAd()` / `await showRewardedAd()`; never branch on
  `platform().name` for ads.
- Text in several languages: `defineStrings({ en: {...}, 'zh-CN': {...} })`, `setLocale('auto')` at boot,
  `tr('key', { name })`; rebuild screens in `onLocaleChange(fn, scene)`; tests call `resetI18n()`.
- Node subclasses must not reuse Node member names (`paused`, `data`, `visible`, `alpha`, ...); the `game-feel`
  skill lists them.
- Deterministic: use `rng` / `new Rng(seed)` from '@engine', never `Math.random()` in engine or game logic.
- Portable canvas subset only (see engine/gfx/types.ts): no Path2D (use `svgPath`), ctx.filter, ctx.roundRect
  (use `roundRectPath`), letterSpacing, OffscreenCanvas, DOM.
- `import type` for type-only imports (verbatimModuleSyntax). Avoid generic export names that could clash
  across barrels (`export *` conflicts are type errors); prefix with the module (`drawArtShape`, `pcmFilter`).
- Keep game rules pure (no rendering) so they can be unit-tested.

## UI: build with `ui.*`, verify with lint

- Screens: `mountScreen(scene, ui.column({...}, [...]))` (lays out inside the safe area by default). Layout is
  flexbox (`direction`, `justify`, `align`, `gap`, `padding`, `grow`, `%` sizes); tokens `xs..xxl` for spacing.
- Every screen must pass `pnpm shot --scene <s> --device "iphone-se,iphone-14,ipad" --lint` with 0 errors.
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
  of listening. Create the manager in `boot()` with `createAudioManager(game, { library: { sfx, music } })`
  (without `library` nothing plays in tests/dev before files are rendered) and play with `playSound` / `playSong`.

## Pitfalls

- PowerShell 5: `Set-Content -Encoding utf8` writes a BOM; write files with the file tools or
  `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))`.
- If an edit tool turns CJK characters into `?`, write them as `\u` escapes (see engine/scene/text.ts).
- PowerShell splits unquoted comma lists into arrays: quote them, `--device "iphone-se,iphone-14,ipad"`.
  PowerShell 5 also strips inner double quotes, so `--params '{"a":1}'` arrives as `{a:1}` (the shot tools accept it).
- pnpm runs with `reporter: silent` (pnpm-workspace.yaml) so scripts don't echo their command to stderr (which
  PowerShell shows as a red NativeCommandError). See install output with `pnpm install --reporter=default`.
- Tests: `createTestGame` renders only the last frame of each step/advance/tap by default (`render: 'every'` to
  count per-frame draws, `pixelRatio: 1` for faster shots); each test game starts with fresh save storage,
  rng seed 1 and the default UI theme.
- New app folders must be covered by tsconfig/vitest includes (see the `make-a-game` skill).
- Mini-game runtimes: no DOM, `performance.now()` is in microseconds on wx/tt (adapters convert), fonts default
  to `'sans-serif'`. Only real devtools/phones prove a platform works; the headless and browser shots do not.
