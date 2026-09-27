import { Emitter } from '../core/emitter';
import { hasPlatform, platform } from '../platform/current';
import type { Node } from '../scene/node';
import { disposeWith } from './events';

// Localization: string tables per locale, tr(key, params) with {name} interpolation and plural forms, a fallback
// chain ('en-US' → 'en' → fallback), missing-key reporting and locale change events. State is app-wide (like the
// `events` bus); tests call resetI18n() between cases.

/** Plural variants picked by `params.count` (CLDR categories; only `other` is required). */
export interface I18nPluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/** Strings of one locale. Nested objects become dotted keys: `{ menu: { play: 'Play' } }` → 'menu.play'. */
export interface I18nTable {
  [key: string]: string | I18nPluralForms | I18nTable;
}

export type I18nParams = Record<string, string | number | boolean | null | undefined>;

export interface I18nChange {
  locale: string;
  previous: string;
}

export interface I18nConfig {
  /** Last resort of every lookup, also what detectLocale() returns without a match (default 'en'). */
  fallback?: string;
  /** console.warn once per missing locale + key (default true). */
  warn?: boolean;
  /** Called once per newly missing locale + key. */
  onMissing?: ((key: string, locale: string) => void) | null;
}

type Entry = string | I18nPluralForms;

const PLURAL_KEYS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

const tables = new Map<string, Map<string, Entry>>();
const missing = new Set<string>();
const bus = new Emitter<{ change: I18nChange }>();
const pluralRules = new Map<string, { select(n: number): string } | null>();
let current = 'en';
let fallback = 'en';
let warn = true;
let onMissing: ((key: string, locale: string) => void) | null = null;
let chainCache: { all: string[]; own: number } | null = null;

/** 'zh_cn' → 'zh-CN', 'ZH-hant-tw' → 'zh-Hant-TW', 'EN' → 'en'. */
export function normalizeLocale(tag: string): string {
  return tag
    .trim()
    .replace(/_/g, '-')
    .split('-')
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.toLowerCase() : p.length === 4 ? p[0]!.toUpperCase() + p.slice(1).toLowerCase() : p.length <= 3 ? p.toUpperCase() : p))
    .join('-');
}

/** 'zh-Hant-TW' → ['zh-Hant-TW', 'zh-Hant', 'zh']. */
function parents(tag: string): string[] {
  const parts = tag.split('-');
  const out: string[] = [];
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join('-'));
  return out;
}

const isTraditionalZh = (tag: string) => /^zh-(?:Hant|TW|HK|MO)\b/.test(tag);

/** Defined locale of the same language when none of the tag's parents is defined ('zh' → 'zh-CN'). */
function sibling(tag: string, available: readonly string[]): string | undefined {
  const lang = tag.split('-')[0]!;
  const same = available.filter((l) => l.split('-')[0] === lang);
  if (lang === 'zh') return same.find((l) => isTraditionalZh(l) === isTraditionalZh(tag)) ?? same[0];
  return same[0];
}

function ownChain(tag: string): string[] {
  const p = parents(tag);
  if (!p.some((t) => tables.has(t))) {
    const s = sibling(tag, [...tables.keys()]);
    if (s) p.push(s);
  }
  return p;
}

function chain(): { all: string[]; own: number } {
  if (chainCache) return chainCache;
  const own = ownChain(current);
  const all = [...new Set([...own, ...ownChain(fallback)])];
  return (chainCache = { all, own: own.length });
}

function isPluralForms(v: object): v is I18nPluralForms {
  const o = v as Record<string, unknown>;
  return typeof o.other === 'string' && Object.keys(o).every((k) => PLURAL_KEYS.has(k) && typeof o[k] === 'string');
}

function flatten(src: I18nTable, prefix: string, out: Map<string, Entry>): void {
  for (const k of Object.keys(src)) {
    const v = src[k];
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else if (v && typeof v === 'object') {
      if (isPluralForms(v)) out.set(key, { ...v });
      else flatten(v as I18nTable, key, out);
    }
  }
}

function pluralCategory(n: number, locale: string): string {
  let rules = pluralRules.get(locale);
  if (rules === undefined) {
    rules = null;
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function') rules = new Intl.PluralRules(locale);
    } catch {
      rules = null;
    }
    pluralRules.set(locale, rules);
  }
  // Runtimes without Intl (some mini-game JS engines) get the English rule.
  return rules ? rules.select(n) : Math.abs(n) === 1 ? 'one' : 'other';
}

function pickPlural(forms: I18nPluralForms, count: unknown, locale: string): string {
  const n = typeof count === 'number' ? count : Number(count);
  if (count === undefined || count === null || !Number.isFinite(n)) return forms.other;
  if (n === 0 && forms.zero !== undefined) return forms.zero;
  return forms[pluralCategory(n, locale) as keyof I18nPluralForms] ?? forms.other;
}

function interpolate(text: string, params: I18nParams): string {
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? m : String(v);
  });
}

function reportMissing(key: string, locale: string): void {
  const id = `${locale}:${key}`;
  if (missing.has(id)) return;
  missing.add(id);
  if (warn) console.warn(`[i18n] missing "${key}" for ${locale}`);
  onMissing?.(key, locale);
}

