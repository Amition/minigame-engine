import { Game } from '../core/game';
import type { Node } from '../scene/node';

/** Something advanced every frame by a Ticker. `tick` returns false once it is finished. */
export interface Tickable {
  tick(dt: number): boolean;
}

/** Time tolerance so durations summed from 1/60 steps still complete on the expected frame. */
export const TIME_EPS = 1e-6;

class Ticker {
  private items: Tickable[] = [];

  add(item: Tickable): void {
    this.items.push(item);
  }

  update(dt: number): void {
    const list = this.items;
    const n = list.length;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const it = list[i]!;
      if (it.tick(dt)) list[w++] = it;
    }
    for (let i = n; i < list.length; i++) list[w++] = list[i]!;
    list.length = w;
  }

  get size(): number {
    return this.items.length;
  }
}

const scaledTickers = new WeakMap<Game, Ticker>();
const realTickers = new WeakMap<Game, Ticker>();

/** The given game, or Game.current. Throws when no game exists yet. */
export function resolveGame(game?: Game | null): Game {
  const g = game ?? Game.current;
  if (!g) throw new Error('no Game yet: create one (runApp / createTestGame) before starting tweens or timers');
  return g;
}

/**
 * Per-game ticker. Game time (default): a system, so it stops while game.paused and follows timeScale.
 * Realtime: driven by the 'frame' event with unscaled dt, runs even while the game is paused.
 */
export function getTicker(game: Game, realtime = false): Ticker {
  const map = realtime ? realTickers : scaledTickers;
  let t = map.get(game);
  if (!t) {
    const ticker = (t = new Ticker());
    if (realtime) game.on('frame', (dt) => ticker.update(dt));
    else game.addSystem(ticker, -100);
    map.set(game, ticker);
  }
  return t;
}

/** True if the node or any ancestor has `paused` set. */
export function isTreePaused(node: Node): boolean {
  for (let n: Node | null = node; n; n = n.parent) if (n.paused) return true;
  return false;
}

export function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as PromiseLike<unknown>).then === 'function';
}
