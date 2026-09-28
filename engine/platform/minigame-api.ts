// Typings for the subset of the mini-game global (`wx`, `tt`, `tap`) used by engine/platform/minigame.ts.
// The three runtimes mirror WeChat's API with a different prefix; everything optional here is feature-detected,
// because availability differs per platform and base-library version.
//   WeChat:  https://developers.weixin.qq.com/minigame/dev/api/
//   Douyin:  https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/overview
//   TapTap:  https://developer.taptap.cn/minigameapidoc/

export interface MgError {
  errMsg?: string;
  errCode?: number;
  /** Douyin / TapTap error number. */
  errNo?: number;
  errno?: number;
}

export interface MgCallbacks<T = unknown> {
  success?(res: T): void;
  fail?(err: MgError): void;
  complete?(): void;
}

export interface MgTouch {
  identifier: number;
  /** Position relative to the window (= the on-screen canvas) in CSS px. */
  clientX: number;
  clientY: number;
  pageX?: number;
  pageY?: number;
  screenX?: number;
  screenY?: number;
  force?: number;
}

export interface MgTouchEvent {
  touches: MgTouch[];
  changedTouches: MgTouch[];
  timeStamp?: number;
}

export interface MgSafeArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** wx.getWindowInfo() (base lib 2.20.1+), tap.getWindowInfo(); also the layout part of getSystemInfoSync(). */
export interface MgWindowInfo {
  pixelRatio: number;
  screenWidth: number;
  screenHeight: number;
  windowWidth: number;
  windowHeight: number;
  statusBarHeight?: number;
  /** Portrait-oriented safe area; some devices omit it (TapTap docs say so explicitly). */
  safeArea?: MgSafeArea;
  screenTop?: number;
}

export interface MgSystemInfo extends MgWindowInfo {
  platform?: string;
  system?: string;
  SDKVersion?: string;
  appName?: string;
}

export interface MgCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
}

export interface MgImage {
  readonly width: number;
  readonly height: number;
  src: string;
  onload: ((e?: unknown) => void) | null;
  onerror: ((e?: unknown) => void) | null;
}

export interface MgFileSystemManager {
  readFileSync(path: string, encoding?: string): string | ArrayBuffer;
  writeFileSync?(path: string, data: string | ArrayBuffer, encoding?: string): void;
  statSync?(path: string): { size: number };
  accessSync?(path: string): void;
}

export interface MgInnerAudioContext {
  src: string;
  loop: boolean;
  volume: number;
  /** wx 2.11.0+ (Android 6+), tt 2.33.0+; 0.5-2.0. */
  playbackRate?: number;
  autoplay?: boolean;
  readonly paused?: boolean;
  play(): void;
  pause(): void;
  stop(): void;
  seek?(position: number): void;
  destroy(): void;
  onCanplay?(cb: () => void): void;
  offCanplay?(cb: () => void): void;
  onPlay?(cb: () => void): void;
  onEnded(cb: () => void): void;
  onStop?(cb: () => void): void;
  onError(cb: (err: MgError) => void): void;
}

/** wx.setInnerAudioOption / tt.setInnerAudioOption. */
export interface MgInnerAudioOption {
  /** Keep other apps' audio playing (default true on wx). */
  mixWithOther?: boolean;
  /** iOS: obey the silent switch (default true: muted phones play no game sound). */
  obeyMuteSwitch?: boolean;
  /** Play through the speaker instead of the earpiece (default true). */
  speakerOn?: boolean;
}

export interface MgRewardedCloseResult {
  /** Watched to the end. WeChat < 2.1.0 passes undefined instead of an object (treated as ended). */
  isEnded?: boolean;
  /** Douyin: number of fully watched videos (preferred over isEnded when present). */
  count?: number;
}

export interface MgRewardedVideoAd {
  load(): Promise<unknown>;
  show(): Promise<unknown>;
  onClose(cb: (res?: MgRewardedCloseResult) => void): void;
  offClose?(cb: (res?: MgRewardedCloseResult) => void): void;
  onError(cb: (err: MgError) => void): void;
  offError?(cb: (err: MgError) => void): void;
  onLoad?(cb: () => void): void;
  destroy?(): unknown;
}

export interface MgInterstitialAd {
  load?(): Promise<unknown>;
  show(): Promise<unknown>;
  onClose(cb: () => void): void;
  offClose?(cb: () => void): void;
  onError(cb: (err: MgError) => void): void;
  offError?(cb: (err: MgError) => void): void;
  onLoad?(cb: () => void): void;
  destroy?(): unknown;
}

export interface MgShareContent {
  title?: string;
  imageUrl?: string;
  query?: string;
  /** TapTap share text. */
  desc?: string;
}

export interface MgLoginResult {
  code?: string;
  /** Douyin: device code returned even when the user is not logged in. */
  anonymousCode?: string;
  isLogin?: boolean;
  errMsg?: string;
}

/** The global `wx` / `tt` / `tap` object. Only createCanvas is mandatory; everything else is feature-detected. */
export interface MiniGameApi {
  createCanvas(): MgCanvas;
  createImage?(): MgImage;

  getWindowInfo?(): MgWindowInfo;
  getSystemInfoSync?(): MgSystemInfo;
  onWindowResize?(cb: (res?: { windowWidth?: number; windowHeight?: number }) => void): void;
  getPerformance?(): { now(): number };

  onTouchStart?(cb: (e: MgTouchEvent) => void): void;
  onTouchMove?(cb: (e: MgTouchEvent) => void): void;
  onTouchEnd?(cb: (e: MgTouchEvent) => void): void;
  onTouchCancel?(cb: (e: MgTouchEvent) => void): void;

  onShow?(cb: (res?: unknown) => void): void;
  onHide?(cb: (res?: unknown) => void): void;

  getFileSystemManager?(): MgFileSystemManager;
  env?: { USER_DATA_PATH?: string };

  getStorageSync?(key: string): unknown;
  setStorageSync?(key: string, data: unknown): void;
  removeStorageSync?(key: string): void;
  getStorageInfoSync?(): { keys: string[] };

  createInnerAudioContext?(opts?: Record<string, unknown>): MgInnerAudioContext;
  onAudioInterruptionBegin?(cb: () => void): void;
  onAudioInterruptionEnd?(cb: () => void): void;
  /** Global audio session options (wx 2.3.0+, tt 1.64.0+). */
  setInnerAudioOption?(opts: MgInnerAudioOption & Record<string, unknown>): unknown;

  /** wx 2.0.2+ (res.level only on Android), tt, tap. */
  onMemoryWarning?(cb: (res?: { level?: number }) => void): void;
  /** Hint to collect garbage now (wx 1.x+, tt, tap). */
  triggerGC?(): void;
  /** Render frame rate 1-60 (wx 1.x+, tt, tap). requestAnimationFrame follows it. */
  setPreferredFramesPerSecond?(fps: number): void;

  vibrateShort?(opts?: Record<string, unknown>): unknown;
  vibrateLong?(opts?: Record<string, unknown>): unknown;

  createRewardedVideoAd?(opts: { adUnitId: string; multiton?: boolean }): MgRewardedVideoAd;
  createInterstitialAd?(opts: { adUnitId: string }): MgInterstitialAd;

  shareAppMessage?(opts: MgShareContent & Record<string, unknown>): unknown;
  showShareMenu?(opts?: Record<string, unknown>): unknown;
  onShareAppMessage?(cb: (res?: { channel?: string }) => MgShareContent): void;
  onShareTimeline?(cb: () => MgShareContent): void;

  login?(opts: MgCallbacks<MgLoginResult> & Record<string, unknown>): unknown;
}
