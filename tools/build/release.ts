// Release-only bundle trimming. The sound library (`<app>/audio/index.ts`) only feeds the AudioManager's dev synth
// fallback, which release builds compile out, so the release bundle gets an empty library for `<app>/main.ts`
// (sfx params and parsed songs are dead weight there: 8-15 KB and 10-40 ms of song parsing at launch). Before that,
// the build checks that `assets/audio/manifest.json` covers every library sound, because nothing can synthesize a
// missing one in release. Other importers (the sandbox audio lab) keep the real module.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'esbuild';

export interface AudioLibraryNames {
  sfx: string[];
  music: string[];
}

/** The part of `assets/audio/manifest.json` the check reads. */
export interface ManifestLike {
  sounds?: Record<string, { file?: string; kind?: string }>;
}

export interface AudioLibraryCheck {
  /** `<app>/audio/index.ts`, or null when the app has no sound library. */
  file: string | null;
  names: AudioLibraryNames;
  /** Build errors: missing manifest, sounds or files. */
  problems: string[];
  /** The module exports nothing but sfx / music (named or as default), so the release stub can replace it. */
  stubbable: boolean;
}

const STUB_EXPORTS = new Set(['sfx', 'music', 'default']);

/**
 * Problems of a manifest against the library: every sfx / music name must be listed with the same kind and its file
 * must exist. `hasFile` gets the manifest `file` (relative to the assets dir).
 */
export function auditAudioManifest(
  names: AudioLibraryNames,
  manifest: ManifestLike | null,
  hasFile: (file: string) => boolean,
  where: { library: string; manifest: string; app: string },
): string[] {
  const total = names.sfx.length + names.music.length;
  if (total === 0) return [];
  const fix = `run "pnpm audio --app ${where.app}" (release builds cannot synthesize sounds)`;
  if (!manifest?.sounds) return [`no audio manifest at ${where.manifest} for the ${total} sounds in ${where.library}: ${fix}`];
  const missing: string[] = [];
  const kind: string[] = [];
  const files: string[] = [];
  const check = (name: string, want: 'sfx' | 'music') => {
    const e = manifest.sounds![name];
    if (!e) missing.push(name);
    else if (e.kind !== want) kind.push(`${name} (library ${want}, manifest ${e.kind ?? 'none'})`);
    else if (!e.file || !hasFile(e.file)) files.push(`${name} (${e.file ?? 'no file'})`);
  };
  for (const n of names.sfx) check(n, 'sfx');
  for (const n of names.music) check(n, 'music');
  const out: string[] = [];
  if (missing.length) out.push(`${where.manifest} is missing ${missing.length} sound(s) of ${where.library}: ${missing.join(', ')}; ${fix}`);
  if (kind.length) out.push(`${where.manifest} lists sounds with the wrong kind: ${kind.join(', ')}; ${fix}`);
  if (files.length) out.push(`audio files listed in ${where.manifest} do not exist: ${files.join(', ')}; ${fix}`);
  return out;
}

/** Imports the app's sound library (the build runs under tsx) and audits the rendered manifest against it. */
export async function checkAudioLibrary(appDir: string): Promise<AudioLibraryCheck> {
  const file = resolve(appDir, 'audio/index.ts');
  const empty: AudioLibraryNames = { sfx: [], music: [] };
  if (!existsSync(file)) return { file: null, names: empty, problems: [], stubbable: false };
  const rel = (p: string) => relative(process.cwd(), p).replace(/\\/g, '/') || p;
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch (e) {
    return { file, names: empty, problems: [`cannot import ${rel(file)}: ${e instanceof Error ? e.message : String(e)}`], stubbable: false };
  }
  const def = (mod.default ?? {}) as Record<string, unknown>;
  const lib = (key: 'sfx' | 'music') => Object.keys((mod[key] ?? def[key] ?? {}) as object);
  const names: AudioLibraryNames = { sfx: lib('sfx'), music: lib('music') };
  const stubbable =
    Object.keys(mod).every((k) => STUB_EXPORTS.has(k)) &&
    (mod.default === undefined || Object.keys(def).every((k) => k === 'sfx' || k === 'music'));
  const manifestFile = resolve(appDir, 'assets/audio/manifest.json');
  let manifest: ManifestLike | null = null;
  if (existsSync(manifestFile)) {
    try {
      manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as ManifestLike;
    } catch (e) {
      return { file, names, problems: [`cannot parse ${rel(manifestFile)}: ${e instanceof Error ? e.message : String(e)}`], stubbable };
    }
  }
  const problems = auditAudioManifest(names, manifest, (f) => existsSync(join(appDir, 'assets', f)), {
    library: rel(file),
    manifest: rel(manifestFile),
    app: rel(appDir),
  });
  return { file, names, problems, stubbable };
}

const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);

/** esbuild plugin (release builds): `<app>/main.ts` imports an empty sound library instead of `<app>/audio/index.ts`. */
export function stubAudioLibrary(appDir: string): Plugin {
  const lib = resolve(appDir, 'audio/index.ts');
  const main = resolve(appDir, 'main.ts');
  return {
    name: 'release-audio-library',
    setup(build) {
      build.onResolve({ filter: /(^|[\\/])audio([\\/]index(\.ts)?)?$/ }, (args) => {
        if (!args.importer || !samePath(args.importer, main)) return undefined;
        const target = resolve(args.resolveDir, args.path);
        if (![target, `${target}.ts`, join(target, 'index.ts')].some((p) => samePath(p, lib))) return undefined;
        return { path: lib, namespace: 'release-stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'release-stub' }, () => ({
        contents: 'export const sfx = {};\nexport const music = {};\nexport default { sfx, music };\n',
        loader: 'ts',
      }));
    },
  };
}
