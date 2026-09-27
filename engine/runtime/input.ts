import { Emitter } from '../core/emitter';
import { Game } from '../core/game';
import type { Vec2 } from '../core/math';
import type { Platform, PlatformGamepad, PlatformKeyEvent } from '../platform/types';
import type { Node } from '../scene/node';
import { disposeWith } from './events';
import type { VirtualJoystick } from './joystick';

// Keyboard, gamepad and input actions. One input hub per game listens to the platform and, at the start of every
// frame (game 'frame' event, also while paused), turns the events since the previous frame into edges
// (justPressed / justReleased), polls gamepads and samples every InputActions. So read input in update(),
// onUpdate() or a system: during one frame every reader sees the same state.

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);

type CodeMatch = (code: string) => boolean;

function codeMatcher(codes: string | readonly string[]): CodeMatch {
  const list = typeof codes === 'string' ? [codes] : codes;
  if (list.includes('*')) return () => true;
  const set = new Set(list);
  return (c) => set.has(c);
}

// ---------------------------------------------------------------- keyboard

export interface KeyboardInputEvents {
  /** Raw key down as it arrives (between frames), including auto-repeats (`e.repeat`). */
  keydown: PlatformKeyEvent;
  keyup: PlatformKeyEvent;
}

/**
 * Keyboard state of one game. Codes are KeyboardEvent.code strings ('KeyA', 'Space', 'ArrowLeft', 'ShiftLeft').
 * `isDown` is live; `justPressed` / `justReleased` are true for exactly one frame (a press and release between two
 * frames shows up as both). Get it with `keyboardInput(game)`.
 */
export class KeyboardInput extends Emitter<KeyboardInputEvents> {
  /** False when the platform has no keyboard API (phones; mini-game clients other than PC). */
  readonly supported: boolean;
  private readonly held = new Set<string>();
  private pendingDown = new Set<string>();
  private pendingUp = new Set<string>();
  private pressedNow = new Set<string>();
  private releasedNow = new Set<string>();

  constructor(supported: boolean) {
    super();
    this.supported = supported;
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  justPressed(code: string): boolean {
    return this.pressedNow.has(code);
  }

  justReleased(code: string): boolean {
    return this.releasedNow.has(code);
  }

  anyDown(): boolean {
    return this.held.size > 0;
  }

  anyJustPressed(): boolean {
    return this.pressedNow.size > 0;
  }

  /** Codes held right now, in press order. */
  downCodes(): string[] {
    return [...this.held];
  }

  /** Calls fn on each (non-repeat) press of one of `codes` ('*' = any key), when it arrives. */
  onPress(codes: string | readonly string[], fn: (e: PlatformKeyEvent) => void, owner?: Node): () => void {
    const match = codeMatcher(codes);
    const off = this.on('keydown', (e) => {
      if (!e.repeat && match(e.code)) fn(e);
    });
    return owner ? disposeWith(owner, off) : off;
  }

  /** Calls fn when one of `codes` ('*' = any key) is released. */
  onRelease(codes: string | readonly string[], fn: (e: PlatformKeyEvent) => void, owner?: Node): () => void {
    const match = codeMatcher(codes);
    const off = this.on('keyup', (e) => {
      if (match(e.code)) fn(e);
    });
    return owner ? disposeWith(owner, off) : off;
  }

  /** Feeds a key event (the platform does this; on-screen keyboards and tests may too). */
  handleKey(e: PlatformKeyEvent): void {
    if (e.type === 'down') {
      const wasHeld = this.held.has(e.code);
      if (!wasHeld) {
        this.held.add(e.code);
        this.pendingDown.add(e.code);
      }
      this.emit('keydown', wasHeld && !e.repeat ? { ...e, repeat: true } : e);
    } else if (this.held.delete(e.code)) {
      this.pendingUp.add(e.code);
      this.emit('keyup', e);
    }
  }

  /** Releases every held key (emits keyup for each); the game calls it on hide. */
  releaseAll(): void {
    for (const code of [...this.held]) this.handleKey({ type: 'up', code, key: '', repeat: false });
  }

  /** Start of a frame: events since the previous frame become this frame's edges. Called by the input hub. */
  nextFrame(): void {
    const p = this.pressedNow;
    const r = this.releasedNow;
    this.pressedNow = this.pendingDown;
    this.releasedNow = this.pendingUp;
    p.clear();
    r.clear();
    this.pendingDown = p;
    this.pendingUp = r;
  }
}

// ---------------------------------------------------------------- gamepad

/** Standard-mapping button names; binding codes are 'Pad' + name ('PadA', 'PadStart', 'PadUp'). */
export const INPUT_PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right', 'Home'] as const;
export type InputPadButton = (typeof INPUT_PAD_BUTTONS)[number];

/** Stick directions as binding codes (value 0..1 after the dead zone): axis index and sign. */
const PAD_STICKS: Record<string, readonly [number, 1 | -1]> = {
  PadLStickLeft: [0, -1],
  PadLStickRight: [0, 1],
  PadLStickUp: [1, -1],
  PadLStickDown: [1, 1],
  PadRStickLeft: [2, -1],
  PadRStickRight: [2, 1],
  PadRStickUp: [3, -1],
  PadRStickDown: [3, 1],
};

const isPadCode = (code: string) => code.startsWith('Pad');

function padValue(pads: readonly PlatformGamepad[], code: string, pad: number | undefined, deadZone: number): number {
  if (!isPadCode(code)) return 0;
  const stick = PAD_STICKS[code];
  const button = stick ? -1 : INPUT_PAD_BUTTONS.indexOf(code.slice(3) as InputPadButton);
  if (!stick && button < 0) return 0;
  let best = 0;
  for (const g of pads) {
    if (pad !== undefined && g.index !== pad) continue;
    let v: number;
    if (stick) {
      const raw = (g.axes[stick[0]] ?? 0) * stick[1];
      v = raw <= deadZone ? 0 : (raw - deadZone) / (1 - deadZone);
    } else v = g.buttons[button] ?? 0;
    if (v > best) best = v;
  }
  return clamp01(best);
}

/**
 * Gamepads of one game (web Gamepad API; other platforms report none). Polled once per frame. Codes are
 * 'Pad' + INPUT_PAD_BUTTONS name or a stick direction ('PadLStickLeft' ... 'PadRStickDown'); `pad` picks one
 * gamepad by index (default: any). Get it with `gamepadInput(game)`.
 */
export class GamepadInput {
  /** False when the platform cannot poll gamepads. */
  readonly supported: boolean;
  /** Stick deflection below this reads as 0 (default 0.2). */
  deadZone = 0.2;
  private cur: PlatformGamepad[] = [];
  private prev: PlatformGamepad[] = [];

