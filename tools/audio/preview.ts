import { createCanvas } from '@napi-rs/canvas';
import {
  computeSpectrogram,
  DRUM_LETTERS,
  midiToNoteName,
  type AudioAnalysis,
  type SongDef,
  type SongSchedule,
} from '@engine';

export interface AudioPreviewInput {
  name: string;
  kind: 'sfx' | 'music';
  channels: readonly Float32Array[];
  sampleRate: number;
  analysis: AudioAnalysis;
  /** Songs: enables bar lines, section labels and the per-track piano roll. */
  song?: SongDef;
  schedule?: SongSchedule;
  /** Extra header lines (file size, key check...). */
  notes?: string[];
}

const W = 1200;
const GUTTER = 130;
const PAD = 12;
const PLOT_W = W - GUTTER - PAD;
const TRACK_COLORS = ['#4fc3f7', '#ffb74d', '#81c784', '#f06292', '#ba68c8', '#fff176', '#4db6ac', '#e57373'];
const DRUM_NAMES: Record<string, string> = {
  k: 'kick',
  s: 'snare',
  h: 'hat',
  o: 'open hat',
  c: 'clap',
  t: 'tom',
  l: 'low tom',
  x: 'crash',
  r: 'rim',
  b: 'cowbell',
  p: 'shaker',
};

function heat(v: number): [number, number, number] {
  const stops: [number, number, number, number][] = [
    [0, 8, 8, 16],
    [0.25, 60, 20, 110],
    [0.5, 180, 40, 90],
    [0.75, 250, 140, 30],
    [1, 255, 250, 200],
  ];
  const x = Math.min(1, Math.max(0, v));
  for (let i = 1; i < stops.length; i++) {
    const [p1, r1, g1, b1] = stops[i]!;
    const [p0, r0, g0, b0] = stops[i - 1]!;
    if (x <= p1) {
      const k = (x - p0) / (p1 - p0);
      return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
    }
  }
  return [255, 250, 200];
}

/** Renders waveform + spectrogram (+ piano roll for songs) with the analysis numbers as a PNG. */
export function renderAudioPreview(input: AudioPreviewInput): Buffer {
  const { channels, sampleRate, analysis: a } = input;
  const n = channels.reduce((m, c) => Math.max(m, c.length), 0);
  const duration = n / sampleRate;
  const waveH = channels.length > 1 ? 100 : 150;
  const specH = 220;
  const headerH = 64 + (input.notes?.length ?? 0) * 18;
  const tracks = input.song && input.schedule ? Object.keys(input.song.tracks) : [];
  const lanes = tracks
    .map((name) => {
      const notes = input.schedule!.notes.filter((x) => x.track === name);
      if (notes.length === 0) return null;
      const drums = notes.some((x) => x.drum);
      if (drums) {
        const used = [...DRUM_LETTERS].filter((l) => notes.some((x) => x.drum === l));
        return { name, notes, drums, rows: used, lo: 0, hi: 0, h: Math.max(40, used.length * 14) };
      }
      const lo = Math.min(...notes.map((x) => x.pitch)) - 1;
      const hi = Math.max(...notes.map((x) => x.pitch)) + 1;
      return { name, notes, drums, rows: [] as string[], lo, hi, h: Math.min(150, Math.max(48, (hi - lo + 1) * 5)) };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  const rollH = lanes.reduce((s, l) => s + l.h + 8, 0);
  const H = headerH + 22 + channels.length * (waveH + 6) + 8 + specH + 24 + (lanes.length ? rollH + 16 : 0) + PAD;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d1017';
  ctx.fillRect(0, 0, W, H);
  const font = (px: number, bold = false) => `${bold ? 'bold ' : ''}${px}px sans-serif`;
  const x0 = GUTTER;
  const tx = (t: number) => x0 + (t / Math.max(duration, 1e-9)) * PLOT_W;

  // header
  ctx.fillStyle = '#ffffff';
  ctx.font = font(20, true);
  ctx.textBaseline = 'top';
  ctx.fillText(`${input.name}  (${input.kind})`, PAD, PAD);
  ctx.font = font(14);
  ctx.fillStyle = '#b8c0d4';
  const nums =
    `${a.duration.toFixed(3)} s   peak ${a.peakDb.toFixed(1)} dBFS   loudness ${a.loudnessDb.toFixed(1)}   ` +
    `rms ${a.rmsDb.toFixed(1)}   crest ${a.crestDb.toFixed(1)} dB   centroid ${Math.round(a.centroidHz)} Hz   ` +
    `zcr ${Math.round(a.zcr)}/s   onsets ${a.onsets}   clip ${a.clipped}   lead ${Math.round(a.leadingSilence * 1000)} ms   ` +
    `tail ${Math.round(a.trailingSilence * 1000)} ms`;
  ctx.fillText(nums, PAD, PAD + 26);
  ctx.fillStyle = a.verdict === 'ok' ? '#7ee787' : '#ffa657';
  ctx.font = font(14, true);
  ctx.fillText(`verdict: ${a.verdict}`, PAD, PAD + 44);
  ctx.font = font(13);
  ctx.fillStyle = '#8b93a7';
  (input.notes ?? []).forEach((line, i) => ctx.fillText(line, PAD, PAD + 64 + i * 18));

  // time axis
  let y = headerH + 6;
  ctx.font = font(11);
  ctx.fillStyle = '#8b93a7';
  const sched = input.schedule;
  const gridLines: { t: number; section: boolean; label: string }[] = [];
  if (sched) {
    const barSec = sched.secondsPerBeat * (input.song?.beatsPerBar ?? 4);
    for (let b = 0; b * barSec < duration + 1e-6; b++) {
      const t = b * barSec;
      const sec = sched.sections.find((s) => s.name && Math.abs(s.start - t) < 1e-6);
      gridLines.push({ t, section: !!sec, label: sec ? `${b + 1} [${sec.name}]` : `${b + 1}` });
    }
  } else {
    const steps = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5];
    const step = steps.find((s) => duration / s <= 16) ?? 10;
    for (let t = 0; t < duration + 1e-9; t += step) gridLines.push({ t, section: false, label: `${Math.round(t * 1000)}ms` });
  }
  for (const g of gridLines) {
    ctx.fillStyle = g.section ? '#8e9cff' : '#8b93a7';
    ctx.fillText(g.label, tx(g.t) + 2, y);
  }
  y += 16;
  const drawGrid = (top: number, h: number) => {
    ctx.save();
    for (const g of gridLines) {
      ctx.strokeStyle = g.section ? '#5b6bd6' : '#252b3a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(tx(g.t)) + 0.5, top);
      ctx.lineTo(Math.round(tx(g.t)) + 0.5, top + h);
      ctx.stroke();
    }
    ctx.restore();
  };

  // waveforms
  channels.forEach((ch, ci) => {
    const top = y;
    const mid = top + waveH / 2;
    ctx.fillStyle = '#131824';
    ctx.fillRect(x0, top, PLOT_W, waveH);
    drawGrid(top, waveH);
    ctx.strokeStyle = '#2c3446';
    ctx.beginPath();
    ctx.moveTo(x0, mid + 0.5);
    ctx.lineTo(x0 + PLOT_W, mid + 0.5);
    for (const lvl of [0.5, -0.5]) {
      ctx.moveTo(x0, mid - lvl * (waveH / 2) + 0.5);
      ctx.lineTo(x0 + PLOT_W, mid - lvl * (waveH / 2) + 0.5);
    }
    ctx.stroke();
    const per = ch.length / PLOT_W;
    for (let px = 0; px < PLOT_W; px++) {
      const s = Math.floor(px * per);
      const e = Math.max(s + 1, Math.floor((px + 1) * per));
      let lo = 0;
      let hi = 0;
      let sq = 0;
      let clip = false;
      for (let i = s; i < e && i < ch.length; i++) {
        const v = ch[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        sq += v * v;
        if (Math.abs(v) >= 0.9999) clip = true;
      }
      const rms = Math.sqrt(sq / Math.max(1, e - s));
      ctx.fillStyle = clip ? '#ff5555' : '#2f7fb0';
      ctx.fillRect(x0 + px, mid - hi * (waveH / 2), 1, Math.max(1, (hi - lo) * (waveH / 2)));
      ctx.fillStyle = clip ? '#ff9999' : '#7fd3ff';
      ctx.fillRect(x0 + px, mid - rms * (waveH / 2), 1, Math.max(1, rms * waveH));
    }
    ctx.fillStyle = '#b8c0d4';
    ctx.font = font(12);
    ctx.fillText(channels.length > 1 ? (ci === 0 ? 'left' : 'right') : 'wave', PAD, top + 4);
    ctx.fillStyle = '#687086';
    ctx.fillText('+1', x0 - 22, top);
    ctx.fillText('-1', x0 - 22, top + waveH - 12);
    y += waveH + 6;
  });

  // spectrogram
  y += 8;
  const mono = channels.length === 1 ? channels[0]! : (() => {
    const m = new Float32Array(n);
    for (const c of channels) for (let i = 0; i < c.length; i++) m[i]! += c[i]! / channels.length;
    return m;
  })();
  const spec = computeSpectrogram(mono, sampleRate, { size: 2048, hop: 256, maxFrames: PLOT_W });
  const fMin = 30;
  const fMax = Math.min(16000, sampleRate / 2);
  let maxDb = -140;
  for (const f of spec.frames) for (let k = 0; k < f.length; k++) if (f[k]! > maxDb) maxDb = f[k]!;
  const img = ctx.createImageData(PLOT_W, specH);
  for (let px = 0; px < PLOT_W; px++) {
    const fr = spec.frames[Math.min(spec.frames.length - 1, Math.floor((px / PLOT_W) * spec.frames.length))];
    for (let py = 0; py < specH; py++) {
      const freq = fMin * Math.pow(fMax / fMin, 1 - py / (specH - 1));
      const bin = Math.min((fr?.length ?? 1) - 1, Math.max(1, Math.round(freq / spec.binHz)));
      const db = fr ? fr[bin]! : -140;
      const [r, g, b] = heat((db - (maxDb - 80)) / 80);
      const o = (py * PLOT_W + px) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, x0, y);
  ctx.font = font(11);
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    if (f < fMin || f > fMax) continue;
    const py = y + (1 - Math.log(f / fMin) / Math.log(fMax / fMin)) * (specH - 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(py) + 0.5);
    ctx.lineTo(x0 + PLOT_W, Math.round(py) + 0.5);
    ctx.stroke();
    ctx.fillStyle = '#8b93a7';
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x0 - 30, py - 6);
  }
  ctx.fillStyle = '#b8c0d4';
  ctx.font = font(12);
  ctx.fillText('spectrum', PAD, y + 4);
  ctx.fillStyle = '#687086';
  ctx.fillText(`${Math.round(maxDb)} dB max`, PAD, y + 20);
  y += specH + 24;

  // piano roll
  if (lanes.length) {
    lanes.forEach((lane, li) => {
      const top = y;
      const color = TRACK_COLORS[li % TRACK_COLORS.length]!;
      ctx.fillStyle = '#131824';
      ctx.fillRect(x0, top, PLOT_W, lane.h);
      drawGrid(top, lane.h);
      const track = input.song!.tracks[lane.name]!;
      ctx.fillStyle = color;
      ctx.font = font(13, true);
      ctx.fillText(lane.name, PAD, top + 2);
      ctx.font = font(11);
      ctx.fillStyle = '#8b93a7';
      ctx.fillText(typeof track.instrument === 'string' ? track.instrument : 'custom', PAD, top + 18);
      if (lane.drums) {
        const rowH = lane.h / lane.rows.length;
        ctx.textAlign = 'right';
        lane.rows.forEach((l, i) => {
          ctx.fillStyle = '#687086';
          ctx.fillText(DRUM_NAMES[l] ?? l, x0 - 4, top + i * rowH + rowH / 2 - 6);
        });
        ctx.textAlign = 'left';
        for (const note of lane.notes) {
          const row = lane.rows.indexOf(note.drum!);
          ctx.globalAlpha = 0.35 + 0.65 * note.velocity;
          ctx.fillStyle = color;
          ctx.fillRect(tx(note.start), top + row * rowH + 1, Math.max(2, tx(note.start + 0.03) - tx(note.start)), rowH - 2);
        }
      } else {
        const range = lane.hi - lane.lo + 1;
        const rowH = lane.h / range;
        for (let p = lane.lo; p <= lane.hi; p++) {
          if (p % 12 !== 0) continue;
          const py = top + (lane.hi - p) * rowH;
          ctx.strokeStyle = '#252b3a';
          ctx.beginPath();
          ctx.moveTo(x0, Math.round(py + rowH) + 0.5);
          ctx.lineTo(x0 + PLOT_W, Math.round(py + rowH) + 0.5);
          ctx.stroke();
          ctx.fillStyle = '#687086';
          ctx.textAlign = 'right';
          ctx.fillText(midiToNoteName(p), x0 - 4, py + rowH / 2 - 6);
          ctx.textAlign = 'left';
        }
        for (const note of lane.notes) {
          const py = top + (lane.hi - note.pitch) * rowH;
          ctx.globalAlpha = 0.35 + 0.65 * note.velocity;
          ctx.fillStyle = color;
          ctx.fillRect(tx(note.start), py, Math.max(2, tx(note.start + note.dur) - tx(note.start) - 1), Math.max(2, rowH - 1));
        }
      }
      ctx.globalAlpha = 1;
      y += lane.h + 8;
    });
  }
  return canvas.toBuffer('image/png');
}
