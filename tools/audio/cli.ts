/**
 * Renders an app's sound definitions into audio files + manifest, prints an analysis table.
 *
 *   pnpm audio                              -> <app>/assets/audio/*.mp3 + manifest.json
 *   pnpm audio --only coin,menu --preview   -> also .shots/audio/coin.png, .shots/audio/menu.png
 *   pnpm audio --app sandbox --format wav --force
 *
 * Options:
 *   --app <dir>          app directory with audio/index.ts (default: package.json "engine.app", else sandbox)
 *   --only <a,b>         render only these sounds (others stay as they are)
 *   --format mp3|wav     output format (default mp3: sfx mono 64 kbps, music stereo 128 kbps or song.kbps)
 *   --preview            write waveform/spectrogram (+ piano roll) PNGs to .shots/audio/<name>.png
 *   --force              ignore the render cache
 *   --help               print this help
 *
 * `<app>/audio/index.ts` exports `sfx: Record<string, SfxParams | () => SfxParams>` and
 * `music: Record<string, SongDef>` (named exports or a default `{ sfx, music }`). Unchanged sounds are skipped
 * using `<app>/audio/.render-cache.json` (hash of the definition, format and the synth source code).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeAudio,
  analyzeSongKey,
  encodeWav,
  pcmFadeIn,
  pcmFadeOut,
  renderSfx,
  renderSong,
  type AudioAnalysis,
  type AudioLibrary,
  type AudioManifest,
  type AudioManifestEntry,
  type SfxParams,
  type SongDef,
  type SongSchedule,
} from '@engine';
import { defaultApp, exitWithUsage } from '../common/app';
import { encodeMp3, MP3_DECODER_DELAY, mp3Info } from './mp3';
import { renderAudioPreview } from './preview';

interface Args {
  app: string;
  only: string[] | null;
  format: 'mp3' | 'wav';
  preview: boolean;
  force: boolean;
}

interface CacheEntry extends AudioManifestEntry {
  hash: string;
  analysis: AudioAnalysis;
}

interface RenderCache {
  version: number;
  sounds: Record<string, CacheEntry>;
}

const SAMPLE_RATE = 44100;
const SFX_KBPS = 64;
const MUSIC_KBPS = 128;
const CACHE_VERSION = 1;

function parseArgs(argv: string[]): Args {
  const a: Args = { app: defaultApp(), only: null, format: 'mp3', preview: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = () => {
      const val = argv[++i];
      if (val === undefined) exitWithUsage(import.meta.url, `missing value for ${k}`);
      return val;
    };
    switch (k) {
      case '--app':
        a.app = v();
        break;
      case '--only':
        a.only = v().split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--format': {
        const f = v();
        if (f !== 'mp3' && f !== 'wav') exitWithUsage(import.meta.url, '--format must be mp3 or wav');
        a.format = f;
        break;
      }
      case '--preview':
        a.preview = true;
        break;
      case '--force':
        a.force = true;
        break;
      case '--help':
      case '-h':
        exitWithUsage(import.meta.url);
      default:
        exitWithUsage(import.meta.url, `unknown option ${k}`);
    }
  }
  return a;
}

/** Hash of the synthesis code, so engine changes re-render everything. */
function engineHash(): string {
  const h = createHash('sha1');
  const dirs = [
    fileURLToPath(new URL('../../engine/audio/', import.meta.url)),
    fileURLToPath(new URL('./', import.meta.url)),
  ];
  for (const dir of dirs) {
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f === 'manager.ts' || f === 'index.ts' || f === 'preview.ts') continue;
      h.update(f);
      h.update(readFileSync(join(dir, f)));
    }
  }
  return h.digest('hex');
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