  constructor(private readonly platform: Platform) {
    this.supported = typeof platform.pollGamepads === 'function';
  }

  get connected(): boolean {
    return this.cur.length > 0;
  }

  /** This frame's snapshots. */
  pads(): readonly PlatformGamepad[] {
    return this.cur;
  }

  /** 0..1: button pressure or stick deflection in that direction. */
  value(code: string, pad?: number): number {
    return padValue(this.cur, code, pad, this.deadZone);
  }

  isDown(code: string, pad?: number): boolean {
    return this.value(code, pad) >= 0.5;
  }

  justPressed(code: string, pad?: number): boolean {
    return this.isDown(code, pad) && padValue(this.prev, code, pad, this.deadZone) < 0.5;
  }

  justReleased(code: string, pad?: number): boolean {
    return !this.isDown(code, pad) && padValue(this.prev, code, pad, this.deadZone) >= 0.5;
  }

  /** Stick vector (-1..1 per axis, y down) with a radial dead zone; the strongest pad when `pad` is omitted. */
  stick(side: 'left' | 'right' = 'left', pad?: number): Vec2 {
    const ax = side === 'left' ? 0 : 2;
    let out = { x: 0, y: 0 };
    let best = 0;
    for (const g of this.cur) {
      if (pad !== undefined && g.index !== pad) continue;
      const x = g.axes[ax] ?? 0;
      const y = g.axes[ax + 1] ?? 0;
      const len = Math.hypot(x, y);
      if (len <= this.deadZone || len <= best) continue;
      best = len;
      const k = Math.min(1, (len - this.deadZone) / (1 - this.deadZone)) / len;
      out = { x: x * k, y: y * k };
    }
    return out;
  }

  /** Takes a new snapshot. Called by the input hub at the start of each frame. */
  poll(): void {
    this.prev = this.cur;
    let next: PlatformGamepad[] = [];
    try {
      next = this.platform.pollGamepads?.() ?? [];
    } catch {
      next = [];
    }
    // Copies: a host may hand out the same live objects every poll, which would hide edges.
    this.cur = next.map((g) => ({ index: g.index, id: g.id, standard: g.standard, buttons: [...g.buttons], axes: [...g.axes] }));
  }
}

// ---------------------------------------------------------------- per-game hub

class InputHub {
  readonly keyboard: KeyboardInput;
  readonly samplers = new Set<() => void>();
  private pad: GamepadInput | null = null;
  private readonly offs: (() => void)[] = [];

