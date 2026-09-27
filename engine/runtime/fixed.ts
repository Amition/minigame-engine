import type { Game } from '../core/game';

/**
 * Calls `fn(step)` at a fixed rate in game time (physics, deterministic simulation), catching up with at most
 * `maxSteps` calls per frame. `alpha` (0..1) is how far the game is into the next step, for render interpolation.
 * Returns a remover: `const stop = fixedUpdate(game, 60, (dt) => world.step(dt));`.
 */
export function fixedUpdate(game: Game, hz: number, fn: (step: number, alpha: number) => void, opts: { maxSteps?: number; priority?: number } = {}): () => void {
  const step = 1 / Math.max(1, hz);
  const maxSteps = opts.maxSteps ?? 5;
  let acc = 0;
  return game.addSystem(
    {
      update(dt) {
        acc += dt;
        let n = 0;
        while (acc >= step - 1e-9 && n < maxSteps) {
          acc -= step;
          n++;
          fn(step, Math.max(0, acc) / step);
        }
        if (n >= maxSteps && acc > step) acc = acc % step;
      },
    },
    opts.priority ?? 0,
  );
}
