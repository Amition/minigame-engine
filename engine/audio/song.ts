import { Rng } from '../core/rng';
import {
  AUDIO_SAMPLE_RATE,
  audioPanGains,
  AudioReverb,
  type AudioReverbOptions,
  dbToGain,
  pcmBitcrush,
  pcmDrive,
  pcmFadeOut,
  pcmFilter,
  pcmLimit,
  pcmPingPong,
  pcmRemoveDc,
  pcmRms,
} from './dsp';
import {
  DRUM_PAN,
  type InstrumentDef,
  type InstrumentName,
  renderDrumHit,
  renderInstrumentNote,
  resolveInstrument,
} from './instruments';
import { parseMusicNotation, type ParsedNotation } from './notation';

/** Per-track effects. Delay time is in beats so it follows the tempo. */
export interface SongTrackEffects {
  /** Send level 0..1 into the song's shared reverb. */
  reverb?: number;
  /** Ping-pong delay: time in beats (0.75 = dotted eighth), feedback 0..1, mix 0..1. */
  delay?: { time: number; feedback?: number; mix?: number };
  lowpass?: number;
  highpass?: number;
  /** Saturation 0..1. */
  drive?: number;
  /** Bit depth for lo-fi (e.g. 8). */
  crush?: number;
}

/** How chords are broken into arpeggios: pattern and notes per beat (4 = sixteenths). */
export interface SongArp {
  pattern: 'up' | 'down' | 'updown' | 'random';
  rate?: number;
  /** Octaves spanned (default 1). */
  octaves?: number;
}

export interface SongTrackDef {
  /** Built-in name or a custom InstrumentDef. 'drums' makes the notation read drum letters. */
  instrument: InstrumentName | InstrumentDef;
  /**
   * Default pattern (see parseMusicNotation for the grammar). Used for the whole song when there are no
   * sections, and for every section that does not mention this track. Patterns shorter than their section loop.
   */
  notes?: string;
  /** Level 0..1 (default 0.7). */
  volume?: number;
  /** Stereo position -1..1 (default 0). */
  pan?: number;
  /** Register for chord symbols (default 4): they are voiced around the middle of this octave. */
  octave?: number;
  /**
   * 'close' (default): each chord symbol uses the inversion nearest the middle of `octave`, so progressions
   * move smoothly (C–G–Am–F stays in one register). 'root': root position starting at `octave`.
   */
  voicing?: 'close' | 'root';
  /** Semitones added to every note. */
  transpose?: number;
  /** Fraction of the notated length that is held (default: instrument gate, usually 0.9). */
  gate?: number;
  /** Fixed slot length in beats instead of splitting each bar evenly. */
  step?: number;
  /** Break chords into arpeggios. */
  arp?: SongArp;
  /** Random timing (seconds, always late) and velocity (±fraction) variation, seeded. */
  humanize?: { time?: number; velocity?: number };
  effects?: SongTrackEffects;
}

/**
 * A song as data. Minimal:
 *
 *     defineSong({ bpm: 120, tracks: { lead: { instrument: 'square', notes: 'C5 E5 G5 . | A4 - - . |' } } })
 *
 * With sections: `sections.A = { lead: '...', bass: '...' }` (track name → pattern), played in `arrangement`
 * order. A section's length is its longest pattern (in bars); shorter patterns loop, '' silences a track.
 */
