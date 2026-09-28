---
name: release-platforms
description: Packages and ships a game from this repo to the web and to mini-game platforms - pnpm build --target web|wx|tt|tap|233|all with --app and --minify, the dist/<target> layouts, the size table and the 4 MB main-package limit, app.json (name, version, orientation, appid, ad unit ids, share), the 233 minihost converter setup, platform differences (WeChat, Douyin, TapTap, 233), a device testing ladder, what only real devtools and phones can prove, and pre-release checklists. Use when building, packaging, uploading, submitting for review, fixing a build or size failure, or setting app ids, ads and share content ("build", "release", "publish", "deploy", "package", "upload", "WeChat mini game", "Douyin", "TapTap", "233", "打包", "发布", "上线", "微信小游戏", "抖音小游戏", "包体", "审核", "广告位").
---

# Release to web and mini-game platforms

One codebase, five targets. The build bundles `<app>/main.ts` (default export `AppDef`) with esbuild into a
single ES2017 IIFE `game.js`, writes the target's config files, copies `<app>/assets/**` (dotfiles skipped) and
prints a size table plus `game.js` per source folder. Source: `tools/build/` (`build.ts`, `config.ts`,
`files.ts`, `release.ts`, `convert233.ts`).

## Commands

```powershell
pnpm audio --app game                                              # render sounds first (see audio-design)
pnpm build --target all --app game --minify                        # dist/{web,wx,tt,tap,233} + dist/tap.zip
pnpm build --target "wx,tt" --app game --minify                    # comma lists must be quoted in PowerShell
pnpm build --target web --app game --out out --dev                 # dev build: sourcemap, window.__engine, error overlay
```

Pass `--app` explicitly (the default is package.json `engine.app`, currently `game`; without it, `sandbox`). The
command exits 1 when any target fails, or when the only requested target was skipped (233 without converter).
Never ship `--dev` builds.

| Target | Output | Upload / open |
|---|---|---|
| `web` | `dist/web/index.html`, `game.js`, `assets/` | any static HTTP host (not `file://`) |
| `wx` | `game.js`, `game.json`, `project.config.json`, `assets/` | import `dist/wx` in WeChat DevTools |
| `tt` | same file names, Douyin formats | import `dist/tt` in Douyin DevTools |
| `tap` | `game.js`, `game.json`, `assets/` + `dist/tap.zip` | upload `dist/tap.zip` |
| `233` | wx build converted: `dist/233/game.zip` | upload to the 233 minihost console |

Real output for the Suika game (`pnpm build --target all --app game --minify`, `dir` column omitted; the 233
row counts the converted package: its ES5 `game.js` plus the converter runtime):

```
target  game.js   assets         package   limit    upload                      status
web     260.3 KB  489.0 KB (12)  750.2 KB  -        -                           ok
wx      263.6 KB  489.0 KB (12)  753.4 KB  4.00 MB  -                           ok
tt      263.5 KB  489.0 KB (12)  752.8 KB  4.00 MB  -                           ok
tap     263.8 KB  489.0 KB (12)  752.9 KB  4.00 MB  dist/tap.zip 561.4 KB       ok
233     337.0 KB  489.0 KB (12)  827.0 KB  -        dist/233/game.zip 575.3 KB  ok

web game.js by source folder: 260.3 KB, gzip 89.9 KB
  engine/ui           73.3 KB   28.2%
  engine/world        48.8 KB   18.7%
  game/art            20.0 KB    7.7%
  ...
```

Archer (`--app archer`): web 294.6 KB, wx 298.0 KB game.js, 233 `game.js` 377.5 KB (zip 722.0 KB). The folder
breakdown (esbuild metafile: bytes each source folder contributes to the output) is printed once per run; check it
when `game.js` grows. `(release-stub)` is the empty sound library, `(bundle glue)` esbuild's wrapper and helpers.

Limits: wx and tt fail above 4 MB (code + assets, source maps excluded; Douyin itself allows 20 MB without
subpackages, the build keeps both at 4 MB). tap warns above 4 MB (hard cap 60 MB). There are no subpackages.
Other failures: esbuild errors, `game.js is not portable` (a `node:` import, `require(...)` or `@napi-rs`
reached the bundle: engine/game code imported `@engine/testing` or a Node module), and (release builds) an audio
manifest that misses a sound of `<app>/audio/index.ts` (`run "pnpm audio --app <app>"`). A warning lists asset
file types uploads reject (for example `.webp`; use `.png`/`.jpg`, `.mp3`, `.json`).

## What release builds drop

