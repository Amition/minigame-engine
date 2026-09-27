import { describe, expect, it } from 'vitest';
import { analyzeAudio, analyzeSongKey, renderSfx, renderSong, scheduleSong, type SfxParams } from '@engine';
import { music, sfx } from './index';

const SR = 44100;

/** The sounds the game plays and their maximum length in seconds. */
const SFX_LIMITS: Record<string, number> = {
  drop: 0.25,
  spawn: 0.12,
  merge: 0.35,
  'merge-big': 0.8,
  watermelon: 2.5,
  combo: 0.4,
  warning: 0.15,
  gameover: 2,
  record: 1.5,
  click: 0.08,
};

const params = (name: string): SfxParams => {
  const def = sfx[name]!;
  return typeof def === 'function' ? def() : def;
};

describe('game audio contract', () => {
  it('defines every contract sound and nothing else', () => {
    expect(Object.keys(sfx).sort()).toEqual(Object.keys(SFX_LIMITS).sort());
    expect(Object.keys(music)).toEqual(['bgm']);
  });

  it.each(Object.entries(SFX_LIMITS))('%s renders a clean, non-silent sound of at most %s s', (name, limit) => {
    const pcm = renderSfx(params(name), SR);
    const a = analyzeAudio(pcm, SR, { kind: 'sfx' });
    expect(a.duration).toBeGreaterThan(0.02);
    expect(a.duration).toBeLessThanOrEqual(limit);
    expect(a.peakDb).toBeGreaterThan(-12);
    expect(a.peakDb).toBeLessThanOrEqual(-1);
    expect(a.clipped).toBe(0);
    expect(a.verdict).toBe('ok');
  });

  it('keeps merge soft: it is played for every merge', () => {
    const a = analyzeAudio(renderSfx(params('merge'), SR), SR, { kind: 'sfx' });
    expect(a.centroidHz).toBeLessThan(1500);
    expect(a.peakDb).toBeLessThan(-3);
  });

  it('bgm schedules as a 30-60 s loop at 100-120 bpm with several sections, all notes in key', () => {
    const song = music.bgm!;
    const s = scheduleSong(song);
    expect(song.loop ?? true).toBe(true);
    expect(song.bpm).toBeGreaterThanOrEqual(100);
    expect(song.bpm).toBeLessThanOrEqual(120);
    expect(s.duration).toBeGreaterThanOrEqual(30);
    expect(s.duration).toBeLessThanOrEqual(60);
    expect(new Set(s.sections.map((x) => x.name)).size).toBeGreaterThanOrEqual(2);
    expect(s.notes.length).toBeGreaterThan(100);
    expect(analyzeSongKey(song)).toMatchObject({ outOfKey: 0 });
  });

  it('bgm renders without clipping and with a clean loop seam', () => {
    const r = renderSong(music.bgm!, { sampleRate: 22050 });
    const a = analyzeAudio([r.left, r.right], 22050, { kind: 'music', loop: true });
    expect(a.clipped).toBe(0);
    expect(a.peakDb).toBeLessThanOrEqual(-1);
    expect(a.seamJump!).toBeLessThan(0.05);
    expect(a.verdict).toBe('ok');
  });
});
