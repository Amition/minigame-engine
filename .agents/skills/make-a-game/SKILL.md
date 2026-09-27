---
name: make-a-game
description: Builds a complete casual mini-game on this engine end to end - app layout (main.ts defineApp, app.json, scenes, art, audio, assets), a pure rules model with unit tests, scene wiring and HUD, art baked at boot, synthesized sound, headless playtesting with screenshots, UI lint on three devices, save data, rewarded ads, dev server on phones and multi-platform builds, plus how a tech lead splits the work among parallel workers. Uses the Suika game (合成大西瓜, game/) as the worked example. Use when asked to make, prototype, finish, polish or ship a game, add a mode/level/screen to one, or plan who builds what ("make a game", "new game", "prototype", "game loop", "gameplay", "Suika", "merge game", "做一个游戏", "新游戏", "小游戏", "玩法", "关卡", "合成大西瓜", "上线").
---

# Make a game

End-to-end order of work for a new game (or a big feature of one). Read `AGENTS.md` first. Each step names the
skill with the details; this skill is the glue and the definition of done.

Related skills: `ui-screens` (HUD, menus, lint), `code-art` (textures), `audio-design` (sfx/music),
`release-platforms` (builds), `engine-extend` (engine changes), `physics`, `testing-and-shots`, `game-feel`
(juice, particles, free sound hooks), `performance`, `input-and-i18n`.

## 1. App layout

One directory per app. The Suika game is `game/`; `sandbox/` is the engine showcase.

```
game/
  main.ts            export default defineApp({ design, scenes, start, boot })
  app.json           store metadata: name, orientation, appid per platform, ad unit ids, share title
  fruits.ts          SHARED CONTRACT: fruit levels, radii, colours, sizes every other file imports
  model.ts           pure rules (no rendering, no platform): input -> step(dt) -> events
  physics.ts         game-specific simulation used by the model (+ physics.test.ts)
  save.ts            createSave() store (best score, counters)
  scenes/            title.ts, play.ts (wiring + HUD), play-view.ts (custom Nodes), gallery.ts (art review)
  art/               painters + bake function + live-drawn Node (fruit-art.ts, fruit-bodies.ts, *.test.ts)
  audio/index.ts     export const sfx / music definitions (+ audio.test.ts)
  assets/            copied into every build; assets/audio/*.mp3 + manifest.json come from `pnpm audio`
  play.test.ts       headless playtest: taps, advance, asserts, lint on 3 devices, optional screenshots
```

Rules:

- `tsconfig.json` includes `engine tools sandbox game tests` and `vitest.config.ts` runs `game/**/*.test.ts`.
  A new app dir with another name is NOT typechecked or tested until you add it to both files.
- CLIs take `--app <dir>`. `package.json` has `"engine": { "app": "game" }` and `tools/common/app.ts`
  `defaultApp()` reads it, but some CLIs may still default to `sandbox`: always pass `--app game`.
- Game code imports only `'@engine'` (never `@engine/testing`, `node:*`, `window`, `wx`).

## 2. Freeze the shared contract first

Before any parallel work, write the small files everybody imports and do not change their signatures later:

- Data contract (`fruits.ts`): the list of pieces with ids, display names, sizes, colours, points, and the
  derived constants (`MAX_LEVEL`, `JAR_WIDTH`, `FRUIT_TEX_PAD`).
- Art contract (top of `art/fruit-art.ts`): `bakeFruitArt(resolution)`, `fruitTexture(level)`,
  `drawFruitFace(ctx, level, r, face)`, `class FruitNode extends Node` with `radius`, `face`, `squash()`.
  A stub that draws coloured circles is enough for the scene worker to start.
- Audio contract (comment at the top of `audio/index.ts`): every sound name, when it plays and with which
  `rate`/`volume` (e.g. `merge` at `rate = 1.25 - level * 0.05`).
- Model contract: event union (`SuikaEvent`) and the public methods the scene calls (`setAim`, `drop`, `step`).

## 3. Rules model + unit tests

