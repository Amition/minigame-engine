import { Game } from '../core/game';
import type { Node } from '../scene/node';
import { isTreePaused, resolveGame } from './ticker';

export interface FixedUpdateOptions {
  /** Most steps per frame (default 5); a larger backlog is dropped instead of spiralling. */
  maxSteps?: number;
  /** System priority: lower runs first (tweens/timers run at -100). Default 0. */
  priority?: number;
  /** Game of a Node target (default Game.current). */
  game?: Game;
}

/** Fixed-step callback: `step` is 1 / hz seconds, `alpha` (0..1) how far the game is into the next step. */
export type FixedStepFn = (step: number, alpha: number) => void;

function onStage(node: Node, game: Game): boolean {
  let n: Node = node;
  while (n.parent) n = n.parent;
  return n === game.stage;
}

/**
 * Calls `fn(step, alpha)` at a fixed rate in game time (physics, deterministic simulation), catching up with at most
 * `maxSteps` calls per frame. `alpha` is for render interpolation. Runs before the stage updates, so `update()` of
 * the nodes sees this frame's simulation. Returns a remover.
 *
 * - Game target: a global system that runs until removed: `const stop = fixedUpdate(game, 60, (dt) => world.step(dt));`.
 * - Node target (usually the scene): stops by itself when the node is destroyed, and skips (without building a
 *   backlog) while the node is off the stage or it or an ancestor is `paused` (pushed dialogs pause the scene below):
 *   `fixedUpdate(this, 60, (dt) => this.handle(this.model.step(dt)))` in `onEnter`.
 */
export function fixedUpdate(target: Game | Node, hz: number, fn: FixedStepFn, opts: FixedUpdateOptions = {}): () => void {
  const step = 1 / Math.max(1, hz);
  const maxSteps = opts.maxSteps ?? 5;
  const node = target instanceof Game ? null : target;
  const game = target instanceof Game ? target : resolveGame(opts.game);
  const halted = () => !!node && (node.destroyed || isTreePaused(node));
  let acc = 0;
  let removed = false;
  const removeSystem = game.addSystem(
    {
      update(dt) {
        if (node) {
          if (node.destroyed) return off();
          if (isTreePaused(node) || !onStage(node, game)) return;
        }
        acc += dt;
        let n = 0;
        while (acc >= step - 1e-9 && n < maxSteps) {
          acc -= step;
          n++;
          fn(step, Math.min(1, Math.max(0, acc) / step));
          if (removed || halted()) return;
        }
        if (n >= maxSteps && acc > step) acc = acc % step;
      },
    },
    opts.priority ?? 0,
  );
  const offDestroyed = node ? node.once('destroyed', () => off()) : null;
  const off = () => {
    if (removed) return;
    removed = true;
    removeSystem();
    offDestroyed?.();
  };
  return off;
}