  constructor(readonly game: Game) {
    const p = game.platform;
    this.keyboard = new KeyboardInput(typeof p.onKey === 'function');
    if (p.onKey) this.offs.push(p.onKey((e) => this.keyboard.handleKey(e)));
    this.offs.push(p.onHide(() => this.keyboard.releaseAll()));
    this.offs.push(game.on('frame', () => this.frame()));
    this.offs.push(game.stage.once('destroyed', () => this.dispose()));
  }

  get gamepad(): GamepadInput {
    return (this.pad ??= new GamepadInput(this.game.platform));
  }

  private frame(): void {
    this.keyboard.nextFrame();
    this.pad?.poll();
    for (const s of [...this.samplers]) s();
  }

  private dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.samplers.clear();
    this.keyboard.removeAllListeners();
    if (hubs.get(this.game) === this) hubs.delete(this.game);
  }
}

const hubs = new WeakMap<Game, InputHub>();

function currentGame(game: Game | undefined, what: string): Game {
  const g = game ?? Game.current;
  if (!g) throw new Error(`${what}: no game (create the Game first or pass it)`);
  return g;
}

function hubOf(game: Game): InputHub {
  let h = hubs.get(game);
  if (!h) hubs.set(game, (h = new InputHub(game)));
  return h;
}

/** The keyboard of a game (default Game.current), created on first use and dropped with the game's stage. */
export function keyboardInput(game?: Game): KeyboardInput {
  return hubOf(currentGame(game, 'keyboardInput')).keyboard;
}

/** The gamepads of a game (default Game.current); polling starts on first use. */
export function gamepadInput(game?: Game): GamepadInput {
  return hubOf(currentGame(game, 'gamepadInput')).gamepad;
}

// ---------------------------------------------------------------- actions

/** Polled once per frame: true/false, or an analog 0..1 value (sticks, triggers). */
export type InputVirtualSource = () => boolean | number;

/** Action name → binding codes: KeyboardEvent.code ('Space', 'KeyW') or gamepad codes ('PadA', 'PadLStickLeft'). */
export type InputActionMap<A extends string = string> = Readonly<Record<A, readonly string[]>>;

export interface InputActionsOptions {
  /** value() at or above this counts as down (default 0.5). */
  threshold?: number;
}

export interface InputActionsEvents<A extends string = string> {
  /** Emitted at the start of the frame in which the action went down. */
  pressed: A;
  released: A;
}

interface ActionState {
  codes: string[];
  virtual: InputVirtualSource[];
  value: number;
  down: boolean;
  pressed: boolean;
  released: boolean;
}

/**
 * Named actions bound to keys, gamepad buttons / stick directions and virtual sources (on-screen buttons,
 * VirtualJoystick). State is sampled once per frame, so `pressed()` is true for exactly one frame.
 * Create with `createInputActions(owner, map)`.
 */
export class InputActions<A extends string = string> extends Emitter<InputActionsEvents<A>> {
  /** While false every action reads as up (down actions emit 'released' once). */
  enabled = true;
  threshold: number;
  destroyed = false;
  readonly keyboard: KeyboardInput;
  private readonly states = new Map<A, ActionState>();
  private readonly hub: InputHub;
  private readonly offSampler: () => void;

  constructor(
    readonly game: Game,
    map: InputActionMap<A>,
    opts: InputActionsOptions = {},
  ) {
    super();
    this.threshold = opts.threshold ?? 0.5;
    this.hub = hubOf(game);
    this.keyboard = this.hub.keyboard;
    for (const name of Object.keys(map) as A[]) this.rebind(name, map[name]);
    // Keys already held (e.g. the key that opened this scene) must not count as a fresh press.
    for (const s of this.states.values()) {
      s.down = s.codes.some((c) => !isPadCode(c) && this.keyboard.isDown(c));
      s.value = s.down ? 1 : 0;
    }
    const sample = () => this.sample();
    this.hub.samplers.add(sample);
    this.offSampler = () => this.hub.samplers.delete(sample);
  }

  /** Held this frame. */
  down(action: A): boolean {
    return this.states.get(action)?.down ?? false;
  }

  /** Went down this frame. */
  pressed(action: A): boolean {
    return this.states.get(action)?.pressed ?? false;
  }

  /** Went up this frame. */
  released(action: A): boolean {
    return this.states.get(action)?.released ?? false;
  }

