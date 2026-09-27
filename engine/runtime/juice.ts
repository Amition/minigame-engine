import type { Color } from '../core/color';
import type { Game } from '../core/game';
import { rng } from '../core/rng';
import { Box } from '../scene/box';
import type { Node } from '../scene/node';
import { resolveGame } from './ticker';
import { Tween, tween, type TweenOptions } from './tween';

// Scale-based helpers (punch, pulse, popIn, popOut) scale around the node's anchor: use anchor 0.5 for centered motion.

type JuiceOptions = Pick<TweenOptions, 'realtime' | 'game' | 'onComplete'>;

const shaking = new WeakMap<Node, Tween<{ t: number }>>();

/**
 * Jitters the node around its position, decaying to rest (screen shake: `shake(scene, 16, 0.3)`).
 * Works on moving nodes: only the offset is added and removed.
 */
export function shake(node: Node, intensity = 12, duration = 0.35, opts: JuiceOptions = {}): Tween<{ t: number }> {
  shaking.get(node)?.kill();
  let ox = 0;
  let oy = 0;
  const clear = () => {
    node.x -= ox;
    node.y -= oy;
    ox = oy = 0;
    if (shaking.get(node) === tw) shaking.delete(node);
  };
  const proxy = { t: 0 };
  const tw = new Tween(proxy, {
    ...opts,
    ease: 'linear',
    owner: node,
    onUpdate: () => {
      const k = intensity * (1 - proxy.t);
      const nx = proxy.t >= 1 ? 0 : rng.float(-k, k);
      const ny = proxy.t >= 1 ? 0 : rng.float(-k, k);
      node.x += nx - ox;
      node.y += ny - oy;
      ox = nx;
      oy = ny;
    },
    onKill: clear,
    onComplete: () => {
      clear();
      opts.onComplete?.();
    },
  }).to({ t: 1 }, duration);
  shaking.set(node, tw);
  return tw;
}

interface ScaleJob {
  tween: Tween<Node>;
  sx: number;
  sy: number;
}

const scaleJobs = new WeakMap<Node, ScaleJob>();

/** Starts a scale animation from the node's rest scale, cancelling (and undoing) a previous scale helper. */
function scaleJob(node: Node, build: (sx: number, sy: number, restore: () => void) => Tween<Node>): Tween<Node> {
  const prev = scaleJobs.get(node);
  if (prev) {
    prev.tween.kill();
    node.scaleX = prev.sx;
    node.scaleY = prev.sy;
  }
  const sx = node.scaleX;
  const sy = node.scaleY;
  const job: ScaleJob = { tween: null!, sx, sy };
  const restore = () => {
    if (scaleJobs.get(node) === job) scaleJobs.delete(node);
  };
  job.tween = build(sx, sy, restore);
  scaleJobs.set(node, job);
  return job.tween;
}

/** Quick scale bump and spring back (button press, hit feedback). */
export function punch(node: Node, scale = 1.25, duration = 0.3, opts: JuiceOptions = {}): Tween<Node> {
  return scaleJob(node, (sx, sy, restore) =>
    new Tween(node, {
      ...opts,
      onKill: () => {
        node.scaleX = sx;
        node.scaleY = sy;
        restore();
      },
      onComplete: () => {
        restore();
        opts.onComplete?.();
      },
    })
      .to({ scaleX: sx * scale, scaleY: sy * scale }, duration * 0.35, 'quadOut')
      .to({ scaleX: sx, scaleY: sy }, duration * 0.65, 'backOut'),
  );
}

/** Endless gentle breathing scale (call-to-action buttons). Kill the returned tween to stop. */
export function pulse(node: Node, scale = 1.08, period = 0.9, opts: JuiceOptions = {}): Tween<Node> {
  return scaleJob(node, (sx, sy, restore) =>
    tween(node, { scaleX: sx * scale, scaleY: sy * scale }, period / 2, {
      ...opts,
      ease: 'sineInOut',
      repeat: Infinity,
      yoyo: true,
      onKill: () => {
        node.scaleX = sx;
        node.scaleY = sy;
        restore();
      },
    }),
  );
}

/** Scales from 0 to the node's scale with overshoot; makes it visible. */
export function popIn(node: Node, duration = 0.4, opts: JuiceOptions = {}): Tween<Node> {
  return scaleJob(node, (sx, sy, restore) => {
    node.visible = true;
    node.scaleX = node.scaleY = 0;
    return tween(node, { scaleX: sx, scaleY: sy }, duration, {
      ...opts,
      ease: 'backOut',
      onKill: () => {
        node.scaleX = sx;
        node.scaleY = sy;
        restore();
      },
      onComplete: () => {
        restore();
        opts.onComplete?.();
      },
    });
  });
}

