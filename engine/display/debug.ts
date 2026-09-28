import type { Game } from '../core/game';
import { Mat2D, type Vec2 } from '../core/math';
import type { Ctx2D } from '../gfx/types';
import { Node } from '../scene/node';

const TAU = Math.PI * 2;
const DEFAULT_COLOR = '#ffd23f';
const MAX_REQUESTS = 20000;

// ---------------------------------------------------------------- debugDraw

type DebugShape = 'line' | 'arrow' | 'rect' | 'circle' | 'point' | 'text' | 'polygon';

export interface DebugDrawOptions {
  /** CSS color (default '#ffd23f'). */
  color?: string;
  /** Line width in design units (default 2). */
  width?: number;
  /** Point size / text size in design units (default 10 / 20). */
  size?: number;
  /** Fill rect / circle / polygon instead of stroking. */
  fill?: boolean;
  /** Coordinates are in this node's local space (a World, a physics layer...); default: stage space. */
  space?: Node | null;
  /** Keep the request for this many seconds (default 0: this frame only). */
  duration?: number;
}

/** A color string (allocation-free) or options. */
export type DebugDrawStyle = string | DebugDrawOptions;

interface DebugRequest {
  shape: DebugShape;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  size: number;
  fill: boolean;
  text: string;
  pts: number[];
  space: Node | null;
  ttl: number;
  drawn: boolean;
  age: number;
}

const tmpLocal = new Mat2D();
const tmpSpace = new Mat2D();
const pA: Vec2 = { x: 0, y: 0 };
const pB: Vec2 = { x: 0, y: 0 };

/** Local → stage matrix without allocating (Node.worldMatrix allocates a chain array). */
function worldMatrixInto(n: Node, out: Mat2D): Mat2D {
  if (n.parent) worldMatrixInto(n.parent, out);
  else out.identity();
  return out.multiply(n.localMatrix(tmpLocal));
}

/**
 * One-frame debug drawing in the spirit of Excalibur's ex.Debug: call from update(), systems or physics code,
 * the debug overlay draws the requests on top of everything and drops them at the start of the next frame
 * (or after `duration` seconds; requests made between frames, e.g. in input handlers, are drawn once first).
 * Calls are ignored (nearly free) while no overlay with `draw` is shown.
 * Request objects are pooled, so a color-string style allocates nothing.
 *
 *     debugDraw.arrow(body.x, body.y, body.x + body.vx * 0.1, body.y + body.vy * 0.1, '#4ade80');
 *     debugDraw.circle(p.x, p.y, 40, { color: '#f00', duration: 1, space: world });
 */
class DebugDraw {
  private reqs: DebugRequest[] = [];
  private n = 0;
  private users = 0;
  private owner: object | null = null;

  /** True while a debug overlay that draws requests is shown. */
  get enabled(): boolean {
    return this.users > 0;
  }

  /** Pending requests. */
  get count(): number {
    return this.n;
  }

  line(x1: number, y1: number, x2: number, y2: number, style?: DebugDrawStyle): void {
    const r = this.push('line', style);
    if (r) this.seg(r, x1, y1, x2, y2);
  }

  /** Line with an arrow head at (x2, y2): velocities, forces, directions. */
  arrow(x1: number, y1: number, x2: number, y2: number, style?: DebugDrawStyle): void {
    const r = this.push('arrow', style);
    if (r) this.seg(r, x1, y1, x2, y2);
  }

  rect(x: number, y: number, w: number, h: number, style?: DebugDrawStyle): void {
    const r = this.push('rect', style);
    if (r) this.seg(r, x, y, w, h);
  }

  circle(x: number, y: number, radius: number, style?: DebugDrawStyle): void {
    const r = this.push('circle', style);
    if (r) this.seg(r, x, y, radius, 0);
  }

  point(x: number, y: number, style?: DebugDrawStyle): void {
    const r = this.push('point', style);
    if (r) this.seg(r, x, y, 0, 0);
  }

  /** Text with its top-left at (x, y), outlined for contrast; stays upright in rotated spaces. */
  text(text: string, x: number, y: number, style?: DebugDrawStyle): void {
    const r = this.push('text', style);
    if (!r) return;
    this.seg(r, x, y, 0, 0);
    r.text = text;
  }

