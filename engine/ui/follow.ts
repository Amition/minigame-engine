import { Game } from '../core/game';
import { Mat2D, type Rect, type Vec2 } from '../core/math';
import type { Node } from '../scene/node';

/** `from` local -> `to` local matrix; null means the stage. */
function spaceMatrix(from: Node | null, to: Node | null): Mat2D {
  const m = to ? to.worldMatrix().invert() : new Mat2D();
  return from ? m.multiply(from.worldMatrix()) : m;
}

/**
 * Converts a point from `from`'s local space to `to`'s local space (null = stage coordinates). Works through any
 * mix of scaled / rotated / moved parents, e.g. a world point to a HUD layer:
 *
 *     const p = convertPoint(field, hud, enemy.x, enemy.y);
 */
export function convertPoint(from: Node | null, to: Node | null, x: number, y: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  return spaceMatrix(from, to).apply(x, y, out);
}

/**
 * Axis-aligned bounds, in `space`'s local coordinates (default: stage), of a rect given in `node`'s local
 * coordinates (default: its content box). `nodeRect(n)` equals `n.worldBounds()`.
 */
export function nodeRect(node: Node, local?: Rect, space: Node | null = null): Rect {
  return spaceMatrix(node, space).applyRect(local ?? { x: 0, y: 0, w: node.width, h: node.height });
}

export interface FollowNodeOptions {
  /** Rect in the target's local coordinates (default its content box), or a function of the target. */
  rect?: Rect | ((target: Node) => Rect);
  /**
   * Coordinate space of the result. Omitted: the mount parent when used as a `mountScreen` area (UIScreen passes
   * it), the stage when the getter is called without an argument. `null`: always the stage.
   */
  space?: Node | null;
  /** Shift in space units, applied right after the conversion. */
  offset?: { x: number; y: number };
  /** Area to stay inside ('view', 'safe' or a stage rect): each edge is clamped into it. Default: none. */
  clamp?: 'view' | 'safe' | Rect | null;
  /** Inset applied after clamping, space units: all sides or [top, right, bottom, left]; negative grows. */
  pad?: number | readonly [number, number, number, number];
  /** Minimum size after padding; the rect grows around `anchor`. */
  minWidth?: number;
  minHeight?: number;
  /** Point of the rect (fractions) that stays put when minWidth / minHeight enlarge it (default centre). */
  anchor?: { x: number; y: number };
}

/** A rect getter; `space` is supplied by `mountScreen` (the mount parent) and used when options.space is omitted. */
export type FollowRect = (space?: Node | null) => Rect;

function clampArea(clamp: FollowNodeOptions['clamp'], space: Node | null): Rect | null {
  if (!clamp) return null;
  let r: Rect;
  if (typeof clamp === 'object') r = clamp;
  else {
    const g = Game.current;
    if (!g) return null;
    r = clamp === 'view' ? { x: 0, y: 0, w: g.view.width, h: g.view.height } : g.safe;
  }
  return space ? spaceMatrix(null, space).applyRect(r) : { ...r };
}

/**
 * Rect getter that tracks a (world) node, for `mountScreen(parent, content, { area: followNode(target) })`: the
 * mounted UI re-lays out whenever the target moves, its parents scale (camera, fitted field) or the view resizes,
 * like Cocos' UICoordinateTracker. Steps: target rect -> space -> offset -> clamp -> pad -> min size. After the
 * target is destroyed the last rect is returned.
 *
 *     // HP bar and jump button on the tower face, 18 below its top, never below the safe area
 *     mountScreen(hudLayer, column, { area: followNode(tower, { pad: [18, 10, 8, 10], clamp: 'safe', minWidth: 150 }) });
 */
export function followNode(target: Node, opts: FollowNodeOptions = {}): FollowRect {
  let last: Rect = { x: 0, y: 0, w: 0, h: 0 };
  return (mountSpace) => {
    if (target.destroyed) return { ...last };
    const space = opts.space !== undefined ? opts.space : (mountSpace ?? null);
    const local = typeof opts.rect === 'function' ? opts.rect(target) : opts.rect;
    const r = nodeRect(target, local, space);
    if (opts.offset) {
      r.x += opts.offset.x;
      r.y += opts.offset.y;
    }
    const c = clampArea(opts.clamp, space);
    if (c) {
      const x0 = Math.min(Math.max(r.x, c.x), c.x + c.w);
      const y0 = Math.min(Math.max(r.y, c.y), c.y + c.h);
      const x1 = Math.min(Math.max(r.x + r.w, c.x), c.x + c.w);
      const y1 = Math.min(Math.max(r.y + r.h, c.y), c.y + c.h);
      r.x = x0;
      r.y = y0;
      r.w = x1 - x0;
      r.h = y1 - y0;
    }
    if (opts.pad !== undefined) {
      const [t, rt, b, l] = typeof opts.pad === 'number' ? [opts.pad, opts.pad, opts.pad, opts.pad] : opts.pad;
      r.x += l;
      r.y += t;
      r.w = Math.max(0, r.w - l - rt);
      r.h = Math.max(0, r.h - t - b);
    }
    const ax = opts.anchor?.x ?? 0.5;
    const ay = opts.anchor?.y ?? 0.5;
    if (opts.minWidth !== undefined && r.w < opts.minWidth) {
      r.x -= (opts.minWidth - r.w) * ax;
      r.w = opts.minWidth;
    }
    if (opts.minHeight !== undefined && r.h < opts.minHeight) {
      r.y -= (opts.minHeight - r.h) * ay;
      r.h = opts.minHeight;
    }
    last = r;
    return { ...r };
  };
}

export interface PinToNodeOptions {
  /** Point in the target's local coordinates (default the centre of its content box), or a function of the target. */
  at?: { x: number; y: number } | ((target: Node) => { x: number; y: number });
  /** Shift in the pinned node's parent units. */
  offset?: { x: number; y: number };
  /** Also copy the target's effective visibility (default false). */
  hideWithTarget?: boolean;
}

/**
 * Keeps `node` (its x/y, i.e. its anchor, in its parent's space) on a point of `target` every frame, after the
 * stage updated and before rendering: labels over characters, markers on world objects (Cocos UICoordinateTracker).
 * Placed immediately too. Stops when either node is destroyed; returns a remover. Pin nodes that no flex container
 * lays out (a plain HUD layer child or `position: 'manual'`).
 *
 *     const tag = hud.add(new Text('P1', style, { anchor: 0.5 }));
 *     pinToNode(tag, archer, { at: (a) => ({ x: a.width / 2, y: 0 }), offset: { x: 0, y: -20 }, hideWithTarget: true });
 */
export function pinToNode(node: Node, target: Node, opts: PinToNodeOptions = {}): () => void {
  const tmp = { x: 0, y: 0 };
  const offs: (() => void)[] = [];
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const off of offs) off();
    offs.length = 0;
  };
  const place = () => {
    if (stopped) return;
    if (node.destroyed || target.destroyed) {
      stop();
      return;
    }
    const at = typeof opts.at === 'function' ? opts.at(target) : (opts.at ?? { x: target.width / 2, y: target.height / 2 });
    const p = convertPoint(target, node.parent, at.x, at.y, tmp);
    node.x = p.x + (opts.offset?.x ?? 0);
    node.y = p.y + (opts.offset?.y ?? 0);
    if (opts.hideWithTarget) node.visible = target.worldVisible;
  };
  const game = Game.current;
  offs.push(game ? game.on('update', place) : node.onUpdate(place), node.on('destroyed', stop), target.on('destroyed', stop));
  place();
  return stop;
}
