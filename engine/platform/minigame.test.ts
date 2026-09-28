import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMiniGamePlatform,
  encodeWav,
  MiniGameStorage,
  normalizeBase,
  rewardWatched,
  safeAreaInsets,
  type MiniGameOptions,
} from './minigame';
import type {
  MgError,
  MgImage,
  MgInnerAudioContext,
  MgInterstitialAd,
  MgRewardedCloseResult,
  MgRewardedVideoAd,
  MgShareContent,
  MgTouchEvent,
  MgWindowInfo,
  MiniGameApi,
} from './minigame-api';
import { createTapPlatform } from './tap';
import { createTtPlatform } from './tt';
import type { RawTouchEvent } from './types';
import { createWxPlatform } from './wx';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

class FakeAudio implements MgInnerAudioContext {
  loop = false;
  volume = 1;
  playbackRate = 1;
  log: string[] = [];
  destroyed = false;
  private _src = '';
  private readonly canplay: (() => void)[] = [];
  private readonly ended: (() => void)[] = [];
  private readonly errors: ((e: MgError) => void)[] = [];

  constructor(
    readonly opts: Record<string, unknown> | undefined,
    private readonly failing: Set<string>,
  ) {}

  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    queueMicrotask(() => {
      if (this.failing.has(v)) for (const cb of this.errors) cb({ errMsg: 'decode failed', errCode: 10004 });
      else for (const cb of this.canplay) cb();
    });
  }
  play() {
    this.log.push('play');
  }
  pause() {
    this.log.push('pause');
  }
  stop() {
    this.log.push('stop');
  }
  seek(t: number) {
    this.log.push(`seek:${t}`);
  }
  destroy() {
    this.destroyed = true;
  }
  onCanplay(cb: () => void) {
    this.canplay.push(cb);
  }
  onEnded(cb: () => void) {
    this.ended.push(cb);
  }
  onError(cb: (e: MgError) => void) {
    this.errors.push(cb);
  }
  end() {
    for (const cb of this.ended) cb();
  }
  last(): string | undefined {
    return this.log[this.log.length - 1];
  }
}

type ShowMode = 'ok' | 'reject-once' | 'reject';

class FakeRewarded implements MgRewardedVideoAd {
  shows = 0;
  loads = 0;
  destroyed = false;
  showMode: ShowMode = 'ok';
  loadFails = false;
  private readonly closeCbs: ((res?: MgRewardedCloseResult) => void)[] = [];
  private readonly errorCbs: ((e: MgError) => void)[] = [];

  constructor(readonly adUnitId: string) {}

  show() {
    this.shows++;
    if (this.showMode === 'reject' || (this.showMode === 'reject-once' && this.loads === 0)) {
      return Promise.reject({ errMsg: 'no ad cached', errCode: 1004 });
    }
    return Promise.resolve();
  }
  load() {
    this.loads++;
    return this.loadFails ? Promise.reject({ errMsg: 'no fill', errCode: 1004 }) : Promise.resolve();
  }
  onClose(cb: (res?: MgRewardedCloseResult) => void) {
    this.closeCbs.push(cb);
  }
  onError(cb: (e: MgError) => void) {
    this.errorCbs.push(cb);
  }
  destroy() {
    this.destroyed = true;
  }
  close(res?: MgRewardedCloseResult) {
    for (const cb of this.closeCbs) cb(res);
  }
  error(e: MgError) {
    for (const cb of this.errorCbs) cb(e);
  }
}

class FakeInterstitial implements MgInterstitialAd {
  shows = 0;
  destroyed = false;
  showFails = false;
  private readonly closeCbs: (() => void)[] = [];

  constructor(readonly adUnitId: string) {}

  show() {
    this.shows++;
    return this.showFails ? Promise.reject({ errMsg: 'frequency limited', errCode: 2001 }) : Promise.resolve();
  }
  load() {
    return Promise.resolve();
  }
  onClose(cb: () => void) {
    this.closeCbs.push(cb);
  }
  onError() {}
  destroy() {
    this.destroyed = true;
  }
  close() {
    for (const cb of this.closeCbs) cb();
  }
}

class FakeImage implements MgImage {
  readonly width = 8;
  readonly height = 8;
  onload: ((e?: unknown) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  private _src = '';

  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    queueMicrotask(() => (v.includes('missing') ? this.onerror?.({ errMsg: 'not found' }) : this.onload?.()));
  }
}

