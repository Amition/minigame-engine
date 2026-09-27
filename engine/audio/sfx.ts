import { TAU } from '../core/math';
import { Rng } from '../core/rng';
import {
  AUDIO_SAMPLE_RATE,
  AudioBiquad,
  AudioOsc,
  pcmBitcrush,
  pcmDelay,
  pcmDrive,
  pcmFadeIn,
  pcmFadeOut,
  pcmMixInto,
  pcmNormalize,
  pcmPeak,
  pcmRemoveDc,
  pcmReverb,
  pcmTrimEnd,
} from './dsp';

export type SfxWave = 'square' | 'saw' | 'sine' | 'triangle' | 'noise' | 'white' | 'metallic';

/**
 * Parametric sound effect in the spirit of sfxr, with physical units. Only `wave` and `freq` are required.
 *
 * Timeline: attack (ramp up) → sustain (full level, +punch) → decay (to silence). Length = attack+sustain+decay.
 * Pitch at time t: freq · 2^((slide·t + ½·slideAccel·t² + arp step + vibrato) / 12); `repeat` restarts t for
 * the pitch terms. Voice processing order: oscillator (+noiseMix) → envelope/tremolo → filters → flanger →
 * drive → crush. Then layers are mixed in and the root's echo → reverb → normalise-to-`volume` apply to the mix.
 */
export interface SfxParams {
  /** 'noise' = sfxr noise whose colour follows `freq`; 'white' = plain hiss; 'metallic' = pitched LFSR noise. */
  wave: SfxWave;
  /** Start frequency, Hz. */
  freq: number;
  /** Seconds of linear fade-in. Default 0. */
  attack?: number;
  /** Seconds at full level. Default 0.1. */
  sustain?: number;
  /** Seconds of fade-out to silence. Default 0.2. */
  decay?: number;
  /** Extra level at the start of the sustain phase, 0..1 (sfxr "punch"). */
  punch?: number;
  /** Shape of the decay: 1 = linear, 2 = default (quadratic), 3+ = snappier. */
  decayCurve?: number;
  /** Pitch slide in semitones per second (negative falls). */
  slide?: number;
  /** Change of the slide in semitones per second² (curves the slide). */
  slideAccel?: number;
  /** The sound is cut when a falling pitch passes this, Hz. Default 20. */
  freqMin?: number;
  /** Pitch ceiling, Hz. Default 16000. */
  freqMax?: number;
  /** Square duty 0..1. Default 0.5. */
  duty?: number;
  /** Duty change per second. */
  dutySweep?: number;
  /** Vibrato depth, semitones. */
  vibrato?: number;
  /** Vibrato rate, Hz. Default 6. */
  vibratoRate?: number;
  /** Arpeggio: semitone offsets stepped through every `arpStep` seconds ([0, 4, 7]); a number = one jump. */
  arp?: number | readonly number[];
  /** Seconds per arpeggio step. Default 0.08. */
  arpStep?: number;
  /** Restart pitch slide/arp every n seconds (sfxr "repeat speed"). */
  repeat?: number;
  /** Tremolo depth 0..1. */
  tremolo?: number;
  /** Tremolo rate, Hz. Default 8. */
  tremoloRate?: number;
  /** Low-pass cutoff, Hz. */
  lowpass?: number;
  /** Low-pass resonance (Q). Default 0.9. */
  lowpassQ?: number;
  /** Low-pass cutoff sweep, octaves per second. */
  lowpassSweep?: number;
  /** High-pass cutoff, Hz. */
  highpass?: number;
  /** High-pass cutoff sweep, octaves per second. */
  highpassSweep?: number;
  /** Band-pass centre, Hz. */
  bandpass?: number;
  /** Band-pass Q. Default 1. */
  bandpassQ?: number;
  /** Band-pass centre sweep, octaves per second. */
  bandpassSweep?: number;
  /** Flanger base delay, ms (sfxr "phaser"). */
  flanger?: number;
  /** Flanger delay change, ms per second. */
  flangerSweep?: number;
  /** White-noise layer mixed into the oscillator, 0..1. */
  noiseMix?: number;
  /** Distortion 0..1. */
  drive?: number;
  /** Bit depth for lo-fi grit (e.g. 6). */
  crush?: number;
  /** Sample-and-hold factor (e.g. 4 = quarter sample rate). */
  downsample?: number;
  /** Echo delay, seconds. */
  echo?: number;
  /** Echo feedback 0..1. Default 0.35. */
  echoFeedback?: number;
  /** Echo level 0..1. Default 0.35. */
  echoMix?: number;
  /** Reverb wet level 0..1. */
  reverb?: number;
  /** Output peak after normalisation, 0..1. Default 0.8 (≈ -2 dBFS). */
  volume?: number;
  /** Extra voices merged over this one's voice params (e.g. `{ at: 0.1, freq: 660 }` for a second note). */
  layers?: readonly SfxLayer[];
  /** Seed for the noise generators. */
  seed?: number;
}

/** A layer: any voice params overriding the root's, plus start offset `at` (s) and relative `gain`. */
export type SfxLayer = Partial<Omit<SfxParams, 'layers' | 'echo' | 'echoFeedback' | 'echoMix' | 'reverb' | 'volume'>> & {
  at?: number;
  gain?: number;
};

/** Total voice length in seconds (without layers, echo or reverb tails). */
export const sfxVoiceLength = (p: Partial<SfxParams>): number =>
  Math.max(0, p.attack ?? 0) + Math.max(0, p.sustain ?? 0.1) + Math.max(0, p.decay ?? 0.2);

function renderSfxVoice(p: SfxParams, sr: number): Float32Array {
  const attack = Math.max(0, p.attack ?? 0);
  const sustain = Math.max(0, p.sustain ?? 0.1);
  const decay = Math.max(0, p.decay ?? 0.2);
  const n = Math.max(1, Math.ceil((attack + sustain + decay) * sr));
  const out = new Float32Array(n);
  const seed = p.seed ?? 1;
  const osc = new AudioOsc(p.wave, sr, seed);
  const noiseMix = Math.min(1, Math.max(0, p.noiseMix ?? 0));
  const noise = noiseMix > 0 ? new AudioOsc('white', sr, seed + 7919) : null;
  const lp = p.lowpass ? new AudioBiquad('lowpass', p.lowpass, p.lowpassQ ?? 0.9, sr) : null;
  const hp = p.highpass ? new AudioBiquad('highpass', p.highpass, Math.SQRT1_2, sr) : null;
  const bp = p.bandpass ? new AudioBiquad('bandpass', p.bandpass, p.bandpassQ ?? 1, sr) : null;
  const arp = p.arp === undefined ? null : typeof p.arp === 'number' ? [0, p.arp] : p.arp;
  const arpStep = Math.max(0.001, p.arpStep ?? 0.08);
  const slide = p.slide ?? 0;
  const accel = p.slideAccel ?? 0;
  const falling = slide < 0 || accel < 0;
  const freqMin = p.freqMin ?? 20;
  const freqMax = p.freqMax ?? 16000;
  const vib = p.vibrato ?? 0;
  const vibRate = p.vibratoRate ?? 6;
  const trem = p.tremolo ?? 0;
  const tremRate = p.tremoloRate ?? 8;
  const punch = p.punch ?? 0;
  const curve = p.decayCurve ?? 2;
  const duty = p.duty ?? 0.5;
  const dutySweep = p.dutySweep ?? 0;
  const repeat = p.repeat && p.repeat > 0 ? p.repeat : 0;
  let cut = n;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const tp = repeat ? t % repeat : t;
    let st = slide * tp + 0.5 * accel * tp * tp;
    if (arp) st += arp[Math.min(arp.length - 1, Math.floor(tp / arpStep))]!;
    if (vib) st += vib * Math.sin(TAU * vibRate * t);
    let f = p.freq * Math.pow(2, st / 12);
    if (f < freqMin) {
      if (falling) {
        cut = i;
        break;
      }
      f = freqMin;
    } else if (f > freqMax) f = freqMax;
    if (dutySweep) osc.duty = duty + dutySweep * t;
    else osc.duty = duty;
    let s = osc.next(f);
    if (noise) s = s * (1 - noiseMix) + noise.next(0) * noiseMix;
    let e: number;
    if (t < attack) e = t / attack;
    else if (t < attack + sustain) e = 1 + punch * (1 - (t - attack) / sustain);
    else {
      const k = decay > 0 ? 1 - (t - attack - sustain) / decay : 0;
      e = k > 0 ? Math.pow(k, curve) : 0;
    }
    if (trem) e *= 1 - trem * (0.5 + 0.5 * Math.sin(TAU * tremRate * t));
    if ((i & 31) === 0) {
      if (lp && p.lowpassSweep) lp.set(p.lowpass! * Math.pow(2, p.lowpassSweep * t));
      if (hp && p.highpassSweep) hp.set(p.highpass! * Math.pow(2, p.highpassSweep * t));
      if (bp && p.bandpassSweep) bp.set(p.bandpass! * Math.pow(2, p.bandpassSweep * t));
    }
    if (lp) s = lp.process(s);
    if (hp) s = hp.process(s);
    if (bp) s = bp.process(s);
    out[i] = s * e;
  }
  let buf = out;
  if (cut < n) {
    buf = out.slice(0, Math.max(1, cut));
    pcmFadeOut(buf, 0.004, sr);
  }
  if (p.flanger !== undefined) {
    const maxD = Math.ceil(((Math.abs(p.flanger) + Math.abs(p.flangerSweep ?? 0) * (buf.length / sr)) / 1000) * sr) + 2;
    const src = buf.slice();
    for (let i = 0; i < buf.length; i++) {
      const d = Math.min(maxD, Math.max(0, ((p.flanger + (p.flangerSweep ?? 0) * (i / sr)) / 1000) * sr));
      const j = i - d;
      const j0 = Math.floor(j);
      if (j0 < 0) continue;
      const a = src[j0]!;
      const b = src[Math.min(src.length - 1, j0 + 1)]!;
      buf[i] = (src[i]! + a + (b - a) * (j - j0)) * 0.6;
    }
  }
  if (p.drive) pcmDrive(buf, p.drive);
  if (p.crush || p.downsample) pcmBitcrush(buf, p.crush ?? 16, p.downsample ?? 1);
  return buf;
}

/** Renders a sound effect to mono PCM (-1..1), peak-normalised to `params.volume`. Deterministic. */
export function renderSfx(params: SfxParams, sampleRate = AUDIO_SAMPLE_RATE): Float32Array {
  const sr = sampleRate;
  const { layers, echo, echoFeedback, echoMix, reverb, volume, ...voice } = params;
  const parts: { buf: Float32Array; at: number; gain: number }[] = [
    { buf: renderSfxVoice(voice, sr), at: 0, gain: 1 },
  ];
  for (const l of layers ?? []) {
    const { at, gain, ...over } = l;
    parts.push({ buf: renderSfxVoice({ ...voice, ...over }, sr), at: Math.max(0, at ?? 0), gain: gain ?? 1 });
  }
  let len = 0;
  for (const part of parts) len = Math.max(len, Math.round(part.at * sr) + part.buf.length);
  const fb = Math.min(0.95, Math.max(0, echoFeedback ?? 0.35));
  let tail = 0;
  if (echo && echo > 0) tail += echo * Math.min(12, Math.ceil(Math.log(0.01) / Math.log(Math.max(fb, 0.01))) + 1);
  if (reverb && reverb > 0) tail += 1.2;
  const out = new Float32Array(len + Math.ceil(Math.min(tail, 4) * sr));
  for (const part of parts) pcmMixInto(out, part.buf, Math.round(part.at * sr), part.gain);
  if (echo && echo > 0) pcmDelay(out, sr, echo, fb, echoMix ?? 0.35);
  if (reverb && reverb > 0) pcmReverb(out, sr, reverb, { room: 0.5, damp: 0.5 });
  pcmRemoveDc(out, sr, 15);
  const trimmed = pcmTrimEnd(out, -60 + 20 * Math.log10(Math.max(pcmPeak(out), 1e-6)), 0.01, sr);
  pcmFadeIn(trimmed, 0.0005, sr);
  pcmFadeOut(trimmed, 0.004, sr);
  pcmNormalize(trimmed, Math.min(1, Math.max(0.01, volume ?? 0.8)));
  return trimmed;
}