function pad(s: string, w: number, right = false): string {
  return right ? s.padStart(w) : s.padEnd(w);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const appDir = resolve(args.app);
  const defsFile = resolve(appDir, 'audio/index.ts');
  if (!existsSync(defsFile)) throw new Error(`no audio definitions at ${defsFile}`);
  const mod = (await import(pathToFileURL(defsFile).href)) as AudioLibrary & { default?: AudioLibrary };
  const lib: AudioLibrary = { sfx: mod.sfx ?? mod.default?.sfx ?? {}, music: mod.music ?? mod.default?.music ?? {} };
  const outDir = resolve(appDir, 'assets/audio');
  const cachePath = resolve(appDir, 'audio/.render-cache.json');
  const shotsDir = resolve('.shots/audio');
  await mkdir(outDir, { recursive: true });
  if (args.preview) await mkdir(shotsDir, { recursive: true });

  const cache: RenderCache = (await readJson<RenderCache>(cachePath)) ?? { version: CACHE_VERSION, sounds: {} };
  if (cache.version !== CACHE_VERSION) cache.sounds = {};
  const eng = engineHash();

  const all: { name: string; kind: 'sfx' | 'music' }[] = [
    ...Object.keys(lib.sfx!).map((name) => ({ name, kind: 'sfx' as const })),
    ...Object.keys(lib.music!).map((name) => ({ name, kind: 'music' as const })),
  ];
  const seen = new Set<string>();
  for (const s of all) {
    if (seen.has(s.name)) throw new Error(`sound name "${s.name}" is used by both sfx and music`);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(s.name)) throw new Error(`sound name "${s.name}" must be a file-safe identifier`);
    seen.add(s.name);
  }
  if (args.only) for (const o of args.only) if (!seen.has(o)) throw new Error(`--only: unknown sound "${o}"`);
  const selected = args.only ? all.filter((s) => args.only!.includes(s.name)) : all;

  const rows: { name: string; kind: string; status: string; e: CacheEntry }[] = [];
  const keyNotes: string[] = [];
  const t0 = Date.now();
  for (const { name, kind } of selected) {
    const rawDef = kind === 'sfx' ? lib.sfx![name]! : lib.music![name]!;
    const def = typeof rawDef === 'function' ? rawDef() : rawDef;
    const kbps = kind === 'sfx' ? SFX_KBPS : ((def as SongDef).kbps ?? MUSIC_KBPS);
    const file = `${name}.${args.format}`;
    const hash = createHash('sha1')
      .update(stable({ def, kind, format: args.format, kbps, eng, sr: SAMPLE_RATE }))
      .digest('hex')
      .slice(0, 16);
    const cached = cache.sounds[name];
    const upToDate = !args.force && cached?.hash === hash && existsSync(join(outDir, file));
    if (upToDate && !args.preview) {
      rows.push({ name, kind, status: 'cached', e: cached });
      continue;
    }

    let channels: Float32Array[];
    let schedule: SongSchedule | undefined;
    let loop = false;
    if (kind === 'sfx') {
      channels = [renderSfx(def as SfxParams, SAMPLE_RATE)];
    } else {
      const song = def as SongDef;
      const r = renderSong(song, { sampleRate: SAMPLE_RATE });
      channels = [r.left, r.right];
      schedule = r.schedule;
      loop = r.loopEnd !== undefined;
      const k = analyzeSongKey(song);
      if (k.key) {
        keyNotes.push(
          `${name}: ${k.outOfKey}/${k.total} notes outside ${k.key}` +
            (k.examples.length ? ` (e.g. ${k.examples.join(', ')})` : ''),
        );
      }
    }
    const analysis = analyzeAudio(channels, SAMPLE_RATE, { kind, loop });
    const duration = channels[0]!.length / SAMPLE_RATE;
    let entry: CacheEntry;
    if (upToDate) {
      entry = { ...cached, analysis };
    } else {
      let bytes: Uint8Array;
      let loopStart: number | undefined;
      let loopEnd: number | undefined;
      if (args.format === 'wav') {
        bytes = encodeWav(channels, SAMPLE_RATE);
        if (loop) [loopStart, loopEnd] = [0, duration];
      } else {
        const enc = channels.map((c) => c.slice());
        if (loop) {
          // Whole-file loopers (mini-game InnerAudioContext) hear the MP3 priming/padding gap: fade the edges
          // so it is a soft dip instead of a click.
          for (const c of enc) {
            pcmFadeIn(c, 0.003, SAMPLE_RATE);
            pcmFadeOut(c, 0.003, SAMPLE_RATE);
          }
        }
        bytes = encodeMp3(enc, SAMPLE_RATE, kbps);
        const info = mp3Info(bytes);
        if (loop) {
          const delay = MP3_DECODER_DELAY / (info.sampleRate || SAMPLE_RATE);
          [loopStart, loopEnd] = [delay, delay + duration];
        }
      }
      await writeFile(join(outDir, file), bytes);
      if (cached && cached.file !== `audio/${file}`) await rm(resolve(outDir, '..', cached.file), { force: true });
      entry = {
        file: `audio/${file}`,
        kind,
        duration: round(duration),
        ...(loopStart !== undefined ? { loopStart: round(loopStart, 4), loopEnd: round(loopEnd!, 4) } : {}),
        bytes: bytes.length,
        hash,
        analysis,
      };
    }
    cache.sounds[name] = entry;
    rows.push({ name, kind, status: upToDate ? 'cached' : 'rendered', e: entry });
    if (args.preview) {
      const png = renderAudioPreview({
        name,
        kind,
        channels,
        sampleRate: SAMPLE_RATE,
        analysis,
        ...(kind === 'music' ? { song: def as SongDef, schedule: schedule! } : {}),
        notes: [
          `${entry.file}  ${(entry.bytes! / 1024).toFixed(1)} KB` +
            (entry.loopEnd !== undefined ? `  loop ${entry.loopStart}s..${entry.loopEnd}s` : '') +
            (kind === 'music' ? `  ${(def as SongDef).bpm} bpm  ${schedule!.bars} bars` : ''),
          ...keyNotes.filter((k) => k.startsWith(`${name}:`)),
        ],
      });
      await writeFile(join(shotsDir, `${name}.png`), png);
    }
  }

  if (!args.only) {
    for (const [name, e] of Object.entries(cache.sounds)) {
      if (seen.has(name)) continue;
      await rm(resolve(outDir, '..', e.file), { force: true });
      delete cache.sounds[name];
      console.log(`removed stale ${e.file}`);
    }
  }

  const manifest: AudioManifest = { version: 1, sampleRate: SAMPLE_RATE, sounds: {} };
  for (const { name } of all) {
    const e = cache.sounds[name];
    if (!e || !existsSync(resolve(outDir, '..', e.file))) continue;
    const { hash: _h, analysis: _a, ...m } = e;
    manifest.sounds[name] = m;
  }
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache, null, 1) + '\n');

  const head = ['name', 'kind', 'status', 'dur s', 'peak', 'loud', 'rms', 'crest', 'clip', 'lead', 'tail', 'bright', 'zcr', 'on', 'KB', 'verdict'];
  const table = rows.map(({ name, kind, status, e }) => {
    const a = e.analysis;
    return [
      name,
      kind,
      status,
      a.duration.toFixed(2),
      a.peakDb.toFixed(1),
      a.loudnessDb.toFixed(1),
      a.rmsDb.toFixed(1),
      a.crestDb.toFixed(1),
      String(a.clipped),
      `${Math.round(a.leadingSilence * 1000)}ms`,
      `${Math.round(a.trailingSilence * 1000)}ms`,
      `${Math.round(a.centroidHz)}Hz`,
      String(Math.round(a.zcr)),
      String(a.onsets),
      ((e.bytes ?? 0) / 1024).toFixed(1),
      a.verdict,
    ];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...table.map((r) => r[i]!.length)));
  const line = (r: string[]) => r.map((c, i) => pad(c, widths[i]!, i >= 3 && i < 15)).join('  ');
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of table) console.log(line(r));
  const totalBytes = Object.values(manifest.sounds).reduce((s, e) => s + (e.bytes ?? 0), 0);
  console.log(
    `\n${Object.keys(manifest.sounds).length} sounds, ${(totalBytes / 1024).toFixed(1)} KB total -> ${outDir}` +
      `  (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
  );
  console.log('columns: peak/loud/rms dBFS (loud = loudest 400 ms), crest dB, bright = spectral centroid, on = onsets');
  for (const k of keyNotes) console.log(`key check: ${k}`);
  if (args.preview) console.log(`previews: ${shotsDir}\\<name>.png`);
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
