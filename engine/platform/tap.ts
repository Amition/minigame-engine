import { createMiniGamePlatform, type MiniGameOptions, type MiniGamePlatform } from './minigame';
import type { MiniGameApi } from './minigame-api';
import type { LoginResult } from './types';

declare const tap: MiniGameApi | undefined;

export interface TapPlatformOptions extends MiniGameOptions {
  /** Call tap.login() once at startup (default true). */
  autoLogin?: boolean;
}

/** tap.login codes are valid for 5 minutes and single-use; reuse the startup code only while clearly fresh. */
const CODE_TTL_MS = 4 * 60 * 1000;

/**
 * TapTap mini-game platform.
 * Docs: https://developer.taptap.cn/minigameapidoc/
 *
 * Login is mandatory: the review rules (5.2.4) require "TapTap 登录" to be integrated in every uploaded package.
 * The API is `tap.login({ success(res) { res.code }, fail(err) { err.errMsg } })` (callback style only, no
 * Promise; optional `timeout` ms). The code is valid for 5 minutes and single-use; the game server exchanges it via
 *   GET https://cloud-miniapp.tapapis.cn/auth/v1/jscode2session?appid=APPID&secret=SECRET&js_code=CODE&grant_type=authorization_code
 * for { openid, unionid?, session_key }. tap.checkSession() tells whether the session is still valid.
 * With autoLogin (default) the platform logs in at startup so the package always integrates login; the first
 * platform.login() call within 4 minutes returns that result instead of requesting a second code.
 *
 * Other differences: tap.vibrateShort requires { type } like wx; tap.createInterstitialAd returns a new
 * instance per call (created per show, destroyed after close); rewarded videos are singletons with
 * onClose({ isEnded }); share content comes from tap.onShareAppMessage (title/desc/query, templates are set up in
 * the TapTap console); game.json deviceOrientation defaults differ between TapTap doc pages, so always set it.
 */
export function createTapPlatform(opts: TapPlatformOptions = {}): MiniGamePlatform {
  if (typeof tap === 'undefined') throw new Error('createTapPlatform: global `tap` not found (not a TapTap mini-game runtime)');
  const { autoLogin = true, ...rest } = opts;
  const p = createMiniGamePlatform(tap, 'tap', {
    vibrateShortArgs: { type: 'light' },
    reuseInterstitial: false,
    ...rest,
  });
  if (autoLogin) {
    const started = p.now();
    const login = p.login.bind(p);
    let first: Promise<LoginResult> | null = login();
    void first.then((r) => {
      if (!r.ok) console.warn(`[tap] login failed: ${r.error ?? 'unknown error'}`);
    });
    p.login = () => {
      const cached = first;
      first = null;
      return cached && p.now() - started < CODE_TTL_MS ? cached : login();
    };
  }
  return p;
}
