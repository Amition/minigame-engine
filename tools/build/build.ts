/**
 * Builds an app for the web and the mini-game platforms.
 *
 *   pnpm build:wx                               -> dist/wx  (game.js, game.json, project.config.json, assets/)
 *   pnpm build --target all --minify            -> dist/{web,wx,tt,tap,233} + dist/tap.zip
 *   pnpm build --target web --app game --out out --dev
 *
 * Options:
 *   --target <t>   web | wx | tt | tap | 233 | all (default web); comma lists allowed (web,wx)
 *   --app <dir>    app directory with main.ts (default export: AppDef) and app.json (default sandbox)
 *   --out <dir>    output root (default dist); each target goes to <out>/<target>
 *   --minify       minify game.js
 *   --dev          dev build: sourcemap, window.__engine automation handle + error overlay (web)
 *
 * Outputs: web → index.html + game.js; wx → + game.json/project.config.json; tt → Douyin's game.js/game.json/
 * project.config.json; tap → game.js/game.json + <out>/tap.zip (upload); 233 → wx build converted by
 * wx_converter.py into <out>/233/game.zip. Fails when the wx/tt package exceeds 4 MB or game.js references node.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { type AppMeta, type BundleTarget, esbuildOptions, findNodeImports, readAppMeta, resolveApp } from './config';
import { convert233 } from './convert233';
import {
  copyAssets,
  formatBytes,
  packageSize,
  type PackageSize,
  unsupportedFiles,
  writeTargetFiles,
  zipDir,
} from './files';

export type Target = BundleTarget | '233';
export const TARGETS: readonly Target[] = ['web', 'wx', 'tt', 'tap', '233'];

export interface BuildOptions {
  /** App dir (default 'sandbox'). */
  app?: string;
  /** Output root (default 'dist'). */
  out?: string;
  minify?: boolean;
  dev?: boolean;
  log?: (line: string) => void;
}

export interface BuildResult {
  target: Target;
  /** Package directory. */
  dir: string;
  ok: boolean;
  /** 233 without a converter. */
  skipped?: boolean;
  size?: PackageSize;
  /** Size limit that applies to `size.total`. */
  limit?: number;
  /** Upload archive (tap.zip, 233 game.zip). */
  zip?: string;
  zipBytes?: number;
  /** Errors that make the build fail. */
  problems: string[];
  warnings: string[];
}

const MB = 1024 * 1024;

/** Main package limits; builds are never split into subpackages. */
const LIMITS: Partial<Record<Target, { bytes: number; fail: boolean; what: string }>> = {
  wx: { bytes: 4 * MB, fail: true, what: 'WeChat main package' },
  // Douyin allows 20 MB without subpackages (4 MB main package with them); kept at 4 MB so wx and tt stay in step.
  tt: { bytes: 4 * MB, fail: true, what: 'Douyin main package' },
  tap: { bytes: 4 * MB, fail: false, what: 'TapTap first package (recommended 4 MB, hard cap 60 MB)' },
};

async function formatErrors(e: unknown): Promise<string> {
  const errors = (e as { errors?: esbuild.Message[] }).errors;
  if (errors?.length) return (await esbuild.formatMessages(errors, { kind: 'error', color: false })).join('\n');
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

/** Bundles <app>/main.ts for a target into <outDir>/game.js. Returns esbuild warnings and portability problems. */
export async function bundle(
  target: BundleTarget,
  appDir: string,
  outDir: string,
  o: { dev: boolean; minify: boolean; meta?: AppMeta },
): Promise<{ warnings: string[]; problems: string[] }> {
  const meta = o.meta ?? readAppMeta(appDir);
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, 'game.js');
  let res: esbuild.BuildResult;
  try {
    res = await esbuild.build({ ...esbuildOptions(target, appDir, meta, { dev: o.dev, minify: o.minify, outfile }), write: true });
  } catch (e) {
    return { warnings: [], problems: [`esbuild failed:\n${await formatErrors(e)}`] };
  }
  const warnings = (await esbuild.formatMessages(res.warnings, { kind: 'warning', color: false })).map((s) => s.trim());
  const problems = findNodeImports(readFileSync(outfile, 'utf8')).map((p) => `game.js is not portable: ${p}`);
  return { warnings, problems };
}

