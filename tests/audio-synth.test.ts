import { describe, expect, it } from 'vitest';
import {
  adsrAt,
  analyzeAudio,
  analyzeSongKey,
  AudioBiquad,
  decodeWav,
  defineSong,
  encodeWav,
  mutateSfx,
  noteNameToMidi,
  parseChordSymbol,
  parseMusicNotation,
  pcmRms,
  renderAdsr,
  renderSfx,
  renderSong,
  renderTone,
  scheduleSong,
  sfxPresets,
  songBarsToSeconds,
  type SfxPresetName,
} from '@engine';
import { encodeMp3, mp3Info } from '../tools/audio/mp3';

const SR = 44100;

function zeroCrossings(buf: Float32Array): number {
  let n = 0;
  for (let i = 1; i < buf.length; i++) if (buf[i - 1]! < 0 !== buf[i]! < 0) n++;
  return n;
}

describe('oscillators', () => {
  it.each([
    ['sine', 440],
    ['square', 220],
    ['triangle', 330],
    ['saw', 100],
  ] as const)('%s at %d Hz crosses zero twice per cycle', (wave, freq) => {
    const buf = renderTone(wave, freq, 1, SR);
    expect(buf.length).toBe(SR);
    expect(Math.abs(zeroCrossings(buf) - 2 * freq)).toBeLessThanOrEqual(2);
  });

  it('keeps pulse waves DC-free for any duty', () => {
    const buf = renderTone('square', 200, 1, SR, { duty: 0.2 });
    const mean = buf.reduce((s, v) => s + v, 0) / buf.length;
    expect(Math.abs(mean)).toBeLessThan(0.01);
  });

  it('metallic noise is periodic at its frequency', () => {
    const buf = renderTone('metallic', 441, 0.5, SR);
    const lag = 100;
    let same = 0;
    for (let i = 0; i + lag < buf.length; i++) if (Math.sign(buf[i]!) === Math.sign(buf[i + lag]!)) same++;
    expect(same / (buf.length - lag)).toBeGreaterThan(0.95);
  });

  it('white noise is seeded', () => {
    expect(renderTone('white', 0, 0.01, SR, { seed: 3 })).toEqual(renderTone('white', 0, 0.01, SR, { seed: 3 }));
    expect(renderTone('white', 0, 0.01, SR, { seed: 3 })).not.toEqual(renderTone('white', 0, 0.01, SR, { seed: 4 }));
  });
});

describe('envelopes and filters', () => {
  const env = { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 };

  it('ADSR rises, decays to sustain, holds, releases to zero', () => {
    expect(adsrAt(env, 0, 1)).toBe(0);
    expect(adsrAt(env, 0.05, 1)).toBeCloseTo(0.5);
    expect(adsrAt(env, 0.1, 1)).toBeCloseTo(1);
    expect(adsrAt(env, 0.2, 1)).toBeGreaterThan(0.5);
    expect(adsrAt(env, 0.2, 1)).toBeLessThan(1);
    expect(adsrAt(env, 0.3, 1)).toBeCloseTo(0.5);
    expect(adsrAt(env, 0.8, 1)).toBeCloseTo(0.5);
    expect(adsrAt(env, 1.15, 1)).toBeLessThan(0.5);
    expect(adsrAt(env, 1.3, 1)).toBe(0);
    const early = adsrAt(env, 0.1 + 0.15, 0.05);
    expect(early).toBeLessThan(adsrAt(env, 0.05, 1));
    const r = renderAdsr(env, 1, 1000);
    expect(r.length).toBe(1300);
    for (let i = 1000; i < 1300; i++) expect(r[i]!).toBeLessThanOrEqual(r[i - 1]! + 1e-9);
  });

  it('low-pass keeps lows and removes highs', () => {
    const run = (freq: number) => {
      const buf = renderTone('sine', freq, 0.5, SR);
      const f = new AudioBiquad('lowpass', 500, Math.SQRT1_2, SR);
      for (let i = 0; i < buf.length; i++) buf[i] = f.process(buf[i]!);
      return pcmRms(buf.subarray(2000));
    };
    expect(run(100)).toBeGreaterThan(0.65);
    expect(run(8000)).toBeLessThan(0.01);
  });
});

