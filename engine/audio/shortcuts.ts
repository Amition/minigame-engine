import type { Game } from '../core/game';
import type { AudioInstance } from '../platform/types';
import { getAudioManager, type AudioChannel, type PlayMusicOptions, type PlaySfxOptions } from './manager';

// One-liners over the current game's AudioManager (createAudioManager). All of them do nothing when there is no
// manager (tests, tools, an app without audio), so game code needs no `getAudioManager(game)?.` chains.

/** Target game for the shortcuts (default Game.current). */
export interface AudioShortcutOptions {
  game?: Game | null;
}

/** Plays a sound effect: `playSound('coin', { pitchJitter: 1 })`. Null when skipped or without a manager. */
export function playSound(name: string, opts: PlaySfxOptions & AudioShortcutOptions = {}): AudioInstance | null {
  return getAudioManager(opts.game)?.playSfx(name, opts) ?? null;
}

/** Cross-fades to a looping music track: `playSong('bgm', { fadeMs: 1200 })`. Same track again is a no-op. */
export function playSong(name: string, opts: PlayMusicOptions & AudioShortcutOptions = {}): void {
  getAudioManager(opts.game)?.playMusic(name, opts);
}

/** Fades the music out (default: the manager's musicFadeMs) and forgets it. */
export function stopSong(fadeMs?: number, opts: AudioShortcutOptions = {}): void {
  getAudioManager(opts.game)?.stopMusic(fadeMs);
}

/** Mute flag of a channel ('master' by default); false without a manager. */
export function isAudioMuted(channel: AudioChannel = 'master', opts: AudioShortcutOptions = {}): boolean {
  return getAudioManager(opts.game)?.isMuted(channel) ?? false;
}

/** Mutes / unmutes a channel (persisted by the manager): `ui.toggle({ onChange: (on) => setAudioMuted('sfx', !on) })`. */
export function setAudioMuted(channel: AudioChannel, muted: boolean, opts: AudioShortcutOptions = {}): void {
  getAudioManager(opts.game)?.setMuted(channel, muted);
}
