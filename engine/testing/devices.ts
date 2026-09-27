import type { Insets } from '../core/math';

export interface DeviceSpec {
  width: number;
  height: number;
  pixelRatio: number;
  safeInsets: Insets;
}

/** Common phone profiles (CSS px). pixelRatio is capped at 2 to keep screenshots small. */
export const devices = {
  /** Small classic iPhone, 16:9. */
  'iphone-se': { width: 375, height: 667, pixelRatio: 2, safeInsets: { top: 20, right: 0, bottom: 0, left: 0 } },
  /** Notched iPhone, ~19.5:9. Default. */
  'iphone-14': { width: 390, height: 844, pixelRatio: 2, safeInsets: { top: 47, right: 0, bottom: 34, left: 0 } },
  'iphone-15-pro-max': {
    width: 430,
    height: 932,
    pixelRatio: 2,
    safeInsets: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  /** Tall Android, 20:9. */
  android: { width: 360, height: 800, pixelRatio: 2, safeInsets: { top: 32, right: 0, bottom: 0, left: 0 } },
  /** Tablet, 4:3. */
  ipad: { width: 768, height: 1024, pixelRatio: 2, safeInsets: { top: 24, right: 0, bottom: 20, left: 0 } },
} satisfies Record<string, DeviceSpec>;

export type DeviceName = keyof typeof devices;

/** Accepts a device name or 'WIDTHxHEIGHT[@DPR]' (e.g. '414x896@2'). */
export function resolveDevice(d: DeviceName | string | DeviceSpec | undefined): DeviceSpec {
  if (!d) return devices['iphone-14'];
  if (typeof d !== 'string') return d;
  if (d in devices) return devices[d as DeviceName];
  const m = /^(\d+)x(\d+)(?:@(\d+(?:\.\d+)?))?$/.exec(d);
  if (!m) throw new Error(`unknown device "${d}" (use ${Object.keys(devices).join(', ')} or WxH@dpr)`);
  return {
    width: +m[1]!,
    height: +m[2]!,
    pixelRatio: m[3] ? +m[3] : 2,
    safeInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}
