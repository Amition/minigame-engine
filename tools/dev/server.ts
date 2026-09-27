/**
 * Dev server: esbuild watch + live reload for the web build.
 *
 *   pnpm dev                          -> http://localhost:5173/ (+ LAN URLs for phones on the same Wi-Fi)
 *   pnpm dev --app sandbox --port 8080
 *
 * Options:
 *   --app <dir>       app directory with main.ts (default: package.json "engine.app", else sandbox)
 *   --port <n>        port (default 5173; the next free one if taken)
 *   --host <addr>     interface to listen on (default 0.0.0.0 = LAN reachable)
 *   --help            print this help
 *
 * Routes:
 *   /                 the game (same URL params as the web build: ?scene=<name>&params=<json>&insets=t,r,b,l)
 *   /frame            the game in iframes at 3 phone sizes side by side (?devices=a,b,c, other params forwarded)
 *   /assets/*         <app>/assets
 *   /__reload         server-sent events: `reload` after a rebuild or asset change, `build-error` with the message
 *
 * The build is a --dev build: window.__engine is available in the page console.
 */
import { existsSync, watch } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { basename, join } from 'node:path';
import * as esbuild from 'esbuild';
import { devices, resolveDevice } from '../../engine/testing/devices';
import { esbuildOptions, readAppMeta, resolveApp, ROOT } from '../build/config';
import { defaultApp, exitWithUsage } from '../common/app';
import { webIndexHtml } from '../build/files';
import { fileInRoot, listen, send, sendFile } from './static';

interface Args {
  app: string;
  port: number;
  host: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { app: defaultApp(), port: 5173, host: '0.0.0.0' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = () => {
      const val = argv[++i];
      if (val === undefined) exitWithUsage(import.meta.url, `missing value for ${k}`);
      return val;
    };
    if (k === '--app') a.app = v();
    else if (k === '--port') a.port = +v();
    else if (k === '--host') a.host = v();
    else if (k === '--help' || k === '-h') exitWithUsage(import.meta.url);
    else exitWithUsage(import.meta.url, `unknown option ${k}`);
  }
  return a;
}

const FRAME_DEVICES = ['iphone-se', 'iphone-14', 'android'];

/** /frame: one iframe per device at its CSS size, scaled down to fit the window height. */
function framePage(title: string, query: URLSearchParams): string {
  const names = (query.get('devices') ?? FRAME_DEVICES.join(',')).split(',').filter(Boolean);
  query.delete('devices');
  const cells = names
    .map((name) => {
      const d = resolveDevice(name);
      const q = new URLSearchParams(query);
      const si = d.safeInsets;
      q.set('insets', `${si.top},${si.right},${si.bottom},${si.left}`);
      return `<figure><figcaption>${name} · ${d.width}×${d.height}</figcaption>
<iframe src="/?${q}" width="${d.width}" height="${d.height}" style="width:${d.width}px;height:${d.height}px"></iframe></figure>`;
    })
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title} · frames</title>
<style>
body{margin:0;background:#0b0c10;color:#c9ccd6;font:13px/1.4 system-ui,sans-serif}
main{display:flex;gap:28px;align-items:flex-start;padding:16px 20px;transform-origin:0 0}
figure{margin:0}figcaption{margin:0 0 6px}
iframe{border:0;border-radius:18px;box-shadow:0 0 0 1px #2a2e3a,0 12px 32px #0008;background:#000}
</style></head>
<body><main id="m">
${cells}
</main>
<script>
function fit(){var m=document.getElementById('m');m.style.transform='';var s=Math.min(1,(innerHeight-8)/m.scrollHeight,(innerWidth-8)/m.scrollWidth);m.style.transform='scale('+s+')';}
addEventListener('resize',fit);fit();
new EventSource('/__reload');
</script>
</body></html>`;
}

function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}/`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const appDir = resolveApp(args.app);
  const assetsDir = join(appDir, 'assets');
  let meta = readAppMeta(appDir);

  let outputs = new Map<string, Uint8Array>();
  let lastError: string | null = null;
  const clients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown) => {
    for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let t0 = 0;
  const ctx = await esbuild.context({
    ...esbuildOptions('web', appDir, meta, { dev: true, minify: false, outfile: join(ROOT, '.cache/dev/game.js') }),
    write: false,
    plugins: [
      {
        name: 'live-reload',
        setup(b) {
          b.onStart(() => {
            t0 = Date.now();
          });
          b.onEnd(async (res) => {
            const time = new Date().toLocaleTimeString();
            if (res.errors.length) {
              lastError = (await esbuild.formatMessages(res.errors, { kind: 'error', color: false })).join('\n');
              console.error(`[dev ${time}] build failed:\n${lastError}`);
              broadcast('build-error', lastError);
              return;
            }
            outputs = new Map((res.outputFiles ?? []).map((f) => [basename(f.path), f.contents]));
            lastError = null;
            for (const w of await esbuild.formatMessages(res.warnings, { kind: 'warning', color: false })) console.warn(w.trim());
            console.log(`[dev ${time}] built game.js in ${Date.now() - t0} ms`);
            broadcast('reload', Date.now());
          });
        },
      },
    ],
  });
  await ctx.watch();

  if (existsSync(assetsDir)) {
    let timer: NodeJS.Timeout | null = null;
    watch(assetsDir, { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => broadcast('reload', Date.now()), 100);
    });
  }
  const appJson = join(appDir, 'app.json');
  if (existsSync(appJson)) watch(appJson, () => (meta = readAppMeta(appDir)));

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (path === '/' || path === '/index.html') return send(res, 200, webIndexHtml(meta, { liveReload: true }), 'text/html; charset=utf-8');
    if (path === '/frame' || path === '/frame/') return send(res, 200, framePage(meta.name, url.searchParams), 'text/html; charset=utf-8');
    if (path === '/game.js' || path === '/game.js.map') {
      const out = outputs.get(path.slice(1));
      if (out) return send(res, 200, out, path.endsWith('.map') ? 'application/json' : 'text/javascript; charset=utf-8');
      return send(res, 503, `console.error(${JSON.stringify(lastError ?? 'build pending, reload in a moment')});`, 'text/javascript');
    }
    if (path === '/__reload') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 1000\n\n');
      if (lastError) res.write(`event: build-error\ndata: ${JSON.stringify(lastError)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (path === '/favicon.ico') return send(res, 204, '');
    if (path.startsWith('/assets/')) {
      const file = fileInRoot(assetsDir, path.slice('/assets/'.length));
      if (file) return sendFile(res, file);
    }
    send(res, 404, `not found: ${path}`);
  });
  const keepAlive = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
  }, 15000);

  const port = await listen(server, args.port, args.host);
  const local = `http://localhost:${port}/`;
  console.log(`\n  ${meta.name} (${basename(appDir)}) dev server`);
  console.log(`  Local:   ${local}`);
  for (const u of lanUrls(port)) console.log(`  LAN:     ${u}   (phone on the same Wi-Fi)`);
  console.log(`  Frames:  ${local}frame   (${FRAME_DEVICES.join(', ')}; ?devices=${Object.keys(devices).join(',')})`);
  console.log(`  Scene:   ${local}?scene=<name>\n`);

  const stop = async () => {
    clearInterval(keepAlive);
    for (const c of clients) c.end();
    await ctx.dispose();
    server.closeAllConnections();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
