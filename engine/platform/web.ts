import type { Insets } from '../core/math';
import type { ImageSource, Surface } from '../gfx/types';
import type {
  AdService,
  AudioBackend,
  AudioInstance,
  AudioLoadHint,
  KeyValueStorage,
  LoginResult,
  MemoryWarningInfo,
  Platform,
  PlatformGamepad,
  PlatformKeyEvent,
  PlayOptions,
  RawTouch,
  RawTouchEvent,
  ScreenInfo,
  ShareOptions,
  TouchPhase,
} from './types';

export interface WebPlatformOptions {
  /** Canvas to render into (default: `canvas#game`, created and appended to body when missing). */
  canvas?: HTMLCanvasElement;
  /** URL prefix for loadImage/readText/audio paths (default 'assets/'). */
  assetBase?: string;
  /** localStorage key prefix (default 'engine:'). */
  storagePrefix?: string;
  /** Overrides the CSS env(safe-area-inset-*) probe (browser screenshots emulate device insets with it). */
  safeInsets?: Partial<Insets>;
  /** Duration of the simulated rewarded ad (default 2 s). */
  adSeconds?: number;
}

export const WEB_FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

const noop = () => {};

class Listeners<T> {
  private readonly set = new Set<(v: T) => void>();
  add(cb: (v: T) => void): () => void {
    this.set.add(cb);
    return () => this.set.delete(cb);
  }
  emit(v: T): void {
    for (const cb of [...this.set]) cb(v);
  }
}

function joinUrl(base: string, path: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(path)) return path;
  return base + path.replace(/^\.\//, '');
}

/** Keys whose default action scrolls the page (or a parent page around an iframe). */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Home', 'End']);

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

// ------------------------------------------------------------------ storage

class WebStorage implements KeyValueStorage {
  private readonly mem = new Map<string, string>();
  private readonly ls: Storage | null;

  constructor(private readonly prefix: string) {
    let ls: Storage | null = null;
    try {
      ls = window.localStorage;
      ls.getItem(prefix);
    } catch {
      ls = null;
    }
    this.ls = ls;
  }

  get(key: string): string | null {
    if (!this.ls) return this.mem.get(key) ?? null;
    return this.ls.getItem(this.prefix + key);
  }

  set(key: string, value: string): void {
    if (!this.ls) {
      this.mem.set(key, value);
      return;
    }
    try {
      this.ls.setItem(this.prefix + key, value);
    } catch (e) {
      console.warn(`[storage] set "${key}" failed`, e);
    }
  }

  remove(key: string): void {
    this.mem.delete(key);
    this.ls?.removeItem(this.prefix + key);
  }

  keys(): string[] {
    if (!this.ls) return [...this.mem.keys()];
    const out: string[] = [];
    for (let i = 0; i < this.ls.length; i++) {
      const k = this.ls.key(i);
      if (k !== null && k.startsWith(this.prefix)) out.push(k.slice(this.prefix.length));
    }
    return out;
  }
}

// ------------------------------------------------------------------ audio

type AudioCtor = typeof AudioContext;

const STOPPED: AudioInstance = { stop: noop, setVolume: noop, playing: false };

interface WebVoice {
  key: string;
  gain: GainNode;
  /** Null while a streamed sound is still decoding. */
  src: AudioBufferSourceNode | null;
  playing: boolean;
}

/**
 * WebAudio backend: fetch + decodeAudioData, one BufferSource + GainNode per play. Streamed sounds (music, load hint
 * `stream`) keep only the encoded file and are decoded when played; their PCM (10+ MB per minute) is dropped again
 * when the last voice stops. The context starts suspended until the first user gesture (autoplay policy), which also
 * unlocks iOS.
 */
export class WebAudio implements AudioBackend {
  /** Dev builds only (synth fallback). */
  loadPcm?: (key: string, pcm: Float32Array, sampleRate: number) => Promise<void>;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly encoded = new Map<string, { data: ArrayBuffer; url: string }>();
  private readonly decoding = new Map<string, Promise<AudioBuffer | null>>();
  private readonly active = new Set<WebVoice>();
  private readonly warned = new Set<string>();
  private hidden = false;
  private unlockBound = false;

