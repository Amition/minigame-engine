import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAudioManager,
  defineSong,
  getAudioManager,
  sfxPresets,
  type AudioLibrary,
  type AudioManifest,
  type Text,
} from '@engine';
import { createTestGame, type TestGame } from '@engine/testing';
import sandbox from '../sandbox/main';

const library: AudioLibrary = {
  sfx: { coin: sfxPresets.coin(), jump: () => sfxPresets.jump(3) },
  music: {
    a: defineSong({ bpm: 240, tracks: { l: { instrument: 'triangle', notes: 'C4 E4 G4 C5 |' } } }),
    b: defineSong({ bpm: 240, tracks: { l: { instrument: 'triangle', notes: 'A3 C4 E4 A4 |' } } }),
  },
};

let t: TestGame | null = null;
let tmp: string | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

const last = <T>(list: T[]): T => list[list.length - 1]!;
const lastLog = () => last(t!.platform.audio.log);
const volumes = (key: string) =>
  t!.platform.audio.log.filter((e) => e.key === key && e.action === 'volume').map((e) => e.opts!.volume!);

describe('AudioManager', () => {
  it('synthesizes library sounds when there is no manifest', async () => {
    t = await createTestGame();
    const audio = createAudioManager(t.game, { library });
    expect(getAudioManager(t.game)).toBe(audio);
    await audio.preload(['coin', 'jump']);
    expect(audio.hasManifest).toBe(false);
    expect(t.platform.audio.pcm.get('coin')!.data.length).toBeGreaterThan(1000);
    expect(audio.info('jump')?.source).toBe('synth');
    expect(await audio.load('nope')).toBe(false);
  });

  it('applies per-sound cooldowns and voice limits', async () => {
    t = await createTestGame();
    const audio = createAudioManager(t.game, { library, cooldownMs: 50 });
    await audio.preload(['coin', 'jump']);
    expect(audio.playSfx('coin')).not.toBeNull();
    expect(audio.playSfx('coin')).toBeNull();
    expect(audio.playSfx('jump')).not.toBeNull();
    await t.step(4);
    expect(audio.playSfx('coin')).not.toBeNull();
    expect(t.played()).toEqual(['coin', 'jump', 'coin']);
    for (let i = 0; i < 3; i++) audio.playSfx('jump', { cooldownMs: 0, maxVoices: 2 });
    expect(audio.voiceCount('jump')).toBe(2);
    expect(t.platform.audio.log.filter((e) => e.key === 'jump' && e.action === 'stop').length).toBe(2);
  });

  it('scales sfx by channel volumes, mutes, and persists settings', async () => {
    t = await createTestGame();
    let audio = createAudioManager(t.game, { library });
    await audio.preload(['coin']);
    audio.setVolume('master', 0.5);
    audio.setVolume('sfx', 0.5);
    audio.playSfx('coin', { volume: 0.8 });
    expect(lastLog()!.opts!.volume).toBeCloseTo(0.2);
    audio.setMuted('sfx', true);
    await t.step(5);
    expect(audio.playSfx('coin')).toBeNull();
    expect(JSON.parse(t.platform.storage.get('audio.settings')!)).toMatchObject({
      volume: { master: 0.5, sfx: 0.5 },
      muted: { sfx: true },
    });
    audio = createAudioManager(t.game, { library });
    expect(audio.isMuted('sfx')).toBe(true);
    expect(audio.getVolume('master')).toBe(0.5);
    expect(audio.toggleMute('sfx')).toBe(false);
    await audio.preload(['coin']);
    expect(audio.playSfx('coin')).not.toBeNull();
  });

  it('cross-fades looping music with per-frame volume ramps', async () => {
    t = await createTestGame();
    const audio = createAudioManager(t.game, { library });
    await audio.preload(['a', 'b']);
    audio.playMusic('a', { fadeMs: 500 });
    const play = t.platform.audio.log.find((e) => e.key === 'a' && e.action === 'play')!;
    expect(play.opts).toMatchObject({ loop: true, volume: 0 });
    await t.advance(0.25);
    const mid = last(volumes('a'))!;
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.5);
    await t.advance(0.4);
    expect(last(volumes('a'))).toBeCloseTo(0.7);
    audio.playMusic('a');
    expect(t.played().filter((k) => k === 'a').length).toBe(1);
    audio.playMusic('b', { fadeMs: 300 });
    await t.advance(0.5);
    expect(t.platform.audio.log.some((e) => e.key === 'a' && e.action === 'stop')).toBe(true);
    expect(last(volumes('b'))).toBeCloseTo(0.7);
    expect(audio.music).toBe('b');
    audio.stopMusic(0);
    expect(audio.music).toBeNull();
    expect(lastLog()).toMatchObject({ key: 'b', action: 'stop' });
  });

  it('stops music while muted and restarts it on unmute', async () => {
    t = await createTestGame();
    const audio = createAudioManager(t.game, { library });
    await audio.preload(['a']);
    audio.playMusic('a', { fadeMs: 0 });
    audio.setMuted('music', true);
    expect(lastLog()).toMatchObject({ key: 'a', action: 'stop' });
    audio.setMuted('music', false);
    expect(t.played().filter((k) => k === 'a').length).toBe(2);
  });

  it('drops sfx while hidden and resumes on show', async () => {
    t = await createTestGame();
    const audio = createAudioManager(t.game, { library });
    await audio.preload(['coin']);
    t.platform.hide();
    expect(t.platform.audio.suspended).toBe(true);
    expect(audio.playSfx('coin')).toBeNull();
    t.platform.show();
    expect(audio.playSfx('coin')).not.toBeNull();
  });

  it('loads files listed in the manifest and passes loop points to music', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'audio-test-'));
    mkdirSync(join(tmp, 'audio'));
    const manifest: AudioManifest = {
      version: 1,
      sampleRate: 44100,
      sounds: {
        coin: { file: 'audio/coin.mp3', kind: 'sfx', duration: 0.3 },
        a: { file: 'audio/a.mp3', kind: 'music', duration: 1, loopStart: 0.025, loopEnd: 1.025 },
      },
    };
    writeFileSync(join(tmp, 'audio/manifest.json'), JSON.stringify(manifest));
    t = await createTestGame({ assetsDir: tmp });
    const audio = createAudioManager(t.game, { library });
    await audio.preload();
    expect(audio.hasManifest).toBe(true);
    expect(t.platform.audio.loaded.get('coin')).toBe('audio/coin.mp3');
    expect(audio.info('coin')?.source).toBe('file');
    expect(audio.info('jump')?.source).toBe('synth');
    audio.playMusic('a', { fadeMs: 0 });
    expect(lastLog()!.opts).toMatchObject({ loop: true, loopStart: 0.025, loopEnd: 1.025 });
  });
});

describe('audio-lab scene', () => {
  it('plays sfx and music from the rendered sandbox assets', async () => {
    t = await createTestGame({ app: sandbox, scene: 'audio-lab', assetsDir: resolve('sandbox/assets') });
    const audio = getAudioManager(t.game)!;
    expect(audio.hasManifest).toBe(true);
    expect(t.platform.audio.loaded.get('coin')).toBe('audio/coin.mp3');
    await t.tap('#sfx-coin');
    await t.tap('#music-menu');
    await t.step(2);
    expect(t.played()).toEqual(['coin', 'menu']);
    await t.tap('#vol-sfx-down');
    expect(t.get<Text>('#vol-sfx-value').text).toBe('90%');
    await t.tap('#mute-master');
    expect(lastLog()).toMatchObject({ key: 'menu', action: 'stop' });
    expect(t.get<Text>('#mute-master-label').text).toBe('muted');
  });
});