export interface HideOptions extends JuiceOptions {
  /** Destroy the node at the end instead of hiding it. */
  destroy?: boolean;
}

/** Shrinks to 0, then hides (or destroys) the node. */
export function popOut(node: Node, duration = 0.25, opts: HideOptions = {}): Tween<Node> {
  return scaleJob(node, (sx, sy, restore) =>
    tween(node, { scaleX: 0, scaleY: 0 }, duration, {
      ...opts,
      ease: 'backIn',
      onKill: restore,
      onComplete: () => {
        restore();
        if (opts.destroy) node.destroy();
        else {
          node.visible = false;
          node.scaleX = sx;
          node.scaleY = sy;
        }
        opts.onComplete?.();
      },
    }),
  );
}

/** Makes the node visible and fades alpha from 0 to `to` (default 1). */
export function fadeIn(node: Node, duration = 0.3, to = 1, opts: JuiceOptions = {}): Tween<Node> {
  node.visible = true;
  node.alpha = 0;
  return tween(node, { alpha: to }, duration, { ease: 'linear', ...opts });
}

/** Fades alpha to 0, then hides (visible = false, so it stops receiving taps) or destroys the node. */
export function fadeOut(node: Node, duration = 0.3, opts: HideOptions = {}): Tween<Node> {
  return tween(node, { alpha: 0 }, duration, {
    ease: 'linear',
    ...opts,
    onComplete: () => {
      if (opts.destroy) node.destroy();
      else node.visible = false;
      opts.onComplete?.();
    },
  });
}

/** Full-screen color flash in game.overlay that fades out (hits, level up). */
export function flash(game?: Game | null, color: Color = '#ffffff', duration = 0.3, opts: { alpha?: number } & JuiceOptions = {}): Tween<Box> {
  const g = resolveGame(game ?? opts.game);
  const box = g.overlay.add(new Box(g.view.width, g.view.height, { fill: color }, { id: 'flash', alpha: opts.alpha ?? 0.85 }));
  return tween(box, { alpha: 0 }, duration, {
    ease: 'quadIn',
    realtime: opts.realtime,
    game: g,
    onComplete: () => {
      box.destroy();
      opts.onComplete?.();
    },
  });
}

/** Rises and fades out, then destroys the node (score popups: `floatUp(scene.add(new Text('+10')))`). */
export function floatUp(node: Node, distance = 80, duration = 0.8, opts: HideOptions = {}): Tween<Node> {
  const destroy = opts.destroy ?? true;
  const a0 = node.alpha;
  return tween(node, { y: node.y - distance }, duration, {
    ...opts,
    ease: 'quadOut',
    onUpdate: (p) => {
      node.alpha = p < 0.5 ? a0 : a0 * (1 - (p - 0.5) * 2);
    },
    onComplete: () => {
      if (destroy) node.destroy();
      else node.visible = false;
      opts.onComplete?.();
    },
  });
}

/** Toggles visibility `times` times over `duration` (invulnerability blink); ends visible. */
export function blink(node: Node, times = 4, duration = 0.8, opts: JuiceOptions = {}): Tween<{ t: number }> {
  const proxy = { t: 0 };
  return tween(proxy, { t: 1 }, duration, {
    ...opts,
    ease: 'linear',
    owner: node,
    onUpdate: () => {
      node.visible = proxy.t >= 1 || Math.floor(proxy.t * times * 2) % 2 === 1;
    },
    onKill: () => {
      node.visible = true;
    },
  });
}

/** Counts a text label from its current number (or `from`) to `to`: score tallies. */
export function countTo(
  label: Node & { text: string },
  to: number,
  duration = 0.8,
  opts: JuiceOptions & { from?: number; format?: (v: number) => string } = {},
): Tween<{ v: number }> {
  const fmt = opts.format ?? ((v: number) => String(Math.round(v)));
  const proxy = { v: opts.from ?? (parseFloat(label.text) || 0) };
  return tween(proxy, { v: to }, duration, {
    ...opts,
    ease: 'quadOut',
    owner: label,
    onUpdate: () => {
      label.text = fmt(proxy.v);
    },
  });
}