  constructor(private readonly base: string) {
    if (process.env.NODE_ENV !== 'production') {
      this.loadPcm = async (key, pcm, sampleRate) => {
        const ctx = this.context();
        if (!ctx) return;
        const buf = ctx.createBuffer(1, Math.max(1, pcm.length), sampleRate);
        buf.getChannelData(0).set(pcm);
        this.encoded.delete(key);
        this.buffers.set(key, buf);
      };
    }
  }

  /** The AudioContext, created on first use (null when WebAudio is unavailable). */
  context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.bindUnlock();
    return this.ctx;
  }

  async load(key: string, src: string, hint?: AudioLoadHint): Promise<void> {
    const ctx = this.context();
    if (!ctx) return;
    const url = joinUrl(this.base, src);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to load audio ${url}: HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    if (hint?.stream) {
      this.buffers.delete(key);
      this.encoded.set(key, { data, url });
      return;
    }
    const buf = await decodeAudio(ctx, data, url);
    this.encoded.delete(key);
    this.buffers.set(key, buf);
  }

  isLoaded(key: string): boolean {
    return this.buffers.has(key) || this.encoded.has(key);
  }

  /** True while the decoded PCM of a sound is held (streamed sounds: only while they play). */
  isDecoded(key: string): boolean {
    return this.buffers.has(key);
  }

  unload(key: string): void {
    for (const v of [...this.active]) if (v.key === key) this.stopVoice(v);
    this.buffers.delete(key);
    this.encoded.delete(key);
    this.decoding.delete(key);
    this.warned.delete(key);
  }

  play(key: string, opts: PlayOptions = {}): AudioInstance {
    const ctx = this.ctx;
    const buf = this.buffers.get(key);
    if (!ctx || !this.master || (!buf && !this.encoded.has(key))) {
      if (!this.warned.has(key)) {
        this.warned.add(key);
        console.warn(`[audio] "${key}" ${ctx ? 'is not loaded' : 'cannot play: WebAudio unavailable'}`);
      }
      return STOPPED;
    }
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    gain.connect(this.master);
    const voice: WebVoice = { key, gain, src: null, playing: true };
    const start = (b: AudioBuffer | null) => {
      if (!voice.playing) return;
      if (!b) {
        this.stopVoice(voice);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = !!opts.loop;
      if (opts.rate !== undefined) src.playbackRate.value = opts.rate;
      src.connect(gain);
      src.onended = () => this.stopVoice(voice);
      voice.src = src;
      src.start();
    };
    this.active.add(voice);
    if (buf) start(buf);
    else void this.decodeStream(key).then(start);
    return {
      stop: () => this.stopVoice(voice),
      setVolume: (v: number) => {
        gain.gain.value = v;
      },
      get playing() {
        return voice.playing;
      },
    };
  }

  stopAll(): void {
    for (const v of [...this.active]) this.stopVoice(v);
  }

  private stopVoice(v: WebVoice): void {
    if (!v.playing) return;
    v.playing = false;
    this.active.delete(v);
    if (v.src) {
      try {
        v.src.stop();
      } catch {
        // already stopped
      }
      v.src.disconnect();
    }
    v.gain.disconnect();
    if (this.encoded.has(v.key) && !this.inUse(v.key)) this.buffers.delete(v.key);
  }

  private inUse(key: string): boolean {
    for (const v of this.active) if (v.key === key) return true;
    return false;
  }

  private decodeStream(key: string): Promise<AudioBuffer | null> {
    const pending = this.decoding.get(key);
    if (pending) return pending;
    const enc = this.encoded.get(key)!;
    // decodeAudioData detaches its input: decode a copy so the track can be decoded again on the next play.
    const p: Promise<AudioBuffer | null> = decodeAudio(this.ctx!, enc.data.slice(0), enc.url)
      .catch((e: unknown) => {
        console.warn(`[audio] ${e instanceof Error ? e.message : String(e)}`);
        return null;
      })
      .then((buf) => {
        if (this.decoding.get(key) === p) this.decoding.delete(key);
        if (buf && this.encoded.get(key) === enc && this.inUse(key)) this.buffers.set(key, buf);
        return buf;
      });
    this.decoding.set(key, p);
    return p;
  }

  suspend(): void {
    this.hidden = true;
    void this.ctx?.suspend().catch(noop);
  }

  resume(): void {
    this.hidden = false;
    void this.ctx?.resume().catch(noop);
  }

  private bindUnlock(): void {
    if (this.unlockBound) return;
    this.unlockBound = true;
    const events = ['touchstart', 'touchend', 'mousedown', 'pointerdown', 'keydown'];
    const unlock = () => {
      const ctx = this.ctx;
      if (!ctx || this.hidden) return;
      void ctx.resume().catch(noop);
      // iOS needs a sound started inside the gesture.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
      if (ctx.state === 'running') for (const e of events) window.removeEventListener(e, unlock, true);
    };
    for (const e of events) window.addEventListener(e, unlock, true);
  }
}

