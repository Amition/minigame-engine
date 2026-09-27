import { Game } from '../core/game';
import type { Rect, Vec2 } from '../core/math';
import type { Node, PointerEvt } from '../scene/node';
import { isTreePaused, resolveGame } from './ticker';
import { after, type Timer } from './timers';

type PointerType = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

/** Subscribes to pointer events of a node (making it interactive) or of the whole stage. */
function listen(target: Node | Game, type: PointerType, fn: (e: PointerEvt) => void): () => void {
  if (target instanceof Game) return target.on(type, fn);
  target.interactive = true;
  return target.on(type, fn);
}

function gameOf(target: Node | Game): Game {
  return target instanceof Game ? target : resolveGame();
}

// ---------------------------------------------------------------- draggable

export interface DragInfo {
  node: Node;
  pointer: PointerEvt;
  /** Node position (parent space). */
  x: number;
  y: number;
  /** Movement since the drag started (parent space). */
  dx: number;
  dy: number;
}

export interface DraggableOptions {
  /** Keeps the node's box inside this rect (parent space), or inside its parent's (0,0,width,height). */
  bounds?: Rect | 'parent' | null;
  /** Restrict movement to one axis (default 'both'). */
  axis?: 'x' | 'y' | 'both';
  onStart?: (e: DragInfo) => void;
  onMove?: (e: DragInfo) => void;
  onEnd?: (e: DragInfo) => void;
}

export interface Draggable {
  /** Set false to ignore new drags. */
  enabled: boolean;
  readonly dragging: boolean;
  /** Removes the drag behaviour. */
  off(): void;
}

/** Makes a node draggable with a pointer: `draggable(card, { bounds: 'parent', onEnd: (e) => drop(e.node) })`. */
export function draggable(node: Node, opts: DraggableOptions = {}): Draggable {
  const axis = opts.axis ?? 'both';
  let id = -1;
  let ox = 0;
  let oy = 0;
  let sx = 0;
  let sy = 0;
  const toParent = (e: PointerEvt): Vec2 => (node.parent ? node.parent.toLocal(e.x, e.y) : { x: e.x, y: e.y });
  const info = (e: PointerEvt): DragInfo => ({ node, pointer: e, x: node.x, y: node.y, dx: node.x - sx, dy: node.y - sy });
  const clampToBounds = (x: number, y: number): Vec2 => {
    const b = opts.bounds === 'parent' ? (node.parent ? { x: 0, y: 0, w: node.parent.width, h: node.parent.height } : null) : opts.bounds;
    if (!b) return { x, y };
    const w = node.width * Math.abs(node.scaleX);
    const h = node.height * Math.abs(node.scaleY);
    const minX = b.x + node.anchorX * w;
    const maxX = b.x + b.w - (1 - node.anchorX) * w;
    const minY = b.y + node.anchorY * h;
    const maxY = b.y + b.h - (1 - node.anchorY) * h;
    return {
      x: maxX < minX ? (minX + maxX) / 2 : Math.min(Math.max(x, minX), maxX),
      y: maxY < minY ? (minY + maxY) / 2 : Math.min(Math.max(y, minY), maxY),
    };
  };
  const handle: Draggable = {
    enabled: true,
    get dragging() {
      return id >= 0;
    },
    off: () => {
      for (const off of offs) off();
      id = -1;
    },
  };
  const end = (e: PointerEvt) => {
    if (e.pointerId !== id) return;
    id = -1;
    opts.onEnd?.(info(e));
  };
  const offs = [
    listen(node, 'pointerdown', (e) => {
      if (!handle.enabled || id >= 0) return;
      e.stopPropagation();
      id = e.pointerId;
      const p = toParent(e);
      ox = node.x - p.x;
      oy = node.y - p.y;
      sx = node.x;
      sy = node.y;
      opts.onStart?.(info(e));
    }),
    listen(node, 'pointermove', (e) => {
      if (e.pointerId !== id) return;
      const p = toParent(e);
      const c = clampToBounds(axis === 'y' ? node.x : p.x + ox, axis === 'x' ? node.y : p.y + oy);
      node.x = c.x;
      node.y = c.y;
      opts.onMove?.(info(e));
    }),
    listen(node, 'pointerup', end),
    listen(node, 'pointercancel', end),
  ];
  return handle;
}

