import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { bootApp, type AppDef } from '../core/app';
import { Game, type GameConfig } from '../core/game';
import type { Vec2 } from '../core/math';
import { rng } from '../core/rng';
import type { Ctx2D } from '../gfx/types';
import { setPlatform } from '../platform/current';
import { reloadAllSaves } from '../runtime/save';
import { dumpTree, type DumpOptions } from '../scene/dump';
import type { Node } from '../scene/node';
import type { Scene } from '../scene/scene';
import { isUIHost, layoutUIRoot, uiLayoutNeeded } from '../ui/layout';
import { darkUITheme, setUITheme, uiTheme } from '../ui/theme';
import { resolveDevice, type DeviceName, type DeviceSpec } from './devices';
import { HeadlessPlatform } from './headless';

/**
 * Which frames step()/advance()/tap()/press()/drag()/go() draw:
 * - 'last' (default): only the final frame of each call (a 36 s advance() draws 1 frame, not 2160)
 * - 'every': every frame, like the real game loop
 * - 'none': never; screenshot()/png() still draw
 * Frames that are not drawn still emit prerender/postrender and lay out the visible UI, so node positions,
 * hit tests and render-driven logic (AudioManager fades) are the same in every mode.
 */
export type TestRenderMode = 'every' | 'last' | 'none';

export interface TestGameOptions {
  /** Boots this app (scenes, boot(), start scene). Its config provides design/scaleMode/background. */
  app?: AppDef;
  /** Used when no app is given (default 750x1334). */
  config?: Partial<GameConfig>;
  device?: DeviceName | string | DeviceSpec;
  /** Absolute assets dir for loadImage/readText. */
  assetsDir?: string;
  /** Reseeds the shared rng (default 1) so runs are reproducible. */
  seed?: number;
  /** Scene to open after boot (overrides app.start). */
  scene?: string;
  params?: unknown;
  /** Which frames get drawn (default 'last'); see TestRenderMode. Changeable later via `t.renderMode`. */
  render?: TestRenderMode;
  /** Backing-store pixel ratio, overriding the device's (usually 2). 1 draws 4x fewer pixels: faster, softer shots. */
  pixelRatio?: number;
}

export interface ScreenshotOptions {
  /** Output scale relative to CSS px (default 1 = CSS size; 2 = full backing resolution at DPR 2). */
  scale?: number;
  /** Extra drawing on top, in stage coordinates (e.g. debug bounds). */
  overlay?: (ctx: Ctx2D, game: Game) => void;
}

export type TapTarget = string | Node | Vec2;

export interface TestGame {
  readonly game: Game;
  readonly platform: HeadlessPlatform;
  readonly stage: Node;
  readonly scene: Scene | null;
  /** Which frames step()/advance()/... draw; starts as `opts.render` (default 'last'). */
  renderMode: TestRenderMode;
  /**
   * Advances `frames` frames of `dt` seconds (dt clamped to maxDt like game.step), letting pending promises settle
   * between frames. Drawing follows `renderMode`.
   */
  step(frames?: number, dt?: number): Promise<void>;
  /** Advances simulated time by `seconds` in 1/60 steps. */
  advance(seconds: number): Promise<void>;
  go(scene: string, params?: unknown): Promise<Scene>;
  find<T extends Node = Node>(selector: string): T | null;
  /** Like find() but throws with a tree dump when missing. */
  get<T extends Node = Node>(selector: string): T;
  findAll<T extends Node = Node>(selector: string): T[];
  /** Taps a node (by selector or reference, at its center) or a stage point. */
  tap(target: TapTarget): Promise<void>;
  /** Presses at a target for `seconds`, then releases. */
  press(target: TapTarget, seconds: number): Promise<void>;
  /** Drags from one target/point to another over `steps` frames. */
  drag(from: TapTarget, to: TapTarget, steps?: number): Promise<void>;
  /**
   * Several fingers at once (multi-touch): stroke i is pointer id i + 1. All press in the same frame, move together
   * over `steps` frames (default 12) and lift in the same frame: `multiDrag([[a, a2], [b, b2]])`.
   */
  multiDrag(strokes: readonly (readonly [TapTarget, TapTarget])[], steps?: number): Promise<void>;
  /** Text outline of the stage (or a subtree). */
  dump(opts?: DumpOptions & { root?: Node }): string;
  /** Renders a frame (in every render mode) and writes a PNG. Returns the absolute path. */
  screenshot(file: string, opts?: ScreenshotOptions): Promise<string>;
  /** Renders a frame (in every render mode) and returns PNG bytes. */
  png(opts?: ScreenshotOptions): Buffer;
  /** Sound keys played so far. */
  played(): string[];
  destroy(): void;
}

