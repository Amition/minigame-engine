import { afterEach, describe, expect, it } from 'vitest';
import {
  createAudioManager,
  defineSong,
  isAudioMuted,
  playSong,
  playSound,
  setAudioMuted,
  sfxPresets,
  stopSong,
  type AudioLibrary,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';

const library: AudioLibrary = {
  sfx: { coin: sfxPresets.coin() },
  music: { a: defineSong({ bpm: 240, tracks: { l: { instrument: 'triangle', notes: 'C4 E4 G4 C5 |' } } }) },
};

let t: TestGame | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

describe('sound shortcuts', () => {
  it('do nothing without an AudioManager', async () => {
    t = await createTestGame();
    expect(playSound('coin')).toBeNull();
    expect(() => playSong('a')).not.toThrow();
    expect(() => stopSong(100)).not.toThrow();
    expect(isAudioMuted('sfx')).toBe(false);
    expect(() => setAudioMuted('sfx', true)).not.toThrow();
    expect(t.played()).toEqual([]);
  });

  it("drive the current game's AudioManager", async () => {
    t = await createTestGame();
    const audio = createAudioManager(t.game, { library });
    await audio.preload(['coin', 'a']);
    expect(playSound('coin', { volume: 0.5 })).not.toBeNull();
    expect(t.platform.audio.log.find((e) => e.key === 'coin')!.opts!.volume).toBeCloseTo(0.5);
    playSong('a', { fadeMs: 0 });
    expect(audio.music).toBe('a');
    expect(t.played()).toEqual(['coin', 'a']);
    stopSong(0);
    expect(audio.music).toBeNull();
    setAudioMuted('sfx', true);
    expect(isAudioMuted('sfx')).toBe(true);
    expect(audio.isMuted('sfx')).toBe(true);
    await t.step(4);
    expect(playSound('coin')).toBeNull();
    expect(isAudioMuted()).toBe(false);
    expect(playSound('coin', { game: null })).toBeNull();
    setAudioMuted('sfx', false, { game: t.game });
    expect(playSound('coin', { game: t.game })).not.toBeNull();
  });
});
