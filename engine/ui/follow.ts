import { Game } from '../core/game';
import { Mat2D, type Rect, type Vec2 } from '../core/math';
import type { Node } from '../scene/node';

const localTmp = new Mat2D();
const fromTmp = new Mat2D();
const spaceTmp = new Mat2D();
const clampTmp: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** @internal Same as `n.worldMatrix(out)` without the per-call allocations. */
export function worldMatrixInto(n: Node, out: Mat2D): Mat2D {
  if (n.parent) worldMatrixInto(n.parent, out);
  else out.identity();
  return out.multiply(n.localMatrix(localTmp));
}

/** `from` local -> `to` local matrix, written into `out`; null means the stage. */
function spaceMatrixInto(from: Node | null, to: Node | null, out: Mat2D): Mat2D {
  if (to) worldMatrixInto(to, out).invert();
  else out.identity();
  return from ? out.multiply(worldMatrixInto(from, fromTmp)) : out;
}

/** Same as `m.applyRect({ x, y, w, h })`, written into `out`. */
function applyRectInto(m: Mat2D, x: number, y: number, w: number, h: number, out: Rect): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 4; i++) {
    const cx = i < 2 ? x : x + w;
    const cy = (i & 1) === 0 ? y : y + h;
    const px = m.a * cx + m.c * cy + m.e;
    const py = m.b * cx + m.d * cy + m.f;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  out.x = minX;
  out.y = minY;
  out.w = maxX - minX;
  out.h = maxY - minY;
  return out;
}

/**
 * Converts a point from `from`'s local space to `to`'s local space (null = stage coordinates). Works through any
 * mix of scaled / rotated / moved parents, e.g. a world point to a HUD layer:
 *
 *     const p = convertPoint(field, hud, enemy.x, enemy.y);
 */
export function convertPoint(from: Node | null, to: Node | null, x: number, y: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  return spaceMatrixInto(from, to, spaceTmp).apply(x, y, out);
}

function nodeRectInto(node: Node, local: Rect | undefined, space: Node | null, out: Rect): Rect {
  const m = spaceMatrixInto(node, space, spaceTmp);
  return local ? applyRectInto(m, local.x, local.y, local.w, local.h, out) : applyRectInto(m, 0, 0, node.width, node.height, out);
}

/**
 * Axis-aligned bounds, in `space`'s local coordinates (default: stage), of a rect given in `node`'s local
 * coordinates (default: its content box). `nodeRect(n)` equals `n.worldBounds()`.
 */
export function nodeRect(node: Node, local?: Rect, space: Node | null = null): Rect {
  return nodeRectInto(node, local, space, { x: 0, y: 0, w: 0, h: 0 });
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
  let x = 0;
  let y = 0;
  let w: number;
  let h: number;
  if (typeof clamp === 'object') ({ x, y, w, h } = clamp);
  else {
    const g = Game.current;
    if (!g) return null;
    if (clamp === 'view') {
      w = g.view.width;
      h = g.view.height;
    } else ({ x, y, w, h } = g.safe);
  }
  if (space) return applyRectInto(spaceMatrixInto(null, space, spaceTmp), x, y, w, h, clampTmp);
  clampTmp.x = x;
  clampTmp.y = y;
  clampTmp.w = w;
  clampTmp.h = h;
  return clampTmp;
}

const followInto = new WeakMap<FollowRect, (space: Node | null | undefined, out: Rect) => Rect>();

/** @internal Reads a followNode() getter into `out` without allocating; false for any other getter. */
export function readFollowRect(get: unknown, space: Node | null, out: Rect): boolean {
  const into = followInto.get(get as FollowRect);
  if (!into) return false;
  into(space, out);
  return true;
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
  const last: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const into = (mountSpace: Node | null | undefined, r: Rect): Rect => {
    if (target.destroyed) {
      r.x = last.x;
      r.y = last.y;
      r.w = last.w;
      r.h = last.h;
      return r;
    }
    const space = opts.space !== undefined ? opts.space : (mountSpace ?? null);
    const local = typeof opts.rect === 'function' ? opts.rect(target) : opts.rect;
    nodeRectInto(target, local, space, r);
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
    const pad = opts.pad;
    if (pad !== undefined) {
      const t = typeof pad === 'number' ? pad : pad[0];
      const rt = typeof pad === 'number' ? pad : pad[1];
      const b = typeof pad === 'number' ? pad : pad[2];
      const l = typeof pad === 'number' ? pad : pad[3];
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
    last.x = r.x;
    last.y = r.y;
    last.w = r.w;
    last.h = r.h;
    return r;
  };
  const get: FollowRect = (mountSpace) => into(mountSpace, { x: 0, y: 0, w: 0, h: 0 });
  followInto.set(get, into);
  return get;
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
    let ax: number;
    let ay: number;
    if (typeof opts.at === 'function') ({ x: ax, y: ay } = opts.at(target));
    else if (opts.at) ({ x: ax, y: ay } = opts.at);
    else {
      ax = target.width / 2;
      ay = target.height / 2;
    }
    const p = convertPoint(target, node.parent, ax, ay, tmp);
    node.x = p.x + (opts.offset?.x ?? 0);
    node.y = p.y + (opts.offset?.y ?? 0);
    if (opts.hideWithTarget) node.visible = target.worldVisible;
  };
  const game = Game.current;
  offs.push(game ? game.on('update', place) : node.onUpdate(place), node.on('destroyed', stop), target.on('destroyed', stop));
  place();
  return stop;
}