/** Builds one target. Never throws for build errors: check `ok` / `problems`. */
export async function buildTarget(target: Target, opts: BuildOptions = {}): Promise<BuildResult> {
  const appDir = resolveApp(opts.app ?? 'sandbox');
  const out = resolve(opts.out ?? 'dist');
  const dev = !!opts.dev;
  const minify = !!opts.minify;
  const log = opts.log ?? ((s: string) => console.log(s));
  const meta = readAppMeta(appDir);

  if (target === '233') {
    const dir = join(out, '233');
    const tmp = mkdtempSync(join(tmpdir(), 'engine-233-'));
    try {
      const wx = await buildTarget('wx', { ...opts, app: appDir, out: tmp, log });
      if (!wx.ok) return { ...wx, target, dir };
      const c = convert233(wx.dir, dir, log);
      const base = { target, dir, warnings: wx.warnings, ...(wx.size ? { size: wx.size } : {}) };
      if (c.skipped) {
        log(`[233] skipped: ${c.message}`);
        return { ...base, ok: true, skipped: true, problems: [] };
      }
      if (!c.ok) return { ...base, ok: false, problems: [c.message ?? 'conversion failed'] };
      return { ...base, ok: true, problems: [], ...(c.zip ? { zip: c.zip } : {}), ...(c.zipBytes ? { zipBytes: c.zipBytes } : {}) };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  const dir = join(out, target);
  log(`[build] ${target} -> ${relative(process.cwd(), dir) || dir}${dev ? ' (dev)' : ''}${minify ? ' (minify)' : ''}`);
  rmSync(dir, { recursive: true, force: true });
  const { warnings, problems } = await bundle(target, appDir, dir, { dev, minify, meta });
  const r: BuildResult = { target, dir, ok: false, problems, warnings };
  if (problems.length) return r;
  writeTargetFiles(target, dir, meta);
  copyAssets(appDir, dir);
  const size = packageSize(dir);
  r.size = size;
  if (target !== 'web') {
    const bad = unsupportedFiles(dir);
    if (bad.length) warnings.push(`${target} uploads reject these file types: ${bad.join(', ')}`);
    const lim = LIMITS[target];
    if (lim) {
      r.limit = lim.bytes;
      if (size.total > lim.bytes) {
        const msg = `${lim.what} is ${formatBytes(size.total)}, over the ${formatBytes(lim.bytes)} limit`;
        (lim.fail ? problems : warnings).push(msg);
      }
    }
  }
  if (target === 'tap') {
    r.zip = join(out, 'tap.zip');
    r.zipBytes = zipDir(dir, r.zip);
  }
  r.ok = problems.length === 0;
  return r;
}

/** Builds several targets in order ('all' = every target). */
export async function buildTargets(targets: readonly Target[], opts: BuildOptions = {}): Promise<BuildResult[]> {
  const results: BuildResult[] = [];
  for (const t of targets) results.push(await buildTarget(t, opts));
  return results;
}

export function parseTargets(s: string): Target[] {
  if (s === 'all') return [...TARGETS];
  const list = s.split(',').map((t) => t.trim()) as Target[];
  for (const t of list) if (!TARGETS.includes(t)) throw new Error(`unknown target "${t}" (use ${TARGETS.join(', ')} or all)`);
  return list;
}

/** Size table plus warnings/problems, as printed by the CLI. */
export function formatReport(results: BuildResult[]): string {
  const rows = [['target', 'dir', 'game.js', 'assets', 'package', 'limit', 'upload', 'status']];
  for (const r of results) {
    const s = r.size;
    rows.push([
      r.target,
      relative(process.cwd(), r.dir) || r.dir,
      s ? formatBytes(s.code) : '-',
      s ? `${formatBytes(s.assets)} (${s.assetFiles})` : '-',
      s ? formatBytes(s.total) : '-',
      r.limit ? formatBytes(r.limit) : '-',
      r.zip ? `${relative(process.cwd(), r.zip) || r.zip} ${formatBytes(r.zipBytes ?? 0)}` : '-',
      r.skipped ? 'skipped' : r.ok ? 'ok' : 'FAILED',
    ]);
  }
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  const lines = rows.map((row) => row.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd());
  for (const r of results) {
    for (const w of r.warnings) lines.push(`warning [${r.target}] ${w}`);
    for (const p of r.problems) lines.push(`error [${r.target}] ${p}`);
  }
  return lines.join('\n');
}

interface CliArgs extends BuildOptions {
  targets: Target[];
}

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = { targets: ['web'] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = () => {
      const val = argv[++i];
      if (val === undefined) throw new Error(`missing value for ${k}`);
      return val;
    };
    if (k === '--target' || k === '-t') a.targets = parseTargets(v());
    else if (k === '--app') a.app = v();
    else if (k === '--out') a.out = v();
    else if (k === '--minify') a.minify = true;
    else if (k === '--dev') a.dev = true;
    else throw new Error(`unknown option ${k}`);
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const results = await buildTargets(args.targets, args);
  console.log('');
  console.log(formatReport(results));
  console.log(`\n${results.every((r) => r.ok) ? 'done' : 'FAILED'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const explicitSkip = args.targets.length === 1 && results[0]?.skipped;
  if (results.some((r) => !r.ok) || explicitSkip) process.exit(1);
}

const isMain = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  });
}