const PORTRAIT: MgWindowInfo = {
  pixelRatio: 3,
  screenWidth: 390,
  screenHeight: 844,
  windowWidth: 390,
  windowHeight: 844,
  statusBarHeight: 47,
  safeArea: { left: 0, right: 390, top: 47, bottom: 810, width: 390, height: 763 },
};

/** A wx-like global backed by in-memory state, recording the calls the adapter makes. */
function fakeApi(over: Partial<MiniGameApi> = {}) {
  const calls: Record<string, unknown[]> = {};
  const record =
    (name: string) =>
    (arg?: unknown): undefined => {
      (calls[name] ??= []).push(arg);
      return undefined;
    };
  const touch: Partial<Record<'start' | 'move' | 'end' | 'cancel', (e: MgTouchEvent) => void>> = {};
  const lifecycle = { show: [] as (() => void)[], hide: [] as (() => void)[], resize: [] as (() => void)[] };
  const interruption = { begin: [] as (() => void)[], end: [] as (() => void)[] };
  const store = new Map<string, unknown>();
  const files = new Map<string, string | ArrayBuffer>();
  const audios: FakeAudio[] = [];
  const rewarded: FakeRewarded[] = [];
  const interstitials: FakeInterstitial[] = [];
  const failingAudio = new Set<string>();
  let shareCb: (() => MgShareContent) | undefined;
  let windowInfo = PORTRAIT;

  const api: MiniGameApi = {
    createCanvas: () => ({ width: 300, height: 150, getContext: () => null }),
    createImage: () => new FakeImage(),
    getWindowInfo: () => windowInfo,
    onWindowResize: (cb) => lifecycle.resize.push(() => cb()),
    onTouchStart: (cb) => (touch.start = cb),
    onTouchMove: (cb) => (touch.move = cb),
    onTouchEnd: (cb) => (touch.end = cb),
    onTouchCancel: (cb) => (touch.cancel = cb),
    onShow: (cb) => lifecycle.show.push(() => cb()),
    onHide: (cb) => lifecycle.hide.push(() => cb()),
    getFileSystemManager: () => ({
      readFileSync: (path: string) => {
        const f = files.get(path);
        if (f === undefined) throw { errMsg: `readFileSync:fail no such file or directory ${path}` };
        return f;
      },
      writeFileSync: (path: string, data: string | ArrayBuffer) => void files.set(path, data),
      statSync: (path: string) => {
        const f = files.get(path);
        if (f === undefined) throw { errMsg: 'statSync:fail no such file' };
        return { size: typeof f === 'string' ? f.length : f.byteLength };
      },
    }),
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
    setStorageSync: (key, data) => void store.set(key, data),
    removeStorageSync: (key) => void store.delete(key),
    getStorageInfoSync: () => ({ keys: [...store.keys()] }),
    createInnerAudioContext: (opts) => {
      const a = new FakeAudio(opts, failingAudio);
      audios.push(a);
      return a;
    },
    onAudioInterruptionBegin: (cb) => interruption.begin.push(cb),
    onAudioInterruptionEnd: (cb) => interruption.end.push(cb),
    vibrateShort: record('vibrateShort'),
    vibrateLong: record('vibrateLong'),
    createRewardedVideoAd: ({ adUnitId }) => {
      const ad = new FakeRewarded(adUnitId);
      rewarded.push(ad);
      return ad;
    },
    createInterstitialAd: ({ adUnitId }) => {
      const ad = new FakeInterstitial(adUnitId);
      interstitials.push(ad);
      return ad;
    },
    shareAppMessage: record('shareAppMessage'),
    showShareMenu: record('showShareMenu'),
    onShareAppMessage: (cb) => (shareCb = cb),
    login: (o) => {
      record('login')(o);
      o.success?.({ code: `code-${calls.login!.length}`, errMsg: 'login:ok' });
    },
    ...over,
  };
  return {
    api,
    calls,
    touch,
    lifecycle,
    interruption,
    store,
    files,
    audios,
    rewarded,
    interstitials,
    failingAudio,
    share: () => shareCb?.(),
    setWindowInfo: (info: MgWindowInfo) => (windowInfo = info),
  };
}