Keep rules pure: plain TypeScript, seeded `Rng`, fixed `step(dt)`, no Nodes, no platform calls. The scene
turns input into model calls and model events into visuals and sounds.

```ts
import { Rng } from '@engine';

export type MatchEvent = { type: 'score'; points: number } | { type: 'gameover'; score: number };

export class MatchModel {
  readonly rng: Rng;
  state: 'playing' | 'over' = 'playing';
  score = 0;
  private pending: MatchEvent[] = [];

  constructor(opts: { seed?: number } = {}) {
    this.rng = new Rng(opts.seed ?? 1);
  }

  /** Input from the scene; effects are reported by the next step(). */
  tap(points: number): void {
    if (this.state !== 'playing') return;
    this.score += points;
    this.pending.push({ type: 'score', points });
  }

  /** Fixed-rate advance; returns what happened since the last call. */
  step(_dt: number): MatchEvent[] {
    const events = this.pending;
    this.pending = [];
    if (this.state === 'playing' && this.score >= 100) {
      this.state = 'over';
      events.push({ type: 'gameover', score: this.score });
    }
    return events;
  }
}
```

Test it next to the code (`model.test.ts`): determinism for a seed, scoring, combo/danger/game-over edges,
revive. `game/physics.test.ts` and `game/play.test.ts` show the style. Never use `Math.random()` or wall time
in rules; seed from params (`PlayScene` takes `{ seed }` so tests and shots are reproducible).

## 4. Scenes, HUD and the fixed step

`game/scenes/play.ts` is the reference:

- `onEnter(params)`: read `game.safe` / `this.width` to size the play area, create the model, build layers
  (`backdrop`, `jar`, `fruits`, `fx`), build the HUD with `ui.*` and `mountScreen(...)`, start music.
- Simulation: `fixedUpdate(this, 60, (step) => { if (!this.halted) this.handle(this.model.step(step)); })` in
  `onEnter` (node-bound: stops when the scene is destroyed, pauses with it). `update(dt)` only syncs nodes to
  bodies. Physics that stacks or rolls uses `RigidWorld` (see `physics`); `game/physics.ts` adapts it to fruits.
- Input: one node covering the play area (tag `lint-surface`) driven by
  `onAim(zone, { start, move, release, cancel }, { space: this.jar, enabled: () => !this.halted })`;
  `a.x` is already in jar space. Keyboard / gamepad: `createInputActions` (see `input-and-i18n`).
- Pause and game over are `showModal` / `showDialog` in the overlay; stop simulation with a `halted` flag.
  Restart with `this.game.scenes.restart({ transition: 'fade', duration: 0.3 })`.
- Give important nodes ids (`#score`, `#pause`, `#jar`) and override `kind` / `describe()` on custom Nodes
  (`Fruit[level=3]`) so tests, `--dump` and lint can find them.

HUD and menus: see `ui-screens`. Juice (popIn, punch, shake, particles, tweens): see `game-feel`.

## 5. Art baked at boot

Bake every texture once in `boot()` (or on first use, cached), never per frame, at the device's resolution:
`bakeTexture(w, h, draw, { resolution: 'auto', key })`, or `bakeFruitArt(autoTextureResolution())` in
`game/main.ts` (about 4x less texture memory than a fixed 2 on most phones; check with `textureStats()`, see
`performance`). Put painters in `art/`, add an art review scene (`scenes/gallery.ts`) and
check it with `pnpm shot --app game --scene gallery`. Details: `code-art`.

## 6. Audio

Write `audio/index.ts` (`export const sfx`, `export const music`), create the manager in `boot()`:
`createAudioManager(game, { library: { sfx, music } })`, then play by name with `playSound('merge', { rate })`,
`playSong('bgm', { fadeMs: 1200 })`, `stopSong(600)`; pause-menu toggles use `isAudioMuted` / `setAudioMuted`.
All of them no-op when no manager exists, so no `getAudioManager()?.` chains.
Render files with `pnpm audio --app game` and read the analysis table. Details: `audio-design`.

## 7. Save data and settings

