import { Game } from '../core/game';
import { platform } from '../platform/current';
import type { KeyValueStorage } from '../platform/types';
import { after, type Timer } from './timers';

export interface SaveOptions<T> {
  /** Schema version stored with the data (default 1). Bump it when the shape changes and handle it in migrate. */
  version?: number;
  /** Upgrades data written by an older version; the result is merged over the defaults. */
  migrate?: (old: any, fromVersion: number) => Partial<T>;
  /** Seconds (unscaled) that save() waits to batch writes (default 0.5; 0 = write immediately). Hiding the app flushes. */
  debounce?: number;
  /** Default: platform().storage. */
  storage?: KeyValueStorage;
}

/** Why the last load fell back to defaults. */
export type SaveLoadError = 'corrupt' | 'migrate-failed' | null;

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Loaded value over defaults: missing keys come from defaults, wrong types fall back, extra keys are kept. */
function mergeDefaults(def: unknown, val: unknown): unknown {
  if (val === undefined) return clone(def);
  if (isPlain(def)) {
    if (!isPlain(val)) return clone(def);
    const out: Record<string, unknown> = { ...val };
    for (const k of Object.keys(def)) out[k] = mergeDefaults(def[k], val[k]);
    return out;
  }
  if (Array.isArray(def)) return Array.isArray(val) ? val : clone(def);
  if (def === null) return val;
  return typeof val === typeof def ? val : clone(def);
}

/**
 * Typed persistent store in platform storage (JSON `{ v, data }`). Loads lazily on first access, so it can be
 * created at module level. Mutate `data` then call save(), or use set()/update() which save for you.
 */
export class SaveStore<T extends object> {
  readonly version: number;
  /** Set when the stored data was unreadable and defaults were used (the raw value is kept under `${key}:corrupt`). */
  loadError: SaveLoadError = null;
  private _data: T | null = null;
  private dirty = false;
  private timer: Timer | null = null;
  private readonly hooked = new WeakSet<Game>();

  constructor(
    readonly key: string,
    private readonly defaults: T,
    private readonly opts: SaveOptions<T> = {},
  ) {
    this.version = opts.version ?? 1;
  }

  /** The live data object. */
  get data(): T {
    return (this._data ??= this.load());
  }

  /** Shallow-merges a patch and schedules a save. */
  set(patch: Partial<T>): this {
    Object.assign(this.data, patch);
    this.save();
    return this;
  }

  /** Mutates the data in a callback and schedules a save: `save.update((d) => d.coins += 10)`. */
  update(fn: (data: T) => void): this {
    fn(this.data);
    this.save();
    return this;
  }

  /** Schedules a (debounced) write. */
  save(): void {
    this.dirty = true;
    const game = Game.current;
    const delay = this.opts.debounce ?? 0.5;
    if (delay <= 0 || !game) {
      this.flush();
      return;
    }
    if (!this.hooked.has(game)) {
      this.hooked.add(game);
      game.on('hide', () => this.flush());
    }
    if (this.timer?.active) return;
    this.timer = after(delay, () => this.flush(), { realtime: true, game });
  }

  /** Writes now if there are unsaved changes. */
  flush(): void {
    this.timer?.cancel();
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      this.storage().set(this.key, JSON.stringify({ v: this.version, data: this.data }));
    } catch (e) {
      console.warn(`save "${this.key}": write failed`, e);
    }
  }

  /** True while changes wait for the debounced write. */
  get pending(): boolean {
    return this.dirty;
  }

  /** Restores the defaults and writes immediately. */
  reset(): void {
    this._data = clone(this.defaults);
    this.dirty = true;
    this.flush();
  }

  /** Drops the in-memory copy; the next access reads storage again. */
  reload(): void {
    this.timer?.cancel();
    this.timer = null;
    this.dirty = false;
    this._data = null;
  }

  private storage(): KeyValueStorage {
    return this.opts.storage ?? platform().storage;
  }

  private load(): T {
    this.loadError = null;
    const raw = this.storage().get(this.key);
    if (raw === null || raw === '') return clone(this.defaults);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.fallback('corrupt', raw);
    }
    const enveloped = isPlain(parsed) && typeof parsed.v === 'number' && 'data' in parsed;
    const from = enveloped ? (parsed as { v: number }).v : 0;
    let data: unknown = enveloped ? (parsed as { data: unknown }).data : parsed;
    if (!isPlain(data)) return this.fallback('corrupt', raw);
    if (from < this.version && this.opts.migrate) {
      try {
        data = this.opts.migrate(data, from);
      } catch (e) {
        console.warn(`save "${this.key}": migrate from v${from} failed`, e);
        return this.fallback('migrate-failed', raw);
      }
    }
    return mergeDefaults(this.defaults, data) as T;
  }

  private fallback(reason: Exclude<SaveLoadError, null>, raw: string): T {
    this.loadError = reason;
    try {
      this.storage().set(`${this.key}:corrupt`, raw);
    } catch {
      // storage full: the backup is best effort
    }
    return clone(this.defaults);
  }
}

/**
 * Creates a typed save store:
 *
 *     export const save = createSave('mygame', { coins: 0, best: 0, unlocked: [1] }, { version: 2,
 *       migrate: (old, v) => (v < 2 ? { ...old, unlocked: [1] } : old) });
 *     save.set({ coins: save.data.coins + 5 });
 */
export function createSave<T extends object>(key: string, defaults: T, opts?: SaveOptions<T>): SaveStore<T> {
  return new SaveStore(key, defaults, opts);
}

export interface GameSettings {
  sound: boolean;
  music: boolean;
  vibration: boolean;
  /** Master volume 0..1. */
  volume: number;
}

/** Persistent player settings (sound/music/vibration/volume), extendable with extra defaults. */
export function createSettings<E extends object = {}>(extra?: E, key = 'settings'): SaveStore<GameSettings & E> {
  const defaults = { sound: true, music: true, vibration: true, volume: 1, ...(extra ?? {}) } as GameSettings & E;
  return new SaveStore(key, defaults, { debounce: 0 });
}
