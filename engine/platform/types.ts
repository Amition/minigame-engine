import type { Insets } from '../core/math';
import type { ImageSource, Surface } from '../gfx/types';

export type PlatformName = 'web' | 'wx' | 'tt' | 'tap' | 'headless';

export interface ScreenInfo {
  /** Screen size in CSS px (logical points). */
  width: number;
  height: number;
  pixelRatio: number;
  /** Unsafe insets (notch, home indicator) in CSS px. */
  safeInsets: Insets;
}

export type TouchPhase = 'start' | 'move' | 'end' | 'cancel';

export interface RawTouch {
  id: number;
  /** Screen position in CSS px. */
  x: number;
  y: number;
}

export interface RawTouchEvent {
  phase: TouchPhase;
  /** Only the touches that changed in this event. */
  touches: RawTouch[];
}

export interface PlatformKeyEvent {
  type: 'down' | 'up';
  /** Physical key in KeyboardEvent.code style: 'KeyA', 'Digit1', 'Space', 'ArrowUp', 'ShiftLeft', 'Enter', 'Escape'. */
  code: string;
  /** Produced value in KeyboardEvent.key style ('a', 'A', ' ', 'ArrowUp'); '' when the host does not say. */
  key: string;
  /** Auto-repeat of a key that is already held (only on 'down'). */
  repeat: boolean;
}

/** Snapshot of one connected gamepad. With `standard` mapping, buttons/axes follow the W3C standard layout. */
export interface PlatformGamepad {
  index: number;
  id: string;
  standard: boolean;
  /** Button values 0..1 (index 0 = A / bottom face button). */
  buttons: number[];
  /** Axes -1..1: 0 left stick x, 1 left stick y (down = +1), 2 right stick x, 3 right stick y. */
  axes: number[];
}

export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export interface PlayOptions {
  volume?: number;
  loop?: boolean;
  /** Playback rate. Backends without rate support ignore it. */
  rate?: number;
}

export interface AudioInstance {
  stop(): void;
  setVolume(v: number): void;
  readonly playing: boolean;
}

/** How a sound will be used, so a backend can pick a decoder. */
export interface AudioLoadHint {
  /**
   * Long / looping audio (music): streamed instead of decoded up front. Mini-games use a plain InnerAudioContext
   * (never useWebAudioImplement), the web decodes it only while it plays. The AudioManager sets it from the
   * manifest kind (`music`).
   */
  stream?: boolean;
}

/**
 * Low-level audio playback. Sounds are files under the app's assets dir (e.g. 'audio/coin.mp3').
 * AudioManager (engine/audio) builds groups, music, mute and pooling on top of this.
 */
export interface AudioBackend {
  load(key: string, src: string, hint?: AudioLoadHint): Promise<void>;
  /** Registers raw mono PCM (-1..1). Optional, dev builds only: web and headless support it, mini-games may not. */
  loadPcm?(key: string, pcm: Float32Array, sampleRate: number): Promise<void>;
  isLoaded(key: string): boolean;
  play(key: string, opts?: PlayOptions): AudioInstance;
  /** Stops and frees a sound (decoded data, audio contexts); load() it again before the next play. */
  unload?(key: string): void;
  stopAll(): void;
  /** Called on hide/show so the platform can release/resume the audio session. */
  suspend(): void;
  resume(): void;
}

/** Payload of Platform.onMemoryWarning and the Game's 'memorywarning' event. */
export interface MemoryWarningInfo {
  /** Android level from the host (wx: 5 = moderate, 10 = low, 15 = critical); absent on iOS and elsewhere. */
  level?: number;
}

export interface AdService {
  /** Shows a rewarded video. Resolves true only if the user watched to the end. */
  rewarded(adUnitId: string): Promise<boolean>;
  /** Shows an interstitial ad. Resolves when closed or failed. */
  interstitial(adUnitId: string): Promise<void>;
}

export interface ShareOptions {
  title?: string;
  imageUrl?: string;
  query?: string;
}

export interface LoginResult {
  ok: boolean;
  code?: string;
  error?: string;
}

/**
 * Everything the engine needs from the host. Implementations: engine/platform/{web,wx,tt,tap}.ts,
 * engine/testing/headless.ts. The 233 build reuses wx. Game code never touches wx/tt/tap/window directly.
 */
export interface Platform {
  readonly name: PlatformName;
  readonly screen: ScreenInfo;
  /** On-screen canvas. Game sets its backing size to screen * pixelRatio. */
  readonly canvas: Surface;
  /** Default CSS font-family stack for this platform. */
  readonly fontFamily: string;
  /** System / host app language as a BCP 47 tag ('zh-CN', 'en-US'), when the host reports one. */
  readonly language?: string;

  createCanvas(width: number, height: number): Surface;
  /** Loads an image from the app assets dir, e.g. 'ui/button.png'. */
  loadImage(path: string): Promise<ImageSource>;
  /** Reads a text file from the app assets dir, e.g. 'levels/1.json'. */
  readText(path: string): Promise<string>;

  /** Monotonic milliseconds. */
  now(): number;
  requestFrame(cb: (timeMs: number) => void): number;
  cancelFrame(id: number): void;

  onTouch(cb: (e: RawTouchEvent) => void): () => void;
  onShow(cb: () => void): () => void;
  onHide(cb: () => void): () => void;
  /** Screen size changes (web window resize). Mini-games never fire it. */
  onResize(cb: () => void): () => void;
  /**
   * Keyboard events (web; PC clients of wx/tt/tap). Absent when the host has no keyboard API. Hosts send an 'up' for
   * every held key when focus is lost, so keys never stick.
   */
  onKey?(cb: (e: PlatformKeyEvent) => void): () => void;
  /** Connected gamepads, polled once per frame by the runtime (web Gamepad API). Absent when unsupported. */
  pollGamepads?(): PlatformGamepad[];

  readonly storage: KeyValueStorage;
  readonly audio: AudioBackend;
  readonly ads: AdService;

  vibrate(kind: 'short' | 'long'): void;
  share(opts: ShareOptions): void;
  /** Platform login. TapTap requires it; others may resolve { ok: true } without a code. */
  login(): Promise<LoginResult>;

  /** The host is low on memory (wx/tt/tap onMemoryWarning). The Game subscribes and emits 'memorywarning'. */
  onMemoryWarning?(cb: (info: MemoryWarningInfo) => void): () => void;
  /** Hints the host to run a garbage collection now (wx/tt/tap triggerGC); no-op elsewhere. */
  triggerGC?(): void;
  /**
   * Native frame-rate cap (wx/tt/tap setPreferredFramesPerSecond, 1-60). Returns false when the host cannot do it;
   * the Game then skips frames itself. Use Game.setFrameRate, not this.
   */
  setPreferredFramesPerSecond?(fps: number): boolean;
}
