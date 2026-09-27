import { Emitter } from '../core/emitter';
import { Game } from '../core/game';
import { Rng } from '../core/rng';
import type { AudioInstance, PlayOptions } from '../platform/types';
import { renderSfx, type SfxParams } from './sfx';
import { renderSong, type SongDef } from './song';

/** Sound definitions of an app (`<app>/audio/index.ts`): the CLI renders them, the manager can synthesize them. */
export interface AudioLibrary {
  sfx?: Record<string, SfxParams | (() => SfxParams)>;
  music?: Record<string, SongDef>;
}

/** One rendered file, as written by `pnpm audio` into `<app>/assets/audio/manifest.json`. */
export interface AudioManifestEntry {
  /** Path under the app's assets dir, e.g. 'audio/coin.mp3'. */
  file: string;
  kind: 'sfx' | 'music';
  /** Seconds of audio (the loop length for music). */
  duration: number;
  /** Loop region in seconds within the decoded file (MP3 encoder delay included). */
  loopStart?: number;
  loopEnd?: number;
  bytes?: number;
}

export interface AudioManifest {
  version: number;
  sampleRate: number;
  sounds: Record<string, AudioManifestEntry>;
}

export type AudioChannel = 'master' | 'music' | 'sfx';

export interface AudioManagerOptions {
  /** Definitions used to synthesize sounds missing from the manifest (dev fallback, needs backend.loadPcm). */
  library?: AudioLibrary;
  /** Manifest path under the assets dir (default 'audio/manifest.json'). */
  manifestPath?: string;
  /** Storage key for volumes and mutes (default 'audio.settings'). */
  storageKey?: string;
  /** Default max simultaneous voices per sfx (default 4; the oldest voice is stopped). */
  maxVoices?: number;
  /** Default minimum ms between two plays of the same sfx (default 40). */
  cooldownMs?: number;
  /** Default music cross-fade, ms (default 800). */
  musicFadeMs?: number;
  /** Sample rate for fallback synthesis (default 22050 for music, 44100 for sfx). */
  fallbackMusicRate?: number;
  /** Seed for pitch jitter. */
  seed?: number;
}

export interface PlaySfxOptions {
  /** 0..1 on top of the channel volumes. */
  volume?: number;
  /** Random pitch variation, ± semitones. */
  pitchJitter?: number;
  /** Playback rate (1 = normal; backends without rate support ignore it). */
  rate?: number;
  cooldownMs?: number;
  maxVoices?: number;
}

export interface PlayMusicOptions {
  /** Cross-fade duration, ms (default: manager musicFadeMs). */
  fadeMs?: number;
  /** 0..1 on top of the channel volumes. */
  volume?: number;
  /** Restart even if this track is already playing. */
  restart?: boolean;
}

export interface AudioManagerEvents {
  play: { name: string; kind: 'sfx' | 'music' };
  /** Volumes or mutes changed. */
  settings: AudioManager;
}

interface SoundInfo {
  duration: number;
  loopStart?: number;
  loopEnd?: number;
  source: 'file' | 'synth';
}

interface SfxVoice {
  inst: AudioInstance;
  endsAt: number;
}

interface MusicVoice {
  name: string;
  inst: AudioInstance;
  /** Fade gain 0..1. */
  gain: number;
  target: number;
  /** Gain change per ms. */
  speed: number;
  volume: number;
}

interface AudioSettings {
  volume: Record<AudioChannel, number>;
  muted: Record<AudioChannel, boolean>;
}

const managers = new WeakMap<Game, AudioManager>();

/**
 * Game audio on top of the platform AudioBackend: manifest loading, sfx with cooldowns and voice limits, looping
 * music with cross-fades, master/music/sfx volumes and mutes (persisted), hide/show handling and a synth fallback.
 *
 *     const audio = createAudioManager(game, { library });   // library = import from '<app>/audio'
 *     await audio.preload();
 *     audio.playSfx('coin', { pitchJitter: 1 });
 *     audio.playMusic('menu', { fadeMs: 600 });
 */
export class AudioManager extends Emitter<AudioManagerEvents> {
  /** Resolves when the manifest was read (or found missing). */
  readonly ready: Promise<void>;
  private manifest: AudioManifest | null = null;
  private readonly library: AudioLibrary;
  private readonly opts: Required<Omit<AudioManagerOptions, 'library' | 'seed'>>;
  private readonly rng: Rng;
  private readonly infos = new Map<string, SoundInfo>();
  private readonly loading = new Map<string, Promise<boolean>>();
  private readonly lastPlay = new Map<string, number>();
  private readonly voices = new Map<string, SfxVoice[]>();
  private settings: AudioSettings = {
    volume: { master: 1, music: 0.7, sfx: 1 },
    muted: { master: false, music: false, sfx: false },
  };
  private musicName: string | null = null;
  private musicVolume = 1;
  private current: MusicVoice | null = null;
  private fading: MusicVoice[] = [];
  private hidden = false;
  private lastReal = -1;
  private readonly offs: (() => void)[] = [];
  private destroyed = false;

