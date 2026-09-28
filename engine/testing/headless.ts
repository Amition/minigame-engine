import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
  PlatformKeyEvent,
  PlayOptions,
  RawTouch,
  RawTouchEvent,
  ScreenInfo,
  ShareOptions,
  TouchPhase,
} from '../platform/types';

export interface HeadlessOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
  safeInsets?: Partial<Insets>;
  /** Absolute dir that asset paths resolve against. */
  assetsDir?: string;
  fontFamily?: string;
  /** System language (default 'zh-CN'). */
  language?: string;
}

export const HEADLESS_FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",sans-serif';

export class MemoryStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

export interface AudioLogEntry {
  action: 'play' | 'stop' | 'stopAll' | 'volume' | 'unload';
  key: string;
  opts?: PlayOptions;
  /** Platform clock (ms) when it happened. */
  time: number;
}

/** Records every call so tests can assert which sounds played. */
export class RecordingAudio implements AudioBackend {
  /**
   * Calls in order. Volume ramps (music fades call setVolume every frame) are coalesced: until the next play / stop /
   * stopAll, further setVolume calls of a sound update its last 'volume' entry (value and time) instead of adding one.
   */
  readonly log: AudioLogEntry[] = [];
  /** Beyond this many entries the oldest quarter is dropped (long play-through tests stay bounded). */
  logLimit = 20_000;
  readonly loaded = new Map<string, string>();
  /** Load hints by key (the AudioManager streams music: `{ stream: true }`). */
  readonly hints = new Map<string, AudioLoadHint>();
  readonly pcm = new Map<string, { data: Float32Array; sampleRate: number }>();
  suspended = false;
  /** Volume entries of this segment may be updated in place; bumped by every other entry and by trimming. */
  private segment = 0;

  constructor(private readonly clock: () => number) {}

  private record(e: AudioLogEntry, coalescable = false): number {
    if (!coalescable) this.segment++;
    this.log.push(e);
    if (this.log.length > this.logLimit) {
      this.log.splice(0, this.log.length - Math.floor(this.logLimit * 0.75));
      this.segment++;
    }
    return this.segment;
  }

  async load(key: string, src: string, hint?: AudioLoadHint): Promise<void> {
    this.loaded.set(key, src);
    if (hint) this.hints.set(key, hint);
  }

  unload(key: string): void {
    this.loaded.delete(key);
    this.hints.delete(key);
    this.pcm.delete(key);
    this.record({ action: 'unload', key, time: this.clock() });
  }

  async loadPcm(key: string, pcm: Float32Array, sampleRate: number): Promise<void> {
    this.pcm.set(key, { data: pcm, sampleRate });
    this.loaded.set(key, '(pcm)');
  }

  isLoaded(key: string): boolean {
    return this.loaded.has(key);
  }

  play(key: string, opts?: PlayOptions): AudioInstance {
    this.record({ action: 'play', key, ...(opts ? { opts } : {}), time: this.clock() });
    let playing = true;
    let vol: (AudioLogEntry & { opts: PlayOptions }) | null = null;
    let volSegment = -1;
    const rec = this;
    return {
      stop() {
        if (!playing) return;
        playing = false;
        rec.record({ action: 'stop', key, time: rec.clock() });
      },
      setVolume(v: number) {
        if (vol && volSegment === rec.segment) {
          vol.opts.volume = v;
          vol.time = rec.clock();
          return;
        }
        vol = { action: 'volume', key, opts: { volume: v }, time: rec.clock() };
        volSegment = rec.record(vol, true);
      },
      get playing() {
        return playing;
      },
    };
  }

  stopAll(): void {
    this.record({ action: 'stopAll', key: '', time: this.clock() });
  }

  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.suspended = false;
  }

  /** Keys of all play() calls, in order. */
  played(): string[] {
    return this.log.filter((e) => e.action === 'play').map((e) => e.key);
  }
}

/**
 * Node platform backed by @napi-rs/canvas. Nothing runs on its own: the harness advances the clock,
 * injects touches and renders frames explicitly. Never import this from runtime (bundled) code.
 */
export class HeadlessPlatform implements Platform {
  readonly name = 'headless' as const;
  readonly screen: ScreenInfo;
  readonly canvas: Surface;
  readonly fontFamily: string;
  readonly storage = new MemoryStorage();
  readonly audio: RecordingAudio;
  readonly ads: AdService & { rewardedResult: boolean; calls: string[] };
  readonly vibrations: string[] = [];
  readonly shares: ShareOptions[] = [];
  loginResult: LoginResult = { ok: true, code: 'headless-code' };
  assetsDir: string;
  /** System language seen by the game; tests may change it before calling detectLocale(). */
  language: string;
  clock = 0;
  /** triggerGC() calls. */
  gcCount = 0;

  private memoryCbs = new Set<(info: MemoryWarningInfo) => void>();
  private frameCbs = new Map<number, (t: number) => void>();
  private nextFrameId = 1;
  private touchCbs = new Set<(e: RawTouchEvent) => void>();
  private showCbs = new Set<() => void>();
  private hideCbs = new Set<() => void>();
  private resizeCbs = new Set<() => void>();
  private keyCbs = new Set<(e: PlatformKeyEvent) => void>();
  private keysDown = new Set<string>();

