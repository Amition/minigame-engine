import type { Insets } from '../core/math';
import type { ImageSource, Surface } from '../gfx/types';
import type {
  AdService,
  AudioBackend,
  AudioInstance,
  KeyValueStorage,
  LoginResult,
  Platform,
  PlayOptions,
  RawTouch,
  RawTouchEvent,
  ScreenInfo,
  ShareOptions,
  TouchPhase,
} from './types';
import type {
  MgCanvas,
  MgError,
  MgFileSystemManager,
  MgInnerAudioContext,
  MgInterstitialAd,
  MgRewardedCloseResult,
  MgRewardedVideoAd,
  MgShareContent,
  MgTouchEvent,
  MgWindowInfo,
  MiniGameApi,
} from './minigame-api';

export type MiniGameName = 'wx' | 'tt' | 'tap';

/** Per-platform switches; wx.ts / tt.ts / tap.ts pass the right defaults. */
export interface MiniGameOptions {
  /** Package-relative dir that loadImage/readText/audio paths resolve against (default 'assets/'). */
  assetBase?: string;
  /** Default font-family (default 'sans-serif': quoted family lists are not parsed reliably by every runtime). */
  fontFamily?: string;
  /** Use this on-screen canvas instead of calling api.createCanvas() for it. */
  canvas?: MgCanvas;
  /** Max simultaneous InnerAudioContexts per sound key (default 4). The oldest non-looping one is reused. */
  audioVoices?: number;
  /** Options for createInnerAudioContext for short sounds (wx: { useWebAudioImplement: true }). */
  sfxAudioOptions?: Record<string, unknown>;
  /** Files larger than this (bytes) count as long audio (music) and never get sfxAudioOptions (default 256 KB). */
  longAudioBytes?: number;
  /** Arguments for vibrateShort (wx/tap require { type }, tt takes none). */
  vibrateShortArgs?: Record<string, unknown>;
  /** Extra arguments for api.login (e.g. tt: { force: false }). */
  loginArgs?: Record<string, unknown>;
  /** Reuse one interstitial instance per unit id (wx) instead of a new one per show, destroyed after close (tt/tap). */
  reuseInterstitial?: boolean;
  /** Content of the passive share (menu) and defaults for share(). */
  share?: ShareOptions;
  /** Arguments for showShareMenu (default: friends + timeline menus). */
  shareMenu?: Record<string, unknown>;
}

export const MINIGAME_FONT = 'sans-serif';

const noop = () => {};

function errText(e: unknown): string {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  const m = e as MgError & { message?: string };
  return m.errMsg ?? m.message ?? JSON.stringify(e);
}

function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function joinAsset(base: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  return base + path.replace(/^\.?\/+/, '');
}

export function normalizeBase(base: string): string {
  const b = base.replace(/\\/g, '/').replace(/^\.?\/+/, '');
  return b === '' || b.endsWith('/') ? b : b + '/';
}

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

// ------------------------------------------------------------------ screen

const clampInset = (v: number, max: number) => (Number.isFinite(v) ? Math.min(Math.max(0, v), max) : 0);

/**
 * Converts a mini-game safeArea (screen coordinates, portrait-oriented) into window insets in CSS px.
 * Devices without a (valid) safeArea fall back to the status bar height on top.
 */
export function safeAreaInsets(info: MgWindowInfo | undefined, width: number, height: number): Insets {
  const sa = info?.safeArea;
  const status = info?.statusBarHeight ?? 0;
  const out: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!sa || !(sa.right > sa.left) || !(sa.bottom > sa.top)) {
    out.top = clampInset(height > width ? status : 0, height / 4);
    return out;
  }
  if (width > height && sa.bottom - sa.top > sa.right - sa.left) {
    // Landscape game but the safe area is still reported for portrait: the notch can end up on either side.
    const portraitH = Math.max(info!.screenWidth || width, info!.screenHeight || height);
    const side = Math.max(sa.top, portraitH - sa.bottom);
    out.left = out.right = clampInset(side, width / 4);
    return out;
  }
  const top = info!.screenTop ?? 0;
  out.top = clampInset(sa.top - top, height / 4);
  out.bottom = clampInset(top + height - sa.bottom, height / 4);
  out.left = clampInset(sa.left, width / 4);
  out.right = clampInset(width - sa.right, width / 4);
  return out;
}