```ts
import { createSave, type SaveStore } from '@engine';

export interface MySave { best: number; games: number }
const store = createSave<MySave>('mygame', { best: 0, games: 0 });
export function mySave(): SaveStore<MySave> {
  return store;
}
```

A module-level store is safe: it reads storage lazily on first access, and every `createTestGame` reloads all
stores from its fresh storage, so tests never share a best score.

`set(patch)` / `update(fn)` schedule a debounced write (hiding the app flushes); call `flush()` at game over and
in `onExit()`. Bump `version` + `migrate` when the shape changes. Audio mutes/volumes are persisted by the
AudioManager itself (`setMuted('sfx', true)`), so the pause menu toggles need no save code.

## 8. Rewarded ads

Ad unit ids live in `app.json` (`ads.wx.rewarded`, ...). Call `configureAds(appJson.ads)` once in `boot()`.
The flow in `PlayScene.onGameOver()`:

```ts
import { canShowAd, showDialog, showRewardedAd, showToast } from '@engine';

async function offerRevive(revive: () => void, restart: () => void): Promise<void> {
  const canRevive = canShowAd('rewarded');
  const dialog = showDialog({
    title: '游戏结束',
    vertical: true,
    closeOnBackdrop: false,
    buttons: [
      ...(canRevive ? [{ id: 'revive', text: '看广告复活', action: 'revive', variant: 'secondary' as const }] : []),
      { id: 'again', text: '再来一局', action: 'again', variant: 'success' as const },
    ],
  });
  if ((await dialog.closed) === 'revive') {
    if (await showRewardedAd('rewarded')) return revive();
    showToast('广告未看完，无法复活');
  }
  restart();
}
```

`showRewardedAd()` resolves `true` only when the video was watched to the end and never rejects.
`canShowAd()` is true when the current platform has a unit id (or on web/headless, where ads are simulated);
never branch on `platform().name` for ads. Web shows a simulated 2 s ad;
headless resolves `t.platform.ads.rewardedResult` (default `true`) and records `t.platform.ads.calls`.
Offer a revive once per run; hide the button when the platform has no unit id.

## 9. Playtest headlessly and look at it

Write `play.test.ts` with `createTestGame` (see `game/play.test.ts` and `references/templates.md`):

```ts
const t = await createTestGame({ app, device: 'iphone-14', scene: 'play', params: { seed: 3 } });
const scene = t.scene as PlayScene;
const jar = t.get('#jar');
const rng = new Rng(11);
for (let i = 0; i < 40 && scene.model.state === 'playing'; i++) {
  await t.tap({ x: jar.toWorld(rng.float(40, 670), 0).x, y: jar.toWorld(0, 400).y });
  await t.advance(0.9);
}
await t.screenshot('.shots/game-play-iphone-14.png');
```

- Assert on the model (`drops`, `merges`, `score`, `state`) and on the tree (`t.find('#score')`,
  `t.findAll('Fruit')`, `openModalsOf().length`, `t.played()` for sounds).
- Screenshots: gate them behind an env var and Read the PNGs:
  `$env:GAME_SHOTS=1; pnpm test game/play.test.ts; Remove-Item Env:GAME_SHOTS`, then Read
  `.shots/game-play-iphone-14.png`. Look for clipped or overlapping text, HUD covering the play area, pieces
  outside the jar, unreadable colours, empty areas on tall/tablet screens.
- One scene, any state: `pnpm shot --app game --scene play --device "iphone-se,iphone-14,ipad" --lint --bounds`
  (`--tap "#pause" --wait 0.5` to open the pause menu first, `--dump` for the node tree). PowerShell splits an
  unquoted `a,b,c` into separate words, so always quote comma lists (`--device`, `--only`, `--target`).
- More: `testing-and-shots`.

## 10. Lint on three devices

Every screen and dialog: 0 lint errors on `iphone-se`, `iphone-14`, `ipad`. Put it in the test (as
`game/play.test.ts` does for the HUD, pause menu and game-over dialog):