function setup(opts: MiniGameOptions = {}, over: Partial<MiniGameApi> = {}) {
  const fake = fakeApi(over);
  const platform = createMiniGamePlatform(fake.api, 'wx', opts);
  return { ...fake, platform };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).wx;
  delete (globalThis as Record<string, unknown>).tt;
  delete (globalThis as Record<string, unknown>).tap;
});

describe('screen', () => {
  it('reads window size, pixel ratio and safe-area insets', () => {
    const { platform } = setup();
    expect(platform.screen).toEqual({
      width: 390,
      height: 844,
      pixelRatio: 3,
      safeInsets: { top: 47, right: 0, bottom: 34, left: 0 },
    });
  });

  it('falls back to getSystemInfoSync, then to defaults', () => {
    const sys = setup({}, { getWindowInfo: undefined, getSystemInfoSync: () => ({ ...PORTRAIT, windowWidth: 360 }) });
    expect(sys.platform.screen.width).toBe(360);
    const none = setup({}, { getWindowInfo: () => { throw new Error('not supported'); } });
    expect(none.platform.screen).toMatchObject({ width: 375, height: 667, pixelRatio: 2 });
  });

  it('maps a portrait safe area onto a landscape window and falls back to the status bar', () => {
    const landscape: MgWindowInfo = { ...PORTRAIT, windowWidth: 844, windowHeight: 390 };
    expect(safeAreaInsets(landscape, 844, 390)).toEqual({ top: 0, right: 47, bottom: 0, left: 47 });
    const noSafeArea: MgWindowInfo = { ...PORTRAIT, safeArea: undefined };
    expect(safeAreaInsets(noSafeArea, 390, 844)).toEqual({ top: 47, right: 0, bottom: 0, left: 0 });
    expect(safeAreaInsets(undefined, 390, 844)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('re-reads the screen on window resize', () => {
    const { platform, lifecycle, setWindowInfo } = setup();
    const onResize = vi.fn();
    platform.onResize(onResize);
    setWindowInfo({ ...PORTRAIT, windowWidth: 800, windowHeight: 600, safeArea: undefined });
    for (const cb of lifecycle.resize) cb();
    expect(onResize).toHaveBeenCalledOnce();
    expect(platform.screen).toMatchObject({ width: 800, height: 600 });
  });
});

describe('touch', () => {
  it('translates changed touches of every phase', () => {
    const { platform, touch } = setup();
    const events: RawTouchEvent[] = [];
    platform.onTouch((e) => events.push(e));
    const other = { identifier: 9, clientX: 1, clientY: 1 };
    touch.start!({ touches: [other, { identifier: 3, clientX: 10, clientY: 20 }], changedTouches: [{ identifier: 3, clientX: 10, clientY: 20 }] });
    touch.move!({ touches: [], changedTouches: [{ identifier: 3, clientX: 12, clientY: 25 }, { identifier: 4, clientX: 50, clientY: 60 }] });
    touch.end!({ touches: [], changedTouches: [{ identifier: 3, pageX: 13, pageY: 26 } as never] });
    touch.cancel!({ touches: [], changedTouches: [{ identifier: 4, clientX: 50, clientY: 60 }] });
    touch.end!({ touches: [], changedTouches: [] });
    expect(events).toEqual([
      { phase: 'start', touches: [{ id: 3, x: 10, y: 20 }] },
      { phase: 'move', touches: [{ id: 3, x: 12, y: 25 }, { id: 4, x: 50, y: 60 }] },
      { phase: 'end', touches: [{ id: 3, x: 13, y: 26 }] },
      { phase: 'cancel', touches: [{ id: 4, x: 50, y: 60 }] },
    ]);
  });

  it('unsubscribes listeners', () => {
    const { platform, touch } = setup();
    const cb = vi.fn();
    const off = platform.onTouch(cb);
    off();
    touch.start!({ touches: [], changedTouches: [{ identifier: 0, clientX: 0, clientY: 0 }] });
    expect(cb).not.toHaveBeenCalled();
  });

  it('forwards show/hide', () => {
    const { platform, lifecycle } = setup();
    const show = vi.fn();
    const hide = vi.fn();
    platform.onShow(show);
    platform.onHide(hide);
    for (const cb of lifecycle.hide) cb();
    for (const cb of lifecycle.show) cb();
    expect(hide).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();
  });
});

describe('storage', () => {
  it('round-trips strings and tells missing keys from empty strings', () => {
    const { platform, store } = setup();
    const s = platform.storage;
    expect(s.get('best')).toBeNull();
    s.set('best', '42');
    s.set('empty', '');
    expect(s.get('best')).toBe('42');
    expect(s.get('empty')).toBe('');
    expect(s.keys().sort()).toEqual(['best', 'empty']);
    store.set('legacy', { v: 1 });
    expect(s.get('legacy')).toBe('{"v":1}');
    s.remove('best');
    expect(s.get('best')).toBeNull();
  });

  it('keeps working in memory without storage APIs and survives write failures', () => {
    const mem = setup({}, { getStorageSync: undefined, setStorageSync: undefined, removeStorageSync: undefined, getStorageInfoSync: undefined });
    mem.platform.storage.set('a', '1');
    expect(mem.platform.storage.get('a')).toBe('1');
    expect(mem.platform.storage.keys()).toEqual(['a']);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const full = setup({}, { setStorageSync: () => { throw { errMsg: 'setStorageSync:fail exceed storage max size 10MB' }; } });
    expect(() => full.platform.storage.set('a', 'x')).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exceed storage max size'));
  });

  it('reads the key list once and keeps it in step with set and remove', () => {
    const { platform, store, api } = setup();
    store.set('old', '');
    const info = api.getStorageInfoSync!;
    let infoCalls = 0;
    api.getStorageInfoSync = () => (infoCalls++, info());
    const s = platform.storage as MiniGameStorage;
    expect(s.get('old')).toBe('');
    for (let i = 0; i < 5; i++) expect(s.get(`missing${i}`)).toBeNull();
    s.set('empty', '');
    expect(s.get('empty')).toBe('');
    expect(s.keys().sort()).toEqual(['empty', 'old']);
    s.remove('empty');
    expect(s.get('empty')).toBeNull();
    expect(infoCalls).toBe(1);
    store.set('external', '');
    expect(s.get('external')).toBeNull();
    s.refresh();
    expect(s.get('external')).toBe('');
    expect(infoCalls).toBe(2);
  });

  it('re-reads the key list after a failed write', () => {
    const { platform, api, store } = setup();
    const s = platform.storage as MiniGameStorage;
    expect(s.keys()).toEqual([]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const write = api.setStorageSync!;
    api.setStorageSync = (key, data) => {
      write(key, data);
      throw { errMsg: 'setStorageSync:fail timeout' };
    };
    s.set('maybe', '');
    expect(store.has('maybe')).toBe(true);
    expect(s.get('maybe')).toBe('');
  });
});

describe('audio', () => {
  it('loads (waits for canplay), resolves asset paths and plays', async () => {
    const { platform, audios } = setup();
    await platform.audio.load('hit', 'sfx/hit.mp3');
    expect(platform.audio.isLoaded('hit')).toBe(true);
    expect(audios).toHaveLength(1);
    expect(audios[0]!.src).toBe('assets/sfx/hit.mp3');
    const inst = platform.audio.play('hit', { volume: 0.5, rate: 3 });
    expect(inst.playing).toBe(true);
    expect(audios[0]!.volume).toBe(0.5);
    expect(audios[0]!.playbackRate).toBe(2);
    expect(audios[0]!.log).toEqual(['play']);
    inst.stop();
    expect(inst.playing).toBe(false);
    expect(audios[0]!.log).toEqual(['play', 'stop']);
  });

  it('pools voices per key and steals the oldest non-looping voice', async () => {
    const { platform, audios } = setup({ audioVoices: 2 });
    await platform.audio.load('hit', 'hit.mp3');
    const a = platform.audio.play('hit');
    const b = platform.audio.play('hit');
    expect(platform.audio.voiceCount('hit')).toBe(2);
    const c = platform.audio.play('hit');
    expect(platform.audio.voiceCount('hit')).toBe(2);
    expect(audios[0]!.log).toEqual(['play', 'seek:0']);
    expect(a.playing).toBe(false);
    expect(b.playing && c.playing).toBe(true);
    a.stop();
    expect(audios[0]!.log).not.toContain('stop');

    audios[1]!.end();
    platform.audio.play('hit');
    expect(audios[1]!.log).toEqual(['play', 'play']);
    expect(platform.audio.voiceCount('hit')).toBe(2);
  });

  it('suspends, resumes and stops everything', async () => {
    const { platform, audios, interruption } = setup();
    await platform.audio.load('music', 'music.mp3');
    const m = platform.audio.play('music', { loop: true });
    expect(audios[0]!.loop).toBe(true);
    platform.audio.suspend();
    expect(audios[0]!.last()).toBe('pause');
    expect(m.playing).toBe(true);
    platform.audio.resume();
    expect(audios[0]!.last()).toBe('play');
    for (const cb of interruption.begin) cb();
    expect(audios[0]!.last()).toBe('pause');
    for (const cb of interruption.end) cb();
    expect(audios[0]!.last()).toBe('play');
    platform.audio.stopAll();
    expect(audios[0]!.last()).toBe('stop');
    expect(m.playing).toBe(false);
    platform.destroy();
    expect(audios[0]!.destroyed).toBe(true);
  });

  it('passes sfx options only to short, non-looping sounds', async () => {
    const { platform, audios, files } = setup({ sfxAudioOptions: { useWebAudioImplement: true }, longAudioBytes: 100 });
    files.set('assets/long.mp3', 'x'.repeat(500));
    await platform.audio.load('short', 'short.mp3');
    await platform.audio.load('long', 'long.mp3');
    platform.audio.play('short');
    platform.audio.play('short', { loop: true });
    platform.audio.play('short');
    const sfx = { useWebAudioImplement: true };
    expect(audios.map((a) => a.opts)).toEqual([sfx, undefined, undefined, sfx]);
  });

  it('picks the context kind from the stream hint and never loops a decoded sfx context', async () => {
    const { platform, audios, files } = setup({ sfxAudioOptions: { useWebAudioImplement: true }, longAudioBytes: 100 });
    files.set('assets/big.mp3', 'x'.repeat(500));
    await platform.audio.load('big', 'big.mp3', { stream: false });
    await platform.audio.load('theme', 'small.mp3', { stream: true });
    const sfx = { useWebAudioImplement: true };
    expect(audios.map((a) => a.opts)).toEqual([sfx, undefined]);

    const loop = platform.audio.play('big', { loop: true });
    expect(audios).toHaveLength(3);
    expect(audios[2]!.opts).toBeUndefined();
    expect(audios[0]!.log).toEqual([]);
    loop.stop();
    platform.audio.play('big');
    expect(audios[0]!.log).toEqual(['play']);
    platform.audio.play('big', { loop: true });
    expect(audios[2]!.log).toEqual(['play', 'stop', 'play']);
    expect(audios).toHaveLength(3);
  });

  it('unload destroys the contexts of a key and a later load starts over', async () => {
    const { platform, audios } = setup();
    await platform.audio.load('theme', 'theme.mp3', { stream: true });
    const m = platform.audio.play('theme', { loop: true });
    platform.audio.unload('theme');
    expect(audios[0]!.destroyed).toBe(true);
    expect(m.playing).toBe(false);
    expect(platform.audio.isLoaded('theme')).toBe(false);
    expect(platform.audio.voiceCount('theme')).toBe(0);
    m.stop();
    expect(audios[0]!.log).toEqual(['play']);
    await platform.audio.load('theme', 'theme.mp3', { stream: true });
    expect(audios).toHaveLength(2);
    expect(platform.audio.play('theme').playing).toBe(true);
  });

  it('writes loadPcm sounds as WAV files into USER_DATA_PATH', async () => {
    const { platform, files, audios } = setup();
    expect(platform.audio.loadPcm).toBeTypeOf('function');
    await platform.audio.loadPcm!('beep 1', new Float32Array([0, 0.5, -0.5, 1]), 44100);
    const wav = files.get('wxfile://usr/pcm-beep_1.wav') as ArrayBuffer;
    expect(wav.byteLength).toBe(44 + 8);
    platform.audio.play('beep 1');
    expect(audios[0]!.src).toBe('wxfile://usr/pcm-beep_1.wav');
  });

  it('settles load on decode errors and warns once for unknown keys', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { platform, failingAudio } = setup();
    failingAudio.add('assets/bad.mp3');
    await platform.audio.load('bad', 'bad.mp3');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('decode failed'));
    const inst = platform.audio.play('nope');
    platform.audio.play('nope');
    expect(inst.playing).toBe(false);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('"nope"'))).toHaveLength(1);
  });
});

