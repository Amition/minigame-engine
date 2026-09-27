---
name: testing-and-shots
description: >-
  How to verify games built on this engine without a phone: Vitest tests with createTestGame (headless game;
  tap/drag/press/advance, find/get/dump, screenshot/png, played sounds), render modes and pixelRatio for fast tests,
  seeds and determinism, balance tests over many seeds (sweepSeeds / formatSweep), test isolation, playing a whole
  game inside a test, UI lint (lintUI, --lint, --bounds), headless and real-browser screenshots (pnpm shot,
  pnpm shot:browser) and the encoding lint (pnpm lint:encoding).
  Use when writing, debugging or speeding up tests, when a test times out, when you need to look at a screen or
  check a layout on several devices, before calling UI work done, and after editing files that contain CJK text.
  Keywords: test, vitest, createTestGame, headless, screenshot, shot, browser, lint, UI lint, bounds, timeout,
  slow tests, determinism, seed, sweepSeeds, balance, median, encoding, BOM, 截图, 测试.
---

# Testing and screenshots

Everything here runs in Node on Windows/PowerShell: no device, no browser (except `pnpm shot:browser`).
Text beats pixels: prefer `t.dump()`, model state and `lintUI` in tests; take screenshots to look, then Read the PNG.

| Task | Command |
|---|---|
| All tests (typecheck first) | `pnpm check` = `pnpm typecheck && pnpm test` |
| One file / one test | `npx vitest run game/play.test.ts` / `npx vitest run -t "pause menu"` |
| Look at a scene | `pnpm shot --scene play` then Read `.shots/<app>-play-iphone-14.png` |
| UI check on 3 devices | `pnpm shot --scene title --device "iphone-se,iphone-14,ipad" --lint --bounds` |
| Per-file timings | `pnpm exec vitest run --reporter=json --outputFile=$env:TEMP\vitest.json` |
| Same in real Chrome | `pnpm shot:browser --scene title --lint` |
| Encoding damage | `pnpm lint:encoding` |

The default app for every CLI (`--app`) is package.json `"engine": { "app": "game" }`; pass `--app sandbox` for
the engine showcase.

## createTestGame

```ts
import { afterEach, expect, it } from 'vitest';
import { createTestGame, type TestGame } from '@engine/testing';
import app from './main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

it('starts a game from the title', async () => {
  t = await createTestGame({ app, device: 'iphone-14', scene: 'title' });
  await t.tap('#start');            // selector, Node or stage point { x, y }
  await t.advance(0.5);             // let the scene transition finish
  expect(t.scene?.sceneName).toBe('play');
  expect(t.dump()).toContain('Fruit');
});
```

Nothing runs on its own: time only moves in `step`/`advance`/`tap`/... Everything is in stage (design) units.

Options (`TestGameOptions`):

| Option | Default | Meaning |
|---|---|---|
| `app` | none | AppDef to boot (scenes, `boot()`, start scene); without it you get an empty 750x1334 game |
| `config` | 750x1334 | `Partial<GameConfig>` when there is no app (`maxDt`, `scaleMode`, ...) |
| `device` | `'iphone-14'` | `iphone-se`, `iphone-14`, `iphone-15-pro-max`, `android`, `ipad`; landscape `iphone-se-land`, `iphone-14-land`, `android-land`, `ipad-land` (`devicesFor('landscape')`); `'WxH@dpr'` or a `DeviceSpec` |
| `scene`, `params` | app start | scene to open after boot, with params |
| `seed` | `1` | reseeds the shared `rng` |
| `render` | `'last'` | which frames are drawn, see below |
| `pixelRatio` | device (2) | backing-store DPR; `1` draws 4x fewer pixels |
| `assetsDir` | `./assets` | absolute dir for `loadImage`/`readText` (use `resolve(appDir, 'assets')`) |

`TestGame` API:

| Member | What it does |
|---|---|
| `step(frames = 1, dt = 1/60)` | runs frames (dt clamped to `maxDt` like the real loop), settling promises between frames |
| `advance(seconds)` | `step(round(seconds * 60))` |
| `tap(target)` | touch start, 1 frame, touch end, 1 frame. Target: selector, `Node` or `{ x, y }` stage point |
| `press(target, seconds)` | holds, then releases (long press) |
| `drag(from, to, steps = 12)` | start, `steps` moves (1 frame each), end |
| `multiDrag([[from, to], ...], steps = 12)` | multi-touch: stroke i is pointer id i + 1; all press, move and lift in the same frames (two `onAim` zones, pinch) |
| `go(scene, params?)` | switches scene and runs 1 frame |
| `find(sel)` / `findAll(sel)` / `get(sel)` | selector queries; `get` throws with a stage dump when nothing matches |
| `dump({ root?, maxDepth?, showHidden?, filter? })` | text outline with stage bounds and node props |
| `screenshot(file, { scale?, overlay? })` / `png(opts)` | draws a fresh frame (any render mode), writes/returns a PNG in CSS px |
| `played()` | sound keys played so far (`platform.audio.log` has the full log with times) |
| `renderMode` | read/write; switch to `'every'` for a section of a test |
| `game`, `stage`, `scene`, `platform` | the Game, its stage, current scene, the `HeadlessPlatform` |
| `destroy()` | stops the game and unsets the platform (always call it in `afterEach`) |

Useful `t.platform` (HeadlessPlatform) extras: `storage` (in-memory, fresh per test game), `audio.log`,
`ads.rewardedResult = false` / `ads.calls`, `vibrations`, `shares`, `hide()` / `show()` (pause on hide),
`resize(w, h, insets?)`, `clock` (ms).

Selectors: `Kind#id.tag[key=value][key*=sub]`, descendant `A B`, child `A > B`; attributes are `describe()` keys,
e.g. `t.get('Button[text=开始游戏]')`, `t.findAll('Fruit')`.

## Render modes and pixelRatio

Drawing a frame at the device's backing size (iPhone 14 = 780x1688, iPad = 1536x2048) is the expensive part of a
test; simulation is cheap. `render` decides which frames `step/advance/tap/press/drag/go` draw:

- `'last'` (default): only the final frame of each call. `advance(36)` draws 1 frame instead of 2160; `tap` draws
  once after the release.
- `'every'`: every frame, like the real loop. Use it when a test counts draws or reads per-frame render stats
  (`CacheContainer` redraw counts per frame, `draws` counters in custom nodes).
- `'none'`: never; `screenshot()`/`png()` still draw. Good for long pure-logic simulations.

Frames that are not drawn still emit `prerender`/`postrender` and run the UI layout of the visible tree, so node
positions, hit tests, `AudioManager` fades and anything hooked to render events behave exactly as with `'every'`.
Render-only counters (`TileMap.drawnChunks`, `PerspectiveRoad.segmentsDrawn`, `DepthSortLayer` order) reflect the
last drawn frame, which in `'last'` mode is the end of every call.

```ts
t = await createTestGame({ app, scene: 'play', render: 'none', pixelRatio: 1 }); // fastest
t.renderMode = 'every';                                                        // per-frame drawing from here on
```

`pixelRatio: 1` makes drawn frames 4x cheaper and screenshots slightly softer (still CSS size). Keep the default
DPR 2 for screenshots you want to inspect closely and for pixel assertions at exact coordinates.

Which options a game test should use:

- Play-throughs, model / HUD text assertions, taps, sounds and UI lint: `render: 'none'`. Lint, hit tests and
  `worldBounds()` only need layout, which runs on undrawn frames too, so results are identical and the test skips
  every draw (about a third faster for the archer/game suites).
- Also `pixelRatio: 1` when the file never takes a screenshot. Files with env-gated shots (`GAME_SHOTS`) keep the
  device DPR so those shots stay sharp; with `render: 'none'` the DPR only costs when a shot is taken.
- Keep `'last'` / `'every'` only when the test reads what was drawn: canvas pixels, draw counters, render stats
  (`stats.drawnNodes`, `renderMs`), `TileMap.drawnChunks`, `debugDraw` counts.

## Seeds and determinism

- A test game reseeds the shared `rng` (`seed`, default 1) and runs a fixed 1/60 s step, so the same test is the
  same run every time. Game logic must use `rng` / `new Rng(seed)` from `@engine`, never `Math.random()`.