// ---------------------------------------------------------------- swipe

export type SwipeDir = 'left' | 'right' | 'up' | 'down';

export interface SwipeInfo {
  dir: SwipeDir;
  /** Stage-space movement. */
  dx: number;
  dy: number;
  /** Seconds from down to up. */
  duration: number;
  /** Units per second along the movement. */
  speed: number;
  vx: number;
  vy: number;
  start: Vec2;
  end: Vec2;
}

export interface SwipeOptions {
  /** Minimum travel in design units (default 60). */
  minDistance?: number;
  /** Maximum seconds from down to up (default 0.6). */
  maxDuration?: number;
  /** Ignored while this node's subtree is paused; removed when it is destroyed (useful with a Game target). */
  owner?: Node;
}

/**
 * Calls `fn(dir, speed, info)` on a quick flick over a node or anywhere on the stage (pass the game).
 * `onSwipe(game, (dir) => board.move(dir), { owner: scene })`. Returns a remover.
 */
export function onSwipe(
  target: Node | Game,
  fn: (dir: SwipeDir, velocity: number, info: SwipeInfo) => void,
  opts: SwipeOptions = {},
): () => void {
  const game = gameOf(target);
  const minDist = opts.minDistance ?? 60;
  const maxDur = opts.maxDuration ?? 0.6;
  const downs = new Map<number, { x: number; y: number; t: number }>();
  const offs = [
    listen(target, 'pointerdown', (e) => {
      if (opts.owner && isTreePaused(opts.owner)) return;
      downs.set(e.pointerId, { x: e.x, y: e.y, t: game.time.realElapsed });
    }),
    listen(target, 'pointerup', (e) => {
      const d = downs.get(e.pointerId);
      if (!d) return;
      downs.delete(e.pointerId);
      if (opts.owner && isTreePaused(opts.owner)) return;
      const dx = e.x - d.x;
      const dy = e.y - d.y;
      const dist = Math.hypot(dx, dy);
      const duration = Math.max(game.time.realElapsed - d.t, 1 / 240);
      if (dist < minDist || duration > maxDur) return;
      const dir: SwipeDir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
      const speed = dist / duration;
      fn(dir, speed, { dir, dx, dy, duration, speed, vx: dx / duration, vy: dy / duration, start: { x: d.x, y: d.y }, end: { x: e.x, y: e.y } });
    }),
    listen(target, 'pointercancel', (e) => void downs.delete(e.pointerId)),
  ];
  const off = () => {
    for (const o of offs) o();
  };
  opts.owner?.once('destroyed', off);
  return off;
}

// ---------------------------------------------------------------- long press / double tap

export interface LongPressOptions {
  /** Max travel (design units) before the press is cancelled (default: the game's tapSlop). */
  tolerance?: number;
}

/**
 * Calls `fn` when the node is held for `seconds` (default 0.5) without moving; the tap that would follow is cancelled.
 * Returns a remover.
 */
export function onLongPress(node: Node, fn: (e: PointerEvt) => void, seconds = 0.5, opts: LongPressOptions = {}): () => void {
  const game = resolveGame();
  const tol = opts.tolerance ?? game.config.tapSlop;
  let timer: Timer | null = null;
  let pid = -1;
  let sx = 0;
  let sy = 0;
  const cancel = () => {
    timer?.cancel();
    timer = null;
    pid = -1;
  };
  const offs = [
    listen(node, 'pointerdown', (e) => {
      if (pid >= 0) return;
      pid = e.pointerId;
      sx = e.x;
      sy = e.y;
      timer = after(seconds, () => {
        timer = null;
        game.cancelTap(e.pointerId);
        fn(e);
      }, { owner: node, realtime: true, game });
    }),
    listen(node, 'pointermove', (e) => {
      if (e.pointerId !== pid) return;
      if (Math.hypot(e.x - sx, e.y - sy) > tol) cancel();
    }),
    listen(node, 'pointerup', (e) => void (e.pointerId === pid && cancel())),
    listen(node, 'pointercancel', (e) => void (e.pointerId === pid && cancel())),
  ];
  return () => {
    cancel();
    for (const o of offs) o();
  };
}

