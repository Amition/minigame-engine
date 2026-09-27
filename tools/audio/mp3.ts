import { Mp3Encoder } from '@breezystack/lamejs';

/** Samples of silence a decoder without gapless info outputs before the first real sample (LAME 576 + 529). */
export const MP3_DECODER_DELAY = 1105;

const toInt16 = (ch: Float32Array): Int16Array => {
  const out = new Int16Array(ch.length);
  for (let i = 0; i < ch.length; i++) {
    const v = Math.max(-1, Math.min(1, ch[i]!));
    out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return out;
};

/** CBR MP3 via lamejs (tools only: keeps the encoder out of runtime bundles). 1 or 2 channels. */
export function encodeMp3(channels: readonly Float32Array[], sampleRate: number, kbps: number): Uint8Array {
  const nch = Math.min(2, channels.length);
  const enc = new Mp3Encoder(nch, sampleRate, kbps);
  const l = toInt16(channels[0]!);
  const r = nch > 1 ? toInt16(channels[1]!) : null;
  const parts: Uint8Array[] = [];
  const block = 1152;
  for (let i = 0; i < l.length; i += block) {
    const a = l.subarray(i, i + block);
    const out = r ? enc.encodeBuffer(a, r.subarray(i, i + block)) : enc.encodeBuffer(a);
    if (out.length) parts.push(out.slice());
  }
  const tail = enc.flush();
  if (tail.length) parts.push(tail.slice());
  const total = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    bytes.set(p, off);
    off += p.length;
  }
  return bytes;
}

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Walks the MPEG audio frames: output sample rate, channel count, frames and decoded length. */
export function mp3Info(bytes: Uint8Array): { sampleRate: number; channels: number; frames: number; samples: number; kbps: number } {
  let off = 0;
  let frames = 0;
  let sampleRate = 0;
  let channels = 0;
  let kbps = 0;
  let spf = 1152;
  while (off + 4 <= bytes.length) {
    if (bytes[off] !== 0xff || (bytes[off + 1]! & 0xe0) !== 0xe0) {
      off++;
      continue;
    }
    const b1 = bytes[off + 1]!;
    const b2 = bytes[off + 2]!;
    const b3 = bytes[off + 3]!;
    const version = (b1 >> 3) & 3;
    const brIdx = b2 >> 4;
    const srIdx = (b2 >> 2) & 3;
    const rates = RATES[version];
    if (!rates || srIdx === 3 || brIdx === 0 || brIdx === 15 || ((b1 >> 1) & 3) !== 1) {
      off++;
      continue;
    }
    const sr = rates[srIdx]!;
    const br = (version === 3 ? BITRATES_V1 : BITRATES_V2)[brIdx]!;
    spf = version === 3 ? 1152 : 576;
    const size = Math.floor(((spf / 8) * br * 1000) / sr) + ((b2 >> 1) & 1);
    if (size < 4) break;
    sampleRate = sr;
    kbps = br;
    channels = b3 >> 6 === 3 ? 1 : 2;
    frames++;
    off += size;
  }
  return { sampleRate, channels, frames, samples: frames * spf, kbps };
}