describe('memory and frame rate', () => {
  it('forwards memory warnings, triggerGC, the preferred frame rate and innerAudioOption', () => {
    let warn: ((res?: { level?: number }) => void) | undefined;
    const gc = vi.fn();
    const fps = vi.fn();
    const audioOption = vi.fn();
    const { platform } = setup(
      { innerAudioOption: { obeyMuteSwitch: false } },
      { onMemoryWarning: (cb) => (warn = cb), triggerGC: gc, setPreferredFramesPerSecond: fps, setInnerAudioOption: audioOption },
    );
    expect(audioOption).toHaveBeenCalledOnce();
    expect(audioOption.mock.calls[0]![0]).toMatchObject({ obeyMuteSwitch: false });
    const infos: unknown[] = [];
    const off = platform.onMemoryWarning!((i) => infos.push(i));
    warn!({ level: 10 });
    warn!();
    off();
    warn!({ level: 15 });
    expect(infos).toEqual([{ level: 10 }, {}]);
    platform.triggerGC();
    expect(gc).toHaveBeenCalledOnce();
    expect(platform.setPreferredFramesPerSecond(29.6)).toBe(true);
    platform.setPreferredFramesPerSecond(0);
    platform.setPreferredFramesPerSecond(240);
    expect(fps.mock.calls.map((c) => c[0])).toEqual([30, 1, 60]);
  });

  it('degrades when the runtime lacks the APIs', () => {
    const audioOption = vi.fn();
    const { platform } = setup({}, { setInnerAudioOption: audioOption });
    expect(audioOption).not.toHaveBeenCalled();
    expect(platform.onMemoryWarning).toBeUndefined();
    expect(() => platform.triggerGC()).not.toThrow();
    expect(platform.setPreferredFramesPerSecond(30)).toBe(false);
    const throwing = setup({}, { setPreferredFramesPerSecond: () => { throw new Error('not supported'); } });
    expect(throwing.platform.setPreferredFramesPerSecond(30)).toBe(false);
  });
});

