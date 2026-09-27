import type { Ctx2D } from '../gfx/types';
import type { Platform, RawTouchEvent } from '../platform/types';
import { Node, type PointerEvt, type PointerPhase } from '../scene/node';
import { type Scene, SceneManager } from '../scene/scene';
import type { Color } from './color';
import { Emitter } from './emitter';
import { Mat2D, type Insets, type Rect, type Vec2 } from './math';

/**
 * - 'expand': uniform scale so the design size fits, then the view grows along the longer axis
 *   (no letterbox; lay out against game.view / game.safe). Default.
 * - 'fit': uniform scale with letterbox bars; view is exactly the design size.
 */
export type ScaleMode = 'expand' | 'fit';

export interface GameConfig {
  /** Design resolution in design units (e.g. 750x1334 portrait). */
  design: { width: number; height: number };
  scaleMode?: ScaleMode;
  /** Canvas clear color (also fills letterbox bars). */
  background?: Color;
  /** Largest dt passed to update, seconds (default 1/15). */
  maxDt?: number;
  /** Cap for the backing-store pixel ratio (default 2). */
  maxPixelRatio?: number;
  /** Max pointer travel in design units that still counts as a tap (default 24). */
  tapSlop?: number;
  /** Pause updates while the app is hidden (default true). */
  pauseOnHide?: boolean;
}

export interface GameEvents {
  /** Start of every frame, also while paused; payload: unscaled dt (UI animations, scene transitions). */
  frame: number;
  /** After systems and the stage ticked; payload dt. */
  update: number;
  prerender: Ctx2D;
  postrender: Ctx2D;
  resize: { width: number; height: number };
  hide: void;
  show: void;
  scene: Scene;
  /** Stage-level pointer events, emitted after node dispatch (target may be null). */
  pointerdown: PointerEvt;
  pointermove: PointerEvt;
  pointerup: PointerEvt;
  pointercancel: PointerEvt;
}

/** Something updated every frame before the stage (tweens, timers, physics...). */
export interface System {
  update(dt: number): void;
}

export interface GameTime {
  /** Scaled seconds since start. */
  elapsed: number;
  /** Unscaled seconds since start. */
  realElapsed: number;
  /** Last scaled dt. */
  dt: number;
  frame: number;
  timeScale: number;
}

class PointerEvtImpl implements PointerEvt {
  currentTarget: Node | null = null;
  private stopped = false;

  constructor(
    readonly pointerId: number,
    readonly phase: PointerPhase,
    readonly x: number,
    readonly y: number,
    readonly startX: number,
    readonly startY: number,
    readonly target: Node | null,
  ) {}

  get propagationStopped(): boolean {
    return this.stopped;
  }

  stopPropagation(): void {
    this.stopped = true;
  }

  local(): Vec2 {
    return this.currentTarget ? this.currentTarget.toLocal(this.x, this.y) : { x: this.x, y: this.y };
  }
}

interface PointerRecord {
  target: Node | null;
  startX: number;
  startY: number;
  moved: boolean;
}

/**
 * Owns the loop, stage, scaling and input. Stage layout: stage > [sceneLayer, overlay].
 * All coordinates exposed to game code are stage (design) units.
 */
export class Game extends Emitter<GameEvents> {
  /** The most recently created game (convenience for code without a reference). */
  static current: Game | null = null;

  readonly stage = new Node({ id: 'stage' });
  readonly sceneLayer = new Node({ id: 'scenes' });
  /** Above scenes: toasts, modals, debug overlays. */
  readonly overlay = new Node({ id: 'overlay' });
  readonly scenes: SceneManager;

  /** Visible area in design units. */
  readonly view = { width: 0, height: 0 };
  /** Unsafe insets in design units. */
  readonly safeInsets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Safe rectangle in stage coordinates. */
  readonly safe: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** CSS px per design unit. */
  scale = 1;
  /** Letterbox offset in CSS px. */
  offsetX = 0;
  offsetY = 0;
  /** Backing-store pixels per CSS px. */
  pixelRatio = 1;

  readonly time: GameTime = { elapsed: 0, realElapsed: 0, dt: 0, frame: 0, timeScale: 1 };
  /** When true, systems and the stage stop updating; rendering continues. */
  paused = false;
  background: Color;

  private readonly cfg: Required<GameConfig>;
  private systems: { sys: System; priority: number }[] = [];
  private pointers = new Map<number, PointerRecord>();
  private frameId = 0;
  private lastTime = -1;
  private running = false;
  private hiddenPaused = false;
  private inputLocks = 0;
  private readonly ctx: Ctx2D;

