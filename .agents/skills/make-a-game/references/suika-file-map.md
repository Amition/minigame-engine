# Suika (合成大西瓜) file map

`game/` is a finished casual game built with the `make-a-game` workflow. Use it as the pattern to copy.

## Files

| File | What it is | Step it demonstrates |
|---|---|---|
| `game/main.ts` | `defineApp`: 750x1334 `expand`, scenes `title` / `play` / `gallery`, `boot()` sets the light UI theme, `configureAds(appJson.ads)`, bakes fruit art at `autoTextureResolution()`, creates the AudioManager with the synth library | app entry, bake at boot |
| `game/app.json` | name 合成大西瓜, portrait, empty appids, `ads.<platform>.rewarded/interstitial`, share title | store metadata |
| `game/fruits.ts` | `FruitDef` (level, key, name, radius, color, juice, points), `FRUITS`, `MAX_LEVEL`, `SPAWN_LEVELS`, `WATERMELON_PAIR_BONUS`, `FRUIT_TEX_PAD`, `JAR_WIDTH`, `fruit(level)` | shared data contract |
| `game/physics.ts` | `FruitPhysics`: thin adapter over the engine's `RigidWorld` (static jar walls, circle bodies that roll and sleep); merge detection from `world.touches`, impacts, `landed`, `born`, `targetR` (grow animation) | engine physics adapted to game rules |
| `game/physics.test.ts` | `FruitPhysics` (rest, stable stacks, rolling, merge growth, pair reporting, determinism) and `SuikaModel` (merge scoring, watermelon bonus, cooldown/spawn, game over, a whole random game) | simulation + rules tests |
| `game/model.ts` | `SuikaModel`: dropper (`setAim`, `canDrop`, `drop`), spawn queue with weights, merges + score + combos, danger line timer, game over, `revive()`; returns `SuikaEvent[]` from `step(dt)` | pure rules |
| `game/save.ts` | `suikaSave()`: module-level `createSave('suika', { best, games, watermelons })` (loads lazily) | save data |
| `game/scenes/title.ts` | backdrop, bobbing fruits (tweens), `mountScreen` column with title / stats / start button, music | title screen |
| `game/scenes/play.ts` | jar sized from `game.safe`, touch zone with `onAim`, node-bound `fixedUpdate(this, 60, ...)`, event handling (drop, spawn, merge, impact, danger, gameover), HUD (score, best, next, pause), pause modal with sfx/music toggles, game-over dialog with rewarded revive | wiring, HUD, ads |
| `game/scenes/play-view.ts` | custom Nodes: `Backdrop`, `DangerLine`, `AimGuide`, `Ring` | view-only nodes |
| `game/scenes/gallery.ts` | art review: all 11 fruits at game size, five faces, touching pairs, rotation, squash | art review scene |
| `game/art/fruit-bodies.ts` | `fruitPainters[level](ctx, r)`: one painter per fruit, silhouette exactly the physics circle | procedural art |
| `game/art/fruit-art.ts` | art contract: `bakeFruitArt`, `fruitTexture`, `drawFruitFace`, `FruitNode` (live face, blink, squash spring) | baked + live art |
| `game/art/fruit-art.test.ts` | texture sizes, alpha exactly fills the circle, rebake, faces, FruitNode API, gallery bounds | art tests |
| `game/audio/index.ts` | contract comment with every sound and how it is played; sfx built from layered voices in F major; `bgm` song (108 bpm, 20 bars, sections A A2 B B2 A3) | audio as code |
| `game/audio/audio.test.ts` | exactly the contract names, each sfx clean and short, merge kept soft, bgm 30-60 s loop at 100-120 bpm in key, no clipping, clean seam | audio tests |
| `game/assets/audio/` | `*.mp3` + `manifest.json` written by `pnpm audio --app game` | rendered assets |
| `game/play.test.ts` | 40 random drops on iphone-14, HUD lint on 3 devices, pause/resume, forced overflow -> game over -> again | headless playtest |

## One merge, input to sound

1. `onAim(zone, ..., { space: jar })`: `start`/`move` call `model.setAim(a.x)`, `release` calls `model.drop()`.
2. `fixedUpdate(this, 60, ...)` calls `model.step(1/60)` until caught up (backlog capped at 5 steps, frozen while
   the scene is paused).
3. `SuikaModel.step` -> `FruitPhysics.step` (one `RigidWorld` step) reports touching same-level pairs from
   `world.touches` -> `merge(a, b)` removes both, adds
   the next level at the weighted centre, updates combo and score, returns `{ type: 'merge', ... }`.
4. `PlayScene.handle(events)` -> `onMerge(e)`: destroys the two `FruitNode`s, adds the new one with `squash()`,
   `splash()` particles in the fruit's `juice` colour plus a `Ring`, a `+points` popup (and a combo popup),
   `playSound('merge', { rate })` (+ `combo`, `merge-big` from level 7), `shake(jar)` from level 8, `celebrate()` for a
   watermelon, then `setScore()` which `punch`es the score label.
5. `sync(dt)` copies body positions/angles to nodes and sets faces (happy after merge, worried above the line).

## Things worth copying

- Params for reproducibility: `onEnter(params?: { seed?: number })`, seed from the clock only when absent.
- HUD reads model state; the model never touches nodes.
- Every node a test needs has an id or a `describe()` field (`#jar`, `#score`, `#pause`, `Fruit[face=worried]`).
- Game over awaits `dialog.closed`, then either revives (`canShowAd()` + `showRewardedAd()`) or restarts with
  `scenes.restart({ transition: 'fade', duration: 0.3 })`.
- Audio calls are `playSound(...)` / `playSong(...)` / `stopSong(...)`: no-ops when no manager exists.