  constructor(
    readonly game: Game,
    opts: AudioManagerOptions = {},
  ) {
    super();
    this.library = opts.library ?? {};
    this.opts = {
      manifestPath: opts.manifestPath ?? 'audio/manifest.json',
      storageKey: opts.storageKey ?? 'audio.settings',
      maxVoices: opts.maxVoices ?? 4,
      cooldownMs: opts.cooldownMs ?? 40,
      musicFadeMs: opts.musicFadeMs ?? 800,
      fallbackMusicRate: opts.fallbackMusicRate ?? 22050,
    };
    this.rng = new Rng(opts.seed ?? 0xa0d10);
    this.loadSettings();
    this.ready = this.readManifest();
    this.offs.push(
      game.on('hide', () => this.onHide()),
      game.on('show', () => this.onShow()),
      game.on('prerender', () => this.tick()),
    );
    managers.set(game, this);
  }

  private get backend() {
    return this.game.platform.audio;
  }

  private now(): number {
    return this.game.platform.now();
  }

  // ---------------------------------------------------------------- loading

  private async readManifest(): Promise<void> {
    try {
      const text = await this.game.platform.readText(this.opts.manifestPath);
      const m = JSON.parse(text) as AudioManifest;
      if (m && typeof m === 'object' && m.sounds) this.manifest = m;
    } catch {
      this.manifest = null;
    }
  }

  /** True once the manifest was read and contains entries. */
  get hasManifest(): boolean {
    return !!this.manifest && Object.keys(this.manifest.sounds).length > 0;
  }

  /** All known sound names (manifest ∪ library). */
  names(kind?: 'sfx' | 'music'): string[] {
    const set = new Set<string>();
    for (const [k, e] of Object.entries(this.manifest?.sounds ?? {})) if (!kind || e.kind === kind) set.add(k);
    if (!kind || kind === 'sfx') for (const k of Object.keys(this.library.sfx ?? {})) set.add(k);
    if (!kind || kind === 'music') for (const k of Object.keys(this.library.music ?? {})) set.add(k);
    return [...set];
  }

  /** Where a loaded sound came from, its duration and loop points; null if not loaded. */
  info(name: string): Readonly<SoundInfo> | null {
    return this.infos.get(name) ?? null;
  }

  isLoaded(name: string): boolean {
    return this.infos.has(name) && this.backend.isLoaded(name);
  }

  /** Loads one sound: the manifest file if listed, else synthesizes it from the library. Resolves false if unavailable. */
  load(name: string): Promise<boolean> {
    if (this.isLoaded(name)) return Promise.resolve(true);
    let p = this.loading.get(name);
    if (p) return p;
    p = (async () => {
      await this.ready;
      const e = this.manifest?.sounds[name];
      if (e) {
        try {
          await this.backend.load(name, e.file);
          this.infos.set(name, {
            duration: e.duration,
            ...(e.loopStart !== undefined ? { loopStart: e.loopStart } : {}),
            ...(e.loopEnd !== undefined ? { loopEnd: e.loopEnd } : {}),
            source: 'file',
          });
          return true;
        } catch {
          // fall through to synthesis
        }
      }
      return this.synthesize(name);
    })().finally(() => this.loading.delete(name));
    this.loading.set(name, p);
    return p;
  }

  /** Loads the given sounds (default: every known sound). */
  async preload(names: string[] = this.names()): Promise<void> {
    await this.ready;
    await Promise.all(names.map((n) => this.load(n)));
  }