  constructor(
    readonly platform: Platform,
    config: GameConfig,
  ) {
    super();
    this.cfg = {
      scaleMode: 'expand',
      background: '#000000',
      maxDt: 1 / 15,
      maxPixelRatio: 2,
      tapSlop: 24,
      pauseOnHide: true,
      ...config,
    };
    this.background = this.cfg.background;
    this.ctx = platform.canvas.getContext('2d');
    this.stage.append(this.sceneLayer, this.overlay);
    this.scenes = new SceneManager(this, this.sceneLayer);
    this.resize();
    platform.onTouch((e) => this.handleTouch(e));
    platform.onResize(() => this.resize());
    platform.onHide(() => {
      platform.audio.suspend();
      if (this.cfg.pauseOnHide && !this.paused) {
        this.paused = true;
        this.hiddenPaused = true;
      }
      this.emit('hide', undefined);
    });
    platform.onShow(() => {
      platform.audio.resume();
      if (this.hiddenPaused) {
        this.paused = false;
        this.hiddenPaused = false;
      }
      this.lastTime = -1;
      this.emit('show', undefined);
    });
    Game.current = this;
  }

  get config(): Readonly<Required<GameConfig>> {
    return this.cfg;
  }

  get design(): { width: number; height: number } {
    return this.cfg.design;
  }