/**
 * Registers (merges) string tables per locale; later definitions override earlier ones key by key.
 *
 *     defineStrings({
 *       en: { play: 'Play', coins: { one: '{count} coin', other: '{count} coins' }, hi: 'Hi {name}!' },
 *       'zh-CN': { play: '\u5f00\u59cb', coins: '{count} \u4e2a\u91d1\u5e01', hi: '\u4f60\u597d\uff0c{name}\uff01' },
 *     });
 */
export function defineStrings(locales: Record<string, I18nTable>): void {
  for (const raw of Object.keys(locales)) {
    const loc = normalizeLocale(raw);
    if (!loc) continue;
    let t = tables.get(loc);
    if (!t) tables.set(loc, (t = new Map()));
    flatten(locales[raw]!, '', t);
  }
  chainCache = null;
}

/**
 * Translates `key` in the current locale: `{name}` placeholders are replaced from params, plural forms are picked by
 * `params.count`. Falls back along 'en-US' → 'en' → any 'en-*' → fallback locale; a key found nowhere returns the key
 * itself. Keys that are missing in the current locale are reported (see i18nMissing()).
 */
export function tr(key: string, params?: I18nParams): string {
  const c = chain();
  for (let i = 0; i < c.all.length; i++) {
    const loc = c.all[i]!;
    const entry = tables.get(loc)?.get(key);
    if (entry === undefined) continue;
    if (i >= c.own) reportMissing(key, current);
    const text = typeof entry === 'string' ? entry : pickPlural(entry, params?.count, loc);
    return params ? interpolate(text, params) : text;
  }
  reportMissing(key, current);
  return key;
}

/** True if `key` resolves in the current locale chain (fallback included). */
export function hasTr(key: string): boolean {
  return chain().all.some((l) => tables.get(l)?.has(key));
}

/** Switches the locale ('auto' = detectLocale()). Emits a change event when it differs. Returns the new locale. */
export function setLocale(locale: string): string {
  const next = locale === 'auto' ? detectLocale() : normalizeLocale(locale) || fallback;
  if (next === current) return current;
  const previous = current;
  current = next;
  chainCache = null;
  bus.emit('change', { locale: next, previous });
  return next;
}

/** The current locale as set (normalized), e.g. 'en-US'. */
export function getLocale(): string {
  return current;
}

/** Calls fn after every locale change (rebuild screens here). Removed with `owner` when given. */
export function onLocaleChange(fn: (e: I18nChange) => void, owner?: Node): () => void {
  const off = bus.on('change', fn);
  return owner ? disposeWith(owner, off) : off;
}

/**
 * Keeps `node.text` translated: sets it now and again on every locale change, until the node is destroyed.
 * `params` may be a function for values that change (read at each update).
 */
export function bindTr(node: Node & { text: string }, key: string, params?: I18nParams | (() => I18nParams)): () => void {
  const apply = () => {
    node.text = tr(key, typeof params === 'function' ? params() : params);
  };
  apply();
  return disposeWith(node, bus.on('change', apply));
}

/**
 * Best defined locale for a requested tag: exact or parent ('en-US' → 'en'), then same language ('zh' → 'zh-CN';
 * 'zh-TW' prefers 'zh-Hant' / 'zh-TW' / 'zh-HK'), else the fallback.
 */
export function matchLocale(requested: string, available: readonly string[] = i18nLocales()): string {
  const req = normalizeLocale(requested);
  const avail = available.map(normalizeLocale);
  if (!req) return fallback;
  for (const p of parents(req)) if (avail.includes(p)) return p;
  return sibling(req, avail) ?? fallback;
}

/** Locale matching the platform's system language (Platform.language), see matchLocale(). */
export function detectLocale(available?: readonly string[]): string {
  const lang = hasPlatform() ? platform().language : undefined;
  return matchLocale(lang ?? '', available);
}

export function configureI18n(cfg: I18nConfig): void {
  if (cfg.fallback !== undefined) fallback = normalizeLocale(cfg.fallback) || 'en';
  if (cfg.warn !== undefined) warn = cfg.warn;
  if (cfg.onMissing !== undefined) onMissing = cfg.onMissing;
  chainCache = null;
}

/** Locales with registered strings, in registration order. */
export function i18nLocales(): string[] {
  return [...tables.keys()];
}

/** Lookup order for the current locale (debugging). */
export function i18nChain(): string[] {
  return [...chain().all];
}

/** Keys looked up so far that the current locale lacked, as sorted 'locale:key' strings. */
export function i18nMissing(): string[] {
  return [...missing].sort();
}

export function clearI18nMissing(): void {
  missing.clear();
}

/**
 * Keys of `reference` (default: the fallback locale) that `locale` does not translate, sorted. Checks whole tables
 * without rendering screens: `expect(i18nUntranslated('zh-CN')).toEqual([])`.
 */
export function i18nUntranslated(locale: string, reference: string = fallback): string[] {
  const own = ownChain(normalizeLocale(locale));
  const ref = tables.get(normalizeLocale(reference));
  if (!ref) return [];
  return [...ref.keys()].filter((k) => !own.some((l) => tables.get(l)?.has(k))).sort();
}

/** Drops all tables, listeners and missing keys; locale and fallback back to 'en' (for tests). */
export function resetI18n(): void {
  tables.clear();
  missing.clear();
  bus.removeAllListeners();
  current = 'en';
  fallback = 'en';
  warn = true;
  onMissing = null;
  chainCache = null;
}