describe('rewarded ads', () => {
  it('resolves true when watched to the end and false when skipped', async () => {
    const { platform, rewarded } = setup();
    const watched = platform.ads.rewarded('unit-1');
    await flush();
    expect(rewarded[0]!.shows).toBe(1);
    rewarded[0]!.close({ isEnded: true });
    await expect(watched).resolves.toBe(true);

    const skipped = platform.ads.rewarded('unit-1');
    await flush();
    rewarded[0]!.close({ isEnded: false });
    await expect(skipped).resolves.toBe(false);
    expect(rewarded).toHaveLength(1);
  });

  it('loads and retries when show fails, and gives up when load fails', async () => {
    const { platform, rewarded } = setup();
    const retry = platform.ads.rewarded('unit-1');
    rewarded[0]!.showMode = 'reject-once';
    await flush();
    expect(rewarded[0]!.loads).toBe(1);
    expect(rewarded[0]!.shows).toBe(2);
    rewarded[0]!.close({ isEnded: true });
    await expect(retry).resolves.toBe(true);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const other = platform.ads.rewarded('unit-2');
    rewarded[1]!.showMode = 'reject';
    rewarded[1]!.loadFails = true;
    await expect(other).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no fill'));
  });

  it('resolves false on onError and for a second concurrent request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { platform, rewarded } = setup();
    const first = platform.ads.rewarded('unit-1');
    await expect(platform.ads.rewarded('unit-1')).resolves.toBe(false);
    await flush();
    rewarded[0]!.error({ errMsg: 'ad error', errCode: 1000 });
    await expect(first).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('understands Douyin count, old WeChat undefined results, and empty unit ids', async () => {
    expect(rewardWatched(undefined)).toBe(true);
    expect(rewardWatched({ isEnded: false, count: 1 })).toBe(true);
    expect(rewardWatched({ isEnded: true, count: 0 })).toBe(false);
    expect(rewardWatched({ isEnded: true })).toBe(true);
    const { platform, rewarded } = setup();
    await expect(platform.ads.rewarded('')).resolves.toBe(false);
    expect(rewarded).toHaveLength(0);
  });
});

describe('interstitial ads', () => {
  it('reuses one instance per unit id when asked to (wx)', async () => {
    const { platform, interstitials } = setup({ reuseInterstitial: true });
    for (let i = 0; i < 2; i++) {
      const p = platform.ads.interstitial('int-1');
      await flush();
      interstitials[0]!.close();
      await p;
    }
    expect(interstitials).toHaveLength(1);
    expect(interstitials[0]!.shows).toBe(2);
    expect(interstitials[0]!.destroyed).toBe(false);
  });

  it('creates a fresh instance per show and destroys it after close (tt/tap)', async () => {
    const { platform, interstitials } = setup({ reuseInterstitial: false });
    const p = platform.ads.interstitial('int-1');
    await flush();
    interstitials[0]!.close();
    await p;
    expect(interstitials[0]!.destroyed).toBe(true);
    const q = platform.ads.interstitial('int-1');
    await flush();
    interstitials[1]!.close();
    await q;
    expect(interstitials).toHaveLength(2);
  });

  it('resolves when the ad cannot be shown', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { platform, interstitials } = setup();
    const p = platform.ads.interstitial('int-1');
    interstitials[0]!.showFails = true;
    await expect(p).resolves.toBeUndefined();
  });
});