  /** Closed polygon from flat points [x0, y0, x1, y1, ...] (copied). */
  polygon(points: readonly number[], style?: DebugDrawStyle): void {
    const r = this.push('polygon', style);
    if (!r) return;
    r.pts.length = 0;
    for (let i = 0; i + 1 < points.length; i += 2) r.pts.push(points[i]!, points[i + 1]!);
  }

  /** Drops every pending request. */
  clear(): void {
    for (let i = 0; i < this.n; i++) this.forget(this.reqs[i]!);
    this.n = 0;
  }

  // ---------------------------------------------------------------- used by DebugOverlay

  /** An overlay starts drawing requests. */
  retain(): void {
    this.users++;
  }

  /** An overlay stops drawing requests; the last one clears the queue. */
  release(owner: object): void {
    this.users = Math.max(0, this.users - 1);
    if (this.owner === owner) this.owner = null;
    if (this.users === 0) this.clear();
  }

  /**
   * Start of a frame: ages requests by dt and drops expired ones that were drawn (undrawn ones get one more
   * frame). Only one overlay (the owner) advances the shared queue.
   */
  advance(dt: number, owner: object): void {
    if (this.owner && this.owner !== owner) return;
    this.owner = owner;
    let keep = 0;
    for (let i = 0; i < this.n; i++) {
      const r = this.reqs[i]!;
      r.ttl -= dt;
      r.age++;
      if (r.ttl > 0 || (!r.drawn && r.age < 2)) {
        if (keep !== i) {
          this.reqs[i] = this.reqs[keep]!;
          this.reqs[keep] = r;
        }
        keep++;
      } else {
        this.forget(r);
      }
    }
    this.n = keep;
  }

