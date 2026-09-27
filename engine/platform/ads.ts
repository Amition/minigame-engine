import { hasPlatform, platform } from './current';
import type { PlatformName } from './types';

/** Ad placement key in app.json `ads.<platform>`. rewarded / interstitial are the usual ones; any key works. */
export type AdKind = 'rewarded' | 'interstitial' | 'banner' | (string & {});

/** Ad unit ids of one platform by kind, e.g. `{ "rewarded": "adunit-123", "revive": "adunit-456" }`. */
export interface AdUnits {
  rewarded?: string;
  interstitial?: string;
  banner?: string;
  [kind: string]: string | undefined;
}

/** app.json `ads`: unit ids per platform (wx, tt, tap; 233 builds run the wx platform). */
export type AdsConfig = Partial<Record<PlatformName, AdUnits>>;

/**
 * `<app>/app.json` (store metadata, appids, ad unit ids, share text). Mirrors AppMeta in tools/build/config.ts,
 * which the engine can't import. JSON imports are typed loosely: `const app = appJson as AppJsonConfig`.
 */
export interface AppJsonConfig {
  name: string;
  version?: string;
  orientation: 'portrait' | 'landscape';
  /** Page / loading background (web index.html). */
  background?: string;
  appid?: Partial<Record<'wx' | 'tt' | 'tap', string>>;
  ads?: AdsConfig;
  /** Passive share (menu) content on mini-games. */
  share?: { title?: string; imageUrl?: string; query?: string };
}

/** What configureAds() accepts: AdsConfig or the object type TypeScript infers for a JSON import. */
export type AdsConfigInput = { readonly [platform: string]: { readonly [kind: string]: string | undefined } | undefined };

let units: Record<string, AdUnits> = {};
let showing = false;

/** Sets the ad unit ids (replacing earlier ones), usually once at boot: `configureAds(appJson.ads)`. */
export function configureAds(ads: AdsConfigInput | null | undefined): void {
  units = {};
  if (!ads) return;
  for (const [name, list] of Object.entries(ads)) if (list && typeof list === 'object') units[name] = { ...list };
}

/** Unit id of `kind` on the current platform (or `platformName`); '' when not configured. */
export function adUnitId(kind: AdKind = 'rewarded', platformName?: PlatformName): string {
  const name = platformName ?? (hasPlatform() ? platform().name : null);
  return (name && units[name]?.[kind]) || '';
}

/** True on web and headless, whose AdService simulates ads (no unit id needed). */
export function adsSimulated(): boolean {
  if (!hasPlatform()) return false;
  const name = platform().name;
  return name === 'web' || name === 'headless';
}

/**
 * Whether an ad of `kind` can be offered now (e.g. show a "watch ad to revive" button): the current platform has
 * a unit id for it and an ad service (web / headless simulate ads without ids), and no other ad is showing.
 * The platform AdService shows rewarded and interstitial formats only.
 */
export function canShowAd(kind: AdKind = 'rewarded'): boolean {
  if (showing || !hasPlatform() || !platform().ads) return false;
  return adsSimulated() || adUnitId(kind) !== '';
}

/** True while showRewardedAd() / showInterstitialAd() waits for an ad to close. */
export function isAdShowing(): boolean {
  return showing;
}

/**
 * Shows a rewarded video for the unit of `kind`. Resolves true only if it was watched to the end; false when no
 * ad is available, another one is showing, it was skipped or it failed (never rejects):
 * `if (await showRewardedAd()) revive(); else showToast('...')`.
 */
export async function showRewardedAd(kind: AdKind = 'rewarded'): Promise<boolean> {
  if (!canShowAd(kind)) return false;
  showing = true;
  try {
    return (await platform().ads.rewarded(adUnitId(kind))) === true;
  } catch {
    return false;
  } finally {
    showing = false;
  }
}

/** Shows an interstitial for the unit of `kind`; resolves when it closed, failed or none was available (never rejects). */
export async function showInterstitialAd(kind: AdKind = 'interstitial'): Promise<void> {
  if (!canShowAd(kind)) return;
  showing = true;
  try {
    await platform().ads.interstitial(adUnitId(kind));
  } catch {
    // no ad: carry on
  } finally {
    showing = false;
  }
}
