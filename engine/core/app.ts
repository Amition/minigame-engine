import type { Platform } from '../platform/types';
import { setPlatform } from '../platform/current';
import type { SceneFactory } from '../scene/scene';
import { Game, type GameConfig } from './game';

/**
 * An app (the sandbox or a real game). Each app dir has `main.ts` with `export default defineApp({...})`.
 * Platform entries (web/wx/tt/tap builds) and the headless harness all start it the same way.
 */
export interface AppDef extends GameConfig {
  /** Scenes registered before boot(). */
  scenes?: Record<string, SceneFactory>;
  /** Opened after boot() unless boot() already opened a scene. */
  start?: string;
  /** Load assets, register extra scenes, set up systems. */
  boot?(game: Game): void | Promise<void>;
}

export const defineApp = (app: AppDef): AppDef => app;

/** Registers scenes, runs boot(), opens the start scene. Does not start the loop. */
export async function bootApp(game: Game, app: AppDef): Promise<void> {
  if (app.scenes) game.scenes.registerAll(app.scenes);
  await app.boot?.(game);
  if (!game.scenes.current && app.start) await game.scenes.go(app.start);
}

/** Production entry: sets the platform, creates the game, starts the loop, then boots. */
export async function runApp(app: AppDef, platform: Platform): Promise<Game> {
  setPlatform(platform);
  const game = new Game(platform, app);
  game.start();
  await bootApp(game, app);
  return game;
}
