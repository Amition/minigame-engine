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

/**
 * Low-level audio playback. Sounds are files under the app's assets dir (e.g. 'audio/coin.mp3').
 * AudioManager (engine/audio) builds groups, music, mute and pooling on top of this.
 */
export interface AudioBackend {
  load(key: string, src: string): Promise<void>;
  /** Registers raw mono PCM (-1..1). Optional: web and headless support it, mini-games may not. */
  loadPcm?(key: string, pcm: Float32Array, sampleRate: number): Promise<void>;
  isLoaded(key: string): boolean;
  play(key: string, opts?: PlayOptions): AudioInstance;
  stopAll(): void;
  /** Called on hide/show so the platform can release/resume the audio session. */
  suspend(): void;
  resume(): void;
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

  readonly storage: KeyValueStorage;
  readonly audio: AudioBackend;
  readonly ads: AdService;

  vibrate(kind: 'short' | 'long'): void;
  share(opts: ShareOptions): void;
  /** Platform login. TapTap requires it; others may resolve { ok: true } without a code. */
  login(): Promise<LoginResult>;
}
