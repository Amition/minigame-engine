import type { Node } from '../scene/node';

export type UIEase = 'linear' | 'inQuad' | 'outQuad' | 'inOutQuad' | 'outCubic' | 'outBack' | 'inBack';

const eases: Record<UIEase, (t: number) => number> = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t) => 1 - (1 - t) ** 3,
  outBack: (t) => {
    const c = 1.70158;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  },
  inBack: (t) => {
    const c = 1.70158;
    return (c + 1) * t * t * t - c * t * t;
  },
};

export interface UIAnimOptions {
  /** Seconds (default 0.2). */
  duration?: number;
  delay?: number;
  ease?: UIEase;
  /** Start values applied immediately (default: current values). */
  from?: Record<string, number>;
  onDone?: () => void;
}

interface Anim {
  keys: string[];
  to: Record<string, number>;
  from: Record<string, number> | null;
  explicitFrom: boolean;
  t: number;
  dur: number;
  delay: number;
  ease: (t: number) => number;
  onDone?: () => void;
}

interface Runner {
  list: Anim[];
  off: () => void;
}

const runners = new WeakMap<Node, Runner>();

function expand(o: Record<string, number>): Record<string, number> {
  if (!('scale' in o)) return o;
  const { scale, ...rest } = o;
  return { scaleX: scale!, scaleY: scale!, ...rest };
}

/**
 * Tiny property animator for UI feedback (press, modal, toast). Animates numeric fields of the node
 * (`alpha`, `scale` = scaleX+scaleY, `translateY`, ...) in its update loop. Starting an animation cancels
 * running ones on the same properties. Returns a cancel function.
 */
export function animateUI(node: Node, to: Record<string, number>, opts: UIAnimOptions = {}): () => void {
  const target = expand(to);
  const keys = Object.keys(target);
  const n = node as unknown as Record<string, number>;
  let r = runners.get(node);
  if (r) {
    for (const a of r.list) a.keys = a.keys.filter((k) => !(k in target));
    r.list = r.list.filter((a) => a.keys.length > 0);
  }
  const from = opts.from ? expand(opts.from) : null;
  if (from) for (const k of Object.keys(from)) n[k] = from[k]!;
  const anim: Anim = {
    keys,
    to: target,
    from,
    explicitFrom: !!from,
    t: 0,
    dur: Math.max(0, opts.duration ?? 0.2),
    delay: Math.max(0, opts.delay ?? 0),
    ease: eases[opts.ease ?? 'outQuad'],
    ...(opts.onDone ? { onDone: opts.onDone } : {}),
  };
  if (!r) {
    const runner: Runner = { list: [], off: () => undefined };
    runner.off = node.onUpdate((dt) => step(node, runner, dt));
    runners.set(node, runner);
    r = runner;
  }
  r.list.push(anim);
  return () => {
    const cur = runners.get(node);
    if (cur) cur.list = cur.list.filter((a) => a !== anim);
  };
}

function step(node: Node, r: Runner, dt: number): void {
  const n = node as unknown as Record<string, number>;
  for (const a of r.list.slice()) {
    a.t += dt;
    if (a.t < a.delay) continue;
    if (!a.explicitFrom && !a.from) {
      a.from = {};
      for (const k of a.keys) a.from[k] = n[k] ?? 0;
    }
    const p = a.dur <= 0 ? 1 : Math.min(1, (a.t - a.delay) / a.dur);
    const e = a.ease(p);
    for (const k of a.keys) {
      const f = a.from![k] ?? n[k] ?? 0;
      n[k] = f + (a.to[k]! - f) * e;
    }
    if (p >= 1) {
      r.list.splice(r.list.indexOf(a), 1);
      a.onDone?.();
    }
  }
  if (r.list.length === 0) {
    r.off();
    runners.delete(node);
  }
}

/** True while `node` has running UI animations. */
export function isUIAnimating(node: Node): boolean {
  return (runners.get(node)?.list.length ?? 0) > 0;
}
