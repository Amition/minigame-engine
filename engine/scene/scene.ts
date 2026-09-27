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

  override get kind(): string {
    return 'Scene';
  }

  /** Called after the scene is added to the stage. May be async (e.g. loading assets). */
  onEnter(_params?: unknown): void | Promise<void> {}

  /** Called before the scene is removed and destroyed. */
  onExit(): void {}

  /** View size in design units; called before onEnter and whenever the view resizes. */
  onResize(_width: number, _height: number): void {}

  override describe() {
    return { ...super.describe(), scene: this.sceneName };
  }
}

export type SceneFactory = () => Scene;

export class SceneManager {
  private factories = new Map<string, SceneFactory>();
  private _current: Scene | null = null;
  private switching: Promise<Scene> | null = null;

  constructor(
    private readonly game: Game,
    private readonly layer: Node,
  ) {}

  get current(): Scene | null {
    return this._current;
  }

  get currentName(): string {
    return this._current?.sceneName ?? '';
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

  /** Replaces the current scene. Resolves after the new scene's onEnter finished. */
  async go(name: string, params?: unknown): Promise<Scene> {
    if (this.switching) await this.switching.catch(() => undefined);
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`scene "${name}" not registered (have: ${this.names().join(', ')})`);
    const run = async () => {
      const old = this._current;
      if (old) {
        old.onExit();
        old.destroy();
      }
      const scene = factory();
      scene.game = this.game;
      scene.sceneName = name;
      scene.setSize(this.game.view.width, this.game.view.height);
      this._current = scene;
      this.layer.add(scene);
      scene.onResize(scene.width, scene.height);
      await scene.onEnter(params);
      this.game.emit('scene', scene);
      return scene;
    };
    this.switching = run();
    try {
      return await this.switching;
    } finally {
      this.switching = null;
    }
  }

  /** Called by Game on view resize. */
  handleResize(width: number, height: number): void {
    const s = this._current;
    if (!s) return;
    s.setSize(width, height);
    s.onResize(width, height);
  }
}