function readWindowInfo(api: MiniGameApi): MgWindowInfo | undefined {
  // getWindowInfo: wx 2.20.1+, tap; tt only on newer base libs. getSystemInfoSync is deprecated on wx but universal.
  const info = attempt(() => api.getWindowInfo?.());
  if (info && info.windowWidth > 0) return info;
  return attempt(() => api.getSystemInfoSync?.());
}

function readScreen(api: MiniGameApi, out: ScreenInfo): ScreenInfo {
  const info = readWindowInfo(api);
  out.width = info?.windowWidth || info?.screenWidth || 375;
  out.height = info?.windowHeight || info?.screenHeight || 667;
  out.pixelRatio = info?.pixelRatio || 2;
  out.safeInsets = safeAreaInsets(info, out.width, out.height);
  return out;
}

/**
 * wx/tt document getPerformance().now() in microseconds (tap mirrors wx). The unit is verified against Date.now
 * once, so a runtime that returns milliseconds cannot slow the game down 1000x.
 */
function createClock(api: MiniGameApi): () => number {
  const perf = attempt(() => api.getPerformance?.());
  if (!perf || typeof perf.now !== 'function') return () => Date.now();
  const p0 = perf.now();
  const d0 = Date.now();
  let scale = 1 / 1000;
  let base = 0;
  let checked = false;
  return () => {
    const dp = perf.now() - p0;
    if (!checked) {
      const dd = Date.now() - d0;
      if (dd >= 250) {
        checked = true;
        const next = dp / dd > 100 ? 1 / 1000 : 1;
        if (next !== scale) {
          base += dp * scale - dp * next;
          scale = next;
        }
      }
    }
    return base + dp * scale;
  };
}

// ------------------------------------------------------------------ storage

/** get/set/removeStorageSync + getStorageInfoSync().keys; in-memory when the API is missing. */
class MiniGameStorage implements KeyValueStorage {
  private readonly mem = new Map<string, string>();

  constructor(private readonly api: MiniGameApi) {}

  get(key: string): string | null {
    const api = this.api;
    if (!api.getStorageSync) return this.mem.get(key) ?? null;
    const v = attempt(() => api.getStorageSync!(key));
    // Missing keys read back as '' on every platform; only the key list tells an empty string apart.
    if (v === undefined || v === null || v === '') return v === '' && this.keys().includes(key) ? '' : null;
    return typeof v === 'string' ? v : JSON.stringify(v);
  }

  set(key: string, value: string): void {
    const api = this.api;
    if (!api.setStorageSync) {
      this.mem.set(key, value);
      return;
    }
    try {
      api.setStorageSync(key, value);
    } catch (e) {
      console.warn(`[storage] set "${key}" failed: ${errText(e)}`);
    }
  }

  remove(key: string): void {
    this.mem.delete(key);
    attempt(() => this.api.removeStorageSync?.(key));
  }

  keys(): string[] {
    const api = this.api;
    if (!api.getStorageInfoSync) return [...this.mem.keys()];
    return attempt(() => api.getStorageInfoSync!().keys.slice()) ?? [];
  }
}

// ------------------------------------------------------------------ audio

const WAV_RATES = [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000];

/**
 * Mono float PCM → 16-bit WAV. Douyin only plays 8/11.025/16/22.05/24/32/44.1/48 kHz, so other rates are
 * resampled (linear) to 44.1 kHz.
 */
