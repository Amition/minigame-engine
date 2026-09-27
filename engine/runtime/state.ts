import type { Node } from '../scene/node';

export interface StateDef<S extends string> {
  /** Entering the state; `prev` is null for the initial state. */
  enter?(prev: S | null, params?: unknown): void;
  /** Every update; return another state name to switch to it. `time` = seconds spent in this state. */
  update?(dt: number, time: number): S | void;
  /** Leaving the state for `next`. */
  exit?(next: S): void;
}

/**
 * Finite state machine with named states, readable for game logic and AI:
 *
 *     const fsm = new StateMachine({
 *       idle: { update: () => (input.jump ? 'jump' : undefined) },
 *       jump: { enter: () => (hero.vy = -900), update: (dt, t) => (t > 0.6 ? 'idle' : undefined) },
 *     }, 'idle');
 *     fsm.attach(hero); // or call fsm.update(dt) yourself
 */
export class StateMachine<S extends string> {
  /** Current state name. */
  state: S;
  /** Previous state name (null before the first switch). */
  previous: S | null = null;
  /** Seconds spent in the current state. */
  time = 0;
  /** Called after every switch. */
  onChange: ((to: S, from: S) => void) | null = null;
  private switching = false;

  constructor(
    readonly states: { [K in S]: StateDef<NoInfer<S>> },
    initial: NoInfer<S>,
    params?: unknown,
  ) {
    this.state = initial;
    this.states[initial].enter?.(null, params);
  }

  /** True if the current state is one of the given names. */
  is(...names: S[]): boolean {
    return names.includes(this.state);
  }

  /** Switches state (exit → enter). Switching to the current state is ignored unless `restart` is true. */
  go(next: S, params?: unknown, restart = false): boolean {
    if (next === this.state && !restart) return false;
    if (!(next in this.states)) throw new Error(`StateMachine: unknown state "${next}" (have: ${Object.keys(this.states).join(', ')})`);
    if (this.switching) throw new Error(`StateMachine: go("${next}") called during exit/enter of "${this.state}"`);
    const from = this.state;
    this.switching = true;
    try {
      this.states[from].exit?.(next);
      this.previous = from;
      this.state = next;
      this.time = 0;
      this.states[next].enter?.(from, params);
    } finally {
      this.switching = false;
    }
    this.onChange?.(next, from);
    return true;
  }

  update(dt: number): void {
    // Rounded to nanoseconds so e.g. 30 frames of 1/60 read as exactly 0.5 in `time >= 0.5` checks.
    this.time = Math.round((this.time + dt) * 1e9) / 1e9;
    const next = this.states[this.state].update?.(dt, this.time);
    if (next) this.go(next);
  }

  /** Runs update(dt) from the node's update loop (paused/destroyed with it). Returns a remover. */
  attach(node: Node): () => void {
    return node.onUpdate((dt) => this.update(dt));
  }
}