// ---------------------------------------------------------------- mutation

const UNIT_KEYS = new Set(['punch', 'duty', 'tremolo', 'noiseMix', 'drive', 'echoFeedback', 'echoMix', 'reverb', 'volume']);
const SIGNED_KEYS = new Set(['slide', 'slideAccel', 'dutySweep', 'lowpassSweep', 'highpassSweep', 'bandpassSweep', 'flangerSweep']);
const FIXED_KEYS = new Set(['seed', 'at', 'crush', 'downsample', 'freqMin', 'freqMax']);

function mutateVoice<T extends Partial<SfxParams> & { at?: number; gain?: number }>(p: T, amount: number, r: Rng): T {
  const out: Record<string, unknown> = { ...p };
  for (const [k, v] of Object.entries(p)) {
    if (typeof v !== 'number' || FIXED_KEYS.has(k)) continue;
    const j = r.float(-1, 1) * amount;
    if (UNIT_KEYS.has(k)) out[k] = Math.min(1, Math.max(0, v + j * 0.5));
    else if (SIGNED_KEYS.has(k)) out[k] = v + j * (Math.abs(v) + 1);
    else out[k] = v * Math.pow(2, j);
  }
  const arp = p.arp;
  if (typeof arp === 'object' && r.chance(amount)) out.arp = arp.map((s, i) => (i === 0 ? s : s + r.int(-1, 1)));
  return out as unknown as T;
}

/** Returns a deterministic variation of `params`: numeric fields jitter by roughly ±`amount` (0..1). */
export function mutateSfx(params: SfxParams, amount = 0.1, seed = 1): SfxParams {
  const r = new Rng(seed);
  const root = mutateVoice(params, amount, r);
  root.seed = r.int(1, 1_000_000);
  if (params.layers) root.layers = params.layers.map((l) => mutateVoice(l, amount, r));
  return root;
}

// ---------------------------------------------------------------- presets

export type SfxPresetName =
  | 'coin'
  | 'pickup'
  | 'jump'
  | 'hit'
  | 'hurt'
  | 'explosion'
  | 'powerup'
  | 'laser'
  | 'shoot'
  | 'click'
  | 'blip'
  | 'select'
  | 'error'
  | 'success'
  | 'whoosh'
  | 'pop'
  | 'bubble'
  | 'win'
  | 'lose';

const semis = (hz: number, st: number) => hz * Math.pow(2, st / 12);

/**
 * Ready-made casual-game sounds. Each takes a seed: the same seed always gives the same sound, other seeds give
 * variations (pitch, timing, timbre). `sfxPresets.coin()` = seed 1.
 */
