---
name: engine-extend
description: Adds or changes engine code (engine/, imported as '@engine') so it stays portable to mini-games, deterministic and inspectable. Covers module layout and barrels (engine/index.ts, export * name clashes), portability and determinism rules (no DOM, Math.random, setTimeout; seeded Rng), Node subclass conventions (kind, describe(), draw(ctx), anchor/local space, selectors, lint), tests next to the code, a lint-clean sandbox demo scene (sandbox/scenes/<module>.ts in sandbox/main.ts), and updating AGENTS.md plus the matching skill in the same change. Use when adding an engine module, feature, widget, Node subclass, system or platform capability, fixing an engine bug, or exporting something new from '@engine' ("engine module", "extend engine", "Node subclass", "custom node", "barrel", "export", "portability", "deterministic", "sandbox demo", "引擎", "新增模块", "扩展引擎", "节点子类", "自定义节点", "兼容性", "小游戏兼容", "示例场景", "沙盒").
---

# Extending the engine

`engine/` is bundled into every platform build and runs in four runtimes: browser, wx/tt/tap
mini-game JS engines, and Node (headless tests, `@napi-rs/canvas`). Every change must keep working in all
of them, stay reproducible under a seed, and be visible to text tools (dumps, selectors, lint).

## Workflow

1. Pick the home for the code (table below). Read two neighbouring files in that folder and copy their style.
2. Check the export names you plan to add are free (see "Naming").
3. Write the code with relative imports, following the portability, determinism and Node rules below.
4. Export it from the folder's barrel (and add a new folder barrel to `engine/index.ts`).
5. Add a unit test next to the code: `engine/<folder>/<file>.test.ts`.
6. Add or extend a sandbox demo scene; add a scene test in `tests/<module>-scenes.test.ts`.
7. Update `AGENTS.md` and the matching skill (see "Docs in the same change").
8. Run the verification checklist at the bottom.

## Where code goes

| Folder | Holds | Barrel |
|---|---|---|
| `core/` | math, emitter, rng, color, `Game` loop, `defineApp`/`runApp` | one line per file in `engine/index.ts` |
| `gfx/` | `Ctx2D`/`Surface` types, `Texture`, `textures` registry, `bakeTexture`, `roundRectPath` | `engine/index.ts` |
| `platform/` | `Platform` interface (`types.ts`), `platform()`, adapters `web`/`minigame`/`wx`/`tt`/`tap` | only `types`, `current`, `ads` are exported |
| `scene/` | `Node`, selectors, dump, `Sprite`, `Box`, `Text`, `Scene` | `engine/index.ts` |
| `runtime/` | tweens, timers, juice, gestures, input, assets, save, pools, i18n | `runtime/index.ts` (`export *`) |
| `display/` | `Graphics`, `AnimatedSprite`, `NineSlice`, particles, masks, effects | `display/index.ts` (`export *`) |
| `world/` | `World`/`Camera2D`, tilemaps, iso, collision, physics, paths | `world/index.ts` (`export *`) |
| `ui/` | flex layout, widgets, `ui.*` builder, modal/toast, lint | `ui/index.ts` (explicit list) |
| `art/` | palettes, SVG, shapes, icons, pixel art, noise, creatures, atlas | `art/index.ts` (explicit list) |
| `audio/` | synth/DSP, sfx, notation, songs, WAV, analysis, `AudioManager` | `audio/index.ts` (`export *`) |
| `testing/` | Node-only harness, `HeadlessPlatform`, devices (`@engine/testing`) | `testing/index.ts`, never re-exported by `@engine` |

Rules:

- A feature that fits a folder goes there as a new file. Create a new top-level folder only for a new
  area; give it an `index.ts` barrel with a one-line header comment and add
  `export * from './<folder>/index';` to `engine/index.ts` under "Feature modules".
- `export *` barrels pick up new files only when you add the `export * from './<file>';` line.
  `ui/index.ts` and `art/index.ts` list names explicitly: add every new public name (and its types with
  `type`) there, or it is not exported. Unlisted names stay internal on purpose.
- Inside `engine/`, import concrete files relatively (`import { Node, type NodeOptions } from '../scene/node';`).
  Never import `'@engine'` or any `index.ts` barrel from engine code: it creates import cycles, and
  `class X extends Node` then evaluates with `Node` undefined.