export function encodeWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  let data = pcm;
  let rate = Math.round(sampleRate);
  if (!WAV_RATES.includes(rate)) {
    const target = 44100;
    const n = Math.max(1, Math.round((pcm.length * target) / sampleRate));
    const out = new Float32Array(n);
    const k = sampleRate / target;
    for (let i = 0; i < n; i++) {
      const p = i * k;
      const j = Math.floor(p);
      const a = pcm[Math.min(j, pcm.length - 1)] ?? 0;
      const b = pcm[Math.min(j + 1, pcm.length - 1)] ?? 0;
      out[i] = a + (b - a) * (p - j);
    }
    data = out;
    rate = target;
  }
  const buf = new ArrayBuffer(44 + data.length * 2);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + data.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]!));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

interface Voice {
  ctx: MgInnerAudioContext;
  playing: boolean;
  /** Paused by suspend(), restarted by resume(). */
  suspended: boolean;
  /** Id of the play() call that owns this voice; stale AudioInstances compare against it. */
  token: number;
  /** canplay (or error) seen. */
  loaded: boolean;
  ready?: () => void;
}

const STOPPED: AudioInstance = { stop: noop, setVolume: noop, playing: false };

/**
 * InnerAudioContext backend. One context plays one sound at a time, so each key has a small pool of contexts
 * (voices) for overlapping sfx. loadPcm writes a WAV into USER_DATA_PATH when the file system allows it.
 */
export class MiniGameAudio implements AudioBackend {
  loadPcm?: (key: string, pcm: Float32Array, sampleRate: number) => Promise<void>;

  private readonly srcs = new Map<string, string>();
  private readonly long = new Set<string>();
  private readonly pools = new Map<string, Voice[]>();
  private readonly warned = new Set<string>();
  private seq = 0;
  private readonly maxVoices: number;
  private readonly longBytes: number;

  constructor(
    private readonly api: MiniGameApi,
    private readonly base: string,
    private readonly fs: MgFileSystemManager | undefined,
    private readonly sfxOptions: Record<string, unknown> | undefined,
    opts: { voices?: number; longBytes?: number } = {},
  ) {
    this.maxVoices = Math.max(1, opts.voices ?? 4);
    this.longBytes = opts.longBytes ?? 256 * 1024;
    const dir = api.env?.USER_DATA_PATH;
    if (api.createInnerAudioContext && fs?.writeFileSync && dir) {
      this.loadPcm = async (key, pcm, sampleRate) => {
        const path = `${dir}/pcm-${key.replace(/[^\w.-]/g, '_')}.wav`;
        const wav = encodeWav(pcm, sampleRate);
        fs.writeFileSync!(path, wav);
        this.register(key, path, wav.byteLength > this.longBytes);
      };
    }
  }

  get supported(): boolean {
    return typeof this.api.createInnerAudioContext === 'function';
  }

