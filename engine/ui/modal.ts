import { Game } from '../core/game';
import type { Node } from '../scene/node';
import { animateUI } from './anim';
import { Button, IconButton, type ButtonProps } from './button';
import { uiEvents } from './events';
import { Label } from './label';
import { bindUIOwner, currentUIOwner } from './owner';
import { Panel, UIView, type UIViewProps } from './view';

export interface ModalProps extends UIViewProps {
  title?: string;
  /** Close (X) button on the panel corner (default true). */
  closeButton?: boolean;
  /** Close when the dimmed backdrop is tapped (default true). */
  closeOnBackdrop?: boolean;
  /** 'pop' (scale in, default) or 'sheet' (slides up from the bottom edge). */
  animation?: 'pop' | 'sheet';
  /** Panel look (default 'raised'). */
  variant?: 'surface' | 'raised' | 'glass';
  /** Called once after the close animation with the close result (button action, 'close', 'backdrop' or null). */
  onClose?: (result: string | null) => void;
  /**
   * Node the modal belongs to. When it is destroyed, or when a scene owner is left (go / restart / pop), the modal
   * is removed at once without animation: `closed` never resolves and onClose is not called, so code waiting on it
   * in the old scene stays asleep. Default: the topmost scene when the modal opens in the game overlay (the default
   * parent). `null`: app-level dialog that survives scene changes.
   */
  owner?: Node | null;
}

/** The dimmed full-screen layer behind a modal; swallows taps. */
export class UIBackdrop extends UIView {
  constructor() {
    super({ position: 'absolute', inset: 0, fill: 'backdrop', lintRole: 'blocker' }, 'Backdrop');
    this.interactive = true;
  }
}

let openModals = 0;

const same = (a: number, b: number) => a === b || (a !== a && b !== b);

/**
 * Modal window: backdrop + centered panel in `game.overlay`, kept inside the safe area, with open/close
 * animations. Children go into `modal.body` (a column). `open()` shows it; `close(result)` animates out and
 * destroys it. `await modal.closed` resolves with the result.
 */
export class Modal extends UIView {
  readonly backdrop: UIBackdrop;
  readonly panel: Panel;
  readonly body: UIView;
  readonly titleLabel: Label | null;
  readonly closeBtn: IconButton | null;
  readonly closed: Promise<string | null>;
  closeOnBackdrop: boolean;
  onClose: ((result: string | null) => void) | null;
  animation: 'pop' | 'sheet';
  isOpen = false;
  closing = false;
  result: string | null = null;
  private resolve: (r: string | null) => void = () => undefined;
  private readonly ownerProp: Node | null | undefined;
  private boundOwner: Node | null = null;
  private unbindOwner: (() => void) | null = null;
  private synced = false;
  private readonly insets = { top: 0, right: 0, bottom: 0, left: 0 };

