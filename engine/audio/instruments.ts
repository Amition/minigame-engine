import { TAU } from '../core/math';
import { Rng } from '../core/rng';
import {
  AUDIO_SAMPLE_RATE,
  adsrAt,
  AudioBiquad,
  AudioOsc,
  type AudioFilterType,
  makeWavetable,
  midiToFreq,
  pcmRemoveDc,
  type OscWave,
} from './dsp';

/**
 * A melodic instrument. Envelope times in seconds, frequencies in Hz.
 * `wave` picks the engine: an oscillator shape, 'pluck' (Karplus-Strong string) or 'fm' (2-operator FM:
 * bells, e-piano, marimba).
 */
export interface InstrumentDef {
  wave: Exclude<OscWave, 'wavetable'> | 'wavetable' | 'pluck' | 'fm';
  /** Pulse width for 'square', 0..1. */
  duty?: number;
  /** Harmonic amplitudes for 'wavetable' ([1, 0.5, 0.33] = first three partials). */
  harmonics?: readonly number[];
  /** Number of detuned oscillator copies (default 1). */
  unison?: number;
  /** Total detune spread of the unison copies, cents. */
  detune?: number;
  /** Sine sub-oscillator one octave down, level 0..1. */
  sub?: number;
  /** FM modulator/carrier frequency ratio (default 2). */
  fmRatio?: number;
  /** FM modulation index at note-on (brightness, default 2). */
  fmIndex?: number;
  /** Seconds for the FM index to fall by ~63% (default 0.5). */
  fmDecay?: number;
  /** Pluck: seconds for the string to ring down by 60 dB (default 1.5). */
  pluckDecay?: number;
  /** Pluck: excitation brightness 0..1 (default 0.6). */
  brightness?: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  filter?: AudioFilterType;
  /** Filter cutoff, Hz. */
  cutoff?: number;
  /** Filter Q (default 0.9). */
  resonance?: number;
  /** Extra cutoff at note-on, Hz, falling away over `filterDecay` seconds. */
  filterEnv?: number;
  filterDecay?: number;
  /** Pitch drop at note-on, semitones, settling over `pitchDecay` seconds. */
  pitchEnv?: number;
  pitchDecay?: number;
  /** Vibrato depth semitones, rate Hz, fade-in delay seconds. */
  vibrato?: number;
  vibratoRate?: number;
  vibratoDelay?: number;
  /** Tremolo depth 0..1 and rate Hz. */
  tremolo?: number;
  tremoloRate?: number;
  /** Saturation 0..1. */
  drive?: number;
  /** Output level (default 1). */
  gain?: number;
  /** Fraction of the notated length the note is held before release (default 0.9). */
  gate?: number;
}

export type InstrumentName =
  | 'square'
  | 'pulse'
  | 'triangle'
  | 'sine'
  | 'saw'
  | 'pluck'
  | 'bell'
  | 'epiano'
  | 'marimba'
  | 'organ'
  | 'pad'
  | 'bass'
  | 'drums';

/** Built-in instruments (everything except 'drums', which is a synthesized kit). */
export const audioInstruments: Record<Exclude<InstrumentName, 'drums'>, InstrumentDef> = {
  square: {
    wave: 'square',
    duty: 0.5,
    attack: 0.005,
    decay: 0.12,
    sustain: 0.6,
    release: 0.08,
    filter: 'lowpass',
    cutoff: 4500,
    vibrato: 0.12,
    vibratoRate: 5.5,
    vibratoDelay: 0.2,
    gain: 0.45,
  },
  pulse: {
    wave: 'square',
    duty: 0.25,
    attack: 0.004,
    decay: 0.1,
    sustain: 0.6,
    release: 0.07,
    filter: 'lowpass',
    cutoff: 5000,
    vibrato: 0.1,
    vibratoRate: 6,
    vibratoDelay: 0.18,
    gain: 0.45,
  },
  triangle: { wave: 'triangle', attack: 0.004, decay: 0.08, sustain: 0.8, release: 0.06, gain: 0.9 },
  sine: { wave: 'sine', attack: 0.006, decay: 0.1, sustain: 0.8, release: 0.1, gain: 0.9 },
  saw: {
    wave: 'saw',
    unison: 2,
    detune: 12,
    attack: 0.005,
    decay: 0.2,
    sustain: 0.6,
    release: 0.1,
    filter: 'lowpass',
    cutoff: 1600,
    resonance: 1.2,
    filterEnv: 2600,
    filterDecay: 0.25,
    gain: 0.4,
  },
  pluck: { wave: 'pluck', pluckDecay: 1.4, brightness: 0.6, attack: 0.001, sustain: 1, release: 0.12, gain: 0.8 },
  bell: {
    wave: 'fm',
    fmRatio: 3.5,
    fmIndex: 3,
    fmDecay: 0.8,
    attack: 0.002,
    decay: 1.6,
    sustain: 0,
    release: 0.6,
    gain: 0.45,
    gate: 1,
  },
  epiano: {
    wave: 'fm',
    fmRatio: 1,
    fmIndex: 1.6,
    fmDecay: 0.45,
    attack: 0.003,
    decay: 1.4,
    sustain: 0.25,
    release: 0.3,
    tremolo: 0.15,
    tremoloRate: 4.5,
    gain: 0.6,
  },
  marimba: {
    wave: 'fm',
    fmRatio: 4,
    fmIndex: 1.4,
    fmDecay: 0.04,
    attack: 0.001,
    decay: 0.5,
    sustain: 0,
    release: 0.1,
    gain: 0.8,
    gate: 1,
  },
  organ: {
    wave: 'wavetable',
    harmonics: [1, 0.6, 0.35, 0.25, 0, 0.12, 0, 0.08],
    attack: 0.01,
    decay: 0.05,
    sustain: 0.9,
    release: 0.08,
    tremolo: 0.1,
    tremoloRate: 6,
    gain: 0.5,
  },
  pad: {
    wave: 'saw',
    unison: 3,
    detune: 18,
    attack: 0.35,
    decay: 0.6,
    sustain: 0.75,
    release: 0.7,
    filter: 'lowpass',
    cutoff: 1300,
    resonance: 0.8,
    tremolo: 0.08,
    tremoloRate: 3,
    gain: 0.28,
    gate: 1,
  },
  bass: {
    wave: 'saw',
    sub: 0.7,
    attack: 0.004,
    decay: 0.18,
    sustain: 0.6,
    release: 0.06,
    filter: 'lowpass',
    cutoff: 420,
    resonance: 1.3,
    filterEnv: 1500,
    filterDecay: 0.12,
    drive: 0.2,
    gain: 0.55,
  },
};

const tableCache = new Map<string, Float32Array>();

/**
 * Renders one note: `gate` seconds held, then the release. Mono, deterministic for the same inputs.
 * `velocity` 0..1 scales the level (and brightness of plucks/FM).
 */
export function renderInstrumentNote(
  inst: InstrumentDef,
  midi: number,
  gate: number,
  velocity = 0.8,
  sampleRate = AUDIO_SAMPLE_RATE,
  seed = 1,
): Float32Array {
  const sr = sampleRate;
  const f0 = midiToFreq(midi);
  const env = {
    attack: inst.attack ?? 0.005,
    decay: inst.decay ?? 0.1,
    sustain: inst.sustain ?? 0.8,
    release: inst.release ?? 0.1,
  };
  const n = Math.max(1, Math.ceil((gate + env.release) * sr));
  const out = new Float32Array(n);
  const gain = (inst.gain ?? 1) * velocity;
  const vib = inst.vibrato ?? 0;
  const vibRate = inst.vibratoRate ?? 5.5;
  const vibDelay = inst.vibratoDelay ?? 0;
  const trem = inst.tremolo ?? 0;
  const tremRate = inst.tremoloRate ?? 5;
  const pEnv = inst.pitchEnv ?? 0;
  const pDecay = Math.max(0.001, inst.pitchDecay ?? 0.05);
  const pitchAt = (t: number): number => {
    let st = 0;
    if (pEnv) st += pEnv * Math.exp(-t / pDecay);
    if (vib) st += vib * Math.sin(TAU * vibRate * t) * Math.min(1, vibDelay > 0 ? t / vibDelay : 1);
    return st === 0 ? f0 : f0 * Math.pow(2, st / 12);
  };

  if (inst.wave === 'pluck') {
    const rng = new Rng(seed ^ (midi * 7919));
    const period = sr / f0;
    const decay = inst.pluckDecay ?? 1.4;
    const loss = Math.pow(0.001, 1 / Math.max(1, f0 * decay));
    const bright = Math.min(1, Math.max(0.05, (inst.brightness ?? 0.6) * (0.6 + 0.4 * velocity)));
    const burst = Math.max(2, Math.round(period));
    let lpState = 0;
    const d = period - 0.5;
    for (let i = 0; i < n; i++) {
      let x = 0;
      if (i < burst) {
        lpState += (rng.next() * 2 - 1 - lpState) * bright;
        x = lpState;
      }
      const j = i - d;
      let fb = 0;
      if (j >= 1) {
        const j0 = Math.floor(j);
        const fr = j - j0;
        const a = out[j0]! * (1 - fr) + out[j0 + 1 < i ? j0 + 1 : j0]! * fr;
        const b = out[j0 - 1]! * (1 - fr) + out[j0]! * fr;
        fb = 0.5 * (a + b) * loss;
      }
      out[i] = x + fb;
    }
    pcmRemoveDc(out, sr, 30);
    for (let i = 0; i < n; i++) out[i]! *= adsrAt(env, i / sr, gate) * gain;
    return out;
  }

  if (inst.wave === 'fm') {
    const ratio = inst.fmRatio ?? 2;
    const index = (inst.fmIndex ?? 2) * (0.5 + 0.5 * velocity);
    const idxDecay = Math.max(0.001, inst.fmDecay ?? 0.5);
    let pc = 0;
    let pm = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = pitchAt(t);
      pm += (f * ratio) / sr;
      pm -= Math.floor(pm);
      const mod = Math.sin(TAU * pm) * index * Math.exp(-t / idxDecay);
      pc += f / sr;
      pc -= Math.floor(pc);
      let e = adsrAt(env, t, gate) * gain;
      if (trem) e *= 1 - trem * (0.5 + 0.5 * Math.sin(TAU * tremRate * t));
      out[i] = Math.sin(TAU * pc + mod) * e;
    }
    return out;
  }

  const unison = Math.max(1, Math.round(inst.unison ?? 1));
  const spread = inst.detune ?? 0;
  let table: Float32Array | null = null;
  if (inst.wave === 'wavetable') {
    const key = (inst.harmonics ?? [1]).join(',');
    table = tableCache.get(key) ?? null;
    if (!table) tableCache.set(key, (table = makeWavetable(inst.harmonics ?? [1])));
  }
  const oscs: { osc: AudioOsc; ratio: number }[] = [];
  const phaseRng = new Rng(seed + midi);
  for (let u = 0; u < unison; u++) {
    const cents = unison === 1 ? 0 : (u / (unison - 1) - 0.5) * spread;
    const osc = new AudioOsc(inst.wave, sr, seed + u * 101, table);
    osc.duty = inst.duty ?? 0.5;
    if (unison > 1) osc.phase = phaseRng.next();
    oscs.push({ osc, ratio: Math.pow(2, cents / 1200) });
  }
  const oscNorm = 1 / Math.sqrt(unison);
  const sub = inst.sub ?? 0;
  const subOsc = sub > 0 ? new AudioOsc('sine', sr) : null;
  const filt = inst.filter ? new AudioBiquad(inst.filter, inst.cutoff ?? 2000, inst.resonance ?? 0.9, sr) : null;
  const cutoff = inst.cutoff ?? 2000;
  const fEnv = inst.filterEnv ?? 0;
  const fDecay = Math.max(0.001, inst.filterDecay ?? 0.2);
  const drive = inst.drive ?? 0;
  const driveK = 1 + drive * 8;
  const driveNorm = drive > 0 ? 1 / Math.tanh(driveK) : 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = pitchAt(t);
    let s = 0;
    for (const o of oscs) s += o.osc.next(f * o.ratio);
    s *= oscNorm;
    if (subOsc) s += subOsc.next(f * 0.5) * sub;
    if (filt) {
      if (fEnv && (i & 15) === 0) filt.set(cutoff + fEnv * Math.exp(-t / fDecay));
      s = filt.process(s);
    }
    if (drive > 0) s = Math.tanh(driveK * s) * driveNorm;
    let e = adsrAt(env, t, gate) * gain;
    if (trem) e *= 1 - trem * (0.5 + 0.5 * Math.sin(TAU * tremRate * t));
    out[i] = s * e;
  }
  return out;
}

// ---------------------------------------------------------------- drums

/** Default stereo offset per drum letter (added to the track pan). */
export const DRUM_PAN: Record<string, number> = { h: 0.25, o: 0.25, p: 0.35, t: -0.2, l: 0.2, x: -0.3, b: -0.15 };

const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];

function metalBank(n: number, sr: number, freqs: readonly number[], mult: number): Float32Array {
  const out = new Float32Array(n);
  const oscs = freqs.map((f) => ({ osc: new AudioOsc('square', sr), f: f * mult }));
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const o of oscs) s += o.osc.next(o.f);
    out[i] = s / oscs.length;
  }
  return out;
}

const drumCache = new Map<string, Float32Array>();

/**
 * One synthesized drum hit (see DRUM_LETTERS). Cached per letter and sample rate; do not mutate the result.
 */
export function renderDrumHit(letter: string, sampleRate = AUDIO_SAMPLE_RATE): Float32Array {
  const key = `${letter}@${sampleRate}`;
  const hit = drumCache.get(key);
  if (hit) return hit;
  const sr = sampleRate;
  const rng = new Rng(0x5eed + letter.charCodeAt(0));
  const noise = () => rng.next() * 2 - 1;
  const len = (s: number) => Math.ceil(s * sr);
  let out: Float32Array;
  switch (letter) {
    case 'k': {
      out = new Float32Array(len(0.45));
      let ph = 0;
      const hp = new AudioBiquad('highpass', 1500, 0.7, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const f = 48 + 120 * Math.exp(-t / 0.03);
        ph += f / sr;
        const body = Math.sin(TAU * ph) * Math.exp(-t / 0.16) * Math.min(1, t / 0.001);
        const click = i < len(0.004) ? hp.process(noise()) * (1 - i / len(0.004)) * 0.5 : 0;
        out[i] = Math.tanh(1.8 * (body + click)) / Math.tanh(1.8);
      }
      break;
    }
    case 's': {
      out = new Float32Array(len(0.3));
      let ph = 0;
      const hp = new AudioBiquad('highpass', 1400, 0.7, sr);
      const lp = new AudioBiquad('lowpass', 9000, 0.7, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        ph += (185 + 60 * Math.exp(-t / 0.01)) / sr;
        const tone = Math.sin(TAU * ph) * Math.exp(-t / 0.045) * 0.55;
        const sn = lp.process(hp.process(noise())) * Math.exp(-t / 0.075) * 0.9;
        out[i] = tone + sn;
      }
      break;
    }
    case 'h':
    case 'o': {
      const open = letter === 'o';
      out = metalBank(len(open ? 0.5 : 0.09), sr, HAT_FREQS, 1.4);
      const bp = new AudioBiquad('bandpass', 10000, 1, sr);
      const hp = new AudioBiquad('highpass', 7000, 0.7, sr);
      const tau = open ? 0.16 : 0.018;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const s = hp.process(bp.process(out[i]! + noise() * 0.3));
        out[i] = s * Math.exp(-t / tau) * Math.min(1, t / 0.0005) * 1.25;
      }
      break;
    }
    case 'c': {
      out = new Float32Array(len(0.35));
      const bp = new AudioBiquad('bandpass', 1100, 1.2, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        let e = 0;
        for (const b of [0, 0.011, 0.022]) if (t >= b && t < b + 0.012) e = Math.max(e, Math.exp(-(t - b) / 0.004));
        if (t >= 0.028) e = Math.max(e, 0.8 * Math.exp(-(t - 0.028) / 0.08));
        out[i] = bp.process(noise()) * e * 2.2;
      }
      break;
    }
    case 't':
    case 'l': {
      const low = letter === 'l';
      out = new Float32Array(len(0.5));
      let ph = 0;
      const [fEnd, fStart] = low ? [78, 125] : [118, 175];
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        ph += (fEnd + (fStart - fEnd) * Math.exp(-t / 0.06)) / sr;
        out[i] = (Math.sin(TAU * ph) * 0.9 + noise() * 0.08 * Math.exp(-t / 0.01)) * Math.exp(-t / 0.2);
      }
      break;
    }
    case 'x': {
      out = metalBank(len(1.6), sr, HAT_FREQS, 1.1);
      const hp = new AudioBiquad('highpass', 4000, 0.7, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        out[i] = hp.process(out[i]! * 0.6 + noise() * 0.6) * Math.exp(-t / 0.55) * Math.min(1, t / 0.002) * 0.9;
      }
      break;
    }
    case 'r': {
      out = new Float32Array(len(0.07));
      const bp = new AudioBiquad('bandpass', 1800, 2.5, sr);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        ph += 820 / sr;
        out[i] = (bp.process(noise()) * 1.5 + Math.sin(TAU * ph) * 0.5) * Math.exp(-t / 0.012);
      }
      break;
    }
    case 'b': {
      out = metalBank(len(0.3), sr, [540, 800], 1);
      const bp = new AudioBiquad('bandpass', 900, 1.5, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        out[i] = bp.process(out[i]!) * (t < 0.02 ? 1 : Math.exp(-(t - 0.02) / 0.07)) * 1.4;
      }
      break;
    }
    case 'p': {
      out = new Float32Array(len(0.1));
      const hp = new AudioBiquad('highpass', 6000, 0.7, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const e = t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) / 0.025);
        out[i] = hp.process(noise()) * e * 0.7;
      }
      break;
    }
    default:
      throw new Error(`unknown drum "${letter}"`);
  }
  drumCache.set(key, out);
  return out;
}

/** Resolves a built-in instrument name or passes a custom definition through. */
export function resolveInstrument(inst: InstrumentName | InstrumentDef): InstrumentDef | 'drums' {
  if (typeof inst !== 'string') return inst;
  if (inst === 'drums') return 'drums';
  const def = audioInstruments[inst];
  if (!def) throw new Error(`unknown instrument "${inst}" (have: ${Object.keys(audioInstruments).join(', ')}, drums)`);
  return def;
}
