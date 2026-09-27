import type { Game } from '../core/game';
import { Node } from './node';

/**
 * A full-screen state (menu, level, result...). Sized to the game view; lives in game.sceneLayer.
 * Build content in onEnter(); react to view size changes in onResize().
 */
export class Scene extends Node {
  /** Set by the SceneManager before onResize/onEnter. */
  game!: Game;
  /** Registered name, set by the SceneManager. */
  sceneName = '';
  /** True for scenes opened with scenes.push() (dialogs, pause menus drawn above the current scene). */
  pushed = false;

  override get kind(): string {
    return 'Scene';
  }

  /** Called after the scene is added to the stage. May be async (e.g. loading assets). */
  onEnter(_params?: unknown): void | Promise<void> {}

  /** Called before the scene is removed and destroyed. */
  onExit(): void {}

  /** View size in design units; called before onEnter and whenever the view resizes. */
  onResize(_width: number, _height: number): void {}

  /** Closes this pushed scene; its push() promise resolves with `result`. */
  close(result?: unknown, opts?: TransitionOptions): Promise<void> {
    return this.game.scenes.close(this, result, opts);
  }

  override describe() {
    return { ...super.describe(), scene: this.sceneName, pushed: this.pushed || undefined };
  }
}

export type SceneFactory = () => Scene;

export type TransitionName = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'zoom';

/**
 * Custom transition, called every frame with eased progress t (0 → 1). `outgoing` is null for push/pop
 * (the scene below stays put); pop plays t from 1 → 0. Scene transforms are restored when it ends.
 */
export type TransitionFn = (t: number, incoming: Scene, outgoing: Scene | null, view: { width: number; height: number }) => void;

export interface TransitionOptions {
  transition?: TransitionName | TransitionFn;
  /** Seconds (default 0.35). Transitions use unscaled time and also run while the game is paused. */
  duration?: number;
}

export interface SceneRestartOptions extends TransitionOptions {
  /** New params for onEnter; when the key is absent the params of the last go()/restart() are reused. */
  params?: unknown;
}

/** Built-in transitions by name. */
export const sceneTransitions: Record<Exclude<TransitionName, 'none'>, TransitionFn> = {
  fade: (t, inc) => {
    inc.alpha = t;
  },
  'slide-left': (t, inc, out, v) => {
    inc.x = v.width * (1 - t);
    if (out) out.x = -v.width * t;
  },
  'slide-right': (t, inc, out, v) => {
    inc.x = -v.width * (1 - t);
    if (out) out.x = v.width * t;
  },
  'slide-up': (t, inc, out, v) => {
    inc.y = v.height * (1 - t);
    if (out) out.y = -v.height * t;
  },
  'slide-down': (t, inc, out, v) => {
    inc.y = -v.height * (1 - t);
    if (out) out.y = v.height * t;
  },
  zoom: (t, inc, _out, v) => {
    const s = 0.6 + 0.4 * t;
    inc.alpha = t;
    inc.scaleX = inc.scaleY = s;
    inc.x = (v.width * (1 - s)) / 2;
    inc.y = (v.height * (1 - s)) / 2;
  },
};

interface Xform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
}

const snapshot = (n: Node): Xform => ({ x: n.x, y: n.y, scaleX: n.scaleX, scaleY: n.scaleY, rotation: n.rotation, alpha: n.alpha });

