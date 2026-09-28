import { Game } from '../core/game';
import type { Node } from '../scene/node';

/** Something advanced every frame by a Ticker. `tick` returns false once it is finished. */
export interface Tickable {
  tick(dt: number): boolean;
}

/** Time tolerance so durations summed from 1/60 steps still complete on the expected frame. */
export const TIME_EPS = 1e-6;

/** Ticks every item once, dropping finished ones; items added meanwhile are kept and start next pass. */
export function tickAll(list: Tickable[], dt: number): void {
  beginTickPass();
  const n = list.length;
  let w = 0;
  let i = 0;
  try {
    for (; i < n; i++) {
      const it = list[i]!;
      if (it.tick(dt)) list[w++] = it;
    }
  } finally {
    // i < n only when a tick threw: that item and the unvisited ones stay.
    for (; i < list.length; i++) list[w++] = list[i]!;
    list.length = w;
    endTickPass();
  }
}

class Ticker {
  private items: Tickable[] = [];

  add(item: Tickable): void {
    this.items.push(item);
  }

  update(dt: number): void {
    tickAll(this.items, dt);
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

// Pause states of ancestors shared by many owners (a scene, a layer) are looked up once per ticker pass instead of
// once per tween / timer / spring. Only valid while nothing but tickable internals ran since they were stored: every
// pass start and every user callback run by a tickable (invalidatePauseCache) drops them. Property writes of tweens
// and springs are not callbacks, so a setter that pauses or moves nodes is seen from the next callback or pass on.
const SLOTS = 64;
const slotNode: (Node | null)[] = new Array<Node | null>(SLOTS).fill(null);
const slotEpoch = new Int32Array(SLOTS);
const slotPaused = new Uint8Array(SLOTS);
let epoch = 1;
let passDepth = 0;

function beginTickPass(): void {
  passDepth++;
  invalidatePauseCache();
}

function endTickPass(): void {
  if (--passDepth === 0) slotNode.fill(null);
}

/** Tickables call this after running user code (callbacks may pause, move or destroy nodes). */
export function invalidatePauseCache(): void {
  if (++epoch === 0x7fffffff) {
    epoch = 1;
    slotEpoch.fill(0);
  }
}

/** isTreePaused() for tickables during a ticker pass (same result, ancestors cached for the pass). */
export function ownerPaused(node: Node): boolean {
  if (node.paused) return true;
  const p = node.parent;
  if (p === null) return false;
  return passDepth > 0 ? ancestorPaused(p) : isTreePaused(p);
}

function ancestorPaused(n: Node): boolean {
  const s = n.uid & (SLOTS - 1);
  if (slotNode[s] === n && slotEpoch[s] === epoch) return slotPaused[s] === 1;
  const p = n.parent;
  const r = n.paused || (p !== null && ancestorPaused(p));
  slotNode[s] = n;
  slotEpoch[s] = epoch;
  slotPaused[s] = r ? 1 : 0;
  return r;
}

export function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as PromiseLike<unknown>).then === 'function';
}
