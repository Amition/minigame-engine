import { Emitter } from '../core/emitter';
import type { Node } from '../scene/node';

/**
 * Global bus for decoupled game events: `events.emit('coin', 5)` / `events.on('coin', (n) => ...)`.
 * Listeners outlive scenes: subscribe with onEvent(type, fn, owner) to drop them with the owner node.
 * For a typed bus of your own: `const bus = new Emitter<{ coin: number; die: void }>()`.
 */
export const events = new Emitter<Record<string, any>>();

/** Calls `off` when `owner` is destroyed. Returns `off`. */
export function disposeWith(owner: Node, off: () => void): () => void {
  if (owner.destroyed) {
    off();
    return off;
  }
  const unhook = owner.once('destroyed', off);
  return () => {
    unhook();
    off();
  };
}

/** Subscribes to the global bus; with an owner the listener is removed when the owner is destroyed. */
export function onEvent(type: string, fn: (payload: any) => void, owner?: Node): () => void {
  const off = events.on(type, fn);
  return owner ? disposeWith(owner, off) : off;
}
