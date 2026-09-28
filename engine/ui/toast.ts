import { Game } from '../core/game';
import type { Node } from '../scene/node';
import { animateUI } from './anim';
import { UIIcon, type UIIconSource } from './icon';
import { Label } from './label';
import { bindUIOwner, currentUIOwner } from './owner';
import type { UIColor, UIColorToken } from './theme';
import { UIView } from './view';

export type UIToastVariant = 'info' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  icon?: UIIconSource;
  /** Seconds on screen (default 2). */
  duration?: number;
  variant?: UIToastVariant;
  /** Default 'top' (below the safe-area top). */
  position?: 'top' | 'center' | 'bottom';
  /**
   * Node the toast belongs to: it is dropped (from the queue, or from the screen at once) when the owner is
   * destroyed or, for a scene, left. Default: the topmost scene when queued in the game overlay's toast host.
   * `null`: app-level, survives scene changes.
   */
  owner?: Node | null;
}

const same = (a: number, b: number) => a === b || (a !== a && b !== b);

const FILL: Record<UIToastVariant, UIColor> = {
  info: 'rgba(16,16,40,0.92)',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

const ON: Record<UIToastVariant, UIColorToken> = {
  info: 'text',
  success: 'onSuccess',
  warning: 'onWarning',
  danger: 'onDanger',
};

/** A short message pill; created by showToast(). */
export class Toast extends UIView {
  readonly label: Label;
  readonly duration: number;
  readonly position: 'top' | 'center' | 'bottom';
  /** 'queued' → 'showing' → 'done'. */
  state: 'queued' | 'showing' | 'done' = 'queued';
  /** @internal ToastOptions.owner as given (undefined = default). */
  readonly ownerProp: Node | null | undefined;
  private unbindOwner: (() => void) | null = null;
  private t = 0;

  constructor(text: string, opts: ToastOptions = {}) {
    const v = opts.variant ?? 'info';
    super(
      {
        direction: 'row',
        align: 'center',
        gap: 'sm',
        padding: [18, 36],
        radius: 'full',
        fill: FILL[v],
        shadow: 'md',
        anchor: 0.5,
        maxWidth: 640,
        alignSelf: 'center',
        lintRole: 'decor',
      },
      'Toast',
    );
    this.duration = opts.duration ?? 2;
    this.position = opts.position ?? 'top';
    this.ownerProp = opts.owner;
    if (opts.icon) this.add(new UIIcon({ src: opts.icon, size: 40, color: ON[v], shrink: 0 }));
    this.label = this.add(new Label(text, { size: 30, weight: 'bold', color: ON[v], align: 'center', shrink: 1 }));
    this.visible = false;
  }

  get text(): string {
    return this.label.text;
  }

  /** @internal Called by the host on enqueue: the toast is destroyed with `owner` (see ToastOptions.owner). */
  bindOwner(owner: Node): void {
    this.unbindOwner?.();
    this.unbindOwner = bindUIOwner(owner, () => this.destroy());
  }

  /** @internal Called by the host when it is this toast's turn. */
  show(): void {
    this.state = 'showing';
    this.visible = true;
    this.t = 0;
    const dy = this.position === 'bottom' ? 40 : -40;
    animateUI(this, { alpha: 1, translateY: 0, scale: 1 }, { from: { alpha: 0, translateY: dy, scale: 0.9 }, duration: 0.25, ease: 'outBack' });
  }

  /** Hides now (skips the rest of the duration). */
  hide(): void {
    if (this.state === 'done') return;
    if (this.state === 'queued') {
      this.state = 'done';
      this.destroy();
      return;
    }
    this.state = 'done';
    animateUI(this, { alpha: 0, translateY: this.position === 'bottom' ? 30 : -30 }, { duration: 0.2, ease: 'inQuad', onDone: () => this.destroy() });
  }

  override update(dt: number): void {
    if (this.state !== 'showing') return;
    this.t += dt;
    if (this.t >= this.duration + 0.25) this.hide();
  }

  protected override onDestroy(): void {
    this.unbindOwner?.();
    this.unbindOwner = null;
    this.state = 'done';
    super.onDestroy();
  }

  override describe() {
    return { ...super.describe(), text: this.label.text, state: this.state };
  }
}

/** Full-screen, tap-transparent layer in game.overlay that shows queued toasts one at a time. */
export class ToastHost extends UIView {
  private queue: Toast[] = [];
  private current: Toast | null = null;
  private synced = false;
  private sw = 0;
  private sh = 0;
  private st = 0;
  private sb = 0;

  constructor() {
    super({ position: 'absolute', inset: 0, direction: 'stack', align: 'center', zIndex: 1000, lintRole: 'decor' }, 'ToastHost');
    this.interactive = false;
  }

  /**
   * Queues `t`. Its owner (ToastOptions.owner) defaults to the topmost scene when this host sits in the game
   * overlay; a toast whose owner goes away leaves the queue (or the screen) at once.
   */
  enqueue(t: Toast): Toast {
    const owner = t.ownerProp !== undefined ? t.ownerProp : this.parent === Game.current?.overlay ? currentUIOwner() : null;
    this.queue.push(t);
    this.add(t);
    t.once('destroyed', () => this.forget(t));
    if (owner) t.bindOwner(owner);
    if (!t.destroyed) this.pump();
    return t;
  }

  /** Toasts waiting or showing. */
  get pending(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  clear(): void {
    const q = this.queue;
    this.queue = [];
    for (const t of q) t.destroy();
    this.current?.hide();
  }

  private forget(t: Toast): void {
    const i = this.queue.indexOf(t);
    if (i >= 0) this.queue.splice(i, 1);
    if (this.current === t) this.current = null;
  }

  private pump(): void {
    if (this.current && !this.current.destroyed && this.current.state === 'showing') return;
    this.current = null;
    while (this.queue.length) {
      const t = this.queue.shift()!;
      if (t.destroyed) continue;
      this.current = t;
      const g = Game.current;
      const i = g?.safeInsets ?? { top: 0, bottom: 0 };
      const h = g?.view.height ?? 1334;
      t.setLayout(
        t.position === 'top'
          ? { position: 'absolute', top: i.top + Math.round(h * 0.09), center: 'x' }
          : t.position === 'bottom'
            ? { position: 'absolute', bottom: i.bottom + Math.round(h * 0.12), center: 'x' }
            : { position: 'flow' },
      );
      t.show();
      return;
    }
  }

  uiSync(): boolean {
    const g = Game.current;
    if (!g) {
      if (!this.synced) return false;
      this.synced = false;
      return true;
    }
    const w = g.view.width;
    const h = g.view.height;
    const t = g.safeInsets.top;
    const b = g.safeInsets.bottom;
    if (this.synced && same(w, this.sw) && same(h, this.sh) && same(t, this.st) && same(b, this.sb)) return false;
    this.synced = true;
    this.sw = w;
    this.sh = h;
    this.st = t;
    this.sb = b;
    return true;
  }

  override update(): void {
    if (!this.current || this.current.destroyed || this.current.state !== 'showing') this.pump();
  }
}

const hosts = new WeakMap<Node, ToastHost>();

/** The toast layer of an overlay node (default: the current game's overlay), created on first use. */
export function toastHost(overlay?: Node): ToastHost {
  const o = overlay ?? Game.current?.overlay;
  if (!o) throw new Error('toastHost(): no overlay and no Game.current');
  let h = hosts.get(o);
  if (!h || h.destroyed || h.parent !== o) {
    h = o.add(new ToastHost());
    hosts.set(o, h);
  }
  return h;
}

/** Queues a toast: `showToast('Saved!', { icon: 'check', variant: 'success' })`. Toasts show one at a time. */
export function showToast(text: string, opts: ToastOptions = {}): Toast {
  return toastHost().enqueue(new Toast(text, opts));
}