export interface SongDef {
  bpm: number;
  /** e.g. 'C major', 'A minor', 'F#m'. Only used for the out-of-key check (analyzeSongKey). */
  key?: string;
  /** Delays off-beat eighths: 0 straight, 0.33 triplet shuffle, 0.5 hard swing. */
  swing?: number;
  /** Swing grid: 8 (eighths, default) or 16. */
  swingUnit?: 8 | 16;
  /** Beats per bar (default 4). */
  beatsPerBar?: number;
  /** Length in bars when there are no sections (default: the longest track pattern). */
  bars?: number;
  tracks: Record<string, SongTrackDef>;
  sections?: Record<string, Record<string, string>>;
  arrangement?: readonly string[];
  /** Loop seamlessly (default true): tails wrap around to the start. False = one-shot jingle with a tail. */
  loop?: boolean;
  master?: {
    /** Shared reverb settings. */
    reverb?: AudioReverbOptions;
    /** Target RMS loudness, dBFS (default -16). */
    loudness?: number;
    /** Peak ceiling, dBFS (default -1). */
    ceiling?: number;
  };
  /** Seed for humanize, arp 'random' and pluck noise. */
  seed?: number;
  /** MP3 bitrate the audio CLI uses for this song (default 128 kbps). */
  kbps?: number;
}

/** One scheduled note, seconds. `pitch` is a MIDI note (-1 for drums). */
export interface SongNote {
  track: string;
  section: string;
  start: number;
  dur: number;
  pitch: number;
  drum: string | null;
  velocity: number;
}

export interface SongSchedule {
  notes: SongNote[];
  duration: number;
  beats: number;
  bars: number;
  secondsPerBeat: number;
  sections: { name: string; start: number; bars: number }[];
}

export interface RenderedSong {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  duration: number;
  /** Loop region in seconds (looping songs only). */
  loopStart?: number;
  loopEnd?: number;
  schedule: SongSchedule;
}

export interface RenderSongOptions {
  sampleRate?: number;
  /** How many times the arrangement is rendered back to back (default 1). */
  loops?: number;
}

function trackPatternOptions(song: SongDef, track: SongTrackDef) {
  return {
    drums: track.instrument === 'drums',
    beatsPerBar: song.beatsPerBar ?? 4,
    octave: track.octave ?? 4,
    ...(track.step ? { step: track.step } : {}),
  };
}

/** Validates a song (parses every pattern) and returns it unchanged. Throws with the track/section on errors. */
export function defineSong(song: SongDef): SongDef {
  if (!(song.bpm > 0)) throw new Error('defineSong: bpm must be > 0');
  for (const [name, t] of Object.entries(song.tracks)) {
    resolveInstrument(t.instrument);
    if (t.notes !== undefined) parsePattern(song, name, t.notes, '(track)');
  }
  for (const [sec, map] of Object.entries(song.sections ?? {})) {
    for (const [name, text] of Object.entries(map)) {
      if (!song.tracks[name]) throw new Error(`defineSong: section "${sec}" uses unknown track "${name}"`);
      parsePattern(song, name, text, sec);
    }
  }
  for (const s of song.arrangement ?? []) {
    if (!song.sections?.[s]) throw new Error(`defineSong: arrangement uses unknown section "${s}"`);
  }
  return song;
}

function parsePattern(song: SongDef, trackName: string, text: string, where: string): ParsedNotation {
  try {
    return parseMusicNotation(text, trackPatternOptions(song, song.tracks[trackName]!));
  } catch (e) {
    throw new Error(`song track "${trackName}" ${where}: ${(e as Error).message}`);
  }
}

/** Inversion/octave of `chord` whose average pitch is closest to `center`; a slash bass stays below it. */
function voiceClose(chord: readonly number[], bass: number | null, center: number): number[] {
  let best: number[] = [...chord];
  let bestD = Infinity;
  for (let inv = 0; inv < chord.length; inv++) {
    for (const shift of [-24, -12, 0, 12]) {
      const v = chord.map((n, i) => (i < inv ? n + 12 : n) + shift).sort((a, b) => a - b);
      const d = Math.abs(v.reduce((s, n) => s + n, 0) / v.length - center);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = v;
      }
    }
  }
  if (bass !== null) {
    let b = bass;
    while (b >= best[0]!) b -= 12;
    while (b + 12 < best[0]!) b += 12;
    best.unshift(b);
  }
  return best;
}

function swingWarp(beat: number, amount: number, unit: number): number {
  if (!amount) return beat;
  const base = Math.floor(beat / unit + 1e-9) * unit;
  const f = (beat - base) / unit;
  const mid = 0.5 * (1 + amount);
  return base + unit * (f <= 0.5 ? f * 2 * mid : mid + (f - 0.5) * 2 * (1 - mid));
}

/** Flattens a song into timed notes (no audio). `loops` repeats the arrangement. */
export function scheduleSong(song: SongDef, loops = 1): SongSchedule {
  const bpb = song.beatsPerBar ?? 4;
  const spb = 60 / song.bpm;
  const swing = Math.min(0.9, Math.max(0, song.swing ?? 0));
  const unit = song.swingUnit === 16 ? 0.5 : 1;
  const trackNames = Object.keys(song.tracks);
  const order = song.sections && song.arrangement?.length ? [...song.arrangement] : [''];
  const notes: SongNote[] = [];
  const sections: SongSchedule['sections'] = [];
  const rng = new Rng(song.seed ?? 1);
  let beat0 = 0;
  for (let loop = 0; loop < Math.max(1, loops); loop++) {
    for (const secName of order) {
      const sec = secName ? song.sections![secName]! : {};
      const patterns = new Map<string, ParsedNotation>();
      let own = 0;
      let dflt = 0;
      for (const name of trackNames) {
        const text = sec[name] ?? song.tracks[name]!.notes;
        if (text === undefined) continue;
        const p = parsePattern(song, name, text, secName || '(track)');
        patterns.set(name, p);
        if (sec[name] !== undefined) own = Math.max(own, p.beats);
        else dflt = Math.max(dflt, p.beats);
      }
      let beats = secName ? own || dflt || (song.bars ?? 0) * bpb : song.bars ? song.bars * bpb : dflt;
      beats = Math.ceil(beats / bpb - 1e-9) * bpb;
      sections.push({ name: secName, start: beat0 * spb, bars: beats / bpb });
      for (const [name, p] of patterns) {
        if (p.beats <= 0) continue;
        const track = song.tracks[name]!;
        const hum = track.humanize;
        const inst = resolveInstrument(track.instrument);
        const gate = track.gate ?? (inst === 'drums' ? 1 : (inst.gate ?? 0.9));
        const tr = track.transpose ?? 0;
        const center = 12 * ((track.octave ?? 4) + 1) + 7;
        const close = track.voicing !== 'root';
        for (let rep = 0; rep * p.beats < beats - 1e-9; rep++) {
          for (const src of p.events) {
            const ev = close && src.symbol ? { ...src, notes: voiceClose(src.symbol.chord, src.symbol.bass, center) } : src;
            const s = rep * p.beats + ev.start;
            if (s >= beats - 1e-9) break;
            const e = Math.min(beats, s + ev.dur);
            const push = (bs: number, be: number, pitch: number, drum: string | null) => {
              const ts = swingWarp(beat0 + bs, swing, unit) * spb;
              const te = swingWarp(beat0 + be, swing, unit) * spb;
              const jitter = hum?.time ? rng.next() * hum.time : 0;
              const vj = hum?.velocity ? 1 + rng.float(-1, 1) * hum.velocity : 1;
              notes.push({
                track: name,
                section: secName,
                start: ts + jitter,
                dur: Math.max(0.005, (te - ts) * (drum ? 1 : gate)),
                pitch,
                drum,
                velocity: Math.min(1, Math.max(0.05, ev.velocity * vj)),
              });
            };
            if (ev.drums.length) {
              for (const d of ev.drums) push(s, e, -1, d);
            } else if (track.arp && ev.notes.length > 1) {
              const rate = track.arp.rate ?? 4;
              const octs = Math.max(1, track.arp.octaves ?? 1);
              const base = [...ev.notes].sort((a, b) => a - b);
              let seq: number[] = [];
              for (let o = 0; o < octs; o++) seq.push(...base.map((n) => n + 12 * o));
              if (track.arp.pattern === 'down') seq.reverse();
              else if (track.arp.pattern === 'updown') seq = [...seq, ...seq.slice(1, -1).reverse()];
              const stepB = 1 / rate;
              let k = 0;
              for (let b = s; b < e - 1e-9; b += stepB, k++) {
                const pitch = track.arp.pattern === 'random' ? rng.pick(seq) : seq[k % seq.length]!;
                push(b, Math.min(e, b + stepB), pitch + tr, null);
              }
            } else {
              for (const n of ev.notes) push(s, e, n + tr, null);
            }
          }
        }
      }
      beat0 += beats;
    }
  }
  notes.sort((a, b) => a.start - b.start);
  return { notes, duration: beat0 * spb, beats: beat0, bars: beat0 / bpb, secondsPerBeat: spb, sections };
}