  constructor(props: ModalProps = {}, children: Node[] = [], kind = 'Modal') {
    const {
      title,
      closeButton,
      closeOnBackdrop,
      animation,
      variant,
      onClose,
      owner,
      id,
      tags,
      zIndex,
      data,
      width,
      height,
      minWidth,
      maxWidth,
      minHeight,
      maxHeight,
      ...panelProps
    } = props;
    super(
      {
        position: 'absolute',
        inset: 0,
        direction: 'stack',
        align: 'center',
        ...(id !== undefined ? { id } : {}),
        ...(tags ? { tags } : {}),
        ...(zIndex !== undefined ? { zIndex } : {}),
        ...(data ? { data } : {}),
      },
      kind,
    );
    this.closeOnBackdrop = closeOnBackdrop ?? true;
    this.onClose = onClose ?? null;
    this.ownerProp = owner;
    this.animation = animation ?? 'pop';
    this.closed = new Promise((r) => (this.resolve = r));
    this.backdrop = super.addAt(new UIBackdrop(), 0);
    this.backdrop.onTap(() => {
      if (this.closeOnBackdrop) this.close('backdrop');
    });
    const sheet = this.animation === 'sheet';
    this.panel = super.addAt(
      new Panel({
        variant: variant ?? 'raised',
        width: width ?? '100%',
        maxWidth: maxWidth ?? (sheet ? 900 : 640),
        padding: 'xl',
        gap: 'lg',
        align: 'stretch',
        anchor: 0.5,
        lintRole: 'surface',
        ...(sheet ? { alignSelf: 'end' as const, radius: [44, 44, 0, 0] as [number, number, number, number] } : { radius: 'xl' as const }),
        ...(panelProps.fill !== undefined ? { fill: panelProps.fill } : {}),
        ...(panelProps.gradient !== undefined ? { gradient: panelProps.gradient } : {}),
        ...(panelProps.border !== undefined ? { border: panelProps.border } : {}),
        ...(panelProps.shadow !== undefined ? { shadow: panelProps.shadow } : {}),
        ...(panelProps.radius !== undefined ? { radius: panelProps.radius } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(minWidth !== undefined ? { minWidth } : {}),
        ...(minHeight !== undefined ? { minHeight } : {}),
        ...(maxHeight !== undefined ? { maxHeight } : {}),
      }),
      1,
    );
    this.panel.interactive = true;
    this.titleLabel = title
      ? this.panel.add(new Label(title, { variant: 'h1', align: 'center', stroke: null, margin: [0, 48] }))
      : null;
    const { padding, gap, align, justify, direction, wrap, crossGap } = panelProps;
    this.body = this.panel.add(
      new UIView({
        kind: 'ModalBody',
        direction: direction ?? 'column',
        gap: gap ?? 'lg',
        align: align ?? 'stretch',
        ...(padding !== undefined ? { padding } : {}),
        ...(justify ? { justify } : {}),
        ...(wrap !== undefined ? { wrap } : {}),
        ...(crossGap !== undefined ? { crossGap } : {}),
      }),
    );
    this.closeBtn =
      closeButton === false
        ? null
        : this.panel.add(
            new IconButton({
              icon: 'close',
              label: 'Close',
              variant: 'danger',
              size: 'sm',
              position: 'absolute',
              top: -22,
              right: -22,
            }),
          );
    this.closeBtn?.onTap(() => this.close('close'));
    for (const c of children) this.body.add(c);
    this.visible = false;
  }

  /** Children added to a Modal go into its body. */
  override addAt<T extends Node>(child: T, index: number): T {
    if (!this.body) return super.addAt(child, index);
    return this.body.addAt(child, index >= this.children.length ? this.body.children.length : index);
  }

  private game(): Game | null {
    return Game.current;
  }

  /** Node whose lifetime the open modal follows (see ModalProps.owner); null when app-level or not open. */
  get owner(): Node | null {
    return this.boundOwner;
  }

  /** Keeps the panel inside the safe area (re-checked every frame). */
  uiSync(): boolean {
    const g = this.game();
    if (!g) return false;
    const i = g.safeInsets;
    const s = this.insets;
    if (this.synced && same(i.top, s.top) && same(i.right, s.right) && same(i.bottom, s.bottom) && same(i.left, s.left)) {
      return false;
    }
    this.synced = true;
    s.top = i.top;
    s.right = i.right;
    s.bottom = i.bottom;
    s.left = i.left;
    const m = 32;
    if (this.animation === 'sheet') this.layout.padding = [i.top + m, 0, 0, 0];
    else this.layout.padding = [i.top + m, i.right + m, i.bottom + m, i.left + m];
    return true;
  }

  /**
   * Shows the modal in `parent` (default: the current game's overlay). In the game overlay it belongs to the
   * topmost scene unless ModalProps.owner says otherwise; elsewhere it lives as long as `parent`.
   */
  open(parent?: Node): this {
    if (this.isOpen) return this;
    const overlay = this.game()?.overlay;
    const host = parent ?? overlay;
    if (!host) throw new Error('Modal.open(): no parent and no Game.current');
    this.zIndex = 100 + openModals++;
    host.add(this);
    this.uiSync();
    this.visible = true;
    this.isOpen = true;
    animateUI(this.backdrop, { alpha: 1 }, { from: { alpha: 0 }, duration: 0.2 });
    if (this.animation === 'sheet') {
      animateUI(this.panel, { translateY: 0 }, { from: { translateY: 900 }, duration: 0.32, ease: 'outCubic' });
    } else {
      animateUI(this.panel, { scale: 1, alpha: 1 }, { from: { scale: 0.82, alpha: 0 }, duration: 0.3, ease: 'outBack' });
    }
    const owner = this.ownerProp !== undefined ? this.ownerProp : host === overlay ? currentUIOwner() : null;
    if (owner) {
      this.boundOwner = owner;
      this.unbindOwner = bindUIOwner(owner, () => this.destroy());
    }
    return this;
  }

  /** Animates out, destroys the modal and resolves `closed` with the result. */
  close(result: string | null = null): void {
    if (!this.isOpen || this.closing) return;
    this.closing = true;
    this.result = result;
    this.interactiveChildren = false;
    const done = () => {
      if (!this.isOpen) return;
      this.isOpen = false;
      openModals = Math.max(0, openModals - 1);
      this.destroy();
      this.onClose?.(result);
      this.emit('close', result);
      this.resolve(result);
    };
    animateUI(this.backdrop, { alpha: 0 }, { duration: 0.18 });
    if (this.animation === 'sheet') animateUI(this.panel, { translateY: this.panel.height + 80 }, { duration: 0.22, ease: 'inQuad', onDone: done });
    else animateUI(this.panel, { scale: 0.86, alpha: 0 }, { duration: 0.16, ease: 'inQuad', onDone: done });
  }

  protected override onDestroy(): void {
    this.unbindOwner?.();
    this.unbindOwner = null;
    this.boundOwner = null;
    if (this.isOpen) {
      this.isOpen = false;
      openModals = Math.max(0, openModals - 1);
    }
    super.onDestroy();
  }

  override describe() {
    return { ...super.describe(), title: this.titleLabel?.text, open: this.isOpen && !this.closing ? true : undefined };
  }
}

/** One button of a Dialog. `action` becomes the close result. */
export interface DialogButton extends Omit<ButtonProps, 'onTap'> {
  text: string;
  action?: string;
  /** Keep the dialog open after the tap (default false). */
  keepOpen?: boolean;
  onTap?: () => void;
}

export interface DialogProps extends ModalProps {
  message?: string;
  buttons?: DialogButton[];
  /** Stack buttons vertically (default: side by side for up to 2 buttons). */
  vertical?: boolean;
}

/** Title + message + buttons. The tapped button's `action` (or text) is the close result. */
export class Dialog extends Modal {
  readonly message: Label | null;
  readonly buttons: Button[] = [];

