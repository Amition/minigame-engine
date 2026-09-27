import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindTr,
  clearI18nMissing,
  configureI18n,
  defineStrings,
  detectLocale,
  getLocale,
  hasTr,
  i18nChain,
  i18nLocales,
  i18nMissing,
  i18nUntranslated,
  matchLocale,
  Node,
  normalizeLocale,
  onLocaleChange,
  resetI18n,
  setLocale,
  tr,
  type I18nChange,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

let t: TestGame | null = null;

beforeEach(() => {
  resetI18n();
  configureI18n({ warn: false });
  defineStrings({
    en: {
      play: 'Play',
      hi: 'Hi {name}, you have {count} lives',
      coins: { one: '{count} coin', other: '{count} coins' },
      lives: { zero: 'No lives', one: 'One life', other: '{count} lives' },
      menu: { settings: { title: 'Settings' } },
      onlyEn: 'English only',
    },
    'zh-CN': {
      play: '\u5f00\u59cb',
      hi: '\u4f60\u597d {name}\uff0c\u8fd8\u6709 {count} \u6761\u547d',
      coins: '{count} \u4e2a\u91d1\u5e01',
      menu: { settings: { title: '\u8bbe\u7f6e' } },
    },
  });
});

afterEach(() => {
  t?.destroy();
  t = null;
  resetI18n();
});

describe('tr', () => {
  it('interpolates {name} placeholders and keeps unknown ones', () => {
    expect(tr('hi', { name: 'Ann', count: 3 })).toBe('Hi Ann, you have 3 lives');
    expect(tr('hi', { name: 'Ann' })).toBe('Hi Ann, you have {count} lives');
    expect(tr('play')).toBe('Play');
  });

  it('flattens nested tables to dotted keys', () => {
    expect(tr('menu.settings.title')).toBe('Settings');
    setLocale('zh-CN');
    expect(tr('menu.settings.title')).toBe('\u8bbe\u7f6e');
  });

  it('picks plural forms by count', () => {
    expect(tr('coins', { count: 1 })).toBe('1 coin');
    expect(tr('coins', { count: 5 })).toBe('5 coins');
    expect(tr('coins', { count: 0 })).toBe('0 coins');
    expect(tr('lives', { count: 0 })).toBe('No lives');
    expect(tr('lives', { count: 1 })).toBe('One life');
    expect(tr('lives', { count: 2 })).toBe('2 lives');
    expect(tr('coins')).toBe('{count} coins');
    setLocale('zh-CN');
    expect(tr('coins', { count: 1 })).toBe('1 \u4e2a\u91d1\u5e01');
  });

  it('falls back en-US → en → fallback and returns the key when nothing matches', () => {
    setLocale('en-US');
    expect(i18nChain()).toEqual(['en-US', 'en']);
    expect(tr('play')).toBe('Play');
    expect(i18nMissing()).toEqual([]);
    setLocale('zh-CN');
    expect(i18nChain()).toEqual(['zh-CN', 'zh', 'en']);
    expect(tr('onlyEn')).toBe('English only');
    expect(tr('nope.key')).toBe('nope.key');
    expect(i18nMissing()).toEqual(['zh-CN:nope.key', 'zh-CN:onlyEn']);
    expect(hasTr('onlyEn')).toBe(true);
    expect(hasTr('nope.key')).toBe(false);
    clearI18nMissing();
    expect(i18nMissing()).toEqual([]);
  });

  it('resolves a bare or regional language to a defined sibling', () => {
    setLocale('zh');
    expect(tr('play')).toBe('\u5f00\u59cb');
    setLocale('zh-SG');
    expect(tr('play')).toBe('\u5f00\u59cb');
    defineStrings({ 'zh-TW': { play: '\u958b\u59cb' } });
    setLocale('zh-HK');
    expect(tr('play')).toBe('\u958b\u59cb');
    setLocale('fr-FR');
    expect(tr('play')).toBe('Play');
  });

  it('warns once per missing key and calls onMissing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    configureI18n({ warn: true, onMissing: (key, locale) => seen.push(`${locale}/${key}`) });
    tr('ghost');
    tr('ghost');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('ghost');
    expect(seen).toEqual(['en/ghost']);
    warn.mockRestore();
  });

  it('lists untranslated keys of a whole table', () => {
    expect(i18nUntranslated('zh-CN')).toEqual(['lives', 'onlyEn']);
    expect(i18nUntranslated('en')).toEqual([]);
    expect(i18nLocales()).toEqual(['en', 'zh-CN']);
  });

  it('normalizes and matches locale tags', () => {
    expect(normalizeLocale('zh_cn')).toBe('zh-CN');
    expect(normalizeLocale('ZH-hant-tw')).toBe('zh-Hant-TW');
    expect(matchLocale('en-GB')).toBe('en');
    expect(matchLocale('zh_CN')).toBe('zh-CN');
    expect(matchLocale('ja-JP')).toBe('en');
    expect(matchLocale('')).toBe('en');
    configureI18n({ fallback: 'zh-CN' });
    expect(matchLocale('ja')).toBe('zh-CN');
  });
});