  /** Draws pending requests; ctx must be in stage (design) space. */
  drawTo(ctx: Ctx2D, fontFamily = 'sans-serif'): void {
    if (this.n === 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (let i = 0; i < this.n; i++) {
      const r = this.reqs[i]!;
      r.drawn = true;
      let m: Mat2D | null = null;
      if (r.space) {
        if (r.space.destroyed) continue;
        m = worldMatrixInto(r.space, tmpSpace);
      }
      drawRequest(ctx, r, m, fontFamily);
    }
    ctx.restore();
  }

  private push(shape: DebugShape, style: DebugDrawStyle | undefined): DebugRequest | null {
    if (this.users === 0 || this.n >= MAX_REQUESTS) return null;
    let r = this.reqs[this.n];
    if (!r) {
      r = { shape, x1: 0, y1: 0, x2: 0, y2: 0, color: '', width: 2, size: 0, fill: false, text: '', pts: [], space: null, ttl: 0, drawn: false, age: 0 };
      this.reqs.push(r);
    }
    this.n++;
    r.shape = shape;
    r.drawn = false;
    r.age = 0;
    if (style === undefined || typeof style === 'string') {
      r.color = style ?? DEFAULT_COLOR;
      r.width = 2;
      r.size = 0;
      r.fill = false;
      r.space = null;
      r.ttl = 0;
    } else {
      r.color = style.color ?? DEFAULT_COLOR;
      r.width = style.width ?? 2;
      r.size = style.size ?? 0;
      r.fill = !!style.fill;
      r.space = style.space ?? null;
      r.ttl = Math.max(0, style.duration ?? 0);
    }
    return r;
  }

  private seg(r: DebugRequest, x1: number, y1: number, x2: number, y2: number): void {
    r.x1 = x1;
    r.y1 = y1;
    r.x2 = x2;
    r.y2 = y2;
  }

  private forget(r: DebugRequest): void {
    r.space = null;
    r.text = '';
  }
}

export const debugDraw = /* @__PURE__ */ new DebugDraw();

function pt(m: Mat2D | null, x: number, y: number, out: Vec2): Vec2 {
  if (m) return m.apply(x, y, out);
  out.x = x;
  out.y = y;
  return out;
}

function drawRequest(ctx: Ctx2D, r: DebugRequest, m: Mat2D | null, fontFamily: string): void {
  ctx.strokeStyle = r.color;
  ctx.fillStyle = r.color;
  ctx.lineWidth = r.width;
  ctx.beginPath();
  switch (r.shape) {
    case 'line':
    case 'arrow': {
      const a = pt(m, r.x1, r.y1, pA);
      const b = pt(m, r.x2, r.y2, pB);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (r.shape === 'arrow') {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const head = Math.max(10, r.width * 4);
        ctx.moveTo(b.x - Math.cos(ang - 0.45) * head, b.y - Math.sin(ang - 0.45) * head);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b.x - Math.cos(ang + 0.45) * head, b.y - Math.sin(ang + 0.45) * head);
      }
      ctx.stroke();
      return;
    }
    case 'rect': {
      const { x1: x, y1: y, x2: w, y2: h } = r;
      let p = pt(m, x, y, pA);
      ctx.moveTo(p.x, p.y);
      p = pt(m, x + w, y, pA);
      ctx.lineTo(p.x, p.y);
      p = pt(m, x + w, y + h, pA);
      ctx.lineTo(p.x, p.y);
      p = pt(m, x, y + h, pA);
      ctx.lineTo(p.x, p.y);
      ctx.closePath();
      break;
    }
    case 'circle': {
      const c = pt(m, r.x1, r.y1, pA);
      const k = m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1;
      ctx.arc(c.x, c.y, Math.max(0, r.x2 * k), 0, TAU);
      break;
    }
    case 'point': {
      const c = pt(m, r.x1, r.y1, pA);
      ctx.arc(c.x, c.y, (r.size || 10) / 2, 0, TAU);
      ctx.fill();
      return;
    }
    case 'text': {
      const c = pt(m, r.x1, r.y1, pA);
      ctx.font = `${r.size || 20}px ${fontFamily}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(r.text, c.x, c.y);
      ctx.fillText(r.text, c.x, c.y);
      return;
    }
    case 'polygon': {
      const p = r.pts;
      if (p.length < 4) return;
      for (let i = 0; i + 1 < p.length; i += 2) {
        const q = pt(m, p[i]!, p[i + 1]!, pA);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      ctx.closePath();
      break;
    }
  }
  if (r.fill) ctx.fill();
  else ctx.stroke();
}

// ---------------------------------------------------------------- overlay

export type DebugOverlayCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface DebugOverlayOptions {
  /** Stats panel: fps, frame / update / render ms, nodes, particles, texture MB, frame-time graph (default true). */
  stats?: boolean;
  /** Outline every rendered node (rotated content box) (default false). */
  bounds?: boolean;
  /** Fill the tap areas (incl. hitPadding) of nodes that currently receive input (default false). */
  hits?: boolean;
  /** Draw debugDraw requests (default true). */
  draw?: boolean;
  /** Stats panel corner inside the safe area (default 'top-left'). */
  corner?: DebugOverlayCorner;
  /** Panel text size in design units (default 22). */
  fontSize?: number;
  /** Seconds between panel text refreshes (default 0.25). */
  refresh?: number;
}

const OVERLAY_Z = 1e9;
const MAX_TREE_NODES = 5000;
const GRAPH_MS = 1000 / 30;
const BUDGET_MS = 1000 / 60;
const PANEL_LINES = 7;

const overlays = new WeakMap<Game, DebugOverlay>();

/**
 * Debug layer on top of game.overlay: stats panel, node bounds, hit areas and debugDraw requests.
 * Never receives input (not interactive, no hit-tested children) and is tagged `lint-ignore` + `debug`.
 * Draws in design space after the rest of the stage. Create it with showDebugOverlay().
 */
export class DebugOverlay extends Node {
  readonly options: Required<DebugOverlayOptions>;
  private readonly lines: string[] = new Array<string>(PANEL_LINES).fill('');
  private fpsColor = '#4ade80';
  private sinceRefresh = Infinity;
  private drawing = false;
  private readonly offFrame: () => void;
  private readonly offResize: () => void;
  private readonly mats: Mat2D[] = [];
  private readonly boxMat = new Mat2D();
  private readonly hitQuads: number[] = [];
  private visited = 0;

  constructor(
    readonly game: Game,
    opts: DebugOverlayOptions = {},
  ) {
    super({ id: 'debug-overlay', tags: ['lint-ignore', 'debug'], zIndex: OVERLAY_Z, interactive: false, interactiveChildren: false });
    this.options = { stats: true, bounds: false, hits: false, draw: true, corner: 'top-left', fontSize: 22, refresh: 0.25 };
    this.configure(opts);
    this.setSize(game.view.width, game.view.height);
    this.offFrame = game.on('frame', (dt) => this.onFrame(dt));
    this.offResize = game.on('resize', (v) => this.setSize(v.width, v.height));
  }

  override get kind(): string {
    return 'DebugOverlay';
  }

  /** Changes options (undefined values are ignored). */
  configure(opts: DebugOverlayOptions): this {
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined) (this.options as Record<string, unknown>)[k] = v;
    }
    this.sinceRefresh = Infinity;
    this.syncDraw();
    return this;
  }

  /** Panel text as shown (refreshed every `refresh` seconds). */
  get panelLines(): readonly string[] {
    return this.lines;
  }

  override render(ctx: Ctx2D): void {
    if (!this.visible || this.destroyed) return;
    const g = this.game;
    const o = this.options;
    ctx.save();
    const k = g.pixelRatio * g.scale;
    ctx.setTransform(k, 0, 0, k, g.offsetX * g.pixelRatio, g.offsetY * g.pixelRatio);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (o.bounds || o.hits) this.drawTree(ctx);
    if (this.drawing) debugDraw.drawTo(ctx, g.platform.fontFamily);
    if (o.stats) this.drawPanel(ctx);
    ctx.restore();
  }

  override describe() {
    const o = this.options;
    return { ...super.describe(), stats: o.stats, bounds: o.bounds, hits: o.hits, draw: o.draw, fps: Math.round(this.game.stats.fps) };
  }

  protected override onDestroy(): void {
    this.offFrame();
    this.offResize();
    if (this.drawing) debugDraw.release(this);
    this.drawing = false;
    if (overlays.get(this.game) === this) overlays.delete(this.game);
  }

  private syncDraw(): void {
    const want = this.options.draw && !this.destroyed;
    if (want === this.drawing) return;
    this.drawing = want;
    if (want) debugDraw.retain();
    else debugDraw.release(this);
  }

  private onFrame(dt: number): void {
    if (this.drawing) debugDraw.advance(dt, this);
    this.sinceRefresh += dt;
  }

  // ---------------------------------------------------------------- stats panel

  private refreshLines(): void {
    const s = this.game.stats;
    const f = (v: number) => v.toFixed(2);
    this.lines[0] = `${s.fps.toFixed(1)} fps  worst ${s.intervalMs.max.toFixed(0)} ms`;
    this.lines[1] = `frame  ${f(s.frameMs.avg)} ms  max ${f(s.frameMs.max)}`;
    this.lines[2] = `update ${f(s.updateMs.avg)} ms  max ${f(s.updateMs.max)}`;
    this.lines[3] = `render ${f(s.renderMs.avg)} ms  max ${f(s.renderMs.max)}`;
    this.lines[4] = `nodes ${s.nodes}  drawn ${s.drawnNodes}`;
    this.lines[5] = `particles ${s.particles}`;
    this.lines[6] = `textures ${s.textureCount}  ${s.textureMB.toFixed(1)} MB`;
    this.fpsColor = s.fps >= 55 ? '#4ade80' : s.fps >= 30 ? '#facc15' : '#f87171';
  }

  private drawPanel(ctx: Ctx2D): void {
    const o = this.options;
    if (this.sinceRefresh >= o.refresh) {
      this.sinceRefresh = 0;
      this.refreshLines();
    }
    const g = this.game;
    const fs = o.fontSize;
    const lh = Math.round(fs * 1.3);
    const pad = Math.round(fs * 0.5);
    const w = Math.round(fs * 15);
    const graphH = Math.round(fs * 2.2);
    const h = pad * 3 + lh * PANEL_LINES + graphH;
    const safe = g.safe;
    const m = 8;
    const x = o.corner.endsWith('left') ? safe.x + m : safe.x + safe.w - w - m;
    const y = o.corner.startsWith('top') ? safe.y + m : safe.y + safe.h - h - m;
    ctx.fillStyle = 'rgba(10,12,18,0.78)';
    ctx.fillRect(x, y, w, h);
    ctx.font = `${fs}px ${g.platform.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (let i = 0; i < PANEL_LINES; i++) {
      ctx.fillStyle = i === 0 ? this.fpsColor : '#e6ecf8';
      ctx.fillText(this.lines[i]!, x + pad, y + pad + i * lh);
    }
    this.drawGraph(ctx, x + pad, y + pad * 2 + lh * PANEL_LINES, w - pad * 2, graphH);
  }

  /** CPU ms per frame, newest on the right; full height = 33 ms, guide line = 16.7 ms. */
  private drawGraph(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
    const series = this.game.stats.frameMs;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, w, h);
    const n = series.size;
    const bw = w / n;
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i < series.count; i++) {
        const v = series.at(i);
        if ((v > BUDGET_MS) !== (pass === 1)) continue;
        const bh = Math.min(h, (v / GRAPH_MS) * h);
        ctx.rect(x + w - (i + 1) * bw, y + h - bh, Math.max(1, bw - 0.5), bh);
      }
      ctx.fillStyle = pass === 0 ? '#38bdf8' : '#f97316';
      ctx.fill();
    }
    const gy = y + h - (BUDGET_MS / GRAPH_MS) * h;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x, gy, w, 1);
  }

  // ---------------------------------------------------------------- bounds / hit areas

  private drawTree(ctx: Ctx2D): void {
    const o = this.options;
    this.visited = 0;
    this.hitQuads.length = 0;
    ctx.beginPath();
    this.visit(ctx, this.game.stage, null, 0, true, true);
    if (o.bounds) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(56,189,248,0.7)';
      ctx.stroke();
    }
    const q = this.hitQuads;
    if (o.hits && q.length > 0) {
      ctx.beginPath();
      for (let i = 0; i < q.length; i += 8) {
        ctx.moveTo(q[i]!, q[i + 1]!);
        ctx.lineTo(q[i + 2]!, q[i + 3]!);
        ctx.lineTo(q[i + 4]!, q[i + 5]!);
        ctx.lineTo(q[i + 6]!, q[i + 7]!);
        ctx.closePath();
      }
      ctx.fillStyle = 'rgba(255,0,170,0.2)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,60,190,0.95)';
      ctx.stroke();
    }
  }

  private visit(ctx: Ctx2D, n: Node, parent: Mat2D | null, depth: number, rendered: boolean, hittable: boolean): void {
    if (!n.visible || n.destroyed || n === this || this.visited >= MAX_TREE_NODES) return;
    this.visited++;
    const o = this.options;
    const m = (this.mats[depth] ??= new Mat2D());
    if (parent) m.copyFrom(parent);
    else m.identity();
    m.multiply(n.localMatrix(tmpLocal));
    const drawn = rendered && n.alpha > 0;
    const w = n.width;
    const h = n.height;
    if (w > 0 && h > 0 && ((o.bounds && drawn) || (o.hits && hittable && n.interactive))) {
      // A World's local matrix includes its camera; its own box is the viewport.
      const vm = (n as { viewportMatrix?: (out: Mat2D) => Mat2D }).viewportMatrix;
      let box = m;
      if (typeof vm === 'function') {
        box = this.boxMat;
        if (parent) box.copyFrom(parent);
        else box.identity();
        box.multiply(vm.call(n, tmpLocal));
      }
      if (o.bounds && drawn) quadPath(ctx, box, 0, 0, w, h);
      if (o.hits && hittable && n.interactive) {
        const p = n.hitPadding;
        pushQuad(this.hitQuads, box, -p, -p, w + 2 * p, h + 2 * p);
      }
    }
    if (!drawn && !o.hits) return;
    const childHittable = hittable && n.interactiveChildren;
    if (!drawn && !childHittable) return;
    const ch = n.children;
    for (let i = 0; i < ch.length; i++) this.visit(ctx, ch[i]!, m, depth + 1, drawn, childHittable);
  }
}

function quadPath(ctx: Ctx2D, m: Mat2D, x: number, y: number, w: number, h: number): void {
  let p = m.apply(x, y, pA);
  ctx.moveTo(p.x, p.y);
  p = m.apply(x + w, y, pA);
  ctx.lineTo(p.x, p.y);
  p = m.apply(x + w, y + h, pA);
  ctx.lineTo(p.x, p.y);
  p = m.apply(x, y + h, pA);
  ctx.lineTo(p.x, p.y);
  ctx.closePath();
}

function pushQuad(out: number[], m: Mat2D, x: number, y: number, w: number, h: number): void {
  let p = m.apply(x, y, pA);
  out.push(p.x, p.y);
  p = m.apply(x + w, y, pA);
  out.push(p.x, p.y);
  p = m.apply(x + w, y + h, pA);
  out.push(p.x, p.y);
  p = m.apply(x, y + h, pA);
  out.push(p.x, p.y);
}

/**
 * Shows (or reconfigures) the debug overlay of a game and returns it:
 * `showDebugOverlay(game, { stats: true, bounds: true, hits: true })`.
 */
export function showDebugOverlay(game: Game, opts: DebugOverlayOptions = {}): DebugOverlay {
  let o = overlays.get(game);
  if (o && !o.destroyed) {
    o.configure(opts);
  } else {
    o = new DebugOverlay(game, opts);
    overlays.set(game, o);
  }
  if (o.parent !== game.overlay) game.overlay.add(o);
  return o;
}

