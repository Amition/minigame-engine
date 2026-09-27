// 233乐园: the wx package converted by the Tuanjie/Unity minihost converter (wx_converter.py).
// Converter CLI (read from its source, v2.0.1): python wx_converter.py -s <wx dir> -t <target dir> [-sp]
//   - must run with cwd = converter dir (relative paths to .babelrc, wx_unity_converter/, libs/)
//   - copies <src> to <target>/game, patches game.json (companyName, convertScriptVersion...), runs
//     `npx babel` (preset-env → ES5) over it, prepends wx_unity.js to game.js (removes GameGlobal.fetch),
//     copies check-version.js and zips <target>/game into <target>/game.zip
//   - asks for confirmation on stdin when <target> is not empty, and opens Explorer when done (os.startfile)
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
}

/** Converts a built wx package dir into <targetDir>/game.zip. Skips (ok: true, skipped) when no converter exists. */
export function convert233(wxDir: string, targetDir: string, log: (s: string) => void = console.log): ConvertResult {
  const conv = findConverter();
  if (!conv) return { ok: true, skipped: true, message: `converter not found at ${converterDir()}\n${CONVERTER_HELP}` };
  const py = findPython();
  if (!py) return { ok: false, message: `python not found on PATH\n${CONVERTER_HELP}` };

  const babel = join(conv, 'node_modules', '.bin', process.platform === 'win32' ? 'babel.cmd' : 'babel');
  if (!existsSync(babel)) {
    log(`[233] installing converter dependencies: npm install (in ${conv})`);
    const r = spawnSync('npm install --no-audit --no-fund', { cwd: conv, stdio: 'inherit', shell: true });
    if (r.status !== 0 || !existsSync(babel)) return { ok: false, message: `npm install failed in ${conv}\n${CONVERTER_HELP}` };
  }

  rmSync(targetDir, { recursive: true, force: true });
  // Run the script through runpy so os.startfile (Explorer popup) can be disabled for CLI use.
  const code =
    "import os,runpy,sys; os.startfile=lambda *a,**k: None; sys.argv=['wx_converter.py']+sys.argv[1:]; " +
    "runpy.run_path('wx_converter.py', run_name='__main__')";
  log(`[233] ${py.cmd} wx_converter.py -s ${wxDir} -t ${targetDir}  (cwd ${conv})`);
  const r = spawnSync(py.cmd, [...py.args, '-c', code, '-s', wxDir, '-t', targetDir], {
    cwd: conv,
    input: 'y\ny\ny\n',
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  const zip = join(targetDir, 'game.zip');
  if (r.status !== 0 || !existsSync(zip)) {
    return { ok: false, message: `converter failed (exit ${r.status ?? r.signal ?? r.error?.message})` };
  }
  return { ok: true, zip, zipBytes: statSync(zip).size };
}