  async load(key: string, src: string): Promise<void> {
    const path = joinAsset(this.base, src);
    const size = attempt(() => this.fs?.statSync?.(path).size);
    this.register(key, path, size !== undefined && size > this.longBytes);
    if (!this.supported) return;
    const voice = this.pool(key)[0] ?? this.addVoice(key, false);
    if (voice.loaded) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, 3000);
      function done() {
        clearTimeout(timer);
        voice.ready = undefined;
        resolve();
      }
      voice.ready = done;
    });
  }

  isLoaded(key: string): boolean {
    return this.srcs.has(key);
  }

  play(key: string, opts: PlayOptions = {}): AudioInstance {
    if (!this.srcs.has(key) || !this.supported) {
      if (!this.warned.has(key)) {
        this.warned.add(key);
        console.warn(`[audio] "${key}" ${this.supported ? 'is not loaded' : 'cannot play: no createInnerAudioContext'}`);
      }
      return STOPPED;
    }
    const loop = !!opts.loop;
    const v = this.pick(key, loop);
    const ctx = v.ctx;
    const token = ++this.seq;
    v.token = token;
    ctx.loop = loop;
    ctx.volume = clamp01(opts.volume ?? 1);
    // playbackRate: wx 2.11.0+ (Android 6+), tt 2.33.0+; older runtimes just ignore the property.
    if (opts.rate !== undefined || (ctx.playbackRate !== undefined && ctx.playbackRate !== 1)) {
      ctx.playbackRate = Math.min(2, Math.max(0.5, opts.rate ?? 1));
    }
    if (v.playing) {
      if (ctx.seek) ctx.seek(0);
      else {
        ctx.stop();
        ctx.play();
      }
    } else {
      ctx.play();
    }
    v.playing = true;
    v.suspended = false;
    return {
      stop() {
        if (v.token !== token) return;
        if (v.playing || v.suspended) ctx.stop();
        v.playing = false;
        v.suspended = false;
      },
      setVolume(vol: number) {
        if (v.token === token) ctx.volume = clamp01(vol);
      },
      get playing() {
        return v.token === token && (v.playing || v.suspended);
      },
    };
  }

  stopAll(): void {
    for (const v of this.voices()) {
      if (v.playing || v.suspended) attempt(() => v.ctx.stop());
      v.playing = false;
      v.suspended = false;
    }
  }

  suspend(): void {
    for (const v of this.voices()) {
      if (!v.playing) continue;
      attempt(() => v.ctx.pause());
      v.playing = false;
      v.suspended = true;
    }
  }

  resume(): void {
    for (const v of this.voices()) {
      if (!v.suspended) continue;
      attempt(() => v.ctx.play());
      v.suspended = false;
      v.playing = true;
    }
  }

  /** Destroys every InnerAudioContext (they are not released automatically). */
  destroy(): void {
    for (const v of this.voices()) attempt(() => v.ctx.destroy());
    this.pools.clear();
  }

  /** Number of InnerAudioContexts created for a key (for tests and debugging). */
  voiceCount(key: string): number {
    return this.pools.get(key)?.length ?? 0;
  }

  private register(key: string, path: string, long: boolean): void {
    if (this.srcs.get(key) !== path) {
      for (const v of this.pools.get(key) ?? []) attempt(() => v.ctx.destroy());
      this.pools.delete(key);
    }
    this.srcs.set(key, path);
    if (long) this.long.add(key);
    else this.long.delete(key);
  }

  private pool(key: string): Voice[] {
    let p = this.pools.get(key);
    if (!p) this.pools.set(key, (p = []));
    return p;
  }

  private *voices(): Iterable<Voice> {
    for (const p of this.pools.values()) yield* p;
  }

  private addVoice(key: string, loop: boolean): Voice {
    const plain = loop || this.long.has(key) || !this.sfxOptions;
    const ctx = this.api.createInnerAudioContext!(plain ? undefined : { ...this.sfxOptions });
    const v: Voice = { ctx, playing: false, suspended: false, token: 0, loaded: false };
    ctx.src = this.srcs.get(key)!;
    ctx.onCanplay?.(() => {
      v.loaded = true;
      v.ready?.();
    });
    ctx.onEnded(() => {
      if (!ctx.loop) v.playing = false;
    });
    ctx.onError((err) => {
      v.playing = false;
      v.loaded = true;
      v.ready?.();
      console.warn(`[audio] "${key}" (${ctx.src}): ${errText(err)}`);
    });
    this.pool(key).push(v);
    return v;
  }

  private pick(key: string, loop: boolean): Voice {
    const pool = this.pool(key);
    const idle = pool.find((v) => !v.playing && !v.suspended);
    if (idle) return idle;
    if (pool.length < this.maxVoices) return this.addVoice(key, loop);
    let oldest: Voice | undefined;
    for (const v of pool) if (!v.ctx.loop && (!oldest || v.token < oldest.token)) oldest = v;
    return oldest ?? pool[0]!;
  }
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

// ------------------------------------------------------------------ ads

interface AdSlot<A> {
  ad: A;
  /** Resolver of the show() in progress, if any. */
  pending: ((ok: boolean) => void) | null;
}