Release builds (everything but `--dev`) define `process.env.NODE_ENV` as `'production'`, and esbuild removes code
behind an inline `if (process.env.NODE_ENV !== 'production') { ... }` (an early `return` does not work):

- the AudioManager's synth fallback (`renderSfx` / `renderSong`, the song parser, instruments, DSP) and the
  platforms' `loadPcm` (WAV writing / PCM decode);
- the sound library imported by `<app>/main.ts`: `tools/build/release.ts` hands `main.ts` an empty
  `export const sfx = {}; export const music = {};` (only when `audio/index.ts` exports nothing but `sfx` / `music`;
  other importers such as the sandbox audio lab keep the real module). First it imports the library (the build runs
  under tsx) and fails when `assets/audio/manifest.json` lacks a name, has the wrong kind or a missing file;
- `AppDef.devScenes` (galleries, previews), written as
  `devScenes: process.env.NODE_ENV === 'production' ? undefined : { gallery: () => new GalleryScene() }`; `bootApp`
  registers them in dev, tests and `pnpm shot` only;
- the debug overlay when unused (`debugDraw` is `/* @__PURE__ */`).

Keep dev-only code in that shape; a `const isDev = ...` variable or a helper function defeats the removal. Verify
with an unminified release build: `class GalleryScene` / `function renderSong` must be absent (their call sites stay
as text inside `if (false)` until `--minify` deletes them).

## app.json

```json
{
  "name": "合成大西瓜",
  "version": "0.1.0",
  "orientation": "portrait",
  "background": "#ffe9a8",
  "appid": { "wx": "", "tt": "", "tap": "" },
  "ads": {
    "wx": { "rewarded": "", "interstitial": "" },
    "tt": { "rewarded": "", "interstitial": "" },
    "tap": { "rewarded": "", "interstitial": "" }
  },
  "share": { "title": "合成大西瓜，你能合出几个？", "imageUrl": "", "query": "" },
  "innerAudioOption": { "obeyMuteSwitch": false }
}
```

- `name` (page title, project name), `orientation` (`game.json` `deviceOrientation`), `background` (web page).
- `appid.*` goes into `project.config.json`; empty ids become `touristappid` (wx) / `testAppId` (tt), which run
  in the devtools but cannot upload or show real ads.
- `share` is the passive share-menu content on mini-games (passed to the platform factory at build time).
- `innerAudioOption` (optional) is passed to `setInnerAudioOption` at startup on mini-games: `obeyMuteSwitch: false`
  plays through the iPhone mute switch, `mixWithOther: false` pauses other apps' audio. Omit it to keep the host
  defaults (unverified on devices: which keys each host honours).
- `ads` is read by game code. Pattern from `game/scenes/play.ts`:

```ts
import { platform } from '@engine';
import appJson from './app.json';

export function rewardedUnit(): string {
  return (appJson.ads as Record<string, { rewarded: string }>)[platform().name]?.rewarded ?? '';
}

export function canOfferAd(unit: string): boolean {
  const name = platform().name;
  return unit !== '' || name === 'web' || name === 'headless';
}
```

Web simulates rewarded ads (about 2 s overlay, resolves true); headless resolves `platform.ads.rewardedResult`.
On mini-games hide ad buttons when the unit id is empty.

## 233 converter

`pnpm build --target 233` builds wx, then runs the Tuanjie/Unity minihost `wx_converter.py` (Python 3) which
transpiles to ES5 with babel, prepends its runtime and zips `dist/233/game.zip`. Babel un-minifies the bundle
(Suika: 264 KB wx → 598 KB), so with `--minify` the build minifies `dist/233/game/game.js` again with esbuild
(ES5 target, so no newer syntax sneaks in: 598 → 336 KB), checks that it parses and re-zips; if esbuild fails the
converter output ships unminified with a warning. Setup once: clone the converter into `%TEMP%\minihost-converter`
(or set `MINIHOST_CONVERTER=<dir with wx_converter.py>`); its `npm install` runs automatically. Without it the
target is skipped with these instructions. The re-minified bundle is only proven by parsing and the headless
suite; smoke-test it in the 233 host (unverified on devices).

## Platform differences (encoded in `engine/platform/{wx,tt,tap,minigame}.ts`)

| Topic | WeChat (wx, also 233) | Douyin (tt) | TapTap (tap) |
|---|---|---|---|
| Vibrate | `vibrateShort({ type: 'light' })` | no `type` | `{ type }` like wx |
| Sfx audio | `useWebAudioImplement` for short files | InnerAudioContext without options; `rate` needs base lib 2.33.0; only 8-48 kHz standard rates | default |
| Interstitial | one instance per unit, reused | new per show; rejected in the first 30 s and within 60 s of the last ad (resolves quietly) | new per show |
| Rewarded | `isEnded` | `count` wins; with no fill may open a share dialog and report success | `isEnded` |
| Login | code only, not required | `force: true` by default (login dialog for logged-out users) | mandatory for review; auto login at startup, code valid 5 min |
| Share | share menu with `share` content | same | templates configured in the TapTap console |