/** Seconds for `bars` bars at `bpm` (4/4 unless beatsPerBar is given). */
export const songBarsToSeconds = (bars: number, bpm: number, beatsPerBar = 4): number => (bars * beatsPerBar * 60) / bpm;

/**
 * Renders a song to stereo PCM. Looping songs are exactly `loops` × arrangement long, with reverb/release tails
 * wrapped to the start so the end flows seamlessly into the beginning. Loudness is normalised to
 * `master.loudness` and peaks are limited to `master.ceiling`.
 */
export function renderSong(song: SongDef, opts: RenderSongOptions = {}): RenderedSong {
  const sr = opts.sampleRate ?? AUDIO_SAMPLE_RATE;
  const loops = Math.max(1, opts.loops ?? 1);
  const loop = song.loop ?? true;
  const schedule = scheduleSong(song, loops);
  const body = Math.max(1, Math.round(schedule.duration * sr));
  const tailSec = 4;
  const total = body + Math.ceil(tailSec * sr);
  const mL = new Float32Array(total);
  const mR = new Float32Array(total);
  const verbBus = new Float32Array(total);
  let verbUsed = false;
  const byTrack = new Map<string, SongNote[]>();
  for (const n of schedule.notes) {
    let list = byTrack.get(n.track);
    if (!list) byTrack.set(n.track, (list = []));
    list.push(n);
  }
  let seed = song.seed ?? 1;
  for (const [name, track] of Object.entries(song.tracks)) {
    seed++;
    const list = byTrack.get(name);
    if (!list?.length) continue;
    const inst = resolveInstrument(track.instrument);
    const tL = new Float32Array(total);
    const tR = new Float32Array(total);
    const pan = track.pan ?? 0;
    const cache = new Map<string, Float32Array>();
    for (const n of list) {
      const at = Math.round(n.start * sr);
      let buf: Float32Array;
      let notePan = pan;
      let vel = n.velocity;
      if (inst === 'drums') {
        buf = renderDrumHit(n.drum!, sr);
        notePan = Math.max(-1, Math.min(1, pan + (DRUM_PAN[n.drum!] ?? 0)));
      } else {
        const gateS = Math.round(n.dur * sr);
        const key = `${n.pitch}|${gateS}|${Math.round(n.velocity * 50)}`;
        let b = cache.get(key);
        if (!b) cache.set(key, (b = renderInstrumentNote(inst, n.pitch, gateS / sr, Math.round(n.velocity * 50) / 50, sr, seed)));
        buf = b;
        vel = 1;
      }
      const [gl, gr] = audioPanGains(notePan);
      const end = Math.min(total, at + buf.length);
      for (let i = Math.max(0, at); i < end; i++) {
        const v = buf[i - at]! * vel;
        tL[i]! += v * gl;
        tR[i]! += v * gr;
      }
    }
    const fx = track.effects ?? {};
    for (const ch of [tL, tR]) {
      if (fx.highpass) pcmFilter(ch, 'highpass', fx.highpass, { sampleRate: sr });
      if (fx.lowpass) pcmFilter(ch, 'lowpass', fx.lowpass, { sampleRate: sr });
      if (fx.drive) pcmDrive(ch, fx.drive);
      if (fx.crush) pcmBitcrush(ch, fx.crush);
    }
    if (fx.delay) {
      pcmPingPong(tL, tR, sr, fx.delay.time * schedule.secondsPerBeat, fx.delay.feedback ?? 0.35, fx.delay.mix ?? 0.3);
    }
    const vol = track.volume ?? 0.7;
    const send = fx.reverb ?? 0;
    if (send > 0) verbUsed = true;
    for (let i = 0; i < total; i++) {
      const l = tL[i]! * vol;
      const r = tR[i]! * vol;
      mL[i]! += l;
      mR[i]! += r;
      if (send > 0) verbBus[i]! += (l + r) * 0.5 * send;
    }
  }
  if (verbUsed) new AudioReverb(sr, { room: 0.7, damp: 0.45, ...song.master?.reverb }).processInto(verbBus, mL, mR, 1);
  pcmRemoveDc(mL, sr, 12);
  pcmRemoveDc(mR, sr, 12);

  let left: Float32Array;
  let right: Float32Array;
  if (loop) {
    left = mL.slice(0, body);
    right = mR.slice(0, body);
    for (let i = body; i < total; i++) {
      left[i % body]! += mL[i]!;
      right[i % body]! += mR[i]!;
    }
  } else {
    let last = total - 1;
    while (last > body && Math.abs(mL[last]!) < 1e-4 && Math.abs(mR[last]!) < 1e-4) last--;
    left = mL.slice(0, last + 1);
    right = mR.slice(0, last + 1);
  }
  const rms = pcmRms([left, right]);
  if (rms > 0) {
    const g = Math.min(20, dbToGain(song.master?.loudness ?? -16) / rms);
    for (let i = 0; i < left.length; i++) {
      left[i]! *= g;
      right[i]! *= g;
    }
  }
  const ceiling = dbToGain(song.master?.ceiling ?? -1);
  if (loop) {
    const n = left.length;
    const l2 = new Float32Array(n * 2);
    const r2 = new Float32Array(n * 2);
    l2.set(left);
    l2.set(left, n);
    r2.set(right);
    r2.set(right, n);
    pcmLimit([l2, r2], sr, ceiling);
    left = l2.slice(n);
    right = r2.slice(n);
  } else {
    pcmLimit([left, right], sr, ceiling);
    pcmFadeOut(left, 0.01, sr);
    pcmFadeOut(right, 0.01, sr);
  }
  const duration = left.length / sr;
  return {
    left,
    right,
    sampleRate: sr,
    duration,
    ...(loop ? { loopStart: 0, loopEnd: duration } : {}),
    schedule,
  };
}

const KEY_RE = /^([A-G])(#|b)?\s*(m|min|minor|maj|major)?$/i;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/**
 * Counts notes outside the song's `key` (natural minor for minor keys; the raised 7th of harmonic minor is
 * allowed). Useful as a sanity check for generated melodies.
 */
export function analyzeSongKey(song: SongDef): { key: string; total: number; outOfKey: number; examples: string[] } {
  const res = { key: song.key ?? '', total: 0, outOfKey: 0, examples: [] as string[] };
  const m = song.key ? KEY_RE.exec(song.key.trim()) : null;
  if (!m) return res;
  const root = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[m[1]!.toUpperCase()]! +
    (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const q = m[3] ?? '';
  const minor = q === 'm' || /^min/i.test(q);
  const scale = new Set((minor ? [...MINOR, 11] : MAJOR).map((s) => (root + s) % 12));
  for (const n of scheduleSong(song).notes) {
    if (n.drum) continue;
    res.total++;
    if (!scale.has(((n.pitch % 12) + 12) % 12)) {
      res.outOfKey++;
      if (res.examples.length < 5) res.examples.push(`${n.track}@${n.start.toFixed(2)}s`);
    }
  }
  return res;
}
