/**
 * Screenshot of an app scene in real Chrome (fallback Edge) with mobile emulation, via the web --dev build.
 *
 *   pnpm shot:browser --scene basics                          -> .shots/browser-basics-iphone-14.png
 *   pnpm shot:browser --scene basics --device iphone-se,ipad --tap "#counter" --tap "#counter" --seconds 1
 *
 * Options:
 *   --app <dir>         app directory (default sandbox)
 *   --scene <name>      scene to open (default: the app's start scene)
 *   --params <json>     params for the scene
 *   --device <list>     comma list of device names (engine/testing/devices.ts) or WxH@dpr; 'all' = every profile
 *   --tap <selector>    tap a node through window.__engine (repeatable, in order)
 *   --input <how>       how taps are delivered: engine (default, injected into the platform), touch (real CDP touch
 *                       events at the node center) or mouse (real mouse click; exercises the adapter's DOM input path)
 *   --seconds <n>       wait after setup/taps before the shot (default 0.5)
 *   --out <file>        output path (only with a single device)
 *   --scale css|device  PNG in CSS px (default, same size as `pnpm shot`) or device pixels
 *   --browser <exe>     browser executable (default: CHROME_PATH, system Chrome, then Edge)
 *   --no-insets         do not emulate the device's safe-area insets (default: passed as ?insets=)
 *
 * Prints page console errors/warnings and uncaught exceptions; exits 1 when there were errors.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { devices, resolveDevice } from '../../engine/testing/devices';
import { buildTarget } from '../build/build';
import { serveDir } from '../dev/static';

interface Args {
  app: string;
  scene?: string;
  params?: string;
  devices: string[];
  taps: string[];
  input: 'engine' | 'touch' | 'mouse';
  seconds: number;
  out?: string;
  scale: 'css' | 'device';
  browser?: string;
  insets: boolean;
  timeout: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    app: 'sandbox',
    devices: ['iphone-14'],
    taps: [],
    input: 'engine',
    seconds: 0.5,
    scale: 'css',
    insets: true,
    timeout: 20,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = () => {
      const val = argv[++i];
      if (val === undefined) throw new Error(`missing value for ${k}`);
      return val;
    };
    switch (k) {
      case '--app':
        a.app = v();
        break;
      case '--scene':
        a.scene = v();
        break;
      case '--params':
        a.params = v();
        break;
      case '--device':
      case '--devices': {
        const d = v();
        a.devices = d === 'all' ? Object.keys(devices) : d.split(',');
        break;
      }
      case '--tap':
        a.taps.push(v());
        break;
      case '--input': {
        const how = v();
        if (how !== 'engine' && how !== 'touch' && how !== 'mouse') throw new Error(`--input must be engine|touch|mouse`);
        a.input = how;
        break;
      }
      case '--seconds':
        a.seconds = +v();
        break;
      case '--out':
        a.out = v();
        break;
      case '--scale':
        a.scale = v() === 'device' ? 'device' : 'css';
        break;
      case '--browser':
        a.browser = v();
        break;
      case '--no-insets':
        a.insets = false;
        break;
      case '--timeout':
        a.timeout = +v();
        break;
      default:
        throw new Error(`unknown option ${k}`);
    }
  }
  return a;
}

/** System Chrome, then Edge (Windows, macOS, Linux locations). */
function findBrowser(explicit?: string): string {
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    local && join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error('no Chrome/Edge found: pass --browser <exe> or set CHROME_PATH');
}

interface EngineWindow {
  __engine?: {
    tap(selector: string): Promise<void>;
    locate(selector: string): { x: number; y: number } | null;
    frames(n?: number): Promise<void>;
    dump(): string;
    scene(): string;
    game: { view: { width: number; height: number } };
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tmp = mkdtempSync(join(tmpdir(), 'engine-shot-'));
  let browser: Browser | null = null;
  let server: Awaited<ReturnType<typeof serveDir>> | null = null;
  let errors = 0;
  try {
    const built = await buildTarget('web', { app: args.app, out: tmp, dev: true, log: () => {} });
    if (!built.ok) throw new Error(`web build failed:\n${built.problems.join('\n')}`);
    server = await serveDir(built.dir);
    const exe = findBrowser(args.browser);
    browser = await chromium.launch({ executablePath: exe, headless: true });
    console.log(`browser: ${exe} (${browser.version()})`);

    for (const name of args.devices) {
      const dev = resolveDevice(name);
      const context = await browser.newContext({
        viewport: { width: dev.width, height: dev.height },
        deviceScaleFactor: dev.pixelRatio,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      const logs: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') logs.push(`console.${m.type()}: ${m.text()}`);
        if (m.type() === 'error') errors++;
      });
      page.on('pageerror', (e) => {
        logs.push(`uncaught: ${e.stack ?? e.message}`);
        errors++;
      });
      page.on('requestfailed', (r) => logs.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));

      const q = new URLSearchParams();
      if (args.scene) q.set('scene', args.scene);
      if (args.params) q.set('params', args.params);
      if (args.insets) {
        const si = dev.safeInsets;
        q.set('insets', `${si.top},${si.right},${si.bottom},${si.left}`);
      }
      await page.goto(`${server.url}/?${q}`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => !!(window as EngineWindow).__engine || !!document.getElementById('__engine_error'),
        null,
        { timeout: args.timeout * 1000 },
      );
      const bootError = await page.evaluate(() => document.getElementById('__engine_error')?.textContent ?? null);
      if (bootError) {
        logs.push(`boot error: ${bootError}`);
        errors++;
      } else {
        for (const sel of args.taps) {
          if (args.input === 'engine') {
            await page.evaluate((s) => (window as EngineWindow).__engine!.tap(s), sel);
            continue;
          }
          const at = await page.evaluate((s) => (window as EngineWindow).__engine!.locate(s), sel);
          if (!at) {
            const dump = await page.evaluate(() => (window as EngineWindow).__engine!.dump());
            throw new Error(`no node matches "${sel}". Stage:\n${dump}`);
          }
          if (args.input === 'touch') await page.touchscreen.tap(at.x, at.y);
          else await page.mouse.click(at.x, at.y, { delay: 50 });
          await page.evaluate(() => (window as EngineWindow).__engine!.frames(2));
        }
      }
      await page.waitForTimeout(args.seconds * 1000);
      const info = await page.evaluate(() => {
        const e = (window as EngineWindow).__engine;
        return e ? { scene: e.scene() || 'none', w: e.game.view.width, h: e.game.view.height } : null;
      });
      const scene = info?.scene ?? args.scene ?? 'error';
      const file = resolve(args.out && args.devices.length === 1 ? args.out : `.shots/browser-${scene}-${name}.png`);
      mkdirSync(dirname(file), { recursive: true });
      await page.screenshot({ path: file, scale: args.scale });
      const view = info ? `, view=${Math.round(info.w)}x${Math.round(info.h)}` : '';
      console.log(`shot: ${file}  (scene=${scene}, device=${name}${view})`);
      for (const l of logs) console.log(`  ${l}`);
      await context.close();
    }
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  if (errors) {
    console.error(`${errors} page error(s)`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