describe('sfx', () => {
  const names = Object.keys(sfxPresets) as SfxPresetName[];

  it.each(names)('preset %s renders a clean, short, normalised sound', (name) => {
    const p = sfxPresets[name]();
    const pcm = renderSfx(p, SR);
    expect(pcm.every((v) => Number.isFinite(v))).toBe(true);
    const a = analyzeAudio(pcm, SR, { kind: 'sfx' });
    expect(a.duration).toBeGreaterThan(0.01);
    expect(a.duration).toBeLessThan(3);
    expect(a.peak).toBeCloseTo(p.volume ?? 0.8, 2);
    expect(a.clipped).toBe(0);
    expect(a.leadingSilence).toBeLessThan(0.02);
    expect(a.verdict).toBe('ok');
  });

  it('is deterministic by seed; other seeds and mutations vary', () => {
    expect(renderSfx(sfxPresets.explosion(7))).toEqual(renderSfx(sfxPresets.explosion(7)));
    expect(sfxPresets.coin(1)).toEqual(sfxPresets.coin(1));
    expect(sfxPresets.coin(1)).not.toEqual(sfxPresets.coin(2));
    const base = sfxPresets.laser();
    expect(mutateSfx(base, 0.2, 5)).toEqual(mutateSfx(base, 0.2, 5));
    expect(mutateSfx(base, 0.2, 5)).not.toEqual(mutateSfx(base, 0.2, 6));
    expect(mutateSfx(base, 0.2, 5).wave).toBe(base.wave);
  });

  it('cuts a falling slide at freqMin and mixes layers at their offsets', () => {
    const cut = renderSfx({ wave: 'square', freq: 400, slide: -100, sustain: 1, decay: 0, freqMin: 200 }, SR);
    expect(cut.length / SR).toBeLessThan(0.2);
    const layered = renderSfx({ wave: 'sine', freq: 440, sustain: 0.05, decay: 0.01, layers: [{ at: 0.5, freq: 880 }] }, SR);
    expect(layered.length / SR).toBeGreaterThan(0.55);
  });
});

describe('notation', () => {
  it('parses notes, rests, holds and bars', () => {
    const p = parseMusicNotation('C5 E5 G5 . | A4 - - . |');
    expect(p.bars).toBe(2);
    expect(p.beats).toBe(8);
    expect(p.events.map((e) => [e.notes[0], e.start, e.dur])).toEqual([
      [72, 0, 1],
      [76, 1, 1],
      [79, 2, 1],
      [69, 4, 3],
    ]);
  });

  it('splits each bar evenly and supports groups, ties across bars and bar repeats', () => {
    const p = parseMusicNotation('C4 D4 E4 F4 G4 A4 B4 C5 | (C4 D4) E4 - - | - . . . | % |');
    expect(p.events[1]!.start).toBe(0.5);
    expect(p.events[1]!.dur).toBe(0.5);
    const group = p.events.filter((e) => e.start >= 4 && e.start < 5);
    expect(group.map((e) => [e.notes[0], e.start, e.dur])).toEqual([
      [60, 4, 0.5],
      [62, 4.5, 0.5],
    ]);
    const tied = p.events.find((e) => e.start === 5)!;
    expect(tied.notes[0]).toBe(64);
    expect(tied.dur).toBe(4);
    expect(p.bars).toBe(4);
    expect(p.events.filter((e) => e.start >= 12)).toEqual([]);
    const rep = parseMusicNotation('C4 D4 | % |');
    expect(rep.events.map((e) => e.start)).toEqual([0, 2, 4, 6]);
  });

  it('parses chords, chord symbols, accidentals and velocity marks', () => {
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('F#3')).toBe(54);
    expect(noteNameToMidi('Bb5')).toBe(82);
    expect(parseChordSymbol('Am7')).toEqual([69, 72, 76, 79]);
    expect(parseChordSymbol('G/B')).toEqual([59, 67, 71, 74]);
    expect(parseChordSymbol('Gdom7', 3)).toEqual([55, 59, 62, 65]);
    const p = parseMusicNotation('[C4 E4 G4]! Cmaj7 C5? D5@0.3');
    expect(p.events[0]!.notes).toEqual([60, 64, 67]);
    expect(p.events[0]!.velocity).toBe(1);
    expect(p.events[1]!.notes).toEqual([60, 64, 67, 71]);
    expect(p.events[1]!.velocity).toBe(0.8);
    expect(p.events[2]!.velocity).toBe(0.5);
    expect(p.events[3]!.velocity).toBe(0.3);
    expect(parseMusicNotation('G7').events[0]!.notes).toEqual([103]);
  });

  it('parses drum letters, combined hits and the step option', () => {
    const p = parseMusicNotation('k h s h | kh . [s c]! o |', { drums: true });
    expect(p.events.map((e) => e.drums.join(''))).toEqual(['k', 'h', 's', 'h', 'kh', 'sc', 'o']);
    expect(p.events[5]!.velocity).toBe(1);
    const s = parseMusicNotation('C4 D4 E4', { step: 0.5 });
    expect(s.events.map((e) => e.start)).toEqual([0, 0.5, 1]);
    expect(s.beats).toBe(1.5);
  });

  it('reports errors with position and hints', () => {
    expect(() => parseMusicNotation('C4 H4')).toThrow(/"H4" is not a note/);
    expect(() => parseMusicNotation('k z', { drums: true })).toThrow(/not a drum hit/);
    expect(() => parseMusicNotation('[C4 E4')).toThrow(/missing '\]'/);
    expect(() => defineSong({ bpm: 100, tracks: { a: { instrument: 'square', notes: 'C4 X' } } })).toThrow(/track "a"/);
  });
});

