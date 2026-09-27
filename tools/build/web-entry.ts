// Runtime boot for the web build (bundled into game.js, so browser APIs only; no node imports).
import { dumpTree, runApp, type AppDef, type Game, type Insets, type Node } from '@engine';
import { createWebPlatform, type WebPlatform } from '@engine/platform/web';

export interface WebBootOptions {
  /** Dev build: error overlay + window.__engine automation handle. */
  dev?: boolean;
  storagePrefix?: string;
}

/** window.__engine in --dev builds (used by tools/shot/browser.ts and handy in the console). */
export interface EngineHandle {
  game: Game;
  platform: WebPlatform;
  /** Taps the center of the first node matching the selector (touch start, 2 frames, end, 2 frames). */
  tap(selector: string): Promise<void>;
  /** Center of the first matching node in page CSS px (for real input events), or null. */
  locate(selector: string): { x: number; y: number } | null;
  /** Text outline of the stage. */
  dump(): string;
  find(selector: string): Node | null;
  go(scene: string, params?: unknown): Promise<void>;
  /** Current scene name. */
  scene(): string;
  frames(n?: number): Promise<void>;
}

/**
 * Starts the app in the browser. URL parameters:
 *   ?scene=<name>          open this scene after boot (instead of the app's start scene)
 *   &params=<json>         params for that scene
 *   &insets=t,r,b,l        simulated safe-area insets in CSS px (browser shots emulate device notches)
 */
export async function bootWeb(app: AppDef, opts: WebBootOptions = {}): Promise<Game> {
  if (opts.dev) installErrorOverlay();
  const q = new URLSearchParams(location.search);
  const scene = q.get('scene') ?? '';
  const rawParams = q.get('params');
  const insets = parseInsets(q.get('insets'));
  const platform = createWebPlatform({
    ...(opts.storagePrefix ? { storagePrefix: opts.storagePrefix } : {}),
    ...(insets ? { safeInsets: insets } : {}),
  });
  const game = await runApp(scene ? { ...app, start: '' } : app, platform);
  if (scene) await game.scenes.go(scene, rawParams ? JSON.parse(rawParams) : undefined);
  if (opts.dev) (window as unknown as { __engine: EngineHandle }).__engine = createHandle(game, platform);
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

function createHandle(game: Game, platform: WebPlatform): EngineHandle {
  const find = (selector: string) => game.stage.find(selector);
  return {
    game,
    platform,
    find,
    frames,
    dump: () => dumpTree(game.stage),
    scene: () => game.scenes.currentName,
    go: async (name, params) => {
      await game.scenes.go(name, params);
    },
    locate: (selector) => {
      const node = find(selector);
      if (!node) return null;
      const c = node.worldCenter();
      const p = game.stageToScreen(c.x, c.y);
      const r = platform.element.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
    tap: async (selector) => {
      const node = find(selector);
      if (!node) throw new Error(`no node matches "${selector}". Stage:\n${dumpTree(game.stage, { maxDepth: 8 })}`);
      const c = node.worldCenter();
      const p = game.stageToScreen(c.x, c.y);
      platform.simulateTouch('start', [{ id: 1000, x: p.x, y: p.y }]);
      await frames(2);
      platform.simulateTouch('end', [{ id: 1000, x: p.x, y: p.y }]);
      await frames(2);
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