describe('locale changes', () => {
  it('emits change events only when the locale changes and drops owner listeners', () => {
    const log: I18nChange[] = [];
    const owner = new Node();
    const off = onLocaleChange((e) => log.push(e));
    onLocaleChange((e) => log.push({ ...e, locale: `owned:${e.locale}` }), owner);
    expect(setLocale('zh-CN')).toBe('zh-CN');
    setLocale('zh-CN');
    expect(getLocale()).toBe('zh-CN');
    owner.destroy();
    setLocale('en');
    off();
    setLocale('zh-CN');
    expect(log).toEqual([
      { locale: 'zh-CN', previous: 'en' },
      { locale: 'owned:zh-CN', previous: 'en' },
      { locale: 'en', previous: 'zh-CN' },
    ]);
  });

  it('bindTr keeps a text node translated until it is destroyed', () => {
    let lives = 3;
    const label = Object.assign(new Node(), { text: '' });
    bindTr(label, 'hi', () => ({ name: 'Bo', count: lives }));
    expect(label.text).toBe('Hi Bo, you have 3 lives');
    lives = 2;
    setLocale('zh-CN');
    expect(label.text).toBe('\u4f60\u597d Bo\uff0c\u8fd8\u6709 2 \u6761\u547d');
    label.destroy();
    setLocale('en');
    expect(label.text).toBe('\u4f60\u597d Bo\uff0c\u8fd8\u6709 2 \u6761\u547d');
  });
});

describe('detectLocale', () => {
  it('matches the platform language', async () => {
    t = await createTestGame();
    expect(t.platform.language).toBe('zh-CN');
    expect(detectLocale()).toBe('zh-CN');
    t.platform.language = 'en-GB';
    expect(detectLocale()).toBe('en');
    t.platform.language = 'zh_TW';
    expect(detectLocale()).toBe('zh-CN');
    t.platform.language = 'de';
    expect(setLocale('auto')).toBe('en');
    t.platform.language = 'zh-Hans-CN';
    expect(setLocale('auto')).toBe('zh-CN');
    expect(tr('play')).toBe('\u5f00\u59cb');
  });

  it('falls back without a platform', () => {
    expect(detectLocale()).toBe('en');
  });
});

describe('sandbox i18n scene', () => {
  it('auto-detects the language and rebuilds on SegmentedControl changes', async () => {
    t = await createTestGame({ app: sandbox, scene: 'i18n' });
    const text = (sel: string) => t!.get<Node & { text: string }>(sel).text;
    expect(getLocale()).toBe('zh-CN');
    expect(text('#greeting')).toBe('\u6b22\u8fce\u56de\u6765\uff0c\u8239\u957f\uff01');
    expect(text('#fallback')).toContain('English');
    expect(text('#missing')).toContain('zh-CN:demo.fallback');
    await t.tap('Segment[text=English]');
    expect(getLocale()).toBe('en');
    expect(text('#greeting')).toBe('Welcome back, Captain!');
    expect(text('#coins-1')).toBe('You found 1 coin');
    expect(text('#coins-5')).toBe('You found 5 coins');
    expect(t.findAll('SegmentedControl')).toHaveLength(1);
  });
});