function restoreXform(n: Node, f: Xform): void {
  n.x = f.x;
  n.y = f.y;
  n.scaleX = f.scaleX;
  n.scaleY = f.scaleY;
  n.rotation = f.rotation;
  n.alpha = f.alpha;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface ResolvedTransition {
  fn: TransitionFn;
  duration: number;
}

interface ActiveTransition extends ResolvedTransition {
  incoming: Scene;
  outgoing: Scene | null;
  reverse: boolean;
  elapsed: number;
  xIn: Xform;
  xOut: Xform | null;
  resolve: () => void;
}

interface Overlay {
  scene: Scene;
  opts: TransitionOptions | undefined;
  resolve: (result: unknown) => void;
}

export class SceneManager {
  /** Used by go()/push() when no transition is passed. Default 'none' (instant switch). */
  defaultTransition: TransitionOptions = { transition: 'none' };
  private factories = new Map<string, SceneFactory>();
  private _current: Scene | null = null;
  private _params: unknown = undefined;
  private overlays: Overlay[] = [];
  private covered = new Map<Scene, { paused: boolean; interactiveChildren: boolean }>();
  private active: ActiveTransition | null = null;
  private pending = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly game: Game,
    private readonly layer: Node,
  ) {
    game.on('frame', (dt) => this.stepTransition(dt));
  }

  /** The base scene opened with go() (pushed scenes don't change it). */
  get current(): Scene | null {
    return this._current;
  }

  get currentName(): string {
    return this._current?.sceneName ?? '';
  }

  /** Params the current base scene was entered with (what restart() reuses). */
  get currentParams(): unknown {
    return this._params;
  }

  /** Topmost scene: the last pushed one, else current. */
  get top(): Scene | null {
    return this.overlays[this.overlays.length - 1]?.scene ?? this._current;
  }

  /** Base scene followed by pushed scenes, bottom to top. */
  get stack(): Scene[] {
    const out = this.overlays.map((o) => o.scene);
    if (this._current) out.unshift(this._current);
    return out;
  }

  /** True while a transition animation runs (input is locked meanwhile). */
  get transitioning(): boolean {
    return this.active !== null;
  }

  register(name: string, factory: SceneFactory): this {
    this.factories.set(name, factory);
    return this;
  }

  registerAll(map: Record<string, SceneFactory>): this {
    for (const [k, f] of Object.entries(map)) this.register(k, f);
    return this;
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  names(): string[] {
    return [...this.factories.keys()];
  }

  /**
   * Replaces the current scene (and closes pushed scenes). Resolves after the new scene's onEnter finished;
   * a transition keeps animating afterwards with input locked (await idle() for its end):
   * `go('level', { n: 2 }, { transition: 'fade' })`.
   * Scene operations are queued: don't await go/push/pop inside onEnter (call them without await instead).
   */
  go(name: string, params?: unknown, opts?: TransitionOptions): Promise<Scene> {
    return new Promise<Scene>((resolve, reject) => {
      this.enqueue(() => this.doGo(name, params, opts, resolve)).catch(reject);
    });
  }

  /**
   * Re-enters the current base scene as a fresh instance (closing pushed scenes, like go()) with the params it was
   * entered with, or `opts.params`: `scenes.restart({ transition: 'fade', duration: 0.3 })`. The scene is looked up
   * when the queued operation runs, so `go('b'); restart()` restarts 'b'. Rejects when there is no current scene.
   */
  restart(opts: SceneRestartOptions = {}): Promise<Scene> {
    return new Promise<Scene>((resolve, reject) => {
      this.enqueue(async () => {
        const cur = this._current;
        if (!cur) throw new Error('restart(): no current scene (open one with go() first)');
        await this.doGo(cur.sceneName, 'params' in opts ? opts.params : this._params, opts, resolve);
      }).catch(reject);
    });
  }

  /** Resolves once queued scene operations and transitions have finished. */
  idle(): Promise<void> {
    return this.pending > 0 ? this.tail.then(() => this.idle()) : Promise.resolve();
  }

  /**
   * Opens a scene above the current one; scenes below are paused and ignore input. Resolves with the value passed
   * to pop()/close(), undefined if closed by go(), never if the scene is destroyed another way:
   * `const ok = await game.scenes.push('confirm', { text })`.
   */
  push<R = unknown>(name: string, params?: unknown, opts?: TransitionOptions): Promise<R | undefined> {
    return new Promise<R | undefined>((resolve, reject) => {
      this.enqueue(() => this.doPush(name, params, opts, resolve as (r: unknown) => void)).catch(reject);
    });
  }

  /** Closes the topmost pushed scene (no-op without one). Plays its push transition in reverse unless overridden. */
  pop(result?: unknown, opts?: TransitionOptions): Promise<void> {
    return this.enqueue(async () => {
      const top = this.overlays[this.overlays.length - 1];
      if (top) await this.closeOverlay(top, result, opts);
    });
  }

  /** Closes a specific pushed scene (no-op if it isn't one). */
  close(scene: Scene, result?: unknown, opts?: TransitionOptions): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.overlays.find((o) => o.scene === scene);
      if (entry) await this.closeOverlay(entry, result, opts);
    });
  }

  /** Called by Game on view resize. */
  handleResize(width: number, height: number): void {
    for (const s of this.stack) {
      s.setSize(width, height);
      s.onResize(width, height);
    }
  }

  // ---------------------------------------------------------------- internals

  /** Runs scene operations one at a time (an op queued from inside a running op starts after it). */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const prev = this.pending > 0 ? this.tail : null;
    this.pending++;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    const run = prev ? prev.then(op) : op();
    const settle = () => {
      this.pending--;
      release();
    };
    run.then(settle, settle);
    return run;
  }

  private factory(name: string): SceneFactory {
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`scene "${name}" not registered (have: ${this.names().join(', ')})`);
    return factory;
  }

  private create(name: string, factory: SceneFactory): Scene {
    const scene = factory();
    scene.game = this.game;
    scene.sceneName = name;
    scene.setSize(this.game.view.width, this.game.view.height);
    return scene;
  }

  private resolveTransition(opts: TransitionOptions | undefined): ResolvedTransition | null {
    const tr = opts?.transition ?? this.defaultTransition.transition ?? 'none';
    if (tr === 'none') return null;
    const fn = typeof tr === 'function' ? tr : sceneTransitions[tr];
    if (!fn) throw new Error(`unknown transition "${String(tr)}" (use none, ${Object.keys(sceneTransitions).join(', ')})`);
    return { fn, duration: Math.max(0, opts?.duration ?? this.defaultTransition.duration ?? 0.35) };
  }

  private async doGo(
    name: string,
    params: unknown,
    opts: TransitionOptions | undefined,
    entered: (s: Scene) => void,
  ): Promise<void> {
    const factory = this.factory(name);
    const tr = this.resolveTransition(opts);
    for (const o of this.overlays.splice(0).reverse()) this.discardOverlay(o, undefined);
    const old = this._current;
    if (old) this.uncover(old);
    if (!tr) {
      if (old) {
        old.onExit();
        old.destroy();
      }
      const scene = this.create(name, factory);
      this._current = scene;
      this._params = params;
      this.layer.add(scene);
      scene.onResize(scene.width, scene.height);
      await scene.onEnter(params);
      this.game.emit('scene', scene);
      entered(scene);
      return;
    }
    const unlock = this.game.lockInput();
    try {
      const scene = this.create(name, factory);
      if (old) {
        old.onExit();
        old.paused = true;
        old.interactiveChildren = false;
      }
      this._current = scene;
      this._params = params;
      this.layer.add(scene);
      scene.onResize(scene.width, scene.height);
      const anim = this.prepare(tr, scene, old, false);
      await scene.onEnter(params);
      this.game.emit('scene', scene);
      entered(scene);
      await anim();
    } finally {
      old?.destroy();
      unlock();
    }
  }

  private async doPush(name: string, params: unknown, opts: TransitionOptions | undefined, resolve: (r: unknown) => void): Promise<void> {
    const factory = this.factory(name);
    const tr = this.resolveTransition(opts);
    const scene = this.create(name, factory);
    scene.pushed = true;
    const below = this.top;
    if (below) this.cover(below);
    const entry: Overlay = { scene, opts, resolve };
    this.overlays.push(entry);
    scene.once('destroyed', () => {
      const i = this.overlays.indexOf(entry);
      if (i < 0) return;
      this.overlays.splice(i, 1);
      this.uncoverTop();
    });
    this.layer.add(scene);
    scene.onResize(scene.width, scene.height);
    if (!tr) {
      await scene.onEnter(params);
      return;
    }
    const unlock = this.game.lockInput();
    try {
      const anim = this.prepare(tr, scene, null, false);
      await scene.onEnter(params);
      await anim();
    } finally {
      unlock();
    }
  }

  private async closeOverlay(entry: Overlay, result: unknown, opts: TransitionOptions | undefined): Promise<void> {
    const tr = this.resolveTransition(opts ?? entry.opts);
    const scene = entry.scene;
    if (tr) {
      const unlock = this.game.lockInput();
      scene.onExit();
      scene.paused = true;
      scene.interactiveChildren = false;
      try {
        await this.prepare(tr, scene, null, true)();
      } finally {
        unlock();
      }
      this.discardOverlay(entry, result, false);
    } else {
      this.discardOverlay(entry, result);
    }
  }

  private discardOverlay(entry: Overlay, result: unknown, exit = true): void {
    const i = this.overlays.indexOf(entry);
    if (i >= 0) this.overlays.splice(i, 1);
    this.covered.delete(entry.scene);
    if (exit) entry.scene.onExit();
    entry.scene.destroy();
    this.uncoverTop();
    entry.resolve(result);
  }

  private cover(scene: Scene): void {
    if (!this.covered.has(scene)) {
      this.covered.set(scene, { paused: scene.paused, interactiveChildren: scene.interactiveChildren });
    }
    scene.paused = true;
    scene.interactiveChildren = false;
  }

  private uncover(scene: Scene): void {
    const saved = this.covered.get(scene);
    if (!saved) return;
    this.covered.delete(scene);
    scene.paused = saved.paused;
    scene.interactiveChildren = saved.interactiveChildren;
  }

  private uncoverTop(): void {
    const top = this.top;
    if (top) this.uncover(top);
  }

  /** Applies the transition's first frame now; the returned function runs the animation to its end. */
  private prepare(tr: ResolvedTransition, incoming: Scene, outgoing: Scene | null, reverse: boolean): () => Promise<void> {
    const xIn = snapshot(incoming);
    const xOut = outgoing ? snapshot(outgoing) : null;
    const view = { width: this.game.view.width, height: this.game.view.height };
    tr.fn(easeInOut(reverse ? 1 : 0), incoming, outgoing, view);
    return () =>
      new Promise<void>((resolve) => {
        this.active = { ...tr, incoming, outgoing, reverse, elapsed: 0, xIn, xOut, resolve };
        if (tr.duration <= 0) this.stepTransition(0);
      });
  }

  private stepTransition(dt: number): void {
    const a = this.active;
    if (!a) return;
    a.elapsed += dt;
    const k = a.duration > 0 ? Math.min(1, a.elapsed / a.duration) : 1;
    const done = k >= 1 - 1e-6;
    a.fn(easeInOut(a.reverse ? 1 - k : k), a.incoming, a.outgoing, { width: this.game.view.width, height: this.game.view.height });
    if (!done) return;
    this.active = null;
    restoreXform(a.incoming, a.xIn);
    if (a.outgoing && a.xOut) restoreXform(a.outgoing, a.xOut);
    a.resolve();
  }
}