Game code never touches `wx`/`tt`/`tap`/`window`: use `platform()` (`ads.rewarded/interstitial`, `vibrate`,
`share`, `login`, `storage`). Fonts on mini-games default to `sans-serif`.

Frame rate, memory and storage (all platforms go through the Game; unverified on real devices):

- `game.setFrameRate(30)` (or `frameRate` in the AppDef / GameConfig) caps the loop, 1-60. Mini-games call the
  host's `setPreferredFramesPerSecond`; web (and runtimes without it) skip `requestAnimationFrame` frames. `dt`
  stays real time. Use 30 on menus, pause and result screens, 20 for a static title; restore 60 for gameplay.
- Mini-games forward `onMemoryWarning` to `game.memoryWarning()`: it clears the tint cache, emits
  `'memorywarning'` (free what the game can rebuild: `releaseTexture`, `TileMap.releaseChunks`, cached
  containers) and calls `triggerGC` (wx/tt/tap when present; web has neither).
- Storage reads `getStorageInfoSync().keys` once per launch and keeps the list in step with set/remove
  (`MiniGameStorage.refresh()` after writing storage outside the platform).

## Testing ladder

1. `pnpm check` (typecheck + all tests), gameplay tests, `lintUI` on three devices (see `testing-and-shots`).
2. `pnpm shot --app game --scene <s> --device "iphone-se,iphone-14,ipad" --lint` for every screen.
3. `pnpm dev --app game`: desktop browser, `/frame` shows three phone sizes; `?scene=play&insets=47,0,34,0`
   simulates a notch. Open the printed LAN URL on a phone (same Wi-Fi) for real touch and audio unlock.
4. `pnpm build --target all --app game --minify`, then open `dist/wx` / `dist/tt` in the official devtools,
   play a full session, and use the devtools' real-device preview (QR code) on an iPhone and a low-end Android.

Only devtools and real phones prove: ad fill and callbacks, interstitial timing rules, login and share dialogs,
audio latency, loop seams and playback-rate support, real safe-area values and notches, touch feel, frame rate
and memory on low-end Android, font and CJK rendering, storage persistence across restarts, upload acceptance
(file types, size) and store review. Headless tests and screenshots cannot.

## Pre-release checklist

- [ ] `pnpm check` green; UI lint clean on iphone-se, iphone-14, ipad; screenshots Read.
- [ ] `pnpm audio --app game` rendered; manifest and MP3s committed; no verdict issues.
- [ ] `app.json`: name, bumped `version`, orientation, background, real app ids, ad unit ids, share title/image.
- [ ] `pnpm build --target all --app game --minify`: every row `ok`, no warnings, packages well under 4 MB.
- [ ] No `--dev` build; review scenes (galleries, previews) live in `devScenes`, so release builds lack them.
- [ ] WeChat: `dist/wx` runs in WeChat DevTools with the real appid; rewarded/interstitial units tested on a
      phone; share menu shows the right title; upload from the devtools.
- [ ] Douyin: `dist/tt` in Douyin DevTools with the real appid; no interstitial in the first 30 s or within 60 s
      of another ad; rewarded flow handles "no fill"; test on a phone.
- [ ] TapTap: login works on a phone (auto login at startup), share templates set in the console, upload
      `dist/tap.zip`.
- [ ] 233: `dist/233/game.zip` produced (converter installed), smoke-tested in the 233 host.
- [ ] Store listing, privacy and age-rating requirements checked against each platform's current docs.

## Pitfalls

- Building without `--app` packages the sandbox showcase.
- Assets must live in `<app>/assets`; files starting with `.` (like `.render-cache.json`) are never copied.
- Big PNG backgrounds and long music loops are what blow the 4 MB budget: prefer code art (`code-art` skill)
  and lower song `kbps` (`audio-design` skill).
- A release build failing with `missing ... sound(s)`: a sound was added to `audio/index.ts` without re-rendering;
  run `pnpm audio --app <app>` and commit the manifest and MP3s.
- Registering a gallery in `scenes` (or a `devScenes` object without the `NODE_ENV` ternary) ships it and its art.
- `project.config.json` sets `es6: false` and no devtools minify: `game.js` is already ES2017 (minified with
  `--minify`); do not turn devtools transpiling on.