- Platform adapters are not exported from `@engine` on purpose: the build entry imports only the target's
  factory (`@engine/platform/wx` etc.), so other targets' code never lands in the bundle.
- `import type` for type-only imports (`verbatimModuleSyntax` makes a missing `type` a compile error).
- Node-only code (fs, `@napi-rs/canvas`, CLIs) belongs in `engine/testing/` or `tools/`, never elsewhere.

## Naming (avoid `export *` clashes)

Every public name from every barrel lands in one namespace. Two barrels exporting the same name is a
compile error (TS2308 "has already exported a member named ...") that breaks `pnpm typecheck` for everyone.

- Before adding a public name, search for it:
  `rg -n "export (const|function|class|type|interface|enum) Sparkline\b" engine`.
- Prefix generic names with the module: `drawArtShape`, `pcmFilter`, `uiColor`, `resolveUITexture`,
  `sparklinePoints`. Types follow the owner: `SparklineOptions`, `UIButtonSize`.
- Already taken at the top level (do not reuse): `clamp`, `clamp01`, `lerp`, `invLerp`, `remap`, `wrap`,
  `approach`, `damp`, `dist`, `vec2`, `rect`, `insets`, `TAU`, `after`, `every`, `wait`, `nextFrame`,
  `Timer`, `rng`, `Rng`, `hashString`, `parseColor`, `toCss`, `platform`, `textures`, `ui`, `buildUI`.
- Keep helpers that only one file needs unexported (or unlisted in an explicit barrel).

## Portability rules

Only `engine/platform/` and `engine/testing/` may touch runtime globals. Everywhere else:

- No DOM or runtime globals: `document`, `window`, `wx`, `tt`, `navigator`, `Image`, `OffscreenCanvas`,
  `createImageBitmap`. Get canvases, images, text files, storage, audio, time and vibration from the
  platform: `platform().createCanvas(w, h)`, `platform().loadImage(path)`, `platform().readText(path)`,
  `platform().storage`, `platform().audio`, `platform().now()`, `platform().vibrate('short')`.
- Portable canvas subset only (`engine/gfx/types.ts`): no `Path2D` (use `svgPath`/`traceSvgPath`), no
  `ctx.roundRect` (use `roundRectPath(ctx, x, y, w, h, r)`), no `ctx.filter`, `ctx.letterSpacing`,
  `ctx.reset`, `createConicGradient`. Blur/glow: `shadowBlur`/`shadowColor` or the art bake effects.
- No `node:*`, `@napi-rs/canvas`, `require`, or `process` (the build defines only `process.env.NODE_ENV`).
  `pnpm build` fails when `game.js` references node modules.
- Nothing at import time: no `platform()` calls (it throws before `runApp`/`createTestGame`), no canvas
  creation, no registering into global registries from a module's top level (UI builder types are the one
  existing exception). This also keeps unused code tree-shakeable.
- Output is ES2017 (esbuild lowers syntax, nothing is polyfilled). Stay within the `ES2020` lib the
  typecheck allows; avoid regex lookbehind and very new APIs.
- A new platform capability means: add it to `Platform` in `engine/platform/types.ts`, implement it in
  `web.ts`, `minigame.ts` (plus `minigame-api.ts` types and `wx.ts`/`tt.ts`/`tap.ts` differences) and
  `engine/testing/headless.ts` (record calls so tests can assert them), and cover it in
  `engine/platform/minigame.test.ts` with the fake API there. The typecheck flags any missing implementation.

