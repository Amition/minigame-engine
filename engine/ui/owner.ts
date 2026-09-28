import { Game } from '../core/game';
import type { Node } from '../scene/node';
import { Scene } from '../scene/scene';

/** @internal Default owner of overlay UI opened now: the topmost scene of the current game (null without one). */
export function currentUIOwner(): Scene | null {
  return Game.current?.scenes.top ?? null;
}

/**
 * @internal Calls `end` once when `owner` is destroyed (right away if it already is) or, for a scene, as soon as
 * it is no longer in the scene stack (go / restart / pop, before a transition finishes). Returns an unbinder.
 */
export function bindUIOwner(owner: Node, end: () => void): () => void {
  if (owner.destroyed) {
    end();
    return () => undefined;
  }
  let offs: (() => void)[] | null = [];
  const unbind = () => {
    if (!offs) return;
    for (const off of offs) off();
    offs = null;
  };
  const fire = () => {
    if (!offs) return;
    unbind();
    end();
  };
  offs.push(owner.on('destroyed', fire));
  const game = owner instanceof Scene ? (owner.game ?? Game.current) : null;
  if (game) offs.push(game.on('scene', () => void (game.scenes.stack.includes(owner as Scene) || fire())));
  return unbind;
}