/** Rewarded result: WeChat < 2.1.0 passes no object; Douyin's count wins over isEnded when present. */
export function rewardWatched(res: MgRewardedCloseResult | undefined): boolean {
  if (res === undefined || res === null) return true;
  if (typeof res.count === 'number') return res.count > 0;
  return !!res.isEnded;
}

function destroyAd(ad: { destroy?(): unknown }): void {
  const r = attempt(() => ad.destroy?.());
  if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(noop);
}

/**
 * Rewarded videos: one instance per unit id (they are singletons on wx/tap anyway), show → on failure load → show,
 * resolve on onClose. Interstitials: reused per unit id on wx; tt only shows an instance once (destroy + recreate)
 * and tap returns a new instance per create call, so there a fresh one is created per show and destroyed after.
 */
export class MiniGameAds implements AdService {
  private readonly rewardedSlots = new Map<string, AdSlot<MgRewardedVideoAd>>();
  private readonly interstitialSlots = new Map<string, AdSlot<MgInterstitialAd>>();

  constructor(
    private readonly api: MiniGameApi,
    private readonly reuseInterstitial: boolean,
  ) {}

  rewarded(adUnitId: string): Promise<boolean> {
    const api = this.api;
    if (!adUnitId || !api.createRewardedVideoAd) return Promise.resolve(false);
    let slot = this.rewardedSlots.get(adUnitId);
    if (!slot) {
      const ad = attempt(() => api.createRewardedVideoAd!({ adUnitId }));
      if (!ad) return Promise.resolve(false);
      const s: AdSlot<MgRewardedVideoAd> = { ad, pending: null };
      ad.onClose((res) => s.pending?.(rewardWatched(res)));
      ad.onError((err) => {
        if (!s.pending) return;
        console.warn(`[ads] rewarded ${adUnitId}: ${errText(err)}`);
        s.pending(false);
      });
      this.rewardedSlots.set(adUnitId, s);
      slot = s;
    }
    const s = slot;
    if (s.pending) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      s.pending = (ok) => {
        s.pending = null;
        resolve(ok);
      };
      Promise.resolve()
        .then(() => s.ad.show())
        .catch(() => s.ad.load().then(() => s.ad.show()))
        .catch((err) => {
          if (!s.pending) return;
          console.warn(`[ads] rewarded ${adUnitId} failed: ${errText(err)}`);
          s.pending(false);
        });
    });
  }

  interstitial(adUnitId: string): Promise<void> {
    const api = this.api;
    if (!adUnitId || !api.createInterstitialAd) return Promise.resolve();
    let slot = this.reuseInterstitial ? this.interstitialSlots.get(adUnitId) : undefined;
    if (!slot) {
      const ad = attempt(() => api.createInterstitialAd!({ adUnitId }));
      if (!ad) return Promise.resolve();
      const s: AdSlot<MgInterstitialAd> = { ad, pending: null };
      ad.onClose(() => s.pending?.(true));
      ad.onError((err) => {
        if (!s.pending) return;
        console.warn(`[ads] interstitial ${adUnitId}: ${errText(err)}`);
        s.pending(false);
      });
      if (this.reuseInterstitial) this.interstitialSlots.set(adUnitId, s);
      slot = s;
    }
    const s = slot;
    if (s.pending) return Promise.resolve();
    return new Promise<void>((resolve) => {
      s.pending = () => {
        s.pending = null;
        // tt: destroying an ad that was never shown fails; destroyAd swallows that.
        if (!this.reuseInterstitial) destroyAd(s.ad);
        resolve();
      };
      Promise.resolve()
        .then(() => s.ad.show())
        .catch(() => (s.ad.load ? s.ad.load().then(() => s.ad.show()) : Promise.reject(new Error('show failed'))))
        .catch((err) => {
          if (!s.pending) return;
          console.warn(`[ads] interstitial ${adUnitId} failed: ${errText(err)}`);
          s.pending(false);
        });
    });
  }

  destroy(): void {
    for (const s of this.rewardedSlots.values()) destroyAd(s.ad);
    for (const s of this.interstitialSlots.values()) destroyAd(s.ad);
    this.rewardedSlots.clear();
    this.interstitialSlots.clear();
  }
}