Self-check (only doc comments and the engine's own `Graphics.roundRect` method may match):

    rg -n "Math\.random|Date\.now|performance\.now|setTimeout|setInterval|document\.|window\.|\bwx\.|\btt\.|from 'node:|@napi-rs|new Path2D|\.roundRect\(|ctx\.filter|letterSpacing|OffscreenCanvas|createConicGradient|createImageBitmap" engine --glob "!engine/platform/**" --glob "!engine/testing/**" --glob "!**/*.test.ts"

## Determinism and time

- Randomness: never `Math.random()`. Take an optional `seed?: number | string` and build the generator like
  `ParticleEmitter` does: `seed !== undefined ? new Rng(seed) : rng.fork()` (`rng` is the shared default;
  the test harness reseeds it to `seed ?? 1`, so forks are reproducible too). Pure helpers take an `Rng`
  parameter instead of reading a global.
- Time: use the `dt` passed to `update(dt)` / systems (seconds, already time-scaled) or `game.time`
  (`elapsed`, `realElapsed`, `dt`, `frame`, `timeScale`). Delays: `after(s, fn)`, `every(s, fn)`,
  `await wait(s)` from the runtime timers. Never `setTimeout`/`setInterval`/`Date.now()`: headless tests
  advance simulated time, so wall-clock code breaks tests and screenshots.
- Per-frame services: implement `System` (`update(dt)`) and register with `game.addSystem(sys, priority)`,
  which returns a remover (lower priority runs first; tweens/timers use -100). Keep one instance per game
  in a `WeakMap<Game, ...>` (see `engine/runtime/ticker.ts`); resolve the game with an explicit parameter
  or `Game.current`. Offer `attach(game, owner?)` that removes itself when `owner` emits `'destroyed'`
  (see `PhysicsWorld.attach` in `engine/world/physics.ts`).
- Iteration order must not depend on `Map`/`Set` insertion races or object key order of numeric-like keys;
  sort explicitly when the order affects results.

## Node subclass conventions

Local space: `draw(ctx)` paints in the node's own box `(0,0)-(width,height)`; `(x, y)` places the anchor in
the parent; the anchor (fractions of width/height) is also the pivot for rotation, scale and skew.
`render()` applies the transform, alpha, blend and clip, then calls `draw`, children (by `zIndex`), `drawOver`.

```ts
// engine/chart/sparkline.ts — example of a new module file
import type { Color } from '../core/color';
import type { Ctx2D } from '../gfx/types';
import { Node, type NodeOptions } from '../scene/node';

export interface SparklineOptions extends NodeOptions {
  color?: Color;
  thickness?: number;
  /** Samples kept (default 64). */
  capacity?: number;
}

/** Samples → flat [x0, y0, x1, y1, ...] spanning (0,0)-(w,h), min at the bottom. Pure, so it is unit-tested. */
export function sparklinePoints(values: readonly number[], w: number, h: number): number[] {
  const out: number[] = [];
  if (values.length === 0) return out;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  values.forEach((v, i) => out.push(i * step, h - ((v - min) / span) * h));
  return out;
}

/**
 * Line chart of recent samples.
 *
 *     const s = scene.add(new Sparkline({ width: 300, height: 80, color: '#38bdf8' }));
 *     s.push(score);
 */
export class Sparkline extends Node {
  color: Color;
  thickness: number;
  capacity: number;
  readonly values: number[] = [];

  constructor(opts: SparklineOptions = {}) {
    super();
    this.width = 200;
    this.height = 60;
    this.color = opts.color ?? '#38bdf8';
    this.thickness = opts.thickness ?? 4;
    this.capacity = opts.capacity ?? 64;
    this.set(opts);
  }

  override get kind(): string {
    return 'Sparkline';
  }

  push(v: number): this {
    this.values.push(v);
    if (this.values.length > this.capacity) this.values.shift();
    return this;
  }

  override draw(ctx: Ctx2D): void {
    const pts = sparklinePoints(this.values, this.width, this.height);
    if (pts.length < 4) return;
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.thickness;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  override describe() {
    const v = this.values;
    return { ...super.describe(), points: v.length, last: v.length ? +v[v.length - 1]!.toFixed(2) : undefined };
  }
}
```

Rules the example follows:

- Constructor: primary arguments first, then `opts` extending `NodeOptions`. Call `super()` with no
  arguments, set your defaults (including default `anchorX/anchorY` or size), then `this.set(opts)` last so
  the caller's `NodeOptions` win. `super(opts)` followed by field initializers silently overwrites them.
- `noImplicitOverride` is on: write `override` on `kind`, `draw`, `drawOver`, `describe`, `update`,
  `hitTest`, `onDestroy`, `renderContent`.
- `kind` returns the class name; it is the selector type and the first word of each dump line.
- `describe()` spreads `super.describe()` and adds a few short, rounded values. They appear in
  `pnpm shot --dump` and become selector attributes (`Sparkline[points=32]`, `[text*=分]`, `[tex^=hero]`;
  values are compared as strings). It runs for every node on each attribute query, so keep it cheap.
- Give the node a real `width`/`height`. Bounds in dumps, `worldBounds()`, tap hit tests, culling and lint
  all use the content box; a zero-size node prints `@x,y` and cannot be tapped.
- Non-rectangular tap area: override `hitTest(lx, ly)` (local coordinates; honour `this.hitPadding`).
- Per-frame logic: override `update(dt)`; release game-level hooks (systems, `game.on` listeners, timers)
  in `protected override onDestroy()`. `destroy()` already removes node listeners and `onUpdate` callbacks.
- Text: prefer child `Text`/`Label` nodes so lint checks size, contrast and truncation. A node that paints
  its own text should expose `uiTextInfo(): { text, size, colors, stroke }` (duck-typed, see
  `RichText` in `engine/ui/richtext.ts`) so `lintUI` still sees it.
- Lint role: `UIView` subclasses set `lintRole`; plain nodes use tags (`lint-blocker`, `lint-surface`,
  `lint-decor`, `lint-control`, `lint-ignore`). Interactive nodes without a role count as controls
  (88-unit minimum tap size). A new built-in UI widget also needs a `ui.<name>` builder entry and a
  `reg([...])` line in `engine/ui/builder.ts`, plus its names in `ui/index.ts` (see the ui-screens skill).
- Cache expensive drawing: bake static parts once into a texture (`bakeTexture`, `textures.getOrCreate`)
  or recompute only when inputs change (see `NineSlice.sliceRects()`).

## Tests next to the code

Pure logic and node behaviour: `engine/<folder>/<file>.test.ts` (Vitest, node environment; `@engine` and
`@engine/testing` aliases work, relative imports too).

```ts
// engine/chart/sparkline.test.ts
import { describe, expect, it } from 'vitest';
import { Node } from '../scene/node';
import { Sparkline, sparklinePoints } from './sparkline';

describe('Sparkline', () => {
  it('maps samples onto the box, min at the bottom', () => {
    expect(sparklinePoints([0, 5, 10], 100, 50)).toEqual([0, 50, 50, 25, 100, 0]);
  });

  it('keeps the last `capacity` samples and exposes them to selectors', () => {
    const root = new Node();
    const s = root.add(new Sparkline({ id: 'spark', capacity: 3 }));
    [1, 2, 3, 4].forEach((v) => s.push(v));
    expect(s.values).toEqual([2, 3, 4]);
    expect(root.find('Sparkline[points=3]')).toBe(s);
  });
});
```

- Anything that needs a canvas, textures, time or input needs a platform: `const t = await createTestGame()`
  from `@engine/testing`, then `await t.step(n)` / `await t.advance(s)` / `await t.tap(sel)`; call
  `t.destroy()` in `afterEach`. Pixel checks: `createTestGame({ device: '750x1334@1' })` (1 unit = 1 px)
  and `t.platform.canvas.getContext('2d').getImageData(x, y, 1, 1)` (see `tests/display.test.ts`).
- Cross-module or sandbox-scene tests go in `tests/<module>-<topic>.test.ts`.
- Run one file: `pnpm test engine/chart/sparkline.test.ts`; by name: `pnpm test -t "Sparkline"`.

## Sandbox demo scene

The sandbox (`sandbox/`) is the engine showcase and compatibility test pack; every module has
`sandbox/scenes/<module>.ts` exporting `scenes: Record<string, SceneFactory>`, spread into
`defineApp({ scenes })` in `sandbox/main.ts`. The home scene lists every registered scene automatically.

- Existing module: add a class and a `'<module>-<topic>'` entry to its file.
- A file that exists but only holds `export const scenes: Record<string, SceneFactory> = {};` is a
  placeholder already registered in `sandbox/main.ts`: fill it, do not touch `main.ts`.
- New module: create `sandbox/scenes/<module>.ts`, then in `sandbox/main.ts` add
  `import { scenes as <module> } from './scenes/<module>';` and `...<module>,` inside `scenes`.

```ts
// sandbox/scenes/chart.ts
import { rng, Sparkline, Text, type SceneFactory } from '@engine';
import { DemoScene } from '../common';

class SparklineDemo extends DemoScene {
  readonly title = 'Chart · Sparkline';

  protected build(): void {
    const { x, y, w } = this.content;
    const spark = this.add(
      new Sparkline({ id: 'spark', x: x + 48, y: y + 48, width: w - 96, height: 240, color: '#38bdf8' }),
    );
    for (let i = 0; i < 32; i++) spark.push(rng.float(0, 100));
    this.add(new Text('32 seeded samples', { fontSize: 24, color: '#9aa3b8' }, { id: 'caption', x: x + 48, y: y + 312 }));
  }
}

export const scenes: Record<string, SceneFactory> = {
  'chart-sparkline': () => new SparklineDemo(),
};
```

`DemoScene` (`sandbox/common.ts`) draws the background, a title bar and a `#back` button; build inside
`this.content` (`{ x, y, w, h }` below the title bar, above the bottom safe inset). Show every option and
state of the feature, label things with `Text` of `fontSize` 20 or more, and seed all randomness.

Scene test (behaviour plus lint on three devices):

```ts
// tests/chart-scenes.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { formatLint, lintUI, type AppDef } from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

describe('chart demo scenes', () => {
  for (const device of ['iphone-se', 'iphone-14', 'ipad'] as const) {
    it(`chart-sparkline on ${device}`, async () => {
      t = await createTestGame({ app: sandbox as AppDef, scene: 'chart-sparkline', device });
      await t.advance(1);
      expect(t.get('#spark').describe()).toMatchObject({ points: 32 });
      const errors = lintUI(t.stage, t.game).filter((i) => i.severity === 'error');
      expect(formatLint(errors)).toBe('UI lint: no issues');
    });
  }
});
```

Look at it and lint it (quote comma lists in PowerShell):

    pnpm shot --app sandbox --scene chart-sparkline --device "iphone-se,iphone-14,ipad" --lint --dump
    pnpm shot --app sandbox --scene chart-sparkline --bounds

Read the PNGs in `.shots/` (`sandbox-chart-sparkline-<device>.png`). Game-world content that is not UI
belongs in a `World` (lint-ignored) or under a `lint-ignore` / `lint-decor` tag; see the ui-screens
skill for lint rules and fixes, and testing-and-shots for the harness and screenshot tools.

## Docs in the same change

A change is not done until the docs agents read describe it:

- `AGENTS.md` "Layout": the folder's line lists the new capability (new folder: add a line).
  "Core conventions": any new rule. "Commands": any new script or flag.
- The skill for the area, in `.agents/skills/<skill>/SKILL.md` (and its `references/` when it lists APIs):

| Change in | Update skill |
|---|---|
| `ui/` | ui-screens |
| `art/`, textures | code-art (texture memory: performance) |
| `audio/`, `tools/audio` | audio-design |
| `platform/`, `tools/build` | release-platforms |
| `world/` physics, collision | physics |
| `testing/`, `tools/shot` | testing-and-shots |
| tweens, juice, particles, screen shake | game-feel |
| frame stats, pooling, caching | performance |
| input, gestures, joystick, i18n | input-and-i18n |
| app structure, game template | make-a-game |
| engine layout or these conventions | engine-extend (this file) |

- Keep doc snippets compiling: API names in docs must match the code you just wrote.

## Verification checklist

- [ ] `pnpm typecheck` clean (catches export clashes, missing `override`, missing `type` imports,
      unimplemented `Platform` members).
- [ ] `pnpm test` green, including the new `engine/**/<file>.test.ts` and `tests/<module>-scenes.test.ts`.
- [ ] Portability self-check `rg` above shows nothing new.
- [ ] `pnpm shot --app sandbox --scene <module>-<topic> --device "iphone-se,iphone-14,ipad" --lint`
      reports 0 errors, and the PNGs look right.
- [ ] `pnpm build --target all --app sandbox` succeeds (no node imports, size table printed; `233` is
      skipped with instructions when its converter is missing).
- [ ] New public names exported from the barrel (explicit list for `ui/`, `art/`) and importable from `'@engine'`.
- [ ] `AGENTS.md` and the matching skill updated.

## Pitfalls

- Importing `'@engine'` inside `engine/` works in some files and breaks others through cycles; always
  import the concrete file.
- `export *` of a name that another barrel already exports fails the typecheck for the whole repo.
- Calling `platform()` or baking textures at module top level throws in tests and on devices.
- Passing `opts` to `super(opts)` and then declaring field defaults overwrites the caller's options.
- A `describe()` value that changes every frame (raw floats) makes dumps noisy; round it.
- Headless shots and Vitest do not prove a runtime works: mini-game-only APIs need wx/tt devtools or a phone
  (see release-platforms).
- The sandbox is also the compatibility pack: a demo scene that throws or fails lint blocks everyone's
  `pnpm test` and `pnpm shot`.
