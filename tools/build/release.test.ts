import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundle } from './build';
import { ROOT } from './config';
import { minifyConverted } from './convert233';
import { formatBreakdown, sourceFolder } from './files';
import { auditAudioManifest, checkAudioLibrary, stubAudioLibrary } from './release';

let tmp = '';
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'engine-release-test-'));
});
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function write(dir: string, files: Record<string, string>): string {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const where = { library: 'x/audio/index.ts', manifest: 'x/assets/audio/manifest.json', app: 'x' };

describe('audio manifest check', () => {
  const names = { sfx: ['coin', 'jump'], music: ['menu'] };
  const all = new Set(['audio/coin.mp3', 'audio/jump.mp3', 'audio/menu.mp3']);
  const complete = {
    sounds: {
      coin: { file: 'audio/coin.mp3', kind: 'sfx' },
      jump: { file: 'audio/jump.mp3', kind: 'sfx' },
      menu: { file: 'audio/menu.mp3', kind: 'music' },
      extra: { file: 'audio/extra.mp3', kind: 'sfx' },
    },
  };

  it('accepts a manifest covering every library sound (extra entries are fine)', () => {
    expect(auditAudioManifest(names, complete, (f) => all.has(f), where)).toEqual([]);
    expect(auditAudioManifest({ sfx: [], music: [] }, null, () => false, where)).toEqual([]);
  });

  it('reports a missing manifest, missing sounds, wrong kinds and missing files with the fix', () => {
    const [none] = auditAudioManifest(names, null, () => true, where);
    expect(none).toContain('no audio manifest at x/assets/audio/manifest.json for the 3 sounds');
    expect(none).toContain('pnpm audio --app x');
    const partial = { sounds: { coin: { file: 'audio/coin.mp3', kind: 'music' }, menu: { file: 'audio/gone.mp3', kind: 'music' } } };
    const problems = auditAudioManifest(names, partial, (f) => all.has(f), where);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/missing 1 sound\(s\) of x\/audio\/index\.ts: jump; run "pnpm audio --app x"/);
    expect(problems[1]).toContain('coin (library sfx, manifest music)');
    expect(problems[2]).toContain('menu (audio/gone.mp3)');
  });

  it('checks the real game library against its rendered manifest', async () => {
    const r = await checkAudioLibrary(join(ROOT, 'game'));
    expect(r.problems).toEqual([]);
    expect(r.stubbable).toBe(true);
    expect(r.names.sfx.length).toBeGreaterThan(0);
    expect(r.names.music.length).toBeGreaterThan(0);
  });

  it('fails a release bundle whose manifest misses sounds, before bundling', async () => {
    const app = write(join(tmp, 'noaudio'), {
      'main.ts': "import { sfx } from './audio/index';\nconsole.log(sfx);\n",
      'audio/index.ts': 'export const sfx = { beep: {} };\nexport const music = {};\n',
    });
    const r = await bundle('wx', app, join(tmp, 'noaudio-out'), { dev: false, minify: false, meta: { name: 'x', orientation: 'portrait' } });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/no audio manifest at .*manifest\.json for the 1 sounds/);
    const dev = await checkAudioLibrary(app);
    expect(dev.names).toEqual({ sfx: ['beep'], music: [] });
  });

  it('keeps libraries that export more than sfx / music', async () => {
    const app = write(join(tmp, 'extra'), { 'audio/index.ts': 'export const sfx = {};\nexport const music = {};\nexport const helper = 1;\n' });
    expect((await checkAudioLibrary(app)).stubbable).toBe(false);
    expect((await checkAudioLibrary(join(tmp, 'missing'))).file).toBeNull();
  });
});

describe('release audio stub', () => {
  it("replaces the library for <app>/main.ts only", async () => {
    const app = write(join(tmp, 'stub'), {
      'main.ts': "import { sfx, music } from './audio/index';\nimport { n } from './lab';\nlog(Object.keys(sfx).length, Object.keys(music).length, n);\n",
      'lab.ts': "import { sfx } from './audio';\nexport const n = Object.keys(sfx).length;\n",
      'audio/index.ts': 'export const sfx = { a: 1, b: 2 };\nexport const music = { m: 1 };\n',
    });
    const res = await esbuild.build({
      entryPoints: [join(app, 'main.ts')],
      bundle: true,
      write: false,
      format: 'iife',
      plugins: [stubAudioLibrary(app)],
    });
    const logged: unknown[][] = [];
    vm.runInNewContext(res.outputFiles[0]!.text, { log: (...a: unknown[]) => logged.push(a) });
    expect(logged).toEqual([[0, 0, 2]]);
  });

  it('strips the synth, the library and dev scenes from the game release bundle', async () => {
    const out = join(tmp, 'game-wx');
    const r = await bundle('wx', join(ROOT, 'game'), out, { dev: false, minify: true });
    expect(r.problems).toEqual([]);
    const folders = r.breakdown!.folders.map((f) => f.folder);
    expect(folders).toContain('(release-stub)');
    expect(folders).not.toContain('game/audio');
    const code = readFileSync(join(out, 'game.js'), 'utf8');
    expect(code).not.toMatch(/gallery/i);
    expect(code).not.toContain('pcm-');
    expect(r.breakdown!.gzip).toBeLessThan(r.breakdown!.bytes);
  });
});

describe('size breakdown', () => {
  it('groups metafile inputs by folder', () => {
    expect(sourceFolder('engine/ui/button.ts')).toBe('engine/ui');
    expect(sourceFolder('game/main.ts')).toBe('game');
    expect(sourceFolder('node_modules/.pnpm/a@1/node_modules/@scope/pkg/x/y.js')).toBe('node_modules/@scope/pkg');
    expect(sourceFolder('../elsewhere/lib/a.ts')).toBe('elsewhere/lib');
    expect(sourceFolder('release-stub:C:/w/game/audio/index.ts')).toBe('(release-stub)');
    expect(sourceFolder('<stdin>')).toBe('(entry)');
    expect(sourceFolder('main.ts')).toBe('.');
  });

  it('prints the largest folders, the rest and the bundle glue', () => {
    const text = formatBreakdown(
      { bytes: 1000, gzip: 400, folders: [{ folder: 'engine/ui', bytes: 600 }, { folder: 'game', bytes: 300 }, { folder: 'x', bytes: 50 }] },
      'wx game.js',
      2,
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('wx game.js by source folder: 1000 B, gzip 400 B');
    expect(lines[1]).toMatch(/^ {2}engine\/ui\s+600 B\s+60\.0%$/);
    expect(lines[3]).toMatch(/\(1 more folders\)\s+50 B/);
    expect(lines[4]).toMatch(/\(bundle glue\)\s+50 B/);
  });
});

describe('233 re-minify', () => {
  it('minifies converted ES5 in place and keeps ES5 syntax', () => {
    const file = join(tmp, 'converted.js');
    const src = 'var game = (function () {\n  var answer = { value: 42 };\n  // comment\n  return answer != null ? answer : { value: 0 };\n})();\n';
    writeFileSync(file, src);
    const r = minifyConverted(file);
    expect(r.ok).toBe(true);
    expect(r.after).toBeLessThan(r.before);
    const code = readFileSync(file, 'utf8');
    expect(code).not.toMatch(/\?\?|\?\./);
    expect(code).not.toContain('=>');
    expect(vm.runInNewContext(`${code}; game.value`)).toBe(42);
  });

  it('leaves a file it cannot parse untouched', () => {
    const file = join(tmp, 'broken.js');
    writeFileSync(file, 'var a = ;');
    const r = minifyConverted(file);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('could not minify');
    expect(readFileSync(file, 'utf8')).toBe('var a = ;');
  });
});
