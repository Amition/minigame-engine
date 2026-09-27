import { describe, expect, it } from 'vitest';
import { createMiniGamePlatform, mgKeyCode } from './minigame';
import type { MiniGameApi } from './minigame-api';
import type { PlatformKeyEvent } from './types';

type KeyCb = (e: { key?: string; code?: string; timeStamp?: number }) => void;

function fakeApi(extra: Record<string, unknown> = {}) {
  const hide: (() => void)[] = [];
  const api = {
    createCanvas: () => ({ width: 300, height: 150, getContext: () => null }),
    onHide: (cb: () => void) => hide.push(cb),
    ...extra,
  } as unknown as MiniGameApi;
  return { api, hide: () => hide.forEach((cb) => cb()) };
}

describe('mini-game keyboard', () => {
  it('has no onKey without onKeyDown / onKeyUp (phones)', () => {
    const p = createMiniGamePlatform(fakeApi().api, 'wx');
    expect(p.onKey).toBeUndefined();
  });

  it('maps onKeyDown / onKeyUp to PlatformKeyEvents with repeat detection', () => {
    let down: KeyCb = () => {};
    let up: KeyCb = () => {};
    const { api, hide } = fakeApi({ onKeyDown: (cb: KeyCb) => (down = cb), onKeyUp: (cb: KeyCb) => (up = cb) });
    const p = createMiniGamePlatform(api, 'wx');
    const log: PlatformKeyEvent[] = [];
    const off = p.onKey!((e) => log.push(e));
    down({ key: 'a', code: 'KeyA', timeStamp: 1 });
    down({ key: 'a', code: 'KeyA', timeStamp: 2 });
    down({ key: ' ' });
    up({ key: 'a', code: 'KeyA' });
    up({ key: 'x', code: 'KeyX' });
    hide();
    off();
    down({ key: 'b', code: 'KeyB' });
    expect(log).toEqual([
      { type: 'down', code: 'KeyA', key: 'a', repeat: false },
      { type: 'down', code: 'KeyA', key: 'a', repeat: true },
      { type: 'down', code: 'Space', key: ' ', repeat: false },
      { type: 'up', code: 'KeyA', key: 'a', repeat: false },
      { type: 'up', code: 'Space', key: ' ', repeat: false },
    ]);
  });

  it('derives codes from keys when the host omits them', () => {
    expect(mgKeyCode('w')).toBe('KeyW');
    expect(mgKeyCode('7')).toBe('Digit7');
    expect(mgKeyCode('ArrowLeft')).toBe('ArrowLeft');
    expect(mgKeyCode('Esc')).toBe('Escape');
  });
});

describe('mini-game language', () => {
  it('prefers getAppBaseInfo, then getSystemInfoSync, normalizing zh_CN', () => {
    expect(createMiniGamePlatform(fakeApi({ getAppBaseInfo: () => ({ language: 'zh_CN' }) }).api, 'wx').language).toBe('zh-CN');
    expect(createMiniGamePlatform(fakeApi({ getSystemInfoSync: () => ({ language: 'en' }) }).api, 'tt').language).toBe('en');
    expect(createMiniGamePlatform(fakeApi().api, 'tap').language).toBeUndefined();
  });
});