export const sfxPresets: Record<SfxPresetName, (seed?: number) => SfxParams> = {
  coin(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'square',
      duty: r.pick([0.5, 0.25]),
      freq: semis(988, r.int(-2, 2)),
      sustain: r.float(0.05, 0.07),
      decay: r.float(0.22, 0.32),
      punch: 0.45,
      decayCurve: 1.6,
      arp: [0, r.pick([5, 5, 7])],
      arpStep: r.float(0.06, 0.08),
      lowpass: 7000,
      volume: 0.7,
      seed: r.int(1, 1e6),
    };
  },
  pickup(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'triangle',
      freq: semis(784, r.int(-3, 3)),
      sustain: 0.09,
      decay: r.float(0.14, 0.2),
      punch: 0.3,
      arp: [0, 7, 12],
      arpStep: r.float(0.035, 0.05),
      slide: r.float(2, 6),
      volume: 0.75,
      layers: [{ wave: 'square', duty: 0.25, gain: 0.25, lowpass: 5000 }],
      seed: r.int(1, 1e6),
    };
  },
  jump(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'square',
      duty: r.float(0.3, 0.45),
      dutySweep: 0.4,
      freq: r.float(220, 320),
      slide: r.float(24, 36),
      slideAccel: -40,
      sustain: r.float(0.06, 0.1),
      decay: r.float(0.14, 0.2),
      punch: 0.2,
      lowpass: 4200,
      volume: 0.65,
      seed: r.int(1, 1e6),
    };
  },
  hit(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'noise',
      freq: r.float(900, 1600),
      slide: -24,
      sustain: 0.015,
      decay: r.float(0.09, 0.14),
      punch: 0.6,
      lowpass: 5000,
      lowpassSweep: -4,
      volume: 0.8,
      layers: [{ wave: 'square', duty: 0.5, freq: r.float(150, 200), slide: -40, gain: 0.8, lowpass: 1800 }],
      seed: r.int(1, 1e6),
    };
  },
  hurt(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: r.pick(['square', 'saw'] as const),
      freq: r.float(420, 560),
      slide: -r.float(40, 55),
      noiseMix: 0.2,
      sustain: 0.05,
      decay: r.float(0.18, 0.25),
      punch: 0.4,
      drive: 0.25,
      lowpass: 3200,
      volume: 0.5,
      seed: r.int(1, 1e6),
    };
  },
  explosion(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'noise',
      freq: r.float(45, 75),
      slide: -5,
      sustain: r.float(0.08, 0.14),
      decay: r.float(0.7, 1),
      punch: 0.6,
      decayCurve: 2.2,
      lowpass: 3500,
      lowpassSweep: -1.6,
      reverb: 0.25,
      volume: 0.85,
      layers: [{ wave: 'sine', freq: 70, slide: -24, sustain: 0.05, decay: 0.4, gain: 0.9, lowpass: 400 }],
      seed: r.int(1, 1e6),
    };
  },
  powerup(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'square',
      duty: 0.25,
      freq: semis(262, r.int(-2, 3)),
      arp: [0, 4, 7, 12, 16, 19, 24],
      arpStep: r.float(0.045, 0.055),
      slide: 3,
      sustain: 0.32,
      decay: 0.22,
      vibrato: 0.12,
      vibratoRate: 10,
      lowpass: 6000,
      echo: 0.09,
      echoFeedback: 0.3,
      echoMix: 0.25,
      volume: 0.7,
      seed: r.int(1, 1e6),
    };
  },
  laser(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: r.pick(['square', 'saw'] as const),
      duty: 0.3,
      dutySweep: 0.9,
      freq: r.float(1100, 1600),
      slide: -r.float(60, 80),
      slideAccel: 60,
      sustain: 0.05,
      decay: r.float(0.12, 0.18),
      punch: 0.3,
      lowpass: 7500,
      volume: 0.65,
      seed: r.int(1, 1e6),
    };
  },
  shoot(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'square',
      freq: r.float(700, 950),
      slide: -r.float(45, 60),
      noiseMix: 0.35,
      sustain: 0.02,
      decay: r.float(0.1, 0.14),
      punch: 0.6,
      highpass: 250,
      lowpass: 6000,
      volume: 0.7,
      seed: r.int(1, 1e6),
    };
  },
  click(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'sine',
      freq: r.float(1500, 2100),
      slide: -30,
      sustain: 0.003,
      decay: 0.03,
      decayCurve: 3,
      volume: 0.55,
      layers: [{ wave: 'white', sustain: 0.001, decay: 0.008, highpass: 3000, gain: 0.35 }],
      seed: r.int(1, 1e6),
    };
  },
  blip(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'square',
      duty: r.pick([0.5, 0.25]),
      freq: semis(880, r.int(-3, 3)),
      sustain: 0.03,
      decay: 0.05,
      lowpass: 6000,
      volume: 0.5,
      seed: r.int(1, 1e6),
    };
  },
  select(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'triangle',
      freq: semis(659, r.int(-2, 2)),
      arp: [0, r.pick([5, 7])],
      arpStep: 0.05,
      sustain: 0.07,
      decay: 0.12,
      punch: 0.3,
      volume: 0.6,
      layers: [{ wave: 'square', duty: 0.125, gain: 0.3, lowpass: 4000 }],
      seed: r.int(1, 1e6),
    };
  },
  error(seed = 1) {
    const r = new Rng(seed);
    const f = semis(233, r.int(-2, 1));
    return {
      wave: 'saw',
      freq: f,
      slide: -4,
      sustain: 0.09,
      decay: 0.05,
      lowpass: 1800,
      drive: 0.2,
      volume: 0.65,
      layers: [
        { wave: 'square', freq: f * 1.06, gain: 0.5 },
        { at: 0.15, freq: semis(f, -4), sustain: 0.13, decay: 0.08 },
        { at: 0.15, wave: 'square', freq: semis(f, -4) * 1.06, sustain: 0.13, decay: 0.08, gain: 0.5 },
      ],
      seed: r.int(1, 1e6),
    };
  },
  success(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'square',
      duty: 0.5,
      freq: semis(523, r.int(-2, 2)),
      arp: [0, 4, 7, 12],
      arpStep: r.float(0.065, 0.08),
      sustain: 0.3,
      decay: 0.3,
      lowpass: 4500,
      vibrato: 0.1,
      vibratoRate: 7,
      echo: 0.12,
      echoFeedback: 0.25,
      echoMix: 0.3,
      volume: 0.7,
      layers: [{ wave: 'triangle', gain: 0.6, lowpass: undefined }],
      seed: r.int(1, 1e6),
    };
  },
  whoosh(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'white',
      freq: 1000,
      attack: r.float(0.1, 0.16),
      sustain: 0.04,
      decay: r.float(0.2, 0.3),
      decayCurve: 1.5,
      bandpass: r.float(350, 500),
      bandpassQ: 1.4,
      bandpassSweep: r.float(3, 4),
      volume: 0.6,
      seed: r.int(1, 1e6),
    };
  },
  pop(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'sine',
      freq: r.float(320, 440),
      slide: r.float(50, 70),
      sustain: 0.01,
      decay: 0.07,
      punch: 0.5,
      volume: 0.75,
      layers: [{ wave: 'white', sustain: 0.002, decay: 0.01, highpass: 2000, gain: 0.25, slide: 0 }],
      seed: r.int(1, 1e6),
    };
  },
  bubble(seed = 1) {
    const r = new Rng(seed);
    return {
      wave: 'sine',
      freq: r.float(260, 340),
      slide: 30,
      slideAccel: 260,
      sustain: 0.03,
      decay: r.float(0.1, 0.14),
      vibrato: 0.8,
      vibratoRate: 28,
      volume: 0.65,
      seed: r.int(1, 1e6),
    };
  },
  win(seed = 1) {
    const r = new Rng(seed);
    const f = semis(523, r.int(-2, 2));
    const step = r.float(0.11, 0.13);
    const note = { sustain: 0.08, decay: 0.08 };
    return {
      wave: 'square',
      duty: 0.5,
      freq: f,
      ...note,
      lowpass: 4000,
      echo: 0.15,
      echoFeedback: 0.3,
      echoMix: 0.25,
      reverb: 0.15,
      volume: 0.75,
      layers: [
        { at: step, freq: semis(f, 4), ...note },
        { at: step * 2, freq: semis(f, 7), ...note },
        { at: step * 3, freq: semis(f, 12), sustain: 0.35, decay: 0.5, vibrato: 0.25, vibratoRate: 6 },
        { at: step * 3, wave: 'triangle', freq: semis(f, 7), sustain: 0.35, decay: 0.5, gain: 0.5 },
      ],
      seed: r.int(1, 1e6),
    };
  },
  lose(seed = 1) {
    const r = new Rng(seed);
    const f = semis(392, r.int(-2, 1));
    const step = r.float(0.28, 0.32);
    const note = { sustain: 0.18, decay: 0.08 };
    return {
      wave: 'saw',
      freq: f,
      ...note,
      slide: -1,
      lowpass: 1400,
      vibrato: 0.15,
      vibratoRate: 5,
      reverb: 0.2,
      volume: 0.7,
      layers: [
        { at: step, freq: semis(f, -1), ...note },
        { at: step * 2, freq: semis(f, -2), ...note },
        { at: step * 3, freq: semis(f, -3), sustain: 0.55, decay: 0.4, vibrato: 0.35, slide: -1.5 },
      ],
      seed: r.int(1, 1e6),
    };
  },
};