describe('share, vibrate, login', () => {
  it('enables the share menu with app defaults and merges share() options', () => {
    const { platform, calls, share } = setup({ share: { title: 'My Game', imageUrl: 'share.png' } });
    expect(calls.showShareMenu![0]).toMatchObject({ menus: ['shareAppMessage', 'shareTimeline'] });
    expect(share()).toEqual({ title: 'My Game', imageUrl: 'share.png' });
    platform.share({ title: 'Beat 42!', query: 'from=share' });
    expect(calls.shareAppMessage![0]).toMatchObject({ title: 'Beat 42!', imageUrl: 'share.png', query: 'from=share' });
  });

  it('vibrates with the configured arguments', () => {
    const { platform, calls } = setup({ vibrateShortArgs: { type: 'medium' } });
    platform.vibrate('short');
    platform.vibrate('long');
    expect(calls.vibrateShort![0]).toMatchObject({ type: 'medium' });
    expect(calls.vibrateLong).toHaveLength(1);
  });

  it('maps login success, failure and exceptions', async () => {
    await expect(setup().platform.login()).resolves.toEqual({ ok: true, code: 'code-1' });
    const fail = setup({}, { login: (o) => o.fail?.({ errMsg: 'login:fail auth deny' }) });
    await expect(fail.platform.login()).resolves.toEqual({ ok: false, error: 'login:fail auth deny' });
    const thrown = setup({}, { login: () => { throw new Error('boom'); } });
    await expect(thrown.platform.login()).resolves.toEqual({ ok: false, error: 'boom' });
  });
});