describe('songs', () => {
  const tiny = defineSong({
    bpm: 120,
    tracks: {
      lead: { instrument: 'square', notes: 'C5 E5 G5 . | A4 - - . |', effects: { reverb: 0.3 } },
      drums: { instrument: 'drums', notes: 'k h s h |' },
    },
  });

  it('derives duration from bpm and bars', () => {
    expect(songBarsToSeconds(8, 120)).toBe(16);
    const s = scheduleSong(tiny);
    expect(s.duration).toBe(4);
    expect(s.bars).toBe(2);
    expect(s.notes.filter((n) => n.drum === 'k').map((n) => n.start)).toEqual([0, 2]);
    const r = renderSong(tiny, { sampleRate: 22050 });
    expect(r.left.length).toBe(4 * 22050);
    expect(r.duration).toBe(4);
    expect(r.loopStart).toBe(0);
    expect(r.loopEnd).toBe(4);
  });

  it('plays sections in arrangement order; short patterns loop, empty strings silence', () => {
    const song = defineSong({
      bpm: 60,
      tracks: { a: { instrument: 'triangle' }, d: { instrument: 'drums', notes: 'k k k k |' } },
      sections: { A: { a: 'C4 - - - | D4 - - - |' }, B: { a: 'E4 - - - |', d: '' } },
      arrangement: ['A', 'A', 'B'],
    });
    const s = scheduleSong(song);
    expect(s.bars).toBe(5);
    expect(s.duration).toBe(20);
    expect(s.sections.map((x) => [x.name, x.start, x.bars])).toEqual([
      ['A', 0, 2],
      ['A', 8, 2],
      ['B', 16, 1],
    ]);
    expect(s.notes.filter((n) => n.drum).length).toBe(16);
    expect(s.notes.filter((n) => n.track === 'a').map((n) => n.pitch)).toEqual([60, 62, 60, 62, 64]);
  });

  it('swings off-beat eighths', () => {
    const song = defineSong({ bpm: 60, swing: 1 / 3, tracks: { a: { instrument: 'sine', notes: 'C4 D4 E4 F4 . . . . |' } } });
    const starts = scheduleSong(song).notes.map((n) => n.start);
    expect(starts[0]).toBeCloseTo(0);
    expect(starts[1]).toBeCloseTo(2 / 3);
    expect(starts[2]).toBeCloseTo(1);
    expect(starts[3]).toBeCloseTo(5 / 3);
  });

  it('voices chord symbols closely and breaks them into arpeggios', () => {
    const song = defineSong({
      bpm: 120,
      tracks: {
        pad: { instrument: 'pad', notes: 'C | G | Am | F |' },
        arp: { instrument: 'pluck', notes: 'C |', arp: { pattern: 'up', rate: 1 } },
      },
    });
    const s = scheduleSong(song);
    const pad = s.notes.filter((n) => n.track === 'pad').map((n) => n.pitch);
    expect(Math.max(...pad) - Math.min(...pad)).toBeLessThanOrEqual(12);
    const arp = s.notes.filter((n) => n.track === 'arp');
    expect(arp.length).toBe(16);
    expect(arp[4]!.start).toBeCloseTo(2);
    expect(arp[1]!.pitch).toBeGreaterThan(arp[0]!.pitch);
    expect(arp[3]!.pitch).toBe(arp[0]!.pitch);
  });

  it('renders deterministically and loops seamlessly', () => {
    const a = renderSong(tiny, { sampleRate: 22050 });
    const b = renderSong(tiny, { sampleRate: 22050 });
    expect(a.left).toEqual(b.left);
    const two = renderSong(tiny, { sampleRate: 22050, loops: 2 });
    const n = a.left.length;
    expect(two.left.length).toBe(2 * n);
    let diff = 0;
    for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(two.left[i]! - two.left[i + n]!));
    expect(diff).toBeLessThan(0.02);
    const an = analyzeAudio([a.left, a.right], 22050, { kind: 'music', loop: true });
    expect(an.clipped).toBe(0);
    expect(an.peakDb).toBeLessThanOrEqual(-0.9);
    expect(an.seamJump!).toBeLessThan(0.25);
  });

  it('counts notes outside the key', () => {
    const song = defineSong({ bpm: 100, key: 'C major', tracks: { a: { instrument: 'sine', notes: 'C4 E4 F#4 G4 |' } } });
    expect(analyzeSongKey(song)).toMatchObject({ total: 4, outOfKey: 1 });
  });
});