// ------------------------------------------------------------------ platform

function shareContent(o: ShareOptions): MgShareContent {
  const out: MgShareContent = {};
  if (o.title !== undefined) out.title = o.title;
  if (o.imageUrl !== undefined) out.imageUrl = o.imageUrl;
  if (o.query !== undefined) out.query = o.query;
  return out;
}

/**
 * Platform for WeChat-style mini-game runtimes. `api` is the global object (wx / tt / tap).
 * Every optional API is feature-detected: a missing one degrades to a no-op instead of throwing.
 */
export class MiniGamePlatform implements Platform {
  readonly screen: ScreenInfo = { width: 0, height: 0, pixelRatio: 1, safeInsets: { top: 0, right: 0, bottom: 0, left: 0 } };
  readonly canvas: Surface;
  readonly fontFamily: string;
  readonly storage: KeyValueStorage;
  readonly audio: MiniGameAudio;
  readonly ads: MiniGameAds;
  readonly now: () => number;

  private readonly base: string;
  private readonly fs: MgFileSystemManager | undefined;
  private readonly touchCbs = new Listeners<RawTouchEvent>();
  private readonly showCbs = new Listeners<void>();
  private readonly hideCbs = new Listeners<void>();
  private readonly resizeCbs = new Listeners<void>();
  private readonly shareDefaults: ShareOptions;

  constructor(
    readonly api: MiniGameApi,
    readonly name: MiniGameName,
    private readonly opts: MiniGameOptions = {},
  ) {
    this.base = normalizeBase(opts.assetBase ?? 'assets/');
    this.fontFamily = opts.fontFamily ?? MINIGAME_FONT;
    this.canvas = (opts.canvas ?? api.createCanvas()) as unknown as Surface;
    readScreen(api, this.screen);
    this.now = createClock(api);
    this.fs = attempt(() => api.getFileSystemManager?.());
    this.storage = new MiniGameStorage(api);
    this.audio = new MiniGameAudio(api, this.base, this.fs, opts.sfxAudioOptions, {
      ...(opts.audioVoices !== undefined ? { voices: opts.audioVoices } : {}),
      ...(opts.longAudioBytes !== undefined ? { longBytes: opts.longAudioBytes } : {}),
    });
    this.ads = new MiniGameAds(api, opts.reuseInterstitial ?? false);
    this.shareDefaults = { ...opts.share };

    const touch = (phase: TouchPhase) => (e: MgTouchEvent) => {
      const list = e?.changedTouches ?? [];
      const touches: RawTouch[] = [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i]!;
        touches.push({ id: t.identifier, x: t.clientX ?? t.pageX ?? 0, y: t.clientY ?? t.pageY ?? 0 });
      }
      if (touches.length) this.touchCbs.emit({ phase, touches });
    };
    attempt(() => api.onTouchStart?.(touch('start')));
    attempt(() => api.onTouchMove?.(touch('move')));
    attempt(() => api.onTouchEnd?.(touch('end')));
    attempt(() => api.onTouchCancel?.(touch('cancel')));
    attempt(() => api.onShow?.(() => this.showCbs.emit()));
    attempt(() => api.onHide?.(() => this.hideCbs.emit()));
    // Only PC / tablet WeChat resizes the window; phones never fire it.
    attempt(() =>
      api.onWindowResize?.(() => {
        readScreen(api, this.screen);
        this.resizeCbs.emit();
      }),
    );
    // Audio is interrupted by calls / alarms (wx, tt); the Game suspends on hide itself.
    attempt(() => api.onAudioInterruptionBegin?.(() => this.audio.suspend()));
    attempt(() => api.onAudioInterruptionEnd?.(() => this.audio.resume()));

