import { createMiniGamePlatform, type MiniGameOptions, type MiniGamePlatform } from './minigame';
import type { MiniGameApi } from './minigame-api';

declare const tt: MiniGameApi | undefined;

/**
 * Douyin (ByteDance) mini-game platform.
 * Docs: https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/overview
 *
 * Differences from wx encoded here / in minigame.ts:
 * - tt.vibrateShort takes no `type` (Android 30 ms, iOS 15 ms); some devices fall back to vibrateLong.
 * - tt.createInnerAudioContext() takes no options (no useWebAudioImplement); playbackRate needs base lib 2.33.0;
 *   only 8/11.025/16/22.05/24/32/44.1/48 kHz audio plays (encodeWav resamples synthesized PCM).
 * - RewardedVideoAd.onClose reports `count` (videos fully watched, multiton mode) next to isEnded; count wins.
 *   When no ad is available (error 1004) Douyin may open a share dialog instead and report count 1.
 * - An InterstitialAd instance can be shown only once: a new one is created per show and destroyed after close
 *   (destroy fails for never-shown ads). The platform rejects interstitials in the first 30 s after launch and
 *   within 60 s of the previous interstitial / rewarded video; those rejections resolve interstitial() quietly.
 * - tt.login defaults to force: true, which opens the host app's login dialog for logged-out users
 *   (success then carries `code`; `anonymousCode` is always present). Pass loginArgs: { force: false } for silent.
 * - tt.getPerformance().now() is in microseconds; getWindowInfo only exists on newer base libs
 *   (getSystemInfoSync fallback, safeArea since 1.51.0).
 * - Package: game.js + game.json + project.config.json; 20 MB total without subpackages, 4 MB main package with.
 */
export function createTtPlatform(opts: MiniGameOptions = {}): MiniGamePlatform {
  if (typeof tt === 'undefined') throw new Error('createTtPlatform: global `tt` not found (not a Douyin mini-game runtime)');
  return createMiniGamePlatform(tt, 'tt', {
    reuseInterstitial: false,
    ...opts,
  });
}
