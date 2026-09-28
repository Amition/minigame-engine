// 233乐园: the wx package converted by the Tuanjie/Unity minihost converter (wx_converter.py).
// Converter CLI (read from its source, v2.0.1): python wx_converter.py -s <wx dir> -t <target dir> [-sp]
//   - must run with cwd = converter dir (relative paths to .babelrc, wx_unity_converter/, libs/)
//   - copies <src> to <target>/game, patches game.json (companyName, convertScriptVersion...), runs
//     `npx babel` (preset-env → ES5) over it, prepends wx_unity.js to game.js (removes GameGlobal.fetch),
//     copies check-version.js and zips <target>/game into <target>/game.zip
//   - asks for confirmation on stdin when <target> is not empty, and opens Explorer when done (os.startfile)
// Babel's ES5 output un-minifies game.js (~2.3x the wx size), so --minify runs esbuild over it again (ES5 target:
// no newer syntax sneaks in), checks that it parses and re-zips <target>/game.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Script } from 'node:vm';
import * as esbuild from 'esbuild';
import { formatBytes, zipDir } from './files';

export function converterDir(): string {
  return process.env.MINIHOST_CONVERTER || join(tmpdir(), 'minihost-converter');
}

export function findConverter(): string | null {
  const dir = converterDir();
  return existsSync(join(dir, 'wx_converter.py')) ? dir : null;
}

