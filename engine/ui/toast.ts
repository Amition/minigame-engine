import { Game } from '../core/game';
import type { Node } from '../scene/node';
import { animateUI } from './anim';
import { UIIcon, type UIIconSource } from './icon';
import { Label } from './label';
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
}

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
    if (opts.icon) this.add(new UIIcon({ src: opts.icon, size: 40, color: ON[v], shrink: 0 }));
    this.label = this.add(new Label(text, { size: 30, weight: 'bold', color: ON[v], align: 'center', shrink: 1 }));
    this.visible = false;
  }

  get text(): string {
    return this.label.text;
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

  override describe() {
    return { ...super.describe(), text: this.label.text, state: this.state };
  }
}

/** Full-screen, tap-transparent layer in game.overlay that shows queued toasts one at a time. */
export class ToastHost extends UIView {
  private queue: Toast[] = [];
  private current: Toast | null = null;
  private insetsKey = '';

  constructor() {
    super({ position: 'absolute', inset: 0, direction: 'stack', align: 'center', zIndex: 1000, lintRole: 'decor' }, 'ToastHost');
    this.interactive = false;
  }

  enqueue(t: Toast): Toast {
    this.queue.push(t);
    this.add(t);
    this.pump();
    return t;
  }

  /** Toasts waiting or showing. */
  get pending(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  clear(): void {
    for (const t of this.queue) t.destroy();
    this.queue = [];
    this.current?.hide();
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
    const key = g ? `${g.view.width}x${g.view.height}:${g.safeInsets.top},${g.safeInsets.bottom}` : '';
    if (key === this.insetsKey) return false;
    this.insetsKey = key;
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
