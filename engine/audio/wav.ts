import { pcmChannels, type PcmChannels } from './dsp';

/**
 * Encodes PCM as a 16-bit little-endian RIFF/WAVE file.
 * `pcm` is either a list of channel buffers, or one buffer that is interleaved when `channels` > 1.
 */
export function encodeWav(pcm: PcmChannels, sampleRate: number, channels?: number): Uint8Array {
  let chans: readonly Float32Array[];
  if (pcm instanceof Float32Array && (channels ?? 1) > 1) {
    const c = channels!;
    const frames = Math.floor(pcm.length / c);
    const split: Float32Array[] = [];
    for (let k = 0; k < c; k++) {
      const ch = new Float32Array(frames);
      for (let i = 0; i < frames; i++) ch[i] = pcm[i * c + k]!;
      split.push(ch);
    }
    chans = split;
  } else chans = pcmChannels(pcm);
  const nch = Math.max(1, chans.length);
  const frames = chans.reduce((m, c) => Math.max(m, c.length), 0);
  const dataBytes = frames * nch * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, nch, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * nch * 2, true);
  view.setUint16(32, nch * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let k = 0; k < nch; k++) {
      const v = Math.max(-1, Math.min(1, chans[k]?.[i] ?? 0));
      view.setInt16(off, Math.round(v < 0 ? v * 32768 : v * 32767), true);
      off += 2;
    }
  }
  return out;
}

/** Decodes a PCM WAV (8/16/24/32-bit int or 32-bit float) into channel buffers. */
export function decodeWav(bytes: Uint8Array): { sampleRate: number; channels: Float32Array[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off: number) => String.fromCharCode(bytes[off]!, bytes[off + 1]!, bytes[off + 2]!, bytes[off + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('decodeWav: not a RIFF/WAVE file');
  let off = 12;
  let fmt: { format: number; nch: number; sr: number; bits: number } | null = null;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(body, true),
        nch: view.getUint16(body + 2, true),
        sr: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('decodeWav: data before fmt');
      const bps = fmt.bits / 8;
      const frames = Math.floor(Math.min(size, bytes.length - body) / (bps * fmt.nch));
      const channels = Array.from({ length: fmt.nch }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let k = 0; k < fmt.nch; k++) {
          const p = body + (i * fmt.nch + k) * bps;
          let v: number;
          if (fmt.format === 3) v = view.getFloat32(p, true);
          else if (fmt.bits === 8) v = (bytes[p]! - 128) / 128;
          else if (fmt.bits === 16) v = view.getInt16(p, true) / 32768;
          else if (fmt.bits === 24) v = (((bytes[p + 2]! << 24) | (bytes[p + 1]! << 16) | (bytes[p]! << 8)) >> 8) / 8388608;
          else v = view.getInt32(p, true) / 2147483648;
          channels[k]![i] = v;
        }
      }
      return { sampleRate: fmt.sr, channels };
    }
    off = body + size + (size & 1);
  }
  throw new Error('decodeWav: no data chunk');
}