- Scenes that take a seed in params (e.g. the game's play scene: `params: { seed }`) can be replayed exactly.
- Drive random-looking input with its own generator so it does not disturb the game's `rng`:
  `const r = new Rng(11); r.float(40, 670)`.
- The CLIs use `--seed <n>` (default 1) for both headless and browser shots.

## Balance tests over many seeds: sweepSeeds

One seed proves little about difficulty. Run a bot over several seeds and assert on the median (or p10 / p90), with
every seed's value in the failure message. `sweepSeeds` from `@engine/testing` runs `run(seed)` once per seed, one
after another (test games share the platform and rng, so never in parallel), sync or async:

```ts
import { formatSweep, sweepSeeds } from '@engine/testing';

it('un-upgraded bots kill a handful of enemies', async () => {
  const r = await sweepSeeds({ from: 1, count: 6 }, (seed) => {   // or an explicit list: [1, 2, 3, 4, 5, 6]
    const m = new BattleModel({ seed });
    while (m.state === 'playing' && m.time < 400) botStep(m);
    return { kills: m.score, time: Math.round(m.time) };          // one number, or several metrics of one run
  });
  expect(r.kills.median, formatSweep(r)).toBeGreaterThanOrEqual(6);
  expect(r.time.p90, formatSweep(r)).toBeLessThanOrEqual(180);
});
```

- A number per seed gives one `SweepStats`: `{ seeds, values, min, max, mean, median, p10, p90 }` (`values[i]`
  belongs to `seeds[i]`; median / percentiles interpolate linearly, so the median of 6 values is the mean of the
  3rd and 4th). An object per seed gives one `SweepStats` per key, all from the same runs.
- `formatSweep(stats)` is one line: `median 8 (p10 6.5, p90 10.5, min 6, max 12, mean 8.33) over 6 seeds [1:8 2:6
  3:12 ...]`; for metric objects `kills: ... | time: ...`.
- The run can be a whole test game: `async (seed) => { t = await createTestGame({ app, params: { seed }, render:
  'none' }); ...; t.destroy(); return score; }`. Prefer pure-model bots when the rules allow it: no scene, no UI.

## Playing a game inside a test

Keep rules pure (model objects) and assert on the model; use taps only to drive it. The drop loop of
`game/play.test.ts`:

```ts
it('drops where the player taps and merges fruits', async () => {
  t = await createTestGame({ app, device: 'iphone-14', scene: 'play', params: { seed: 3 }, render: 'none' });
  const scene = t.scene as PlayScene;
  const jar = t.get('#jar');
  const rng = new Rng(11);
  let drops = 0;
  for (let i = 0; i < 40 && scene.model.state === 'playing'; i++) {
    const x = jar.toWorld(rng.float(40, 670), 0).x;      // jar-local x -> stage x
    await t.tap({ x, y: jar.toWorld(0, 400).y });          // tap a stage point
    drops++;
    await t.advance(0.9);                                  // let the fruit fall and settle
  }
  expect(scene.model.drops).toBe(drops);
  expect(scene.model.merges).toBeGreaterThan(5);
});
```

- Convert between spaces with `node.toWorld(x, y)` / `node.toLocal(x, y)`; tap targets are stage points.
- Two players on one screen (one `onAim` zone each): `await t.multiDrag([[p1From, p1To], [p2From, p2To]], 40)`
  drags both fingers at once. For staggered fingers inject raw touches yourself:
  `t.platform.touch('start', [{ id: 2, ...t.game.stageToScreen(x, y) }])`, then `await t.step(1)`.
- Force situations through the model instead of playing for minutes (e.g. add bodies near the top to test game
  over), then assert on UI: `openModalsOf().length`, `t.get('#again')`.
- Lint the UI in the states you reach: `lintUI(t.game.stage, t.game)` with 0 errors.
- Gate screenshots behind an env var so normal runs write nothing:
  `if (process.env.GAME_SHOTS) await t.screenshot('.shots/game-over.png');`

## Reading screenshots

- `await t.screenshot('.shots/name.png')` returns the absolute path; then Read the PNG to look at it. Size is the
  device's CSS px (390x844 for iPhone 14); `{ scale: 2 }` gives full backing resolution.
- Overlays in stage coordinates: `t.screenshot(file, { overlay: (ctx, game) => drawUIBounds(ctx, game.stage, { game }) })`.
- Before looking at pixels, read `t.dump()` (or `pnpm shot --dump`): bounds, text, sizes and states are exact.
- `.shots/` is git-ignored scratch space; name files by scene and device.

## UI lint workflow

1. `pnpm shot --scene <s> --device iphone-se,iphone-14,ipad --lint` prints one report per device and exits 1 on any
   error (overlap, off-screen, outside safe area, truncation, contrast < 3:1, tap target < 88, font < 20).
2. `--bounds` also writes `<shot>-bounds.png`: hit areas, text boxes and lint issues drawn over the frame. Read it
   to see which node an issue points at; issue lines name the node and its rect in stage units.
3. Fix, rerun until `UI lint: no issues` on all three devices. Reach dialogs/menus with `--tap` and `--wait`
   (e.g. `--tap "#pause" --wait 0.5`), or with scene params (`--params '{"open":"settings"}'`).
4. Keep a test that lints the same states (`lintUI(t.game.stage, t.game)`); tune rules per call with
   `lintUI(root, game, { rules: { 'small-font': 'off' } })`, and mark hand-made nodes with `lint-*` tags.

## Browser shots

`pnpm shot:browser` builds the app for the web in dev mode, opens it in headless Chrome (Edge fallback) with mobile
emulation and takes the shot. Use it to check the real web adapter, real font rendering and the DOM input path; it
is slower (a build plus a browser) and exits 1 when the page logged console errors. Dev builds expose
`window.__engine`: `tap(target)`, `drag(from, to, steps?)`, `point`, `locate`, `dump()`, `find`, `go(scene)`,
`scene()`, `frames(n)`, `lint()`, `bounds(on)`; URL params `?scene=&params=&insets=&seed=`.
`--input touch` / `--input mouse` send real CDP touch or mouse events instead of injecting into the platform.
Timing there is real time: `--wait` and `--seconds` are wall-clock seconds.

## Test isolation

Each `createTestGame` starts clean: a new `HeadlessPlatform` (fresh in-memory storage, clock 0, empty audio log),
every `SaveStore` drops its cached data (so module-level stores such as `suikaSave()` re-read the new, empty
storage and a best score does not leak into the next test; pending debounced writes are dropped), the UI theme is
reset to the default dark theme (the app's `boot()` sets its own again) and the rng is reseeded.

Not reset, by design: the texture registry and art/SVG caches (textures are platform-independent in Node and
re-baking would be slow), sounds the AudioManager synthesized from a library (deterministic, shared per definition
object), `Game.current` (points at the newest game), the modal z-order counter, and module-level
state in your own game code: reset that in `beforeEach` or keep it inside scenes. Vitest runs each test file in its
own module context, so leaks can only happen between tests of the same file. Always `destroy()` in `afterEach`.

## Timeouts and speed

- `vitest.config.ts` sets one budget for everything: `testTimeout` and `hookTimeout` of 30 s, about 7x the slowest
  play-through, because parallel files and other agents on the same machine slow tests down 3-5x. Don't add
  per-test timeouts (`it(..., 60_000)`); if a test gets near a few seconds, make it cheaper.
- Files run in worker threads (`pool: 'threads'`, much faster to start than forked processes on Windows), each file
  isolated (`isolate` stays on: the texture registry and other process-wide state would leak between files).
- Use `render: 'none'` (plus `pixelRatio: 1` without screenshots) for game tests, see Render modes above; advance in
  bigger chunks (`advance(0.9)` instead of many `step(1)` calls); test one device unless the device matters.
- Apps that synthesize their audio from the library (no rendered files) pay that once per test file, not per test
  game: the AudioManager shares synthesized PCM between managers. It still shows up as a slow first test.
- Tests that call `game.update()`/`game.render()` directly bypass the render modes: keep their drawn-frame count
  small (the particle stress test draws 30 frames and only updates the rest).
- Find slow files and tests: `pnpm exec vitest run --reporter=json --outputFile=$env:TEMP\vitest.json`, then sort
  `testResults[].endTime - startTime` and `assertionResults[].duration`. Profile a flow outside Vitest with
  `node --cpu-prof --import tsx script.ts` (Vitest workers exit before a `--cpu-prof` profile is written).
- When an unrelated test times out under load, rerun that file alone (`npx vitest run path`) before judging.

## CLI reference: pnpm shot and pnpm shot:browser

Both tools share one parser (`tools/shot/args.ts`). An unknown option prints the full usage and exits 1;
`--help` prints it. Values can also be given as `--opt=value`.

| Option | shot (headless) | shot:browser | Default |
|---|---|---|---|
| `--app <dir>` | yes | yes | package.json `engine.app` (`game`), else `sandbox` |
| `--scene <name>` | yes | yes | the app's start scene |
| `--params <json>` | yes | yes | none; `{open:settings}` (quotes stripped by PowerShell 5) is accepted too |
| `--device <list>` | yes | yes | `iphone-14`; comma list, `WxH@dpr`, or `all` |
| `--tap <target>` | yes | yes | selector or stage point `x,y`; repeatable, in order |
| `--drag "<from>\|<to>"` | yes | yes | two targets, 12 steps, in order with taps/waits |
| `--wait <s>` | simulated time | real time | between actions |
| `--seconds <n>` | simulated, `0.3` | real time, `0.5` | time before the shot |
| `--seed <n>` | yes | yes (`?seed=`) | `1` |
| `--input engine\|touch\|mouse` | engine/touch (same) | all three | `engine` |
| `--out <file>` | yes | yes | `.shots/<app>-<scene>-<device>.png` / `.shots/browser-<scene>-<device>.png`; with several devices one file each, the device before the extension (`x.png` -> `x-iphone-se.png`) |
| `--scale css\|device\|<n>` | all | `css`, `device` | `css` (CSS px) |
| `--dump` | yes | yes | print the node tree |
| `--lint` | yes | yes | print UI lint; exit 1 on errors |
| `--bounds` | yes | yes | also write `<file>-bounds.png` |
| `--no-insets` | yes | yes | ignore the device's safe-area insets |
| `--browser <exe>` | no | yes | `CHROME_PATH`, Chrome, then Edge |
| `--timeout <s>` | no | yes | `20` (page boot) |

Examples:

```powershell
pnpm shot --scene play --tap 375,900 --wait 1 --dump
pnpm shot --app sandbox --scene ui-menu --params '{"open":"settings"}' --device all --lint
pnpm shot --app archer --scene play --device "iphone-se-land,ipad-land" --out .shots/hud.png   # hud-iphone-se-land.png, hud-ipad-land.png
pnpm shot:browser --scene title --tap "#start" --wait 0.5 --input touch
```

Other CLIs use the same default app: `pnpm build`, `pnpm dev`, `pnpm audio` (each has `--help`).
pnpm is configured with `reporter: silent` (pnpm-workspace.yaml) so `pnpm <script>` does not echo `$ command` to
stderr; for installs use `pnpm install --reporter=default` to see pnpm's own output and errors.

## Encoding lint

`pnpm lint:encoding` checks git-tracked and new text files (`.ts .json .md .html .css .yaml`, skipping
node_modules, dist, .shots) and prints `file:line:col  rule  message` plus the line; exit 1 on findings:

- `bom`: UTF-8 BOM (PowerShell 5 `Set-Content -Encoding utf8` adds one). `pnpm lint:encoding --fix` strips BOMs.
- `invalid-utf8`: bytes that are not UTF-8, usually a file saved in the ANSI/GBK code page.
- `replacement-char`: U+FFFD in the text (decoded with the wrong encoding at some point).
- `mangled-cjk`: runs of `?` in string literals/comments (or text files) where CJK characters were replaced; the
  `a ?? b` operator and English `Really??` are not flagged.
- `mojibake`: UTF-8 read as CP1252/GBK and saved again.

Run it after editing files with CJK text; `pnpm lint:encoding path/to/dir file.ts` checks only those paths. Write
files with the file tools (UTF-8, no BOM); if a tool turns CJK into `?`, use `\u` escapes in strings instead.