describe('files and clock', () => {
  it('reads text and images relative to the asset dir', async () => {
    const { platform, files } = setup({ assetBase: './res' });
    files.set('res/data/level.json', '{"n":1}');
    await expect(platform.readText('data/level.json')).resolves.toBe('{"n":1}');
    await expect(platform.readText('nope.txt')).rejects.toThrow('res/nope.txt');
    const img = await platform.loadImage('/img/a.png');
    expect((img as unknown as MgImage).src).toBe('res/img/a.png');
    await expect(platform.loadImage('missing.png')).rejects.toThrow('missing.png');
    const remote = await platform.loadImage('https://cdn.example.com/a.png');
    expect((remote as unknown as MgImage).src).toBe('https://cdn.example.com/a.png');
    expect(normalizeBase('assets')).toBe('assets/');
    expect(normalizeBase('')).toBe('');
  });

  it('creates offscreen canvases with the requested size', () => {
    const c = setup().platform.createCanvas(10.2, 0);
    expect([c.width, c.height]).toEqual([11, 1]);
  });

  it('converts getPerformance microseconds to milliseconds and detects millisecond runtimes', () => {
    let date = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => date);
    let us = 0;
    const micro = setup({}, { getPerformance: () => ({ now: () => us }) }).platform;
    us = 500_000;
    date += 500;
    expect(micro.now()).toBeCloseTo(500);
    us = 1_500_000;
    date += 1000;
    expect(micro.now()).toBeCloseTo(1500);

    let ms = 0;
    const milli = setup({}, { getPerformance: () => ({ now: () => ms }) }).platform;
    ms = 500;
    date += 500;
    const a = milli.now();
    ms = 1500;
    date += 1000;
    expect(milli.now() - a).toBeCloseTo(1000);
  });
});