  /** 0..1: 1 for keys, analog for sticks / triggers / numeric virtual sources (strongest source wins). */
  value(action: A): number {
    return this.states.get(action)?.value ?? 0;
  }

  /** value(positive) - value(negative), -1..1: `axis('left', 'right')`. */
  axis(negative: A, positive: A): number {
    return Math.max(-1, Math.min(1, this.value(positive) - this.value(negative)));
  }

  /** Movement vector from four actions (y down), clamped to length 1 so diagonals are not faster. */
  vector(left: A, right: A, up: A, down: A): Vec2 {
    const x = this.axis(left, right);
    const y = this.axis(up, down);
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  /** Action names, in definition order. */
  actionNames(): A[] {
    return [...this.states.keys()];
  }

  /** Actions held this frame (for HUDs and debugging). */
  downActions(): A[] {
    return this.actionNames().filter((a) => this.states.get(a)!.down);
  }

  bindings(action: A): string[] {
    return [...(this.states.get(action)?.codes ?? [])];
  }

  /** Adds binding codes to an action (creating the action if needed). */
  bind(action: A, ...codes: string[]): this {
    return this.rebind(action, [...this.bindings(action), ...codes]);
  }

  /** Removes binding codes (all of them when none are given). Virtual sources stay. */
  unbind(action: A, ...codes: string[]): this {
    return this.rebind(action, codes.length ? this.bindings(action).filter((c) => !codes.includes(c)) : []);
  }

  /** Replaces the binding codes of an action (key remapping at runtime). */
  rebind(action: A, codes: readonly string[]): this {
    let s = this.states.get(action);
    if (!s) this.states.set(action, (s = { codes: [], virtual: [], value: 0, down: false, pressed: false, released: false }));
    s.codes = [...new Set(codes)];
    if (s.codes.some(isPadCode)) void this.hub.gamepad;
    return this;
  }

  /** Current binding codes of every action (store it to persist remapping; feed it back to rebind). */
  toJSON(): Record<A, string[]> {
    const out = {} as Record<A, string[]>;
    for (const [a, s] of this.states) out[a] = [...s.codes];
    return out;
  }

  /**
   * Drives an action from a polled source, e.g. `() => stick.value.y < -0.5`. Removed with `owner` when given.
   * Returns the remover.
   */
  bindVirtual(action: A, source: InputVirtualSource, owner?: Node): () => void {
    this.rebind(action, this.bindings(action));
    const list = this.states.get(action)!.virtual;
    list.push(source);
    const off = () => {
      const i = list.indexOf(source);
      if (i >= 0) list.splice(i, 1);
    };
    return owner ? disposeWith(owner, off) : off;
  }

  /**
   * Holds `action` while a pointer is down on `node` (on-screen buttons, d-pads). Unlike taps it keeps holding when
   * the finger slides, and a touch shorter than a frame still counts for one frame. Removed with the node.
   */
  bindHold(action: A, node: Node): () => void {
    const held = new Set<number>();
    let latched = false;
    node.interactive = true;
    const offs = [
      node.on('pointerdown', (e) => {
        held.add(e.pointerId);
        latched = true;
      }),
      node.on('pointerup', (e) => void held.delete(e.pointerId)),
      node.on('pointercancel', (e) => void held.delete(e.pointerId)),
    ];
    const offSource = this.bindVirtual(action, () => {
      const v = held.size > 0 || latched;
      latched = false;
      return v;
    });
    return disposeWith(node, () => {
      for (const off of offs) off();
      offSource();
    });
  }

  /** Maps a VirtualJoystick's directions onto actions (analog: value() = deflection). Removed with the stick. */
  bindStick(stick: VirtualJoystick, map: { left?: A; right?: A; up?: A; down?: A }): () => void {
    const offs: (() => void)[] = [];
    if (map.left) offs.push(this.bindVirtual(map.left, () => Math.max(0, -stick.value.x)));
    if (map.right) offs.push(this.bindVirtual(map.right, () => Math.max(0, stick.value.x)));
    if (map.up) offs.push(this.bindVirtual(map.up, () => Math.max(0, -stick.value.y)));
    if (map.down) offs.push(this.bindVirtual(map.down, () => Math.max(0, stick.value.y)));
    return disposeWith(stick, () => {
      for (const off of offs) off();
    });
  }

  /** Calls fn when one of the actions goes down (at the start of that frame). */
  onPress(action: A | readonly A[], fn: (action: A) => void, owner?: Node): () => void {
    const set = new Set<A>(typeof action === 'string' ? [action as A] : (action as readonly A[]));
    const off = this.on('pressed', (a) => {
      if (set.has(a)) fn(a);
    });
    return owner ? disposeWith(owner, off) : off;
  }

  /** Calls fn when one of the actions goes up. */
  onRelease(action: A | readonly A[], fn: (action: A) => void, owner?: Node): () => void {
    const set = new Set<A>(typeof action === 'string' ? [action as A] : (action as readonly A[]));
    const off = this.on('released', (a) => {
      if (set.has(a)) fn(a);
    });
    return owner ? disposeWith(owner, off) : off;
  }

  /** Stops sampling and drops listeners and virtual sources. Called automatically with the owner. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.offSampler();
    this.removeAllListeners();
    for (const s of this.states.values()) {
      s.virtual.length = 0;
      s.value = 0;
      s.down = s.pressed = s.released = false;
    }
  }

  private sample(): void {
    const kb = this.keyboard;
    for (const [name, s] of this.states) {
      if (this.destroyed) return;
      const wasDown = s.down;
      let v = 0;
      let tapped = false;
      for (const c of s.codes) {
        if (isPadCode(c)) v = Math.max(v, this.hub.gamepad.value(c));
        else {
          if (kb.isDown(c)) v = 1;
          if (kb.justPressed(c)) tapped = true;
        }
      }
      for (const src of s.virtual.slice()) {
        const r = src();
        v = Math.max(v, r === true ? 1 : r === false ? 0 : clamp01(r));
      }
      if (!this.enabled) {
        v = 0;
        tapped = false;
      }
      s.value = v;
      s.down = v >= this.threshold;
      s.pressed = !wasDown && (s.down || tapped);
      s.released = wasDown ? !s.down : tapped && !s.down;
      if (s.pressed) this.emit('pressed', name);
      if (s.released && !this.destroyed) this.emit('released', name);
    }
  }
}

/**
 * Creates named actions for a game. `owner` is the Game (lives as long as it) or a node such as the scene: the
 * actions are destroyed with it, so scene-local controls never leak.
 *
 *     const input = createInputActions(this, {
 *       left: ['ArrowLeft', 'KeyA', 'PadLeft', 'PadLStickLeft'],
 *       right: ['ArrowRight', 'KeyD', 'PadRight', 'PadLStickRight'],
 *       jump: ['Space', 'ArrowUp', 'KeyW', 'PadA'],
 *     });
 *     input.bindHold('jump', jumpButton);
 *     hero.onUpdate((dt) => {
 *       hero.x += input.axis('left', 'right') * 400 * dt;
 *       if (input.pressed('jump')) hero.jump();
 *     });
 */
export function createInputActions<A extends string>(owner: Game | Node, map: InputActionMap<A>, opts: InputActionsOptions = {}): InputActions<A> {
  if (owner instanceof Game) {
    const actions = new InputActions(owner, map, opts);
    disposeWith(owner.stage, () => actions.destroy());
    return actions;
  }
  const g = (owner as Node & { game?: unknown }).game;
  const actions = new InputActions(g instanceof Game ? g : currentGame(undefined, 'createInputActions'), map, opts);
  disposeWith(owner, () => actions.destroy());
  return actions;
}

const CODE_LABELS: Record<string, string> = {
  ArrowLeft: '\u2190',
  ArrowUp: '\u2191',
  ArrowRight: '\u2192',
  ArrowDown: '\u2193',
  Escape: 'Esc',
  Space: 'Space',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  PadLStickLeft: 'L\u2190',
  PadLStickRight: 'L\u2192',
  PadLStickUp: 'L\u2191',
  PadLStickDown: 'L\u2193',
  PadRStickLeft: 'R\u2190',
  PadRStickRight: 'R\u2192',
  PadRStickUp: 'R\u2191',
  PadRStickDown: 'R\u2193',
};

/** Short display label for a binding code: 'KeyW' → 'W', 'ArrowUp' → '↑', 'ShiftLeft' → 'Shift', 'PadA' → 'A'. */
export function inputCodeLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code]!;
  let m = /^(?:Key|Digit)(.)$/.exec(code);
  if (m) return m[1]!;
  m = /^Numpad(.+)$/.exec(code);
  if (m) return `Num ${m[1]}`;
  m = /^(Shift|Control|Alt|Meta)(?:Left|Right)$/.exec(code);
  if (m) return m[1] === 'Control' ? 'Ctrl' : m[1]!;
  if (isPadCode(code)) return code.slice(3);
  return code;
}
