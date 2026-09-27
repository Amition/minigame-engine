import { createMiniGamePlatform, type MiniGameOptions, type MiniGamePlatform } from './minigame';
import type { MiniGameApi } from './minigame-api';

declare const wx: MiniGameApi | undefined;

/**
 * WeChat mini-game platform. The 233乐园 build uses it too: its host runs converted wx packages.
 * Docs: https://developers.weixin.qq.com/minigame/dev/api/
 *
 * wx specifics encoded here:
 * - wx.vibrateShort needs { type: 'heavy' | 'medium' | 'light' } (base lib 2.13.0+), otherwise it fails.
 * - wx.createInnerAudioContext({ useWebAudioImplement: true }) (2.19.0+) lowers latency for short, frequent
 *   sounds; long files (music) keep the default decoder to save memory.
 * - Interstitial ads are created once per unit id and reused; rewarded videos are singletons per unit id.
 * - getWindowInfo (2.20.1+) replaces the deprecated getSystemInfoSync; Performance.now() is in microseconds.
 * - wx.login returns a code only; no login is required to run.
 */
export function createWxPlatform(opts: MiniGameOptions = {}): MiniGamePlatform {
  if (typeof wx === 'undefined') throw new Error('createWxPlatform: global `wx` not found (not a WeChat mini-game runtime)');
  return createMiniGamePlatform(wx, 'wx', {
    vibrateShortArgs: { type: 'light' },
    sfxAudioOptions: { useWebAudioImplement: true },
    reuseInterstitial: true,
    ...opts,
  });
}