/** Removes the game's debug overlay (no-op if none). */
export function hideDebugOverlay(game: Game): void {
  overlays.get(game)?.destroy();
}

/** The game's debug overlay, or null. */
export function getDebugOverlay(game: Game): DebugOverlay | null {
  const o = overlays.get(game);
  return o && !o.destroyed ? o : null;
}

/** Hides the overlay if shown, else shows it with `opts`. Returns true when now shown. */
export function toggleDebugOverlay(game: Game, opts: DebugOverlayOptions = {}): boolean {
  if (getDebugOverlay(game)) {
    hideDebugOverlay(game);
    return false;
  }
  showDebugOverlay(game, opts);
  return true;
}

const TRUTHY = new Set(['', '1', 'true', 'on', 'yes']);

function queryParam(query: string | Record<string, unknown>, name: string): string | null {
  if (typeof query !== 'string') {
    const v = query[name];
    return v === undefined || v === null ? null : String(v);
  }
  const s = query.charAt(0) === '?' || query.charAt(0) === '#' ? query.slice(1) : query;
  for (const part of s.split('&')) {
    const eq = part.indexOf('=');
    const k = eq < 0 ? part : part.slice(0, eq);
    if (safeDecode(k) !== name) continue;
    return eq < 0 ? '' : safeDecode(part.slice(eq + 1).replace(/\+/g, ' '));
  }
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Turns on the overlay from launch parameters (a URL search string like '?debug=1', or a mini-game launch query
 * object). `stats=1` shows the panel; `debug=1` panel + hit areas + debugDraw; `debug=all` adds bounds;
 * `debug=stats,bounds,hits,draw` picks parts. Returns the overlay, or null when the parameters don't ask for it.
 */
export function applyDebugQuery(game: Game, query: string | Record<string, unknown>): DebugOverlay | null {
  const debug = queryParam(query, 'debug');
  const stats = queryParam(query, 'stats');
  const on = (v: string | null) => v !== null && TRUTHY.has(v.trim().toLowerCase());
  const opts: DebugOverlayOptions = { stats: false, bounds: false, hits: false, draw: false };
  let any = false;
  if (on(stats)) {
    opts.stats = true;
    any = true;
  }
  if (debug !== null && debug !== '0' && debug.toLowerCase() !== 'false') {
    const v = debug.trim().toLowerCase();
    any = true;
    if (TRUTHY.has(v)) {
      Object.assign(opts, { stats: true, hits: true, draw: true });
    } else if (v === 'all') {
      Object.assign(opts, { stats: true, bounds: true, hits: true, draw: true });
    } else {
      for (const part of v.split(',')) {
        const p = part.trim();
        if (p === 'stats' || p === 'bounds' || p === 'hits' || p === 'draw') opts[p] = true;
      }
    }
  }
  return any ? showDebugOverlay(game, opts) : null;
}