function decodeAudio(ctx: AudioContext, data: ArrayBuffer, url: string): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    // Callback form keeps old Safari (no promise-returning decodeAudioData) working.
    const p = ctx.decodeAudioData(data, resolve, (e) => reject(new Error(`failed to decode audio ${url}: ${e}`)));
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

// ------------------------------------------------------------------ ads

/** Dev stand-in for mini-game ads: a DOM overlay. Rewarded resolves true after ~2 s; interstitial on close. */
class SimulatedAds implements AdService {
  constructor(private readonly seconds: number) {}

  rewarded(adUnitId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const el = overlay(`Ad (simulated)\nrewarded ${adUnitId || '(no unit id)'}`);
      const label = el.querySelector('span')!;
      let left = Math.ceil(this.seconds);
      label.textContent = `${left}`;
      const timer = setInterval(() => {
        left--;
        label.textContent = `${Math.max(0, left)}`;
      }, 1000);
      setTimeout(() => {
        clearInterval(timer);
        el.remove();
        resolve(true);
      }, this.seconds * 1000);
    });
  }

  interstitial(adUnitId: string): Promise<void> {
    return new Promise((resolve) => {
      const el = overlay(`Ad (simulated)\ninterstitial ${adUnitId || '(no unit id)'}`);
      const label = el.querySelector('span')!;
      label.textContent = '× close';
      label.style.cursor = 'pointer';
      let done = false;
      const close = () => {
        if (done) return;
        done = true;
        el.remove();
        resolve();
      };
      label.addEventListener('click', close);
      // Auto-close so unattended runs (browser shots) never hang on an ad.
      setTimeout(close, 4000);
    });
  }
}

function overlay(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:16px;background:rgba(0,0,0,.88);color:#fff;font:600 20px/1.4 sans-serif;' +
    'white-space:pre-line;text-align:center;touch-action:none';
  el.textContent = text;
  const span = document.createElement('span');
  span.style.cssText = 'padding:6px 16px;border:1px solid #fff8;border-radius:16px;font-size:16px';
  el.appendChild(span);
  document.body.appendChild(el);
  return el;
}

// ------------------------------------------------------------------ platform

/**
 * Browser platform for dev and testing: full-window canvas, touch + mouse input (mouse is pointer 0, touches are
 * identifier + 1), localStorage, WebAudio, simulated ads.
 */
export class WebPlatform implements Platform {
  readonly name = 'web' as const;
  readonly screen: ScreenInfo = { width: 0, height: 0, pixelRatio: 1, safeInsets: { top: 0, right: 0, bottom: 0, left: 0 } };
  readonly canvas: Surface;
  readonly fontFamily = WEB_FONT;
  readonly storage: KeyValueStorage;
  readonly audio: WebAudio;
  readonly ads: AdService;
  readonly element: HTMLCanvasElement;
  readonly language: string | undefined = typeof navigator !== 'undefined' ? navigator.language || undefined : undefined;

  private readonly base: string;
  private readonly probe: HTMLDivElement;
  private readonly touchCbs = new Listeners<RawTouchEvent>();
  private readonly showCbs = new Listeners<void>();
  private readonly hideCbs = new Listeners<void>();
  private readonly resizeCbs = new Listeners<void>();
  private readonly keyCbs = new Listeners<PlatformKeyEvent>();
  /** Held keys: code → key. */
  private readonly heldKeys = new Map<string, string>();