describe('encoders and analysis', () => {
  it('writes a valid 16-bit WAV header and round-trips samples', () => {
    const pcm = renderTone('sine', 1000, 0.1, SR, { gain: 0.5 });
    const wav = encodeWav(pcm, SR, 1);
    const view = new DataView(wav.buffer);
    const str = (o: number) => String.fromCharCode(...wav.subarray(o, o + 4));
    expect(str(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(str(8)).toBe('WAVE');
    expect(str(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(SR);
    expect(view.getUint32(28, true)).toBe(SR * 2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(str(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(pcm.length * 2);
    const back = decodeWav(wav);
    expect(back.sampleRate).toBe(SR);
    for (let i = 0; i < pcm.length; i += 97) expect(back.channels[0]![i]!).toBeCloseTo(pcm[i]!, 4);
  });

  it('de-interleaves stereo input', () => {
    const inter = new Float32Array([0.5, -0.5, 0.25, -0.25]);
    const back = decodeWav(encodeWav(inter, 8000, 2));
    expect(back.channels.length).toBe(2);
    expect([...back.channels[1]!].map((v) => Math.round(v * 4) / 4)).toEqual([-0.5, -0.25]);
  });

  it('encodes MP3 with lamejs', () => {
    const tone = renderTone('sine', 440, 0.5, SR, { gain: 0.5 });
    const info = mp3Info(encodeMp3([tone, tone], SR, 128));
    expect(info.frames).toBeGreaterThan(15);
    expect(info.sampleRate).toBe(SR);
    expect(info.channels).toBe(2);
    expect(info.kbps).toBe(128);
  });

  it('measures levels, silence, brightness and gives verdicts', () => {
    const sine = renderTone('sine', 1000, 0.5, SR, { gain: 0.5 });
    const a = analyzeAudio(sine, SR);
    expect(a.peakDb).toBeCloseTo(-6.02, 1);
    expect(a.rmsDb).toBeCloseTo(-9.03, 1);
    expect(a.centroidHz).toBeGreaterThan(900);
    expect(a.centroidHz).toBeLessThan(1150);
    expect(a.zcr).toBeCloseTo(2000, -1);
    expect(a.verdict).toBe('ok');
    expect(analyzeAudio(new Float32Array(1000), SR).verdict).toBe('silent');
    const hot = renderTone('square', 100, 0.2, SR, { gain: 1.2 });
    expect(analyzeAudio(hot, SR).verdict).toMatch(/clipping/);
    const quiet = renderTone('sine', 440, 0.3, SR, { gain: 0.05 });
    expect(analyzeAudio(quiet, SR).verdict).toMatch(/too quiet/);
    const late = new Float32Array(SR);
    late.set(renderTone('sine', 440, 0.3, SR, { gain: 0.5 }), SR / 2);
    const l = analyzeAudio(late, SR, { kind: 'sfx' });
    expect(l.leadingSilence).toBeCloseTo(0.5, 2);
    expect(l.verdict).toMatch(/late start/);
  });
});