export interface DoubleTapOptions {
  /** Max seconds between the two taps (default 0.3). */
  interval?: number;
  /** Max distance between the two taps (default 40). */
  distance?: number;
}

/** Calls `fn` when the node is tapped twice quickly. Returns a remover. */
export function onDoubleTap(node: Node, fn: (e: PointerEvt) => void, opts: DoubleTapOptions = {}): () => void {
  const game = resolveGame();
  const interval = opts.interval ?? 0.3;
  const maxDist = opts.distance ?? 40;
  let last: { t: number; x: number; y: number } | null = null;
  return node.onTap((e) => {
    const now = game.time.realElapsed;
    if (last && now - last.t <= interval && Math.hypot(e.x - last.x, e.y - last.y) <= maxDist) {
      last = null;
      fn(e);
    } else {
      last = { t: now, x: e.x, y: e.y };
    }
  });
}

// ---------------------------------------------------------------- pinch

export interface PinchEvent {
  phase: 'start' | 'move' | 'end';
  /** Finger distance relative to the start of the pinch (2 = spread twice as far). */
  scale: number;
  /** Scale change since the previous event. */
  delta: number;
  /** Midpoint of the two pointers (stage coordinates). */
  center: Vec2;
  /** Radians the finger pair rotated since the start. */
  rotation: number;
}

/**
 * Two-finger pinch on a node or the whole stage. Typical zoom:
 * `let s0 = 1; pinch(map, (e) => { if (e.phase === 'start') s0 = map.scaleX; map.setScale(clamp(s0 * e.scale, 0.5, 3)); })`.
 */
export function pinch(target: Node | Game, fn: (e: PinchEvent) => void, opts: { owner?: Node } = {}): () => void {
  const pts = new Map<number, Vec2>();
  let active = false;
  let d0 = 1;
  let a0 = 0;
  let last = 1;
  const pair = (): [Vec2, Vec2] => {
    const [a, b] = [...pts.values()];
    return [a!, b!];
  };
  const emit = (phase: PinchEvent['phase']) => {
    const [a, b] = pair();
    const d = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
    const scale = d / d0;
    const delta = scale / last;
    last = scale;
    fn({ phase, scale, delta, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, rotation: Math.atan2(b.y - a.y, b.x - a.x) - a0 });
  };
  const up = (e: PointerEvt) => {
    if (!pts.has(e.pointerId)) return;
    if (active) {
      pts.set(e.pointerId, { x: e.x, y: e.y });
      emit('end');
      active = false;
    }
    pts.delete(e.pointerId);
  };
  const offs = [
    listen(target, 'pointerdown', (e) => {
      if (pts.size >= 2 || (opts.owner && isTreePaused(opts.owner))) return;
      pts.set(e.pointerId, { x: e.x, y: e.y });
      if (pts.size === 2) {
        const [a, b] = pair();
        d0 = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
        a0 = Math.atan2(b.y - a.y, b.x - a.x);
        last = 1;
        active = true;
        emit('start');
      }
    }),
    listen(target, 'pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.x, y: e.y });
      if (active) emit('move');
    }),
    listen(target, 'pointerup', up),
    listen(target, 'pointercancel', up),
  ];
  const off = () => {
    for (const o of offs) o();
  };
  opts.owner?.once('destroyed', off);
  return off;
}