function findPython(): { cmd: string; args: string[] } | null {
  const candidates: { cmd: string; args: string[] }[] = [
    { cmd: 'python', args: [] },
    { cmd: 'python3', args: [] },
    { cmd: 'py', args: ['-3'] },
  ];
  for (const c of candidates) {
    const r = spawnSync(c.cmd, [...c.args, '--version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}

export const CONVERTER_HELP = `233乐园 build needs the minihost converter (wx_converter.py) and Python 3:
  1. git clone the converter (UnityMiniHost WeixinGameConverter) into %TEMP%\\minihost-converter,
     or set MINIHOST_CONVERTER=<dir containing wx_converter.py>
  2. cd <converter dir> && npm install        (babel + terser, done automatically when missing)
  3. pnpm build:233                           (or by hand: python wx_converter.py -s dist/wx -t dist/233)
Upload <out>/233/game.zip to the 233 minihost console.`;

export interface ConvertResult {
  ok: boolean;
  skipped?: boolean;
  zip?: string;
  zipBytes?: number;
  message?: string;
  /** Full converter output (also written to <targetDir>/convert.log). */
  logFile?: string;
  /** Non-fatal problems (re-minify failed: the converter's game.js is shipped as is). */
  warnings?: string[];
}

const outputOf = (r: SpawnSyncReturns<string>) => `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}\n` : ''}`;

export interface MinifyResult {
  ok: boolean;
  before: number;
  after: number;
  message?: string;
}

/**
 * Minifies a converted (ES5) game.js in place with esbuild and checks that the result parses. Leaves the file
 * untouched when esbuild fails, the output does not parse, or it would not get smaller.
 */
export function minifyConverted(file: string): MinifyResult {
  const src = readFileSync(file, 'utf8');
  const before = Buffer.byteLength(src);
  let code: string;
  try {
    code = esbuild.transformSync(src, { loader: 'js', minify: true, target: 'es5', charset: 'utf8', legalComments: 'none' }).code;
  } catch (e) {
    return { ok: false, before, after: before, message: `esbuild could not minify ${file}: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    new Script(code, { filename: 'game.js' });
  } catch (e) {
    return { ok: false, before, after: before, message: `minified ${file} does not parse: ${e instanceof Error ? e.message : String(e)}` };
  }
  const after = Buffer.byteLength(code);
  if (after >= before) return { ok: true, before, after: before };
  writeFileSync(file, code);
  return { ok: true, before, after };
}

/**
 * Converts a built wx package dir into <targetDir>/game.zip. Skips (ok: true, skipped) when no converter exists.
 * The converter's output goes to <targetDir>/convert.log; `log` gets one summary line, or the whole log on failure.
 * `minify`: minify the converted game.js again and re-zip (see minifyConverted).
 */
export function convert233(
  wxDir: string,
  targetDir: string,
  log: (s: string) => void = console.log,
  o: { minify?: boolean } = {},
): ConvertResult {
  const conv = findConverter();
  if (!conv) return { ok: true, skipped: true, message: `converter not found at ${converterDir()}\n${CONVERTER_HELP}` };
  const py = findPython();
  if (!py) return { ok: false, message: `python not found on PATH\n${CONVERTER_HELP}` };

  const t0 = Date.now();
  let output = '';
  const logFile = join(targetDir, 'convert.log');
  const finish = (res: ConvertResult): ConvertResult => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(logFile, output);
    const shown = relative(process.cwd(), logFile) || logFile;
    if (res.ok) {
      const zip = res.zip ? ` -> ${relative(process.cwd(), res.zip) || res.zip}` : '';
      log(`[233] converted in ${((Date.now() - t0) / 1000).toFixed(1)} s${zip}  (converter log: ${shown})`);
    } else {
      log(`[233] converter output (${shown}):\n${output.trimEnd()}`);
    }
    return { ...res, logFile };
  };

  const babel = join(conv, 'node_modules', '.bin', process.platform === 'win32' ? 'babel.cmd' : 'babel');
  if (!existsSync(babel)) {
    log(`[233] installing converter dependencies: npm install (in ${conv})`);
    const r = spawnSync('npm install --no-audit --no-fund', { cwd: conv, shell: true, encoding: 'utf8', maxBuffer: 64 << 20 });
    output += `$ npm install --no-audit --no-fund  (cwd ${conv})\n${outputOf(r)}\n`;
    if (r.status !== 0 || !existsSync(babel)) {
      rmSync(targetDir, { recursive: true, force: true });
      return finish({ ok: false, message: `npm install failed in ${conv}\n${CONVERTER_HELP}` });
    }
  }

  rmSync(targetDir, { recursive: true, force: true });
  // Run the script through runpy so os.startfile (Explorer popup) can be disabled for CLI use.
  const code =
    "import os,runpy,sys; os.startfile=lambda *a,**k: None; sys.argv=['wx_converter.py']+sys.argv[1:]; " +
    "runpy.run_path('wx_converter.py', run_name='__main__')";
  output += `$ ${py.cmd} wx_converter.py -s ${wxDir} -t ${targetDir}  (cwd ${conv})\n`;
  const r = spawnSync(py.cmd, [...py.args, '-c', code, '-s', wxDir, '-t', targetDir], {
    cwd: conv,
    input: 'y\ny\ny\n',
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  output += outputOf(r);
  const zip = join(targetDir, 'game.zip');
  if (r.status !== 0 || !existsSync(zip)) {
    return finish({ ok: false, message: `converter failed (exit ${r.status ?? r.signal ?? r.error?.message})` });
  }
  const gameJs = join(targetDir, 'game', 'game.js');
  if (o.minify && existsSync(gameJs)) {
    const m = minifyConverted(gameJs);
    if (!m.ok) {
      output += `\n$ esbuild minify game/game.js: FAILED, keeping the converter output\n${m.message}\n`;
      return finish({ ok: true, zip, zipBytes: statSync(zip).size, warnings: [`${m.message} (shipping it unminified)`] });
    }
    output += `\n$ esbuild minify game/game.js: ${formatBytes(m.before)} -> ${formatBytes(m.after)} (parses)\n`;
    log(`[233] re-minified game.js: ${formatBytes(m.before)} -> ${formatBytes(m.after)}`);
    return finish({ ok: true, zip, zipBytes: zipDir(join(targetDir, 'game'), zip) });
  }
  return finish({ ok: true, zip, zipBytes: statSync(zip).size });
}