    // Passive share: wx/tt/tap keep the menu item disabled until showShareMenu; the callback supplies the content.
    attempt(() =>
      api.showShareMenu?.({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'], fail: noop, ...opts.shareMenu }),
    );
    attempt(() => api.onShareAppMessage?.(() => shareContent(this.shareDefaults)));
    attempt(() => api.onShareTimeline?.(() => shareContent(this.shareDefaults)));
  }

  createCanvas(width: number, height: number): Surface {
    const c = this.api.createCanvas();
    c.width = Math.max(1, Math.ceil(width));
    c.height = Math.max(1, Math.ceil(height));
    return c as unknown as Surface;
  }

  loadImage(path: string): Promise<ImageSource> {
    const api = this.api;
    const src = joinAsset(this.base, path);
    if (!api.createImage) return Promise.reject(new Error(`${this.name}: createImage is not available (${src})`));
    return new Promise((resolve, reject) => {
      const img = api.createImage!();
      img.onload = () => resolve(img as ImageSource);
      img.onerror = (e) => reject(new Error(`failed to load image ${src}: ${errText(e)}`));
      img.src = src;
    });
  }

  async readText(path: string): Promise<string> {
    const file = joinAsset(this.base, path);
    if (!this.fs) throw new Error(`${this.name}: getFileSystemManager is not available (${file})`);
    let data: string | ArrayBuffer;
    try {
      data = this.fs.readFileSync(file, 'utf8');
    } catch (e) {
      throw new Error(`failed to read ${file}: ${errText(e)}`);
    }
    if (typeof data !== 'string') throw new Error(`failed to read ${file}: runtime returned binary data`);
    return data;
  }

  requestFrame(cb: (timeMs: number) => void): number {
    // requestAnimationFrame is a global in all three runtimes (GameGlobal.requestAnimationFrame).
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => cb(this.now()));
    return setTimeout(() => cb(this.now()), 16) as unknown as number;
  }

  cancelFrame(id: number): void {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    else clearTimeout(id);
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

  vibrate(kind: 'short' | 'long'): void {
    // wx/tap vibrateShort requires { type } (heavy|medium|light); tt takes no type. fail: noop avoids the
    // Promise-style call (and its unhandled rejection) where the runtime supports it.
    if (kind === 'short') attempt(() => this.api.vibrateShort?.({ ...this.opts.vibrateShortArgs, fail: noop }));
    else attempt(() => this.api.vibrateLong?.({ fail: noop }));
  }

  share(opts: ShareOptions): void {
    attempt(() => this.api.shareAppMessage?.({ ...shareContent({ ...this.shareDefaults, ...opts }), fail: noop }));
  }

  login(): Promise<LoginResult> {
    const api = this.api;
    if (!api.login) return Promise.resolve({ ok: true });
    return new Promise((resolve) => {
      let done = false;
      const finish = (r: LoginResult) => {
        if (done) return;
        done = true;
        resolve(r);
      };
      try {
        api.login!({
          ...this.opts.loginArgs,
          success: (res) => finish(res?.code ? { ok: true, code: res.code } : { ok: true }),
          fail: (err) => finish({ ok: false, error: errText(err) }),
        });
      } catch (e) {
        finish({ ok: false, error: errText(e) });
      }
    });
  }

  /** Releases audio contexts and ad instances. */
  destroy(): void {
    this.audio.destroy();
    this.ads.destroy();
  }
}

/** Creates the platform for a WeChat-style runtime; prefer createWxPlatform / createTtPlatform / createTapPlatform. */
export function createMiniGamePlatform(api: MiniGameApi, name: MiniGameName, opts: MiniGameOptions = {}): MiniGamePlatform {
  if (!api || typeof api.createCanvas !== 'function') {
    throw new Error(`${name}: mini-game API object not found (is this running inside the ${name} runtime?)`);
  }
  return new MiniGamePlatform(api, name, opts);
}