  // ---------------------------------------------------------------- loop

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = -1;
    const loop = (t: number) => {
      if (!this.running) return;
      this.frameId = this.platform.requestFrame(loop);
      const dt = this.lastTime < 0 ? 1 / 60 : (t - this.lastTime) / 1000;
      this.lastTime = t;
      this.step(dt);
    };
    this.frameId = this.platform.requestFrame(loop);
  }

  stop(): void {
    this.running = false;
    this.platform.cancelFrame(this.frameId);
  }

  /** One frame: update (dt clamped to maxDt) then render. Tests call this directly. */
  step(dt: number): void {
    this.update(Math.min(Math.max(dt, 0), this.cfg.maxDt));
    this.render();
  }

  update(rawDt: number): void {
    const dt = rawDt * this.time.timeScale;
    this.time.dt = dt;
    this.time.frame++;
    this.time.realElapsed += rawDt;
    this.emit('frame', rawDt);
    if (this.paused) return;
    this.time.elapsed += dt;
    for (const { sys } of this.systems.slice()) sys.update(dt);
    this.stage.tick(dt);
    this.emit('update', dt);
  }

  render(): void {
    const ctx = this.ctx;
    const canvas = this.platform.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const k = this.pixelRatio * this.scale;
    ctx.setTransform(k, 0, 0, k, this.offsetX * this.pixelRatio, this.offsetY * this.pixelRatio);
    this.emit('prerender', ctx);
    this.stage.render(ctx);
    this.emit('postrender', ctx);
  }

  /** Registers a per-frame system (runs before the stage, lower priority first). Returns a remover. */
  addSystem(sys: System, priority = 0): () => void {
    this.systems.push({ sys, priority });
    this.systems.sort((a, b) => a.priority - b.priority);
    return () => {
      const i = this.systems.findIndex((s) => s.sys === sys);
      if (i >= 0) this.systems.splice(i, 1);
    };
  }

  // ---------------------------------------------------------------- scaling

  resize(): void {
    const { screen, canvas } = this.platform;
    const { width: dw, height: dh } = this.cfg.design;
    this.pixelRatio = Math.min(screen.pixelRatio, this.cfg.maxPixelRatio);
    canvas.width = Math.round(screen.width * this.pixelRatio);
    canvas.height = Math.round(screen.height * this.pixelRatio);
    const s = Math.min(screen.width / dw, screen.height / dh);
    this.scale = s;
    if (this.cfg.scaleMode === 'fit') {
      this.view.width = dw;
      this.view.height = dh;
      this.offsetX = (screen.width - dw * s) / 2;
      this.offsetY = (screen.height - dh * s) / 2;
    } else {
      this.view.width = screen.width / s;
      this.view.height = screen.height / s;
      this.offsetX = 0;
      this.offsetY = 0;
    }
    const si = screen.safeInsets;
    this.safeInsets.top = Math.max(0, si.top - this.offsetY) / s;
    this.safeInsets.bottom = Math.max(0, si.bottom - this.offsetY) / s;
    this.safeInsets.left = Math.max(0, si.left - this.offsetX) / s;
    this.safeInsets.right = Math.max(0, si.right - this.offsetX) / s;
    this.safe.x = this.safeInsets.left;
    this.safe.y = this.safeInsets.top;
    this.safe.w = this.view.width - this.safeInsets.left - this.safeInsets.right;
    this.safe.h = this.view.height - this.safeInsets.top - this.safeInsets.bottom;
    this.stage.setSize(this.view.width, this.view.height);
    this.sceneLayer.setSize(this.view.width, this.view.height);
    this.overlay.setSize(this.view.width, this.view.height);
    this.scenes?.handleResize(this.view.width, this.view.height);
    this.emit('resize', { width: this.view.width, height: this.view.height });
  }

  /** Screen CSS px → stage coordinates. */
  screenToStage(x: number, y: number): Vec2 {
    return { x: (x - this.offsetX) / this.scale, y: (y - this.offsetY) / this.scale };
  }

  /** Stage coordinates → screen CSS px. */
  stageToScreen(x: number, y: number): Vec2 {
    return { x: x * this.scale + this.offsetX, y: y * this.scale + this.offsetY };
  }

  // ---------------------------------------------------------------- input

  /** Topmost interactive node at a stage point, or null. */
  hitTest(x: number, y: number): Node | null {
    return hitNode(this.stage, x, y);
  }

  /** True while any lockInput() is held: new touches are ignored and pending taps don't fire. */
  get inputLocked(): boolean {
    return this.inputLocks > 0;
  }

  /** Blocks input (e.g. during scene transitions). Returns the release function (safe to call twice). */
  lockInput(): () => void {
    this.inputLocks++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.inputLocks--;
    };
  }

  /** Prevents the pending tap of a pointer that is still down (e.g. after a long press fired). */
  cancelTap(pointerId: number): void {
    const rec = this.pointers.get(pointerId);
    if (rec) rec.moved = true;
  }

  private handleTouch(e: RawTouchEvent): void {
    for (const t of e.touches) {
      const p = this.screenToStage(t.x, t.y);
      if (e.phase === 'start') {
        if (this.inputLocks > 0) continue;
        const target = this.hitTest(p.x, p.y);
        const rec = { target, startX: p.x, startY: p.y, moved: false };
        this.pointers.set(t.id, rec);
        this.dispatch('pointerdown', t.id, p, rec);
        continue;
      }
      const rec = this.pointers.get(t.id);
      if (!rec) continue;
      if (e.phase === 'move') {
        const dx = p.x - rec.startX;
        const dy = p.y - rec.startY;
        if (dx * dx + dy * dy > this.cfg.tapSlop * this.cfg.tapSlop) rec.moved = true;
        this.dispatch('pointermove', t.id, p, rec);
      } else if (e.phase === 'end') {
        this.pointers.delete(t.id);
        this.dispatch('pointerup', t.id, p, rec);
        if (!rec.moved && rec.target && !rec.target.destroyed && this.inputLocks === 0) {
          this.dispatch('tap', t.id, p, rec);
        }
      } else {
        this.pointers.delete(t.id);
        this.dispatch('pointercancel', t.id, p, rec);
      }
    }
  }

  private dispatch(
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'tap',
    id: number,
    p: Vec2,
    rec: PointerRecord,
  ): void {
    const phase: PointerPhase =
      type === 'pointerdown' ? 'down' : type === 'pointermove' ? 'move' : type === 'pointercancel' ? 'cancel' : 'up';
    const target = rec.target;
    const evt = new PointerEvtImpl(id, phase, p.x, p.y, rec.startX, rec.startY, target);
    for (let n: Node | null = target; n && !evt.propagationStopped; n = n.parent) {
      evt.currentTarget = n;
      n.emit(type, evt);
    }
    if (type !== 'tap') {
      evt.currentTarget = null;
      this.emit(type, evt);
    }
  }
}

const hitMat = new Mat2D();

function hitNode(node: Node, px: number, py: number): Node | null {
  if (!node.visible || node.destroyed) return null;
  const p = node.localMatrix(hitMat).invert().apply(px, py);
  const inside = node.hitTest(p.x, p.y);
  if (!node.hitClip(p.x, p.y)) return null;
  if (node.interactiveChildren && node.children.length) {
    node.sortChildren();
    for (let i = node.children.length - 1; i >= 0; i--) {
      const hit = hitNode(node.children[i]!, p.x, p.y);
      if (hit) return hit;
    }
  }
  return node.interactive && inside ? node : null;
}
