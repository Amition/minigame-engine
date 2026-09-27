// Runtime boot for the web build (bundled into game.js, so browser APIs only; no node imports).
import {
  applyDebugQuery,
  drawUIBounds,
  dumpTree,
  formatGameStats,
  formatLint,
  lintUI,
  rng,
  runApp,
  showDebugOverlay,
  textureStats,
  type AppDef,
  type DebugOverlayOptions,
  type Game,
  type GameStatsSnapshot,
  type Insets,
  type Node,
  type TextureStats,
  type Vec2,
} from '@engine';
import { createWebPlatform, type WebPlatform } from '@engine/platform/web';

export interface WebBootOptions {
  /** Dev build: error overlay + window.__engine automation handle. */
  dev?: boolean;
  storagePrefix?: string;
}

/**
 * window.__engine in --dev builds (used by tools/shot/browser.ts and handy in the console).
 * A target is a node selector or a stage point "x,y" in design units.
 */
export interface EngineHandle {
  game: Game;
  platform: WebPlatform;
  /** Taps a target (touch start, 2 frames, end, 2 frames). */
  tap(target: string): Promise<void>;
  /** Drags between two targets over `steps` frames (touch start, moves, end), like the headless harness. */
  drag(from: string, to: string, steps?: number): Promise<void>;
  /** Stage point of a target (node center), or null when no node matches. */
  point(target: string): Vec2 | null;
  /** A target in page CSS px (for real input events), or null. */
  locate(target: string): { x: number; y: number } | null;
  /** Text outline of the stage. */
  dump(): string;
  find(selector: string): Node | null;
  go(scene: string, params?: unknown): Promise<void>;
  /** Current scene name. */
  scene(): string;
  frames(n?: number): Promise<void>;
  /** UI lint of the stage: formatted report and error count. */
  lint(): { report: string; errors: number };
  /** Draws the drawUIBounds overlay (hit areas, text boxes, lint issues) on every frame while on. */
  bounds(on: boolean): void;
  /** Frame-time / node / texture stats of the running game. */
  stats(): GameStatsSnapshot;
  /** One-line stats summary, e.g. `fps 60 | frame 1.9ms | ...`. */
  statsLine(): string;
  /** Texture memory with the `top` largest sources. */
  textures(top?: number): TextureStats;
  /** Shows (or reconfigures) the debug overlay. */
  debug(opts?: DebugOverlayOptions): void;
}

/**
 * Starts the app in the browser. URL parameters:
 *   ?scene=<name>          open this scene after boot (instead of the app's start scene)
 *   &params=<json>         params for that scene
 *   &insets=t,r,b,l        simulated safe-area insets in CSS px (browser shots emulate device notches)
 *   &seed=<n>              dev builds: reseed the shared rng before boot (shots match the headless seed)
 *   &stats=1 / &debug=1    dev builds: debug overlay (stats panel; debug adds hit areas and debugDraw, debug=all bounds)
 */
export async function bootWeb(app: AppDef, opts: WebBootOptions = {}): Promise<Game> {
  // The NODE_ENV test is repeated inline so esbuild drops the dev code (handle, lint) from production bundles.
  if (process.env.NODE_ENV !== 'production' && opts.dev) installErrorOverlay();
  const q = new URLSearchParams(location.search);
  const scene = q.get('scene') ?? '';
  const rawParams = q.get('params');
  const insets = parseInsets(q.get('insets'));
  const seed = q.get('seed');
  if (process.env.NODE_ENV !== 'production' && opts.dev && seed !== null && seed !== '' && Number.isFinite(Number(seed))) {
    rng.seed(Number(seed));
  }
  const platform = createWebPlatform({
    ...(opts.storagePrefix ? { storagePrefix: opts.storagePrefix } : {}),
    ...(insets ? { safeInsets: insets } : {}),
  });
  const game = await runApp(scene ? { ...app, start: '' } : app, platform);
  if (scene) await game.scenes.go(scene, rawParams ? JSON.parse(rawParams) : undefined);
  if (process.env.NODE_ENV !== 'production' && opts.dev) {
    (window as unknown as { __engine: EngineHandle }).__engine = createHandle(game, platform);
    applyDebugQuery(game, location.search);
  }
  return game;
}