const flush = () => new Promise<void>((r) => setImmediate(r));

/** The UI layout pass that UIView.render() runs for the visible tree, without drawing anything. */
function layoutVisibleUI(n: Node): void {
  if (!n.visible || n.alpha <= 0 || n.destroyed) return;
  if (isUIHost(n) && !isUIHost(n.parent) && uiLayoutNeeded(n)) layoutUIRoot(n);
  for (const c of n.children) layoutVisibleUI(c);
}

/**
 * Creates a headless game for tests and tools. Nothing runs automatically: call step()/advance().
 * Each call starts from a clean slate: fresh platform storage (SaveStores re-read it), rng reseeded,
 * default UI theme.
 *
 *     const t = await createTestGame({ app, scene: 'menu' });
 *     await t.tap('Button[text=开始]');
 *     expect(t.scene?.sceneName).toBe('level');
 *     await t.screenshot('.shots/level.png');
 */
export async function createTestGame(opts: TestGameOptions = {}): Promise<TestGame> {
  const dev = resolveDevice(opts.device);
  const pixelRatio = opts.pixelRatio ?? dev.pixelRatio;
  const platform = new HeadlessPlatform({
    width: dev.width,
    height: dev.height,
    pixelRatio,
    safeInsets: dev.safeInsets,
    ...(opts.assetsDir ? { assetsDir: opts.assetsDir } : {}),
  });
  setPlatform(platform);
  reloadAllSaves();
  if (uiTheme() !== darkUITheme) setUITheme(darkUITheme);
  rng.seed(opts.seed ?? 1);
  const cfg: GameConfig = opts.app ?? { design: { width: 750, height: 1334 }, ...opts.config };
  const game = new Game(platform, { ...cfg, maxPixelRatio: pixelRatio });
  const ctx = platform.canvas.getContext('2d');
  const dt60 = 1 / 60;
  let renderMode: TestRenderMode = opts.render ?? 'last';

  /** Runs frames; in 'last' mode only the final one is drawn, and only when `endsCall` (the end of a public call). */
  const run = async (frames: number, dt: number, endsCall: boolean) => {
    for (let i = 0; i < frames; i++) {
      platform.clock += dt * 1000;
      game.update(Math.min(Math.max(dt, 0), game.config.maxDt));
      if (renderMode === 'every' || (renderMode === 'last' && endsCall && i === frames - 1)) {
        game.render();
      } else {
        game.emit('prerender', ctx);
        layoutVisibleUI(game.stage);
        game.emit('postrender', ctx);
      }
      await flush();
    }
  };
  const step = (frames = 1, dt = dt60) => run(frames, dt, true);

  if (opts.app) {
    await bootApp(game, opts.scene ? { ...opts.app, start: '' } : opts.app);
    if (opts.scene) await game.scenes.go(opts.scene, opts.params);
  }
  await step(1);

  const point = (t: TapTarget): Vec2 => {
    if (typeof t === 'string') return get(t).worldCenter();
    if ('x' in t && !('kind' in t)) return t;
    return (t as Node).worldCenter();
  };
  const toScreen = (p: Vec2) => game.stageToScreen(p.x, p.y);
  const get = <T extends Node = Node>(selector: string): T => {
    const n = game.stage.find<T>(selector);
    if (!n) throw new Error(`no node matches "${selector}". Stage:\n${dumpTree(game.stage, { maxDepth: 8 })}`);
    return n;
  };

  const render = (o: ScreenshotOptions = {}): Buffer => {
    game.render();
    if (o.overlay) {
      const ctx = platform.canvas.getContext('2d');
      ctx.save();
      const k = game.pixelRatio * game.scale;
      ctx.setTransform(k, 0, 0, k, game.offsetX * game.pixelRatio, game.offsetY * game.pixelRatio);
      o.overlay(ctx, game);
      ctx.restore();
    }
    const scale = o.scale ?? 1;
    const src = platform.canvas as unknown as Canvas;
    const w = Math.round(platform.screen.width * scale);
    const h = Math.round(platform.screen.height * scale);
    if (w === src.width && h === src.height) return src.toBuffer('image/png');
    const out = createCanvas(w, h);
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(src, 0, 0, w, h);
    return out.toBuffer('image/png');
  };

  const tg: TestGame = {
    game,
    platform,
    stage: game.stage,
    get scene() {
      return game.scenes.current;
    },
    get renderMode() {
      return renderMode;
    },
    set renderMode(m: TestRenderMode) {
      renderMode = m;
    },
    step,
    advance: async (seconds: number) => step(Math.max(1, Math.round(seconds * 60))),
    go: async (name, params) => {
      const s = await game.scenes.go(name, params);
      await step(1);
      return s;
    },
    find: (sel) => game.stage.find(sel),
    get,
    findAll: (sel) => game.stage.findAll(sel),
    tap: async (target) => {
      const p = toScreen(point(target));
      platform.touch('start', [{ id: 1, x: p.x, y: p.y }]);
      await run(1, dt60, false);
      platform.touch('end', [{ id: 1, x: p.x, y: p.y }]);
      await step(1);
    },
    press: async (target, seconds) => {
      const p = toScreen(point(target));
      platform.touch('start', [{ id: 1, x: p.x, y: p.y }]);
      await run(Math.max(1, Math.round(seconds * 60)), dt60, false);
      platform.touch('end', [{ id: 1, x: p.x, y: p.y }]);
      await step(1);
    },
    drag: async (from, to, steps = 12) => {
      const a = toScreen(point(from));
      const b = toScreen(point(to));
      platform.touch('start', [{ id: 1, x: a.x, y: a.y }]);
      await run(1, dt60, false);
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        platform.touch('move', [{ id: 1, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }]);
        await run(1, dt60, false);
      }
      platform.touch('end', [{ id: 1, x: b.x, y: b.y }]);
      await step(1);
    },
    multiDrag: async (strokes, steps = 12) => {
      const paths = strokes.map(([from, to], i) => ({ id: i + 1, a: toScreen(point(from)), b: toScreen(point(to)) }));
      const at = (k: number) => paths.map((p) => ({ id: p.id, x: p.a.x + (p.b.x - p.a.x) * k, y: p.a.y + (p.b.y - p.a.y) * k }));
      platform.touch('start', at(0));
      await run(1, dt60, false);
      for (let i = 1; i <= steps; i++) {
        platform.touch('move', at(i / steps));
        await run(1, dt60, false);
      }
      platform.touch('end', at(1));
      await step(1);
    },
    dump: (o = {}) => dumpTree(o.root ?? game.stage, o),
    screenshot: async (file, o) => {
      const path = resolve(file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, render(o));
      return path;
    },
    png: (o) => render(o),
    played: () => platform.audio.played(),
    destroy: () => {
      game.stop();
      game.stage.destroy();
      setPlatform(null);
    },
  };
  return tg;
}
