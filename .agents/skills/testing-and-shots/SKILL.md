---
name: testing-and-shots
description: >-
  How to verify games built on this engine without a phone: Vitest tests with createTestGame (headless game;
  tap/drag/press/advance, find/get/dump, screenshot/png, played sounds), render modes and pixelRatio for fast tests,
  seeds and determinism, test isolation, playing a whole game inside a test, UI lint (lintUI, --lint, --bounds),
  headless and real-browser screenshots (pnpm shot, pnpm shot:browser) and the encoding lint (pnpm lint:encoding).
  Use when writing, debugging or speeding up tests, when a test times out, when you need to look at a screen or
  check a layout on several devices, before calling UI work done, and after editing files that contain CJK text.
  Keywords: test, vitest, createTestGame, headless, screenshot, shot, browser, lint, UI lint, bounds, timeout,
  determinism, seed, encoding, BOM, 截图, 测试.
---

# Testing and screenshots

Everything here runs in Node on Windows/PowerShell: no device, no browser (except `pnpm shot:browser`).
Text beats pixels: prefer `t.dump()`, model state and `lintUI` in tests; take screenshots to look, then Read the PNG.

| Task | Command |
|---|---|
| All tests (typecheck first) | `pnpm check` = `pnpm typecheck && pnpm test` |
| One file / one test | `npx vitest run game/play.test.ts` / `npx vitest run -t "pause menu"` |
| Look at a scene | `pnpm shot --scene play` then Read `.shots/<app>-play-iphone-14.png` |
| UI check on 3 devices | `pnpm shot --scene title --device iphone-se,iphone-14,ipad --lint --bounds` |
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

## Seeds and determinism

- A test game reseeds the shared `rng` (`seed`, default 1) and runs a fixed 1/60 s step, so the same test is the
  same run every time. Game logic must use `rng` / `new Rng(seed)` from `@engine`, never `Math.random()`.
- Scenes that take a seed in params (e.g. the game's play scene: `params: { seed }`) can be replayed exactly.
- Drive random-looking input with its own generator so it does not disturb the game's `rng`:
  `const r = new Rng(11); r.float(40, 670)`.
- The CLIs use `--seed <n>` (default 1) for both headless and browser shots.

## Playing a game inside a test

Keep rules pure (model objects) and assert on the model; use taps only to drive it. The drop loop of
`game/play.test.ts`:

```ts
it('drops where the player taps and merges fruits', async () => {
  t = await createTestGame({ app, device: 'iphone-14', scene: 'play', params: { seed: 3 } });
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
}, 60_000);
```

- Convert between spaces with `node.toWorld(x, y)` / `node.toLocal(x, y)`; tap targets are stage points.
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
re-baking would be slow), `Game.current` (points at the newest game), the modal z-order counter, and module-level
state in your own game code: reset that in `beforeEach` or keep it inside scenes. Vitest runs each test file in its
own module context, so leaks can only happen between tests of the same file. Always `destroy()` in `afterEach`.

## Timeouts and speed

- Vitest's default timeout is 5 s per test, and files run in parallel with other workers on the same machine.
  Long simulations need an explicit timeout: `it('...', async () => { ... }, 30_000)`.
- Keep the default `render: 'last'`; use `render: 'none'` and `pixelRatio: 1` for long simulations; advance in
  bigger chunks (`advance(0.9)` instead of many `step(1)` calls); test one device unless the device matters.
- Tests that call `game.update()`/`game.render()` directly bypass the render modes: keep their drawn-frame count
  small (the particle stress test draws 30 frames and only updates the rest).
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
| `--out <file>` | yes | yes | `.shots/<app>-<scene>-<device>.png` / `.shots/browser-<scene>-<device>.png` |
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