function parseInsets(s: string | null): Insets | null {
  if (!s) return null;
  const [top = 0, right = 0, bottom = 0, left = 0] = s.split(',').map((v) => Number(v) || 0);
  return { top, right, bottom, left };
}

function frames(n = 1): Promise<void> {
  return new Promise((resolve) => {
    let left = Math.max(1, n);
    const tick = () => (--left <= 0 ? resolve() : void requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
}

const POINT = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

function createHandle(game: Game, platform: WebPlatform): EngineHandle {
  const find = (selector: string) => game.stage.find(selector);
  const point = (target: string): Vec2 | null => {
    const m = POINT.exec(target);
    if (m) return { x: +m[1]!, y: +m[2]! };
    return find(target)?.worldCenter() ?? null;
  };
  const screenPoint = (target: string): Vec2 => {
    const p = point(target);
    if (!p) throw new Error(`no node matches "${target}". Stage:\n${dumpTree(game.stage, { maxDepth: 8 })}`);
    return game.stageToScreen(p.x, p.y);
  };
  let offBounds: (() => void) | null = null;
  return {
    game,
    platform,
    find,
    frames,
    point,
    dump: () => dumpTree(game.stage),
    scene: () => game.scenes.currentName,
    go: async (name, params) => {
      await game.scenes.go(name, params);
    },
    locate: (target) => {
      const p = point(target);
      if (!p) return null;
      const s = game.stageToScreen(p.x, p.y);
      const r = platform.element.getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y };
    },
    tap: async (target) => {
      const p = screenPoint(target);
      platform.simulateTouch('start', [{ id: 1000, x: p.x, y: p.y }]);
      await frames(2);
      platform.simulateTouch('end', [{ id: 1000, x: p.x, y: p.y }]);
      await frames(2);
    },
    drag: async (from, to, steps = 12) => {
      const a = screenPoint(from);
      const b = screenPoint(to);
      platform.simulateTouch('start', [{ id: 1000, x: a.x, y: a.y }]);
      await frames(1);
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        platform.simulateTouch('move', [{ id: 1000, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }]);
        await frames(1);
      }
      platform.simulateTouch('end', [{ id: 1000, x: b.x, y: b.y }]);
      await frames(2);
    },
    lint: () => {
      const issues = lintUI(game.stage, game);
      return { report: formatLint(issues), errors: issues.filter((i) => i.severity === 'error').length };
    },
    bounds: (on) => {
      offBounds?.();
      offBounds = on ? game.on('postrender', (ctx) => drawUIBounds(ctx, game.stage, { game })) : null;
    },
    stats: () => game.stats.snapshot(),
    statsLine: () => formatGameStats(game.stats),
    textures: (top) => textureStats(top === undefined ? {} : { top }),
    debug: (o) => {
      showDebugOverlay(game, o);
    },
  };
}

function installErrorOverlay(): void {
  const show = (msg: string) => {
    let el = document.getElementById('__engine_error');
    if (!el) {
      el = document.createElement('pre');
      el.id = '__engine_error';
      el.style.cssText =
        'position:fixed;left:0;right:0;bottom:0;max-height:60%;overflow:auto;margin:0;padding:12px;z-index:2147483646;' +
        'background:rgba(127,0,0,.92);color:#fff;font:12px/1.4 Consolas,monospace;white-space:pre-wrap';
      document.body.appendChild(el);
    }
    el.textContent += msg + '\n';
  };
  window.addEventListener('error', (e) => show(String(e.error?.stack ?? e.message)));
  window.addEventListener('unhandledrejection', (e) => show(String(e.reason?.stack ?? e.reason)));
}
