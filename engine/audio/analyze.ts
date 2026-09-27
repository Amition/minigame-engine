import { AUDIO_SAMPLE_RATE, gainToDb, pcmChannels, type PcmChannels } from './dsp';

const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function fftTables(n: number) {
  let t = twiddles.get(n);
  if (t) return t;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  twiddles.set(n, (t = { cos, sin, rev }));
  return t;
}

/** In-place radix-2 complex FFT (`re.length` must be a power of two). */
export function audioFft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { cos, sin, rev } = fftTables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const wr = cos[k * step]!;
        const wi = sin[k * step]!;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a]! += xr;
        im[a]! += xi;
      }
    }
  }
}

export interface AudioSpectrogram {
  /** Magnitude in dBFS per frame, `size / 2` bins each. */
  frames: Float32Array[];
  /** Hz per bin. */
  binHz: number;
  /** Seconds between frames. */
  hopSeconds: number;
  size: number;
}

const mono = (pcm: PcmChannels): Float32Array => {
  const ch = pcmChannels(pcm);
  if (ch.length === 1) return ch[0]!;
  const n = ch.reduce((m, c) => Math.max(m, c.length), 0);
  const out = new Float32Array(n);
  for (const c of ch) for (let i = 0; i < c.length; i++) out[i]! += c[i]! / ch.length;
  return out;
};

/** Short-time Fourier transform (Hann window). Channels are averaged. */
export function computeSpectrogram(
  pcm: PcmChannels,
  sampleRate = AUDIO_SAMPLE_RATE,
  opts: { size?: number; hop?: number; maxFrames?: number } = {},
): AudioSpectrogram {
  const x = mono(pcm);
  const size = opts.size ?? 1024;
  let hop = opts.hop ?? size / 2;
  if (opts.maxFrames && x.length / hop > opts.maxFrames) hop = Math.ceil(x.length / opts.maxFrames);
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const frames: Float32Array[] = [];
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const norm = 2 / (size * 0.5);
  for (let start = 0; start < Math.max(1, x.length - size / 2); start += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = (x[start + i] ?? 0) * win[i]!;
      im[i] = 0;
    }
    audioFft(re, im);
    const mag = new Float32Array(size / 2);
    for (let k = 0; k < size / 2; k++) {
      const m = Math.hypot(re[k]!, im[k]!) * norm;
      mag[k] = m > 1e-7 ? 20 * Math.log10(m) : -140;
    }
    frames.push(mag);
  }
  return { frames, binHz: sampleRate / size, hopSeconds: hop / sampleRate, size };
}

export interface AudioAnalysis {
  duration: number;
  channels: number;
  /** Linear peak and its dBFS value. */
  peak: number;
  peakDb: number;
  /** Whole-file RMS, dBFS. */
  rmsDb: number;
  /** Loudest 400 ms window RMS, dBFS: roughly how loud it feels. */
  loudnessDb: number;
  /** Peak-to-RMS ratio, dB (low = squashed, high = spiky). */
  crestDb: number;
  /** Samples at or beyond full scale. */
  clipped: number;
  dcOffset: number;
  /** Seconds below -60 dBFS at the start / end. */
  leadingSilence: number;
  trailingSilence: number;
  /** Energy-weighted mean spectral centroid, Hz (brightness). */
  centroidHz: number;
  /** Zero crossings per second (noisiness / pitch hint). */
  zcr: number;
  /** Detected note/hit onsets. */
  onsets: number;
  /** Jump between the last and first sample, relative to the peak (loops only). */
  seamJump?: number;
  issues: string[];
  /** One line: 'ok' or the issues joined with '; '. */
  verdict: string;
}

export interface AnalyzeAudioOptions {
  /** Affects thresholds: sfx should start instantly and be short; music is judged on loudness and loops. */
  kind?: 'sfx' | 'music';
  /** Also check that the end joins the start smoothly. */
  loop?: boolean;
}

/** Numbers and a verdict describing a sound, so it can be judged without listening. */
export function analyzeAudio(pcm: PcmChannels, sampleRate = AUDIO_SAMPLE_RATE, opts: AnalyzeAudioOptions = {}): AudioAnalysis {
  const chans = pcmChannels(pcm);
  const n = chans.reduce((m, c) => Math.max(m, c.length), 0);
  const duration = n / sampleRate;
  let peak = 0;
  let sum = 0;
  let dc = 0;
  let clipped = 0;
  let crossings = 0;
  for (const c of chans) {
    for (let i = 0; i < c.length; i++) {
      const v = c[i]!;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.9999) clipped++;
      sum += v * v;
      dc += v;
      if (i > 0 && (c[i - 1]! < 0) !== (v < 0)) crossings++;
    }
  }
  const total = Math.max(1, n * chans.length);
  const rms = Math.sqrt(sum / total);
  const x = mono(chans);
  const silent = 0.001;
  let lead = 0;
  while (lead < n && Math.abs(x[lead]!) < silent) lead++;
  let tail = n - 1;
  while (tail > lead && Math.abs(x[tail]!) < silent) tail--;

  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  const energies: number[] = [];
  for (let s = 0; s < n; s += hop) {
    let e = 0;
    const end = Math.min(n, s + hop);
    for (let i = s; i < end; i++) e += x[i]! * x[i]!;
    energies.push(e / Math.max(1, end - s));
  }
  const win = 40;
  let loud = 0;
  let acc = 0;
  for (let i = 0; i < energies.length; i++) {
    acc += energies[i]!;
    if (i >= win) acc -= energies[i - win]!;
    loud = Math.max(loud, acc / Math.min(win, i + 1));
  }
  const peakDb = gainToDb(peak);
  let onsets = 0;
  let lastOnset = -1e9;
  const edb = energies.map((e) => (e > 1e-12 ? 10 * Math.log10(e) : -120));
  for (let i = 0; i < edb.length; i++) {
    let floor = Infinity;
    for (let j = Math.max(0, i - 5); j < i; j++) floor = Math.min(floor, edb[j]!);
    if (i === 0) floor = -120;
    if (edb[i]! - floor > 9 && edb[i]! > peakDb - 35 && i - lastOnset >= 6) {
      onsets++;
      lastOnset = i;
    }
  }

  let centroid = 0;
  if (n > 0) {
    const spec = computeSpectrogram(x, sampleRate, { size: 1024, maxFrames: 300 });
    let wsum = 0;
    for (const f of spec.frames) {
      let e = 0;
      let c = 0;
      for (let k = 1; k < f.length; k++) {
        const m = Math.pow(10, f[k]! / 20);
        e += m;
        c += m * k * spec.binHz;
      }
      if (e > 0) {
        const w = e * e;
        centroid += (c / e) * w;
        wsum += w;
      }
    }
    centroid = wsum > 0 ? centroid / wsum : 0;
  }

  const res: AudioAnalysis = {
    duration,
    channels: chans.length,
    peak,
    peakDb,
    rmsDb: gainToDb(rms),
    loudnessDb: gainToDb(Math.sqrt(loud)),
    crestDb: rms > 0 ? gainToDb(peak / rms) : 0,
    clipped,
    dcOffset: dc / total,
    leadingSilence: lead / sampleRate,
    trailingSilence: tail > lead ? (n - 1 - tail) / sampleRate : duration,
    centroidHz: centroid,
    zcr: crossings / chans.length / Math.max(duration, 1e-9),
    onsets,
    issues: [],
    verdict: 'ok',
  };
  if (opts.loop && n > 1 && peak > 0) {
    let jump = 0;
    for (const c of chans) jump = Math.max(jump, Math.abs(c[c.length - 1]! - c[0]!));
    res.seamJump = jump / peak;
  }
  const music = opts.kind === 'music';
  const issues = res.issues;
  if (n === 0 || peak < 1e-4) issues.push('silent');
  else {
    if (clipped > 0) issues.push(`clipping (${clipped} samples)`);
    else if (peakDb > -0.3) issues.push('no headroom (peak > -0.3 dBFS, mp3 may clip)');
    if (peakDb < -12) issues.push(`too quiet (peak ${peakDb.toFixed(1)} dBFS)`);
    else if (res.loudnessDb < (music ? -26 : -30)) issues.push(`quiet (loudness ${res.loudnessDb.toFixed(1)} dBFS)`);
    if (music && res.loudnessDb > -8) issues.push('very loud (will dominate sfx)');
    if (!music && res.loudnessDb > -6) issues.push(`dense/loud (loudness ${res.loudnessDb.toFixed(1)} dBFS, lower volume)`);
    if (!music && res.leadingSilence > 0.02) issues.push(`late start (${Math.round(res.leadingSilence * 1000)} ms silence)`);
    if (res.trailingSilence > 0.15 && res.trailingSilence > duration * 0.2 && !opts.loop) {
      issues.push(`long silent tail (${Math.round(res.trailingSilence * 1000)} ms)`);
    }
    if (Math.abs(res.dcOffset) > 0.01) issues.push(`DC offset ${res.dcOffset.toFixed(3)}`);
    if (centroid > 6000) issues.push(`harsh/bright (centroid ${Math.round(centroid)} Hz)`);
    else if (centroid > 0 && centroid < 120) issues.push(`muddy (centroid ${Math.round(centroid)} Hz)`);
    if (music && res.crestDb < 6) issues.push(`over-compressed (crest ${res.crestDb.toFixed(1)} dB)`);
    if (!music && duration > 3) issues.push(`long for an sfx (${duration.toFixed(1)} s)`);
    if (res.seamJump !== undefined && res.seamJump > 0.25) issues.push(`loop seam jump ${(res.seamJump * 100).toFixed(0)}%`);
  }
  res.verdict = issues.length ? issues.join('; ') : 'ok';
  return res;
}