  constructor(private readonly opts: WebPlatformOptions = {}) {
    const base = opts.assetBase ?? 'assets/';
    this.base = base === '' || base.endsWith('/') ? base : base + '/';
    let el = opts.canvas ?? (document.getElementById('game') as HTMLCanvasElement | null);
    if (!el || el.tagName !== 'CANVAS') {
      el = document.createElement('canvas');
      el.id = 'game';
      document.body.appendChild(el);
    }
    this.element = el;
    this.canvas = el as unknown as Surface;
    this.storage = new WebStorage(opts.storagePrefix ?? 'engine:');
    this.audio = new WebAudio(this.base);
    this.ads = new SimulatedAds(opts.adSeconds ?? 2);

    this.probe = document.createElement('div');
    this.probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(this.probe);

    this.lockPage();
    let last = this.measure();
    this.bindInput();
    this.bindKeys();

    const onResize = () => {
      const next = this.measure();
      if (next === last) return;
      last = next;
      this.resizeCbs.emit();
    };
    window.addEventListener('resize', onResize);
    // iOS Safari updates innerWidth/innerHeight only some time after orientationchange.
    window.addEventListener('orientationchange', () => {
      onResize();
      setTimeout(onResize, 300);
    });
    window.visualViewport?.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.hideCbs.emit();
      else this.showCbs.emit();
    });
  }

  createCanvas(width: number, height: number): Surface {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(width));
    c.height = Math.max(1, Math.ceil(height));
    return c as unknown as Surface;
  }

  loadImage(path: string): Promise<ImageSource> {
    const url = joinUrl(this.base, path);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load image ${url}`));
      img.src = url;
    });
  }

  async readText(path: string): Promise<string> {
    const url = joinUrl(this.base, path);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to read ${url}: HTTP ${res.status}`);
    return res.text();
  }

  now(): number {
    return performance.now();
  }

  requestFrame(cb: (timeMs: number) => void): number {
    return requestAnimationFrame(cb);
  }

  cancelFrame(id: number): void {
    cancelAnimationFrame(id);
  }

  onTouch(cb: (e: RawTouchEvent) => void): () => void {
    return this.touchCbs.add(cb);
  }

  onShow(cb: () => void): () => void {
    return this.showCbs.add(cb);
  }

  onHide(cb: () => void): () => void {
    return this.hideCbs.add(cb);
  }

  onResize(cb: () => void): () => void {
    return this.resizeCbs.add(cb);
  }

  onKey(cb: (e: PlatformKeyEvent) => void): () => void {
    return this.keyCbs.add(cb);
  }

  pollGamepads(): PlatformGamepad[] {
    let list: ArrayLike<Gamepad | null> = [];
    try {
      list = navigator.getGamepads?.() ?? [];
    } catch {
      // blocked by permissions policy / insecure context
    }
    const out: PlatformGamepad[] = [];
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g || !g.connected) continue;
      out.push({
        index: g.index,
        id: g.id,
        standard: g.mapping === 'standard',
        buttons: Array.from(g.buttons, (b) => b.value || (b.pressed ? 1 : 0)),
        axes: Array.from(g.axes),
      });
    }
    return out;
  }

  vibrate(kind: 'short' | 'long'): void {
    try {
      navigator.vibrate?.(kind === 'short' ? 15 : 400);
    } catch {
      // not allowed without a gesture in some browsers
    }
  }

  share(opts: ShareOptions): void {
    console.log('[share]', JSON.stringify(opts));
  }

  async login(): Promise<LoginResult> {
    return { ok: true };
  }

  /** Browsers report no memory pressure: the callback never fires. */
  onMemoryWarning(_cb: (info: MemoryWarningInfo) => void): () => void {
    return noop;
  }

  /** No GC hook in browsers. */
  triggerGC(): void {}

  /** Injects a touch event in screen CSS px, as if it came from the browser (used by automation). */
  simulateTouch(phase: TouchPhase, touches: RawTouch[]): void {
    this.touchCbs.emit({ phase, touches });
  }

  /** Injects a key event (KeyboardEvent.code), as if it came from the browser (used by automation). */
  simulateKey(code: string, type: 'down' | 'up' = 'down', key = ''): void {
    this.emitKey(type, code, key);
  }

  private emitKey(type: 'down' | 'up', code: string, key: string): void {
    if (type === 'down') {
      const repeat = this.heldKeys.has(code);
      this.heldKeys.set(code, key);
      this.keyCbs.emit({ type, code, key, repeat });
    } else if (this.heldKeys.delete(code)) {
      this.keyCbs.emit({ type, code, key, repeat: false });
    }
  }

  private releaseKeys(): void {
    for (const [code, key] of [...this.heldKeys]) this.emitKey('up', code, key);
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.isComposing || isEditable(e.target) || !e.code) return;
      // Only plain presses: Ctrl/Cmd shortcuts and browser keys keep working.
      if (SCROLL_KEYS.has(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
      this.emitKey('down', e.code, e.key ?? '');
    });
    // Ups are delivered even for editable targets, so a key pressed before focusing an input cannot stick.
    window.addEventListener('keyup', (e) => {
      if (e.code) this.emitKey('up', e.code, e.key ?? '');
    });
    window.addEventListener('blur', () => this.releaseKeys());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseKeys();
    });
  }

  /** Updates `screen` and the canvas CSS size; returns a key that changes whenever the screen does. */
  private measure(): string {
    const s = this.screen;
    s.width = Math.max(1, Math.round(window.innerWidth));
    s.height = Math.max(1, Math.round(window.innerHeight));
    s.pixelRatio = window.devicePixelRatio || 1;
    const cs = getComputedStyle(this.probe);
    const o = this.opts.safeInsets ?? {};
    s.safeInsets = {
      top: o.top ?? (parseFloat(cs.paddingTop) || 0),
      right: o.right ?? (parseFloat(cs.paddingRight) || 0),
      bottom: o.bottom ?? (parseFloat(cs.paddingBottom) || 0),
      left: o.left ?? (parseFloat(cs.paddingLeft) || 0),
    };
    const st = this.element.style;
    st.width = `${s.width}px`;
    st.height = `${s.height}px`;
    const i = s.safeInsets;
    return `${s.width}x${s.height}@${s.pixelRatio}:${i.top},${i.right},${i.bottom},${i.left}`;
  }

  private lockPage(): void {
    const root = document.documentElement.style;
    const body = document.body.style;
    for (const st of [root, body]) {
      st.margin = '0';
      st.padding = '0';
      st.overflow = 'hidden';
      st.height = '100%';
      st.touchAction = 'none';
      st.overscrollBehavior = 'none';
      st.userSelect = 'none';
      st.setProperty('-webkit-user-select', 'none');
      st.setProperty('-webkit-touch-callout', 'none');
      st.setProperty('-webkit-tap-highlight-color', 'transparent');
    }
    const el = this.element.style;
    el.display = 'block';
    el.position = 'fixed';
    el.left = '0';
    el.top = '0';
    el.touchAction = 'none';
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener('touchmove', prevent, { passive: false });
    document.addEventListener('gesturestart', prevent);
    document.addEventListener('gesturechange', prevent);
    document.addEventListener('dblclick', prevent);
    document.addEventListener('contextmenu', prevent);
    document.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });
  }

  private bindInput(): void {
    const el = this.element;
    const touch = (phase: TouchPhase) => (e: TouchEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const touches: RawTouch[] = [];
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]!;
        touches.push({ id: t.identifier + 1, x: t.clientX - r.left, y: t.clientY - r.top });
      }
      if (touches.length) this.touchCbs.emit({ phase, touches });
    };
    const opt = { passive: false };
    el.addEventListener('touchstart', touch('start'), opt);
    el.addEventListener('touchmove', touch('move'), opt);
    el.addEventListener('touchend', touch('end'), opt);
    el.addEventListener('touchcancel', touch('cancel'), opt);

    let down = false;
    const mouse = (phase: TouchPhase, e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      this.touchCbs.emit({ phase, touches: [{ id: 0, x: e.clientX - r.left, y: e.clientY - r.top }] });
    };
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      down = true;
      mouse('start', e);
    });
    window.addEventListener('mousemove', (e) => down && mouse('move', e));
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !down) return;
      down = false;
      mouse('end', e);
    });
    window.addEventListener('blur', () => {
      if (!down) return;
      down = false;
      this.touchCbs.emit({ phase: 'cancel', touches: [{ id: 0, x: 0, y: 0 }] });
    });
  }
}

/** Creates the browser platform. The canvas is sized to the window; Game sets its backing store. */
export function createWebPlatform(opts: WebPlatformOptions = {}): WebPlatform {
  return new WebPlatform(opts);
}
