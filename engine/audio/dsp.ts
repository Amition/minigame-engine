import { TAU } from '../core/math';
import { Rng } from '../core/rng';

/** Default sample rate for all synthesis and rendering (Hz). */
export const AUDIO_SAMPLE_RATE = 44100;

/** MIDI note number → frequency in Hz (A4 = 69 = 440 Hz). */
export const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
/** Frequency in Hz → fractional MIDI note number. */
export const freqToMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
/** Decibels → linear gain (0 dB = 1). */
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
/** Linear gain → decibels (-Infinity for 0). */
export const gainToDb = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);

// ---------------------------------------------------------------- oscillators

/**
 * Oscillator shapes:
 * - sine, triangle, saw, square (pulse with `duty`, DC-free): saw/square are PolyBLEP band-limited.
 * - noise: sfxr-style sample-and-hold noise, 32 random values per period, so its colour follows the frequency
 *   (low freq = rumble, high freq = hiss).
 * - white: independent random value every sample (frequency ignored).
 * - metallic: NES-style short-period LFSR noise (93-step loop) clocked at the frequency: pitched, metallic.
 * - wavetable: one cycle from `table`, linearly interpolated.
 */
export type OscWave = 'sine' | 'square' | 'triangle' | 'saw' | 'noise' | 'white' | 'metallic' | 'wavetable';

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

let metallicSeq: Int8Array | null = null;
function metallicTable(): Int8Array {
  if (metallicSeq) return metallicSeq;
  const out: number[] = [];
  let s = 1;
  do {
    out.push(s & 1 ? 1 : -1);
    const fb = (s & 1) ^ ((s >> 6) & 1);
    s = (s >> 1) | (fb << 14);
  } while (s !== 1 && out.length < 32768);
  return (metallicSeq = Int8Array.from(out));
}

/** Stateful oscillator. Call `next(freqHz)` once per sample; output is in -1..1. */
export class AudioOsc {
  /** Phase in [0, 1). */
  phase = 0;
  /** Pulse width for 'square', 0..1 (0.5 = square). */
  duty = 0.5;
  private readonly rng: Rng;
  private hold = 0;
  private holdIdx = -1;

  constructor(
    public wave: OscWave,
    readonly sampleRate = AUDIO_SAMPLE_RATE,
    seed = 1,
    public table: Float32Array | null = null,
  ) {
    this.rng = new Rng(seed);
  }

  next(freq: number): number {
    const inc = freq > 0 ? freq / this.sampleRate : 0;
    const dt = inc > 0.49 ? 0.49 : inc;
    const p = this.phase;
    let out = 0;
    switch (this.wave) {
      case 'sine':
        out = Math.sin(TAU * p);
        break;
      case 'triangle':
        out = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
        break;
      case 'saw':
        out = 2 * p - 1 - polyBlep(p, dt);
        break;
      case 'square': {
        const d = this.duty < 0.01 ? 0.01 : this.duty > 0.99 ? 0.99 : this.duty;
        out = (p < d ? 1 : -1) + polyBlep(p, dt) - polyBlep((p - d + 1) % 1, dt) - (2 * d - 1);
        break;
      }
      case 'noise': {
        const i = Math.floor(p * 32);
        if (i !== this.holdIdx) {
          this.holdIdx = i;
          this.hold = this.rng.next() * 2 - 1;
        }
        out = this.hold;
        break;
      }
      case 'white':
        out = this.rng.next() * 2 - 1;
        break;
      case 'metallic': {
        const seq = metallicTable();
        out = seq[Math.floor(p * seq.length)]! * 0.8;
        break;
      }
      case 'wavetable': {
        const t = this.table;
        if (t && t.length > 0) {
          const x = p * t.length;
          const i = Math.floor(x);
          const a = t[i]!;
          out = a + (t[(i + 1) % t.length]! - a) * (x - i);
        }
        break;
      }
    }
    let np = p + (this.wave === 'noise' || this.wave === 'metallic' ? inc : dt);
    if (np >= 1) {
      np -= Math.floor(np);
      if (this.wave === 'noise') this.holdIdx = -1;
    }
    this.phase = np;
    return out;
  }

  reset(phase = 0): void {
    this.phase = phase;
    this.holdIdx = -1;
  }
}

/** Builds a single-cycle wavetable from harmonic amplitudes ([fundamental, 2nd, 3rd, ...]), peak-normalised. */
export function makeWavetable(harmonics: readonly number[], size = 1024): Float32Array {
  const t = new Float32Array(size);
  for (let h = 0; h < harmonics.length; h++) {
    const a = harmonics[h]!;
    if (a === 0) continue;
    for (let i = 0; i < size; i++) t[i]! += a * Math.sin((TAU * (h + 1) * i) / size);
  }
  let peak = 0;
  for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(t[i]!));
  if (peak > 0) for (let i = 0; i < size; i++) t[i]! /= peak;
  return t;
}

/** Renders a constant tone (handy for tests and quick checks). */
export function renderTone(
  wave: OscWave,
  freq: number,
  seconds: number,
  sampleRate = AUDIO_SAMPLE_RATE,
  opts: { duty?: number; seed?: number; gain?: number; table?: Float32Array } = {},
): Float32Array {
  const n = Math.max(0, Math.round(seconds * sampleRate));
  const out = new Float32Array(n);
  const osc = new AudioOsc(wave, sampleRate, opts.seed ?? 1, opts.table ?? null);
  osc.duty = opts.duty ?? 0.5;
  const g = opts.gain ?? 1;
  for (let i = 0; i < n; i++) out[i] = osc.next(freq) * g;
  return out;
}

// ---------------------------------------------------------------- envelopes

/** ADSR envelope. Times in seconds, sustain level 0..1. */
export interface AdsrEnvelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

function heldLevel(env: AdsrEnvelope, t: number): number {
  const a = env.attack > 0 ? env.attack : 0;
  if (t < a) return t / a;
  const d = env.decay > 0 ? env.decay : 0;
  const s = env.sustain;
  if (t < a + d) {
    const k = 1 - (t - a) / d;
    return s + (1 - s) * k * k;
  }
  return s;
}

/**
 * Envelope gain at time `t` (seconds since note-on) for a note held `gate` seconds.
 * Attack is linear 0→1, decay and release are quadratic curves; release starts from the level at note-off.
 */
export function adsrAt(env: AdsrEnvelope, t: number, gate: number): number {
  if (t < 0) return 0;
  if (t < gate) return heldLevel(env, t);
  const r = env.release;
  if (r <= 0) return 0;
  const k = (t - gate) / r;
  if (k >= 1) return 0;
  const lvl = heldLevel(env, gate);
  return lvl * (1 - k) * (1 - k);
}

/** Samples an ADSR envelope for a note held `gate` seconds (length = gate + release). */
export function renderAdsr(env: AdsrEnvelope, gate: number, sampleRate = AUDIO_SAMPLE_RATE): Float32Array {
  const n = Math.ceil((gate + Math.max(0, env.release)) * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = adsrAt(env, i / sampleRate, gate);
  return out;
}

// ---------------------------------------------------------------- filters

export type AudioFilterType = 'lowpass' | 'highpass' | 'bandpass';

/** RBJ-cookbook biquad. `q` ≈ 0.707 is flat (Butterworth); higher values resonate. */
export class AudioBiquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    public type: AudioFilterType,
    freq: number,
    public q = Math.SQRT1_2,
    readonly sampleRate = AUDIO_SAMPLE_RATE,
  ) {
    this.set(freq, q);
  }

  /** Recomputes coefficients for a new cutoff/center frequency (cheap enough every ~32 samples). */
  set(freq: number, q = this.q): void {
    this.q = q;
    const f = Math.min(Math.max(freq, 10), this.sampleRate * 0.45);
    const w0 = (TAU * f) / this.sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.max(q, 0.05));
    const a0 = 1 + alpha;
    let b0: number;
    let b1: number;
    let b2: number;
    if (this.type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = b0;
    } else if (this.type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = b0;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/**
 * Filters a buffer in place. With `to`, the cutoff sweeps exponentially from `freq` to `to` over the buffer.
 */
export function pcmFilter(
  buf: Float32Array,
  type: AudioFilterType,
  freq: number,
  opts: { q?: number; to?: number; sampleRate?: number } = {},
): Float32Array {
  const f = new AudioBiquad(type, freq, opts.q ?? Math.SQRT1_2, opts.sampleRate ?? AUDIO_SAMPLE_RATE);
  const to = opts.to;
  const n = buf.length;
  for (let i = 0; i < n; i++) {
    if (to !== undefined && (i & 31) === 0) f.set(freq * Math.pow(to / freq, i / n));
    buf[i] = f.process(buf[i]!);
  }
  return buf;
}

/** One-pole DC blocker (high-pass around `cutoff` Hz), in place. */
export function pcmRemoveDc(buf: Float32Array, sampleRate = AUDIO_SAMPLE_RATE, cutoff = 20): Float32Array {
  const r = 1 - (TAU * cutoff) / sampleRate;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const y = x - x1 + r * y1;
    x1 = x;
    y1 = y;
    buf[i] = y;
  }
  return buf;
}

// ---------------------------------------------------------------- effects

/** Soft saturation (tanh), `amount` 0..1. Keeps the peak level roughly unchanged. In place. */
export function pcmDrive(buf: Float32Array, amount: number): Float32Array {
  if (amount <= 0) return buf;
  const k = 1 + amount * 20;
  const norm = 1 / Math.tanh(k);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(k * buf[i]!) * norm;
  return buf;
}

/** Lo-fi: quantise to `bits` and hold every `downsample` samples. In place. */
export function pcmBitcrush(buf: Float32Array, bits: number, downsample = 1): Float32Array {
  const levels = Math.pow(2, Math.max(1, Math.min(16, bits)) - 1);
  const hold = Math.max(1, Math.round(downsample));
  let held = 0;
  for (let i = 0; i < buf.length; i++) {
    if (i % hold === 0) held = Math.round(buf[i]! * levels) / levels;
    buf[i] = held;
  }
  return buf;
}

/**
 * Feedback echo in place: `time` seconds between repeats, `feedback` 0..1, `mix` = level of the echoes.
 * The buffer is not extended: allocate room for the tail first.
 */
export function pcmDelay(
  buf: Float32Array,
  sampleRate: number,
  time: number,
  feedback: number,
  mix: number,
): Float32Array {
  const d = Math.max(1, Math.round(time * sampleRate));
  const line = new Float32Array(d);
  let idx = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const y = line[idx]!;
    line[idx] = x + y * feedback;
    buf[i] = x + y * mix;
    if (++idx >= d) idx = 0;
  }
  return buf;
}

/** Stereo ping-pong delay in place (mono sum in, echoes alternate left/right). */
export function pcmPingPong(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  time: number,
  feedback: number,
  mix: number,
): void {
  const d = Math.max(1, Math.round(time * sampleRate));
  const lineL = new Float32Array(d);
  const lineR = new Float32Array(d);
  let idx = 0;
  for (let i = 0; i < left.length; i++) {
    const yl = lineL[idx]!;
    const yr = lineR[idx]!;
    lineL[idx] = (left[i]! + right[i]!) * 0.5 + yr * feedback;
    lineR[idx] = yl * feedback;
    left[i] = left[i]! + yl * mix;
    right[i] = right[i]! + yr * mix;
    if (++idx >= d) idx = 0;
  }
}

class Comb {
  private readonly buf: Float32Array;
  private idx = 0;
  private store = 0;
  constructor(size: number) {
    this.buf = new Float32Array(Math.max(1, size));
  }
  process(x: number, feedback: number, damp: number): number {
    const out = this.buf[this.idx]!;
    this.store = out * (1 - damp) + this.store * damp;
    this.buf[this.idx] = x + this.store * feedback;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return out;
  }
}

class Allpass {
  private readonly buf: Float32Array;
  private idx = 0;
  constructor(size: number) {
    this.buf = new Float32Array(Math.max(1, size));
  }
  process(x: number): number {
    const b = this.buf[this.idx]!;
    this.buf[this.idx] = x + b * 0.5;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return b - x;
  }
}

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];

export interface AudioReverbOptions {
  /** Room size 0..1 (tail length). Default 0.6. */
  room?: number;
  /** High-frequency damping 0..1. Default 0.4. */
  damp?: number;
  /** Stereo width 0..1. Default 1. */
  width?: number;
}

/** Freeverb-style reverb: 8 damped combs + 4 allpasses per channel, mono in, stereo out. */
export class AudioReverb {
  private readonly combsL: Comb[];
  private readonly combsR: Comb[];
  private readonly apL: Allpass[];
  private readonly apR: Allpass[];
  private readonly feedback: number;
  private readonly damp: number;
  private readonly width: number;

  constructor(
    readonly sampleRate = AUDIO_SAMPLE_RATE,
    opts: AudioReverbOptions = {},
  ) {
    const k = sampleRate / 44100;
    const spread = 23;
    this.combsL = COMB_TUNING.map((n) => new Comb(Math.round(n * k)));
    this.combsR = COMB_TUNING.map((n) => new Comb(Math.round((n + spread) * k)));
    this.apL = ALLPASS_TUNING.map((n) => new Allpass(Math.round(n * k)));
    this.apR = ALLPASS_TUNING.map((n) => new Allpass(Math.round((n + spread) * k)));
    this.feedback = (opts.room ?? 0.6) * 0.28 + 0.7;
    this.damp = (opts.damp ?? 0.4) * 0.4;
    this.width = opts.width ?? 1;
  }

  /** Adds the wet signal of `input` (scaled by `wet`) into outL/outR. */
  processInto(input: Float32Array, outL: Float32Array, outR: Float32Array, wet = 1): void {
    const w1 = wet * (this.width / 2 + 0.5);
    const w2 = wet * ((1 - this.width) / 2);
    const fb = this.feedback;
    const dmp = this.damp;
    const n = Math.min(input.length, outL.length, outR.length);
    for (let i = 0; i < n; i++) {
      const x = input[i]! * 0.015;
      let l = 0;
      let r = 0;
      for (let c = 0; c < 8; c++) {
        l += this.combsL[c]!.process(x, fb, dmp);
        r += this.combsR[c]!.process(x, fb, dmp);
      }
      for (let a = 0; a < 4; a++) {
        l = this.apL[a]!.process(l);
        r = this.apR[a]!.process(r);
      }
      outL[i]! += l * w1 + r * w2;
      outR[i]! += r * w1 + l * w2;
    }
  }
}

/** Mono reverb in place: adds `wet` 0..1 of reverb to the dry signal. Allocate room for the tail first. */
export function pcmReverb(
  buf: Float32Array,
  sampleRate: number,
  wet: number,
  opts: AudioReverbOptions = {},
): Float32Array {
  if (wet <= 0) return buf;
  const l = new Float32Array(buf.length);
  const r = new Float32Array(buf.length);
  new AudioReverb(sampleRate, opts).processInto(buf, l, r, wet);
  for (let i = 0; i < buf.length; i++) buf[i]! += (l[i]! + r[i]!) * 0.5;
  return buf;
}

// ---------------------------------------------------------------- mixing, levels, fades

/** Adds `src * gain` into `dst` starting at sample `offset` (clipped to dst). */
export function pcmMixInto(dst: Float32Array, src: Float32Array, offset = 0, gain = 1): void {
  const start = Math.max(0, offset);
  const end = Math.min(dst.length, offset + src.length);
  for (let i = start; i < end; i++) dst[i]! += src[i - offset]! * gain;
}

/** Constant-power pan gains [left, right] for pan -1 (left) .. 1 (right). */
export function audioPanGains(pan: number): [number, number] {
  const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** One buffer or a list of channel buffers. */
export type PcmChannels = Float32Array | readonly Float32Array[];

/** Normalises `PcmChannels` to a channel list. */
export const pcmChannels = (pcm: PcmChannels): readonly Float32Array[] => (pcm instanceof Float32Array ? [pcm] : pcm);

/** Largest absolute sample over one or more channels. */
export function pcmPeak(pcm: PcmChannels): number {
  let peak = 0;
  for (const ch of pcmChannels(pcm)) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]!);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/** Root-mean-square level over one or more channels. */
export function pcmRms(pcm: PcmChannels): number {
  let sum = 0;
  let n = 0;
  for (const ch of pcmChannels(pcm)) {
    for (let i = 0; i < ch.length; i++) sum += ch[i]! * ch[i]!;
    n += ch.length;
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

/** Scales one or more channels so the peak equals `target` (linear). Returns the gain applied. */
export function pcmNormalize(pcm: PcmChannels, target = 0.89): number {
  const peak = pcmPeak(pcm);
  if (peak <= 0) return 1;
  const g = target / peak;
  for (const ch of pcmChannels(pcm)) for (let i = 0; i < ch.length; i++) ch[i]! *= g;
  return g;
}

/** Soft clipper: linear below `knee * ceiling`, tanh-curved above, never exceeds `ceiling`. In place. */
export function pcmSoftClip(buf: Float32Array, ceiling = 1, knee = 0.8): Float32Array {
  const k = ceiling * knee;
  const room = ceiling - k;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const a = Math.abs(x);
    if (a > k) buf[i] = Math.sign(x) * (k + room * Math.tanh((a - k) / room));
  }
  return buf;
}

/**
 * Look-ahead peak limiter over linked channels, in place: output never exceeds `ceiling` (linear).
 * Returns the largest gain reduction in dB (0 when nothing was limited).
 */
export function pcmLimit(
  channels: readonly Float32Array[],
  sampleRate = AUDIO_SAMPLE_RATE,
  ceiling = 0.89,
  opts: { releaseMs?: number; lookaheadMs?: number } = {},
): number {
  const n = channels.reduce((m, c) => Math.max(m, c.length), 0);
  if (n === 0) return 0;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of channels) {
      const v = Math.abs(c[i] ?? 0);
      if (v > p) p = v;
    }
    g[i] = p > ceiling ? ceiling / p : 1;
  }
  const look = Math.max(1, Math.round(((opts.lookaheadMs ?? 3) / 1000) * sampleRate));
  const attackStep = 1 / look;
  for (let i = n - 2; i >= 0; i--) g[i] = Math.min(g[i]!, g[i + 1]! + attackStep);
  const rel = 1 - Math.exp(-1 / (((opts.releaseMs ?? 80) / 1000) * sampleRate));
  let cur = g[0]!;
  let minG = 1;
  for (let i = 0; i < n; i++) {
    const t = g[i]!;
    cur = t < cur ? t : cur + (t - cur) * rel;
    if (cur < minG) minG = cur;
    for (const c of channels) if (i < c.length) c[i]! *= cur;
  }
  return minG < 1 ? -gainToDb(minG) : 0;
}

/** Fades the first `seconds` in (sine curve). In place. */
export function pcmFadeIn(buf: Float32Array, seconds: number, sampleRate = AUDIO_SAMPLE_RATE): Float32Array {
  const n = Math.min(buf.length, Math.round(seconds * sampleRate));
  for (let i = 0; i < n; i++) buf[i]! *= Math.sin(((i / n) * Math.PI) / 2);
  return buf;
}

/** Fades the last `seconds` out (sine curve). In place. */
export function pcmFadeOut(buf: Float32Array, seconds: number, sampleRate = AUDIO_SAMPLE_RATE): Float32Array {
  const n = Math.min(buf.length, Math.round(seconds * sampleRate));
  const start = buf.length - n;
  for (let i = 0; i < n; i++) buf[start + i]! *= Math.cos(((i / n) * Math.PI) / 2);
  return buf;
}

/**
 * Drops the silent end: keeps everything up to the last sample above `thresholdDb` (relative to full scale)
 * plus `keepSeconds`. Returns a new (shorter) array or the input when nothing is trimmed.
 */
export function pcmTrimEnd(
  buf: Float32Array,
  thresholdDb = -60,
  keepSeconds = 0.01,
  sampleRate = AUDIO_SAMPLE_RATE,
): Float32Array {
  const th = dbToGain(thresholdDb);
  let last = buf.length - 1;
  while (last > 0 && Math.abs(buf[last]!) < th) last--;
  const end = Math.min(buf.length, last + 1 + Math.round(keepSeconds * sampleRate));
  return end >= buf.length ? buf : buf.slice(0, Math.max(1, end));
}