  constructor(props: DialogProps = {}, children: Node[] = []) {
    const { message, buttons, vertical, ...rest } = props;
    super({ closeButton: false, ...rest }, [], 'Dialog');
    this.message = message ? this.body.add(new Label(message, { variant: 'body', color: 'textDim', align: 'center' })) : null;
    for (const c of children) this.body.add(c);
    const list = buttons ?? [{ text: 'OK', action: 'ok' }];
    const col = vertical ?? list.length > 2;
    const row = this.body.add(new UIView({ kind: 'DialogButtons', direction: col ? 'column' : 'row', gap: 'md', align: 'stretch', margin: [8, 0, 0, 0] }));
    for (const b of list) {
      const { action, keepOpen, onTap, text, ...bp } = b;
      const btn = row.add(new Button({ variant: 'primary', size: 'lg', ...bp, text, ...(col ? {} : { grow: 1, basis: 0, minWidth: 0 }) }));
      btn.onTap(() => {
        onTap?.();
        uiEvents.emit('action', { name: action ?? text, node: btn });
        if (!keepOpen) this.close(action ?? text);
      });
      this.buttons.push(btn);
    }
  }
}

/** Opens a Modal in the game overlay: `showModal({ title: 'Settings' }, [ui.toggle(...)])`. */
export function showModal(props: ModalProps = {}, children: Node[] = []): Modal {
  return new Modal(props, children).open();
}

/** Opens a Dialog: `const r = await showDialog({ title: 'Quit?', buttons: [{ text: 'Yes', action: 'yes' }] }).closed`. */
export function showDialog(props: DialogProps = {}, children: Node[] = []): Dialog {
  return new Dialog(props, children).open();
}

/** Open modals under `root` (default: current game's overlay), topmost last. */
export function openModalsOf(root?: Node): Modal[] {
  const r = root ?? Game.current?.overlay;
  if (!r) return [];
  const out: Modal[] = [];
  r.walk((n) => void (n instanceof Modal && n.isOpen && out.push(n)));
  return out.sort((a, b) => a.zIndex - b.zIndex);
}