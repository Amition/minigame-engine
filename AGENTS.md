# AGENTS.md — project guide for coding agents

A self-written TypeScript 2D/2.5D game engine plus games built on it. Targets: WeChat (wx), Douyin (tt),
TapTap (tap) mini-games, 233乐园 (wx package converted by the Tuanjie converter) and the web (dev/testing).
Rendering is Canvas 2D. An AI agent writes all code, art, music and UI; the human only tests and gives feedback.
So every feature must be inspectable from code: text dumps, lint reports, headless screenshots you can Read.

## Commands (Windows / PowerShell, pnpm)

- `pnpm typecheck` — TypeScript 7 (`tsc --noEmit`). Must be clean.
- `pnpm test` — Vitest (node env). Tests live next to code (`*.test.ts`) or in `tests/`.
- `pnpm shot --scene <name> [--device iphone-se,ipad|all] [--tap "<selector>"] [--seconds 1] [--dump]`
  — headless screenshot of a sandbox scene into `.shots/`, optional tree dump. Read the PNG to look at it.
- `pnpm check` — typecheck + test.
- If `node_modules` is missing: `pnpm install --frozen-lockfile --prefer-offline`.
- GitHub needs the local proxy: `git -c http.proxy=http://127.0.0.1:7890 ...` (npm registry works directly).

## Layout

```
engine/            runtime engine, imported as '@engine' (engine/index.ts). Bundled into builds:
                   no node:*, no @napi-rs/canvas, no DOM/window/wx access outside engine/platform/.
  core/            math, emitter, rng (seeded), color, game (loop/scaling/input), app (defineApp/runApp)
  gfx/             Ctx2D/Surface types, Texture, textures registry, bakeTexture, draw helpers
  platform/        Platform interface (types.ts), current platform, adapters web/wx/tt/tap
  scene/           Node, selector, dump, Sprite, Box, Text, Scene/SceneManager
  runtime/ display/ world/ ui/ art/ audio/   feature modules, one barrel (index.ts) each
  testing/         Node-only: HeadlessPlatform, createTestGame harness, devices ('@engine/testing')
sandbox/           engine showcase app = compatibility test pack; scenes/<module>.ts per module
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
- Portable canvas subset only (see engine/gfx/types.ts): no Path2D, ctx.filter, ctx.roundRect (use
  `roundRectPath`), letterSpacing, OffscreenCanvas, DOM.
- `import type` for type-only imports (verbatimModuleSyntax). Avoid generic export names that could clash
  across barrels (`export *` conflicts are type errors).
- Keep game rules pure (no rendering) so they can be unit-tested.