  constructor(opts: HeadlessOptions = {}) {
    const si = opts.safeInsets ?? {};
    this.screen = {
      width: opts.width ?? 390,
      height: opts.height ?? 844,
      pixelRatio: opts.pixelRatio ?? 2,
      safeInsets: { top: si.top ?? 0, right: si.right ?? 0, bottom: si.bottom ?? 0, left: si.left ?? 0 },
    };
    this.canvas = createCanvas(
      this.screen.width * this.screen.pixelRatio,
      this.screen.height * this.screen.pixelRatio,
    ) as unknown as Surface;
    this.fontFamily = opts.fontFamily ?? HEADLESS_FONT;
    this.language = opts.language ?? 'zh-CN';
    this.assetsDir = opts.assetsDir ?? resolve('assets');
    this.audio = new RecordingAudio(() => this.clock);
    const calls: string[] = [];
    const ads = {
      rewardedResult: true,
      calls,
      rewarded: async (id: string) => {
        calls.push(`rewarded:${id}`);
        return ads.rewardedResult;
      },
      interstitial: async (id: string) => {
        calls.push(`interstitial:${id}`);
      },
    };
    this.ads = ads;
  }

  createCanvas(width: number, height: number): Surface {
    return createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height))) as unknown as Surface;
  }

  async loadImage(path: string): Promise<ImageSource> {
    return (await loadImage(resolve(this.assetsDir, path))) as unknown as ImageSource;
  }

  async readText(path: string): Promise<string> {
    return readFile(resolve(this.assetsDir, path), 'utf8');
  }

  now(): number {
    return this.clock;
  }

  requestFrame(cb: (t: number) => void): number {
    const id = this.nextFrameId++;
    this.frameCbs.set(id, cb);
    return id;
  }

  cancelFrame(id: number): void {
    this.frameCbs.delete(id);
  }

  /** Runs pending requestFrame callbacks once (only used if something called game.start()). */
  flushFrames(): void {
    const cbs = [...this.frameCbs.values()];
    this.frameCbs.clear();
    for (const cb of cbs) cb(this.clock);
  }

  onTouch(cb: (e: RawTouchEvent) => void): () => void {
    this.touchCbs.add(cb);
    return () => this.touchCbs.delete(cb);
  }

  onShow(cb: () => void): () => void {
    this.showCbs.add(cb);
    return () => this.showCbs.delete(cb);
  }

  onHide(cb: () => void): () => void {
    this.hideCbs.add(cb);
    return () => this.hideCbs.delete(cb);
  }

  onResize(cb: () => void): () => void {
    this.resizeCbs.add(cb);
    return () => this.resizeCbs.delete(cb);
  }

  onKey(cb: (e: PlatformKeyEvent) => void): () => void {
    this.keyCbs.add(cb);
    return () => this.keyCbs.delete(cb);
  }

  vibrate(kind: 'short' | 'long'): void {
    this.vibrations.push(kind);
  }

  share(opts: ShareOptions): void {
    this.shares.push(opts);
  }

  async login(): Promise<LoginResult> {
    return this.loginResult;
  }

  onMemoryWarning(cb: (info: MemoryWarningInfo) => void): () => void {
    this.memoryCbs.add(cb);
    return () => this.memoryCbs.delete(cb);
  }

  triggerGC(): void {
    this.gcCount++;
  }

  // ------------------------------------------------ simulation helpers

  /** Injects a raw touch event (screen CSS px). */
  touch(phase: TouchPhase, touches: RawTouch[]): void {
    const e: RawTouchEvent = { phase, touches };
    for (const cb of [...this.touchCbs]) cb(e);
  }

  /**
   * Injects a key event (KeyboardEvent.code, e.g. 'Space', 'KeyA'); a 'down' for a held key is a repeat, an 'up'
   * for a key that is not held is dropped. Edges show up in the next frame: `t.platform.key('Space'); await t.step();`
   */
  key(code: string, type: 'down' | 'up' = 'down', key?: string): void {
    if (type === 'up' && !this.keysDown.delete(code)) return;
    const repeat = type === 'down' && this.keysDown.has(code);
    if (type === 'down') this.keysDown.add(code);
    key ??= /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code;
    const e: PlatformKeyEvent = { type, code, key, repeat };
    for (const cb of [...this.keyCbs]) cb(e);
  }

  hide(): void {
    for (const cb of [...this.hideCbs]) cb();
  }

  /** Simulates the host's onMemoryWarning (wx level 5 / 10 / 15 on Android). */
  memoryWarning(level?: number): void {
    const info: MemoryWarningInfo = level === undefined ? {} : { level };
    for (const cb of [...this.memoryCbs]) cb(info);
  }

  show(): void {
    for (const cb of [...this.showCbs]) cb();
  }

  /** Changes the simulated screen size and fires resize listeners. */
  resize(width: number, height: number, safeInsets?: Partial<Insets>): void {
    this.screen.width = width;
    this.screen.height = height;
    if (safeInsets) Object.assign(this.screen.safeInsets, safeInsets);
    for (const cb of [...this.resizeCbs]) cb();
  }
}