  private async synthesize(name: string): Promise<boolean> {
    const loadPcm = this.backend.loadPcm?.bind(this.backend);
    if (!loadPcm) return false;
    const sfx = this.library.sfx?.[name];
    if (sfx) {
      const params = typeof sfx === 'function' ? sfx() : sfx;
      const sr = 44100;
      const pcm = renderSfx(params, sr);
      await loadPcm(name, pcm, sr);
      this.infos.set(name, { duration: pcm.length / sr, source: 'synth' });
      return true;
    }
    const song = this.library.music?.[name];
    if (song) {
      const sr = this.opts.fallbackMusicRate;
      const r = renderSong(song, { sampleRate: sr });
      const pcm = new Float32Array(r.left.length);
      for (let i = 0; i < pcm.length; i++) pcm[i] = (r.left[i]! + r.right[i]!) * 0.5;
      await loadPcm(name, pcm, sr);
      this.infos.set(name, {
        duration: r.duration,
        ...(r.loopStart !== undefined ? { loopStart: r.loopStart, loopEnd: r.loopEnd! } : {}),
        source: 'synth',
      });
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- volumes

  getVolume(channel: AudioChannel): number {
    return this.settings.volume[channel];
  }

  setVolume(channel: AudioChannel, v: number): void {
    this.settings.volume[channel] = Math.min(1, Math.max(0, v));
    this.settingsChanged();
  }

  isMuted(channel: AudioChannel): boolean {
    return this.settings.muted[channel];
  }

  setMuted(channel: AudioChannel, muted: boolean): void {
    if (this.settings.muted[channel] === muted) return;
    this.settings.muted[channel] = muted;
    this.settingsChanged();
  }

  /** Flips a mute flag; returns the new muted state. */
  toggleMute(channel: AudioChannel = 'master'): boolean {
    this.setMuted(channel, !this.isMuted(channel));
    return this.isMuted(channel);
  }

  /** Effective gain of a channel (master × channel, 0 when either is muted). */
  channelGain(channel: 'music' | 'sfx'): number {
    const s = this.settings;
    if (s.muted.master || s.muted[channel]) return 0;
    return s.volume.master * s.volume[channel];
  }

  private loadSettings(): void {
    try {
      const raw = this.game.platform.storage.get(this.opts.storageKey);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<AudioSettings>;
      for (const ch of ['master', 'music', 'sfx'] as const) {
        const v = s.volume?.[ch];
        if (typeof v === 'number' && Number.isFinite(v)) this.settings.volume[ch] = Math.min(1, Math.max(0, v));
        const m = s.muted?.[ch];
        if (typeof m === 'boolean') this.settings.muted[ch] = m;
      }
    } catch {
      // corrupt settings: keep defaults
    }
  }

  private settingsChanged(): void {
    this.game.platform.storage.set(this.opts.storageKey, JSON.stringify(this.settings));
    const g = this.channelGain('music');
    if (g <= 0) {
      this.stopMusicVoices();
    } else if (this.current) {
      this.applyMusicVolume(this.current);
      for (const v of this.fading) this.applyMusicVolume(v);
    } else if (this.musicName && !this.hidden) {
      this.startMusic(this.musicName, this.opts.musicFadeMs);
    }
    this.emit('settings', this);
  }

  // ---------------------------------------------------------------- sfx

  /**
   * Plays a sound effect. Returns null when skipped: muted, hidden, within the cooldown, or not loaded yet
   * (loading then starts; a play requested while loading happens once loaded if that takes < 250 ms).
   */
  playSfx(name: string, opts: PlaySfxOptions = {}): AudioInstance | null {
    if (this.hidden || this.destroyed) return null;
    const gain = this.channelGain('sfx') * (opts.volume ?? 1);
    if (gain <= 0) return null;
    const now = this.now();
    const last = this.lastPlay.get(name);
    if (last !== undefined && now - last < (opts.cooldownMs ?? this.opts.cooldownMs)) return null;
    if (!this.isLoaded(name)) {
      const asked = now;
      void this.load(name).then((ok) => {
        if (ok && this.now() - asked < 250) this.playSfx(name, opts);
      });
      return null;
    }
    const list = (this.voices.get(name) ?? []).filter((v) => v.inst.playing && v.endsAt > now);
    const max = Math.max(1, opts.maxVoices ?? this.opts.maxVoices);
    while (list.length >= max) list.shift()!.inst.stop();
    let rate = opts.rate ?? 1;
    if (opts.pitchJitter) rate *= Math.pow(2, this.rng.float(-opts.pitchJitter, opts.pitchJitter) / 12);
    const play: PlayOptions = { volume: gain };
    if (rate !== 1) play.rate = rate;
    const inst = this.backend.play(name, play);
    const dur = this.infos.get(name)?.duration ?? 1;
    list.push({ inst, endsAt: now + (dur * 1000) / rate });
    this.voices.set(name, list);
    this.lastPlay.set(name, now);
    this.emit('play', { name, kind: 'sfx' });
    return inst;
  }

  /** Active voices of one sfx (or of all sfx). */
  voiceCount(name?: string): number {
    const now = this.now();
    let n = 0;
    for (const [k, list] of this.voices) {
      if (name && k !== name) continue;
      n += list.filter((v) => v.inst.playing && v.endsAt > now).length;
    }
    return n;
  }

  // ---------------------------------------------------------------- music

  /** Name of the requested music track (it may be silent while muted or hidden). */
  get music(): string | null {
    return this.musicName;
  }

  /** Cross-fades to a looping music track. Same track again = no-op unless `restart`. */
  playMusic(name: string, opts: PlayMusicOptions = {}): void {
    if (this.destroyed) return;
    const fade = Math.max(0, opts.fadeMs ?? this.opts.musicFadeMs);
    this.musicVolume = Math.min(1, Math.max(0, opts.volume ?? 1));
    if (this.musicName === name && this.current && !opts.restart) {
      this.current.volume = this.musicVolume;
      this.applyMusicVolume(this.current);
      return;
    }
    this.musicName = name;
    this.fadeOutCurrent(fade);
    this.emit('play', { name, kind: 'music' });
    if (this.hidden || this.channelGain('music') <= 0) return;
    this.startMusic(name, fade);
  }

  /** Fades the music out and forgets it. */
  stopMusic(fadeMs = this.opts.musicFadeMs): void {
    this.musicName = null;
    this.fadeOutCurrent(fadeMs);
  }

  private startMusic(name: string, fade: number): void {
    if (this.current) return;
    if (!this.isLoaded(name)) {
      void this.load(name).then((ok) => {
        if (ok && this.musicName === name && !this.current && !this.hidden && this.channelGain('music') > 0) {
          this.startMusic(name, fade);
        }
      });
      return;
    }
    const info = this.infos.get(name);
    const opts: PlayOptions & { loopStart?: number; loopEnd?: number } = { loop: true, volume: 0 };
    if (info?.loopStart !== undefined && info.loopEnd !== undefined) {
      opts.loopStart = info.loopStart;
      opts.loopEnd = info.loopEnd;
    }
    const v: MusicVoice = {
      name,
      inst: null as unknown as AudioInstance,
      gain: fade > 0 ? 0 : 1,
      target: 1,
      speed: fade > 0 ? 1 / fade : Infinity,
      volume: this.musicVolume,
    };
    opts.volume = v.gain * v.volume * this.channelGain('music');
    v.inst = this.backend.play(name, opts);
    this.current = v;
  }

  private fadeOutCurrent(fade: number): void {
    const cur = this.current;
    this.current = null;
    if (!cur) return;
    if (fade <= 0) {
      cur.inst.stop();
      return;
    }
    cur.target = 0;
    cur.speed = Math.max(cur.gain, 1e-6) / fade;
    this.fading.push(cur);
  }

  private stopMusicVoices(): void {
    this.current?.inst.stop();
    this.current = null;
    for (const v of this.fading) v.inst.stop();
    this.fading = [];
  }

  private applyMusicVolume(v: MusicVoice): void {
    v.inst.setVolume(v.gain * v.volume * this.channelGain('music'));
  }

  /** Advances fades by `dtMs`. Called automatically every rendered frame (also while the game is paused). */
  update(dtMs: number): void {
    const step = (v: MusicVoice): boolean => {
      if (v.gain === v.target) return true;
      const d = v.speed * dtMs;
      v.gain = v.target > v.gain ? Math.min(v.target, v.gain + d) : Math.max(v.target, v.gain - d);
      this.applyMusicVolume(v);
      return v.gain > 0 || v.target > 0;
    };
    if (this.current) step(this.current);
    if (this.fading.length) {
      this.fading = this.fading.filter((v) => {
        const alive = step(v);
        if (!alive) v.inst.stop();
        return alive;
      });
    }
  }

  private tick(): void {
    const real = this.game.time.realElapsed;
    const dt = this.lastReal < 0 ? 0 : real - this.lastReal;
    this.lastReal = real;
    if (!this.hidden && dt > 0) this.update(Math.min(dt, 0.25) * 1000);
  }

  // ---------------------------------------------------------------- lifecycle

  private onHide(): void {
    this.hidden = true;
  }

  private onShow(): void {
    this.hidden = false;
    const cur = this.current;
    if (cur && !cur.inst.playing) {
      this.current = null;
      if (this.musicName) this.startMusic(this.musicName, 300);
    } else if (!cur && this.musicName && this.channelGain('music') > 0) {
      this.startMusic(this.musicName, 300);
    }
  }

  /** Stops every sfx voice and the music (the music request is kept only if `keepMusic`). */
  stopAll(keepMusic = false): void {
    for (const list of this.voices.values()) for (const v of list) v.inst.stop();
    this.voices.clear();
    this.stopMusicVoices();
    if (!keepMusic) this.musicName = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stopAll();
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.destroyed = true;
    if (managers.get(this.game) === this) managers.delete(this.game);
    this.removeAllListeners();
  }
}

/** Creates the game's AudioManager (replacing a previous one). */
export function createAudioManager(game: Game, opts: AudioManagerOptions = {}): AudioManager {
  managers.get(game)?.destroy();
  return new AudioManager(game, opts);
}

/** The AudioManager created for `game` (default: Game.current), or null. */
export function getAudioManager(game: Game | null = Game.current): AudioManager | null {
  return game ? (managers.get(game) ?? null) : null;
}
