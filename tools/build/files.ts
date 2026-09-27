// Per-target package files, asset copying, size accounting and a small zip writer.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import type { AppMeta, BundleTarget } from './config';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Script injected by the dev server: reload on rebuild, show build errors. */
export const LIVE_RELOAD_SCRIPT = `<script>
(function () {
  var es = new EventSource('/__reload');
  es.addEventListener('reload', function () { location.reload(); });
  es.addEventListener('build-error', function (e) {
    var el = document.getElementById('__engine_error');
    if (!el) {
      el = document.createElement('pre');
      el.id = '__engine_error';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:60%;overflow:auto;margin:0;padding:12px;z-index:2147483646;background:rgba(127,0,0,.92);color:#fff;font:12px/1.4 Consolas,monospace;white-space:pre-wrap';
      document.body.appendChild(el);
    }
    el.textContent = JSON.parse(e.data);
  });
})();
</script>`;

/** index.html for the web build: mobile viewport without zoom, dark background, one canvas. */
export function webIndexHtml(meta: AppMeta, opts: { liveReload?: boolean } = {}): string {
  const bg = meta.background ?? '#000000';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="${esc(bg)}">
<title>${esc(meta.name)}</title>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:${esc(bg)};touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
canvas{display:block;position:fixed;left:0;top:0;touch-action:none}
</style>
</head>
<body>
<canvas id="game"></canvas>
<script src="game.js"></script>
${opts.liveReload ? LIVE_RELOAD_SCRIPT + '\n' : ''}</body>
</html>
`;
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

/** Writes the target's config files next to game.js. Returns the file names written. */
export function writeTargetFiles(target: BundleTarget, dir: string, meta: AppMeta): string[] {
  const put = (name: string, content: string) => {
    writeFileSync(join(dir, name), content);
    return name;
  };
  switch (target) {
    case 'web':
      return [put('index.html', webIndexHtml(meta))];
    case 'wx':
      // https://developers.weixin.qq.com/minigame/dev/reference/configuration/app.html
      return [
        put(
          'game.json',
          json({
            deviceOrientation: meta.orientation,
            showStatusBar: false,
            networkTimeout: { request: 10000, connectSocket: 10000, uploadFile: 10000, downloadFile: 10000 },
          }),
        ),
        put(
          'project.config.json',
          json({
            description: meta.name,
            appid: meta.appid?.wx || 'touristappid',
            projectname: meta.name,
            compileType: 'game',
            // game.js is already ES2017 (and minified with --minify): no devtools transpile/minify pass.
            setting: {
              urlCheck: false,
              es6: false,
              enhance: false,
              postcss: false,
              minified: false,
              uglifyFileName: false,
              uploadWithSourceMap: true,
              checkInvalidKey: true,
              ignoreUploadUnusedFiles: true,
            },
            packOptions: { ignore: [{ type: 'suffix', value: '.map' }], include: [] },
            condition: {},
            editorSetting: { tabIndent: 'insertSpaces', tabSize: 2 },
          }),
        ),
      ];
    case 'tt':
      // https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/dev-guide/bytedance-mini-game
      // https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/dev-tools/code-edit/project-config
      return [
        put('game.json', json({ deviceOrientation: meta.orientation })),
        put(
          'project.config.json',
          json({
            appid: meta.appid?.tt || 'testAppId',
            projectname: meta.name,
            description: meta.name,
            setting: { es6: false, urlCheck: false, autoCompile: true, mockUpdate: false, mockLogin: false },
          }),
        ),
      ];
    case 'tap':
      // https://developer.taptap.cn/minigameapidoc/dev/dev-support/config/ : game.js + game.json only.
      // deviceOrientation defaults differ between TapTap doc pages (landscape / portrait): always explicit.
      return [put('game.json', json({ deviceOrientation: meta.orientation, showStatusBar: false }))];
  }
}

/** Copies `<app>/assets/**` (without dotfiles) to `<dir>/assets`. Returns the number of files copied. */
export function copyAssets(appDir: string, dir: string): number {
  const src = join(appDir, 'assets');
  if (!existsSync(src)) return 0;
  const files = listFiles(src).filter((f) => !f.split('/').some((part) => part.startsWith('.')));
  if (files.length === 0) return 0;
  mkdirSync(join(dir, 'assets'), { recursive: true });
  cpSync(src, join(dir, 'assets'), {
    recursive: true,
    filter: (from) => !relative(src, from).split(/[\\/]/).some((part) => part.startsWith('.')),
  });
  return files.length;
}

/** Relative (posix) paths of all files under dir, sorted. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(relative(dir, p).replace(/\\/g, '/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

export interface PackageSize {
  files: number;
  /** All files except source maps (not uploaded / not counted by the devtools). */
  total: number;
  code: number;
  assets: number;
  assetFiles: number;
}

export function packageSize(dir: string): PackageSize {
  const s: PackageSize = { files: 0, total: 0, code: 0, assets: 0, assetFiles: 0 };
  for (const f of listFiles(dir)) {
    if (f.endsWith('.map')) continue;
    const size = statSync(join(dir, f)).size;
    s.files++;
    s.total += size;
    if (f.endsWith('.js')) s.code += size;
    if (f.startsWith('assets/')) {
      s.assets += size;
      s.assetFiles++;
    }
  }
  return s;
}

/**
 * File types mini-game uploads accept (Douyin's list, which matches WeChat's for everything a Canvas 2D game
 * ships; note: no .webp). Other files are rejected or silently dropped by the devtools.
 */
const UPLOAD_TYPES = new Set(
  (
    'png jpg jpeg gif svg json js cer mp3 aac m4a mp4 wav flac ape ogg wma midi ogv webm mkv ttc ttf woff otf obj dae ' +
    'fbx mtl stl 3ds pvr plist fnt gz ccz bmp atlas swf ani part proto bin sk mipmaps txt zip tt map silk dbbin dbmv etc ' +
    'lmat lm ls lh lani lav lsani ltc xml pkm scene csv prefab mesh astc wasm br heic ico cur dat dds glb gltf ktx lmani lml skel'
  ).split(' '),
);

/** Package files whose type mini-game uploads reject. */
export function unsupportedFiles(dir: string): string[] {
  return listFiles(dir).filter((f) => !UPLOAD_TYPES.has(extname(f).slice(1).toLowerCase()));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Writes a zip of everything in dir (entries at the zip root, deflated, fixed timestamps). */
export function zipDir(dir: string, outFile: string): number {
  const files = listFiles(dir);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const date = ((2020 - 1980) << 9) | (1 << 5) | 1;
  for (const rel of files) {
    const data = readFileSync(join(dir, rel));
    const deflated = deflateRawSync(data, { level: 9 });
    const store = deflated.length >= data.length;
    const body = store ? data : deflated;
    const crc = crc32(data);
    const name = Buffer.from(rel, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(store ? 0 : 8, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += local.length + name.length + body.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...parts, ...central, end]);
  writeFileSync(outFile, zip);
  return zip.length;
}
