import { describe, expect, it } from 'vitest';
import { analyzeAudio, analyzeSongKey, renderSfx, renderSong, scheduleSong, type SfxParams } from '@engine';
import { music, sfx } from './index';

const SR = 44100;

/** The sounds the game plays and their maximum length in seconds. */
const SFX_LIMITS: Record<string, number> = {
  draw: 0.4,
  shoot: 0.25,
  hit: 0.2,
  clank: 0.3,
  headshot: 0.35,
  thunk: 0.2,
  hurt: 0.3,
  explode: 0.8,
  zap: 0.35,
  poison: 0.45,
  balloon: 0.3,
  saw: 0.35,
  heal: 0.6,
  apple: 0.45,
  coin: 0.4,
  kill: 0.4,
  boss: 2.5,
  arrive: 0.35,
  jump: 0.2,
  revive: 1.3,
  gameover: 2.5,
  record: 2,
  buy: 0.5,
  deny: 0.2,
  click: 0.06,
  equip: 0.12,
};

/** Played many times per round: short, soft and not too bright. */
const FREQUENT = ['draw', 'shoot', 'hit', 'clank', 'thunk', 'click'];

const params = (name: string): SfxParams => {
  const def = sfx[name]!;
  return typeof def === 'function' ? def() : def;
};

describe('archer audio contract', () => {
  it('defines every contract sound and nothing else', () => {
    expect(Object.keys(sfx).sort()).toEqual(Object.keys(SFX_LIMITS).sort());
    expect(Object.keys(music).sort()).toEqual(['bgm', 'menu']);
  });

  it.each(Object.entries(SFX_LIMITS))('%s renders a clean, non-silent sound of at most %s s', (name, limit) => {
    const pcm = renderSfx(params(name), SR);
    const a = analyzeAudio(pcm, SR, { kind: 'sfx' });
    expect(a.duration).toBeGreaterThan(0.02);
    expect(a.duration).toBeLessThanOrEqual(limit);
    expect(a.peakDb).toBeGreaterThan(-12);
    expect(a.peakDb).toBeLessThanOrEqual(-1);
    expect(a.clipped).toBe(0);
    expect(a.leadingSilence).toBeLessThan(0.01);
    expect(a.verdict).toBe('ok');
  });

  it.each(FREQUENT)('%s stays short and gentle: it repeats all game long', (name) => {
    const a = analyzeAudio(renderSfx(params(name), SR), SR, { kind: 'sfx' });
    expect(a.duration).toBeLessThanOrEqual(0.4);
    expect(a.loudnessDb).toBeLessThan(-10);
    expect(a.centroidHz).toBeLessThan(3500);
  });

  it('shoot stays clean across its playback rates', () => {
    // rate 0.85..1.15 stretches the length by 1/rate; the slowest shot must still be short.
    const a = analyzeAudio(renderSfx(params('shoot'), SR), SR, { kind: 'sfx' });
    expect(a.duration / 0.85).toBeLessThan(0.3);
  });

  it('clank is a short bright ping that sits a little under hit', () => {
    const clank = analyzeAudio(renderSfx(params('clank'), SR), SR, { kind: 'sfx' });
    const hit = analyzeAudio(renderSfx(params('hit'), SR), SR, { kind: 'sfx' });
    expect(clank.duration).toBeGreaterThanOrEqual(0.15);
    expect(clank.loudnessDb).toBeLessThan(hit.loudnessDb - 1);
    expect(clank.loudnessDb).toBeGreaterThan(hit.loudnessDb - 8);
    expect(clank.centroidHz).toBeGreaterThan(hit.centroidHz * 1.5);
  });

  it('draw rises over about a third of a second', () => {
    const a = analyzeAudio(renderSfx(params('draw'), SR), SR, { kind: 'sfx' });
    expect(a.duration).toBeGreaterThanOrEqual(0.25);
    expect(a.duration).toBeLessThanOrEqual(0.4);
  });

  it.each([
    ['bgm', 100, 115],
    ['menu', 60, 100],
  ] as const)('%s schedules as a seamless 30-60 s D minor loop at %s-%s bpm, all notes in key', (name, lo, hi) => {
    const song = music[name]!;
    const s = scheduleSong(song);
    expect(song.loop ?? true).toBe(true);
    expect(song.key).toBe('D minor');
    expect(song.bpm).toBeGreaterThanOrEqual(lo);
    expect(song.bpm).toBeLessThanOrEqual(hi);
    expect(s.duration).toBeGreaterThanOrEqual(30);
    expect(s.duration).toBeLessThanOrEqual(60);
    expect(new Set(s.sections.map((x) => x.name)).size).toBeGreaterThanOrEqual(2);
    expect(s.notes.length).toBeGreaterThan(100);
    expect(analyzeSongKey(song)).toMatchObject({ outOfKey: 0 });
  });

  it('bgm has 16-32 bars', () => {
    const song = music.bgm!;
    const bars = (scheduleSong(song).duration * song.bpm) / 60 / 4;
    expect(bars).toBeGreaterThanOrEqual(16);
    expect(bars).toBeLessThanOrEqual(32);
  });

  it.each(['bgm', 'menu'])('%s renders without clipping, under the sfx, with a clean loop seam', (name) => {
    const r = renderSong(music[name]!, { sampleRate: 22050 });
    const a = analyzeAudio([r.left, r.right], 22050, { kind: 'music', loop: true });
    expect(a.clipped).toBe(0);
    expect(a.peakDb).toBeLessThanOrEqual(-1);
    expect(a.rmsDb).toBeLessThanOrEqual(-22);
    expect(a.seamJump!).toBeLessThan(0.05);
    expect(a.verdict).toBe('ok');
  });
});
