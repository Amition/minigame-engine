import { afterEach, describe, expect, it } from 'vitest';
import {
  adsSimulated,
  adUnitId,
  canShowAd,
  configureAds,
  isAdShowing,
  setPlatform,
  showInterstitialAd,
  showRewardedAd,
  type AppJsonConfig,
  type Platform,
} from '@engine';
import { createTestGame, HeadlessPlatform, type TestGame } from '@engine/testing';
import gameApp from '../game/app.json';

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
  configureAds(null);
});

/** A headless platform that reports itself as a mini-game (unit ids required). */
const asMiniGame = (p: HeadlessPlatform, name: 'wx' | 'tt' | 'tap'): Platform => Object.assign(Object.create(p) as Platform, { name });

describe('ads helper', () => {
  it('types app.json and reads unit ids per platform', async () => {
    const app: AppJsonConfig = gameApp as AppJsonConfig;
    expect(app.orientation).toBe('portrait');
    configureAds(gameApp.ads);
    configureAds({ wx: { rewarded: 'wx-r', revive: 'wx-revive' }, tt: { interstitial: 'tt-i' } });
    expect(adUnitId('rewarded', 'wx')).toBe('wx-r');
    expect(adUnitId('revive', 'wx')).toBe('wx-revive');
    expect(adUnitId('interstitial', 'wx')).toBe('');
    expect(adUnitId('interstitial', 'tt')).toBe('tt-i');
    expect(adUnitId()).toBe('');
    configureAds(undefined);
    expect(adUnitId('rewarded', 'wx')).toBe('');
  });

  it('simulates ads on headless: always offered, rewarded result from the platform', async () => {
    t = await createTestGame();
    expect(adsSimulated()).toBe(true);
    expect(canShowAd()).toBe(true);
    expect(await showRewardedAd()).toBe(true);
    t.platform.ads.rewardedResult = false;
    expect(await showRewardedAd()).toBe(false);
    await showInterstitialAd();
    expect(t.platform.ads.calls).toEqual(['rewarded:', 'rewarded:', 'interstitial:']);
    configureAds({ headless: { rewarded: 'h-1' } });
    await showRewardedAd();
    expect(t.platform.ads.calls[3]).toBe('rewarded:h-1');
  });

  it('on mini-games offers only kinds with a unit id and passes the id to the AdService', async () => {
    t = await createTestGame();
    setPlatform(asMiniGame(t.platform, 'wx'));
    expect(adsSimulated()).toBe(false);
    expect(canShowAd('rewarded')).toBe(false);
    expect(await showRewardedAd()).toBe(false);
    await showInterstitialAd();
    expect(t.platform.ads.calls).toEqual([]);
    configureAds({ wx: { rewarded: 'adunit-r', revive: 'adunit-rv', interstitial: 'adunit-i' }, tt: { rewarded: 'tt-r' } });
    expect(canShowAd('rewarded')).toBe(true);
    expect(await showRewardedAd('revive')).toBe(true);
    await showInterstitialAd();
    expect(t.platform.ads.calls).toEqual(['rewarded:adunit-rv', 'interstitial:adunit-i']);
    setPlatform(asMiniGame(t.platform, 'tap'));
    expect(canShowAd()).toBe(false);
  });

  it('allows one ad at a time and never rejects', async () => {
    t = await createTestGame();
    let finish!: (ok: boolean) => void;
    t.platform.ads.rewarded = () => new Promise<boolean>((r) => (finish = r));
    const first = showRewardedAd();
    expect(isAdShowing()).toBe(true);
    expect(canShowAd()).toBe(false);
    expect(await showRewardedAd()).toBe(false);
    finish(true);
    expect(await first).toBe(true);
    expect(isAdShowing()).toBe(false);
    t.platform.ads.rewarded = () => Promise.reject(new Error('no fill'));
    t.platform.ads.interstitial = () => Promise.reject(new Error('no fill'));
    expect(await showRewardedAd()).toBe(false);
    await expect(showInterstitialAd()).resolves.toBeUndefined();
    expect(isAdShowing()).toBe(false);
  });

  it('offers nothing without a platform', () => {
    setPlatform(null);
    expect(canShowAd()).toBe(false);
    expect(adsSimulated()).toBe(false);
    expect(adUnitId()).toBe('');
  });
});