describe('missing APIs', () => {
  it('runs on a runtime that only has createCanvas', async () => {
    const api: MiniGameApi = { createCanvas: () => ({ width: 1, height: 1, getContext: () => null }) };
    const p = createMiniGamePlatform(api, 'tt');
    expect(p.screen).toMatchObject({ width: 375, height: 667, pixelRatio: 2 });
    expect(p.now()).toBeTypeOf('number');
    p.storage.set('k', 'v');
    expect(p.storage.get('k')).toBe('v');
    expect(() => {
      p.vibrate('short');
      p.vibrate('long');
      p.share({ title: 'x' });
      p.audio.stopAll();
      p.audio.suspend();
      p.audio.resume();
    }).not.toThrow();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await p.audio.load('a', 'a.mp3');
    expect(p.audio.play('a').playing).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no createInnerAudioContext'));
    expect(p.audio.loadPcm).toBeUndefined();
    await expect(p.ads.rewarded('unit')).resolves.toBe(false);
    await expect(p.ads.interstitial('unit')).resolves.toBeUndefined();
    await expect(p.login()).resolves.toEqual({ ok: true });
    await expect(p.readText('a.txt')).rejects.toThrow('getFileSystemManager');
    await expect(p.loadImage('a.png')).rejects.toThrow('createImage');
  });

  it('swallows throwing optional APIs', async () => {
    const boom = () => {
      throw new Error('not supported on this base library');
    };
    const { platform } = setup({}, {
      vibrateShort: boom,
      showShareMenu: boom,
      onShareAppMessage: boom,
      onWindowResize: boom,
      createRewardedVideoAd: boom,
      getFileSystemManager: boom,
    });
    expect(() => platform.vibrate('short')).not.toThrow();
    await expect(platform.ads.rewarded('unit')).resolves.toBe(false);
  });

  it('rejects an object that is not a mini-game API', () => {
    expect(() => createMiniGamePlatform({} as MiniGameApi, 'wx')).toThrow(/wx: mini-game API object not found/);
  });
});

describe('platform factories', () => {
  it('createWxPlatform uses the global wx with WeChat defaults', async () => {
    const fake = fakeApi();
    (globalThis as Record<string, unknown>).wx = fake.api;
    const p = createWxPlatform();
    expect(p.name).toBe('wx');
    p.vibrate('short');
    expect(fake.calls.vibrateShort![0]).toMatchObject({ type: 'light' });
    await p.audio.load('hit', 'hit.mp3');
    expect(fake.audios[0]!.opts).toEqual({ useWebAudioImplement: true });
  });

  it('createTtPlatform calls vibrateShort without a type', () => {
    const fake = fakeApi();
    (globalThis as Record<string, unknown>).tt = fake.api;
    const p = createTtPlatform();
    expect(p.name).toBe('tt');
    p.vibrate('short');
    expect(fake.calls.vibrateShort![0]).not.toHaveProperty('type');
  });

  it('throws outside the runtime', () => {
    expect(() => createWxPlatform()).toThrow(/wx/);
    expect(() => createTtPlatform()).toThrow(/tt/);
    expect(() => createTapPlatform()).toThrow(/tap/);
  });

  it('createTapPlatform logs in at startup and hands that code to the first login()', async () => {
    const fake = fakeApi();
    (globalThis as Record<string, unknown>).tap = fake.api;
    const p = createTapPlatform();
    expect(fake.calls.login).toHaveLength(1);
    await expect(p.login()).resolves.toEqual({ ok: true, code: 'code-1' });
    expect(fake.calls.login).toHaveLength(1);
    await expect(p.login()).resolves.toEqual({ ok: true, code: 'code-2' });

    const manual = fakeApi();
    (globalThis as Record<string, unknown>).tap = manual.api;
    createTapPlatform({ autoLogin: false });
    expect(manual.calls.login).toBeUndefined();
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono header and resamples unsupported rates', () => {
    const wav = new DataView(encodeWav(new Float32Array([0, 1, -1]), 22050));
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(wav.buffer, o, 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(wav.getUint32(24, true)).toBe(22050);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getInt16(46, true)).toBe(0x7fff);
    expect(wav.getInt16(48, true)).toBe(-0x8000);

    const odd = new DataView(encodeWav(new Float32Array(1000), 30000));
    expect(odd.getUint32(24, true)).toBe(44100);
    expect(odd.getUint32(40, true)).toBe(Math.round((1000 * 44100) / 30000) * 2);
  });
});