```ts
for (const device of ['iphone-se', 'iphone-14', 'ipad']) {
  const t = await createTestGame({ app, device, scene: 'play', params: { seed: 1 } });
  await t.advance(0.5);
  const issues = lintUI(t.game.stage, t.game);
  expect(issues.filter((i) => i.severity === 'error'), `${device}\n${formatLint(issues)}`).toHaveLength(0);
  t.destroy();
}
```

## 11. Run on phones, build for platforms

- `pnpm dev --app game` prints `http://localhost:5173/` and LAN URLs: open a LAN URL on a phone on the same
  Wi-Fi. `/frame` shows three phone sizes side by side; `?scene=play&params={"seed":3}` opens a scene.
- `pnpm build --app game --target all` (add `--minify` for release): `dist/web`, `dist/wx`, `dist/tt`,
  `dist/tap` (+ `dist/tap.zip`), `dist/233` (needs the converter). Read the size table; wx/tt fail above 4 MB.
  Details and store checklists: `release-platforms`.

## 12. Splitting the work (for a tech lead)

1. Lead writes the contracts (section 2) + `main.ts` + scene names, commits them, then fans out.
2. In parallel, each worker owns disjoint files:

| Worker | Owns | Needs from contract | Verifies with |
|---|---|---|---|
| rules | `model.ts`, `physics.ts`, tests | data + event union | `pnpm test game/` |
| art | `art/**`, `scenes/gallery.ts` | data (sizes/colours), art API | `pnpm shot --app game --scene gallery`, art tests |
| audio | `audio/**`, `assets/audio/**` | sound-name list + rates | `pnpm audio --app game --preview`, audio test |
| scenes/UI | `scenes/title.ts`, `scenes/play.ts`, `play-view.ts`, `save.ts`, `play.test.ts` | all contracts (stubs ok) | playtest + lint on 3 devices |

3. Lead merges, runs `pnpm check`, the playtest with screenshots, `pnpm build --app game --target all`, and
   reads every PNG before reporting.

Give each worker: the files it owns, the contract files it must not change, the exact verify commands, and
"report back: changed files, commands run, screenshots read, open issues".

## Definition of done

- [ ] `pnpm typecheck` clean, `pnpm test` green (model tests, art tests, audio test, playtest).
- [ ] Playtest drives a full run to game over and back (restart / revive) without errors.
- [ ] Screenshots of title, play (early + late), pause, game over read on iphone-se, iphone-14, ipad.
- [ ] `lintUI` 0 errors on those screens on the three devices (warnings reviewed).
- [ ] Art baked once at boot at resolution 2; gallery scene reviewed.
- [ ] `pnpm audio --app game` verdicts `ok` (or understood); music loops; sfx in the music's key.
- [ ] Best score / counters persist (`createSave`), flushed at game over and on exit.
- [ ] Rewarded revive works on web (simulated) and is hidden without an ad unit id.
- [ ] `pnpm build --app game --target all --minify` ok; wx/tt packages under 4 MB.
- [ ] Tried on a real phone through `pnpm dev --app game` (LAN URL); platform devtools for store builds.

## Pitfalls

- Starting parallel work before the contracts exist: workers invent incompatible names and sizes.
- Rules inside the scene: impossible to unit-test and replay; keep `model.ts` pure.
- `Math.random()` / `Date.now()` in rules: runs are not reproducible; use `new Rng(seed)`.
- Baking textures in `update()` or per spawn: stutter; bake once and reuse.
- Laying out against `design` height: tall phones and iPads show gaps; use `game.view` and `game.safe`.
- Scene operations inside `onEnter`: don't `await game.scenes.go(...)` there (queued; call without await).
- Forgetting `flush()` on save before a scene change that may be the last thing the player does.
- Headless and browser shots do not prove a mini-game works: test builds in the real devtools/phones.

## Worked example

`references/suika-file-map.md` maps every file of `game/` to the step it demonstrates and traces one merge
from input to sound. `references/templates.md` has copy-ready `main.ts`, scene, save and test skeletons.
