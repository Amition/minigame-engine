/**
 * Screenshot of an app scene in real Chrome (fallback Edge) with mobile emulation, via the web --dev build.
 * Same options as `pnpm shot` (tools/shot/args.ts); `pnpm shot:browser --help` prints them all.
 *
 *   pnpm shot:browser --scene play                              -> .shots/browser-play-iphone-14.png
 *   pnpm shot:browser --app sandbox --scene ui-kit --wait 0.5 --tap "#go" --input touch --lint --bounds
 *
 * Prints page console errors/warnings and uncaught exceptions; exits 1 when there were errors (or lint errors
 * with --lint).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { resolveDevice } from '../../engine/testing/devices';
import { buildTarget } from '../build/build';
import type { EngineHandle } from '../build/web-entry';
import { serveDir } from '../dev/static';
import { ActionError, describeAction, exitOnError, formatTarget, shotArgsOrExit, shotFile, type ShotAction, type ShotArgs } from './args';

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

type EngineWindow = { __engine?: EngineHandle };

const DRAG_STEPS = 12;

async function locate(page: Page, target: string): Promise<{ x: number; y: number }> {
  const at = await page.evaluate((s) => (window as EngineWindow).__engine!.locate(s), target);
  if (at) return at;
  const dump = await page.evaluate(() => (window as EngineWindow).__engine!.dump());
  throw new Error(`no node matches "${target}". Stage:\n${dump}`);
}

const frames = (page: Page, n: number) => page.evaluate((k) => (window as EngineWindow).__engine!.frames(k), n);

/** Runs one --tap/--drag/--wait with the chosen input path. */
async function runAction(page: Page, context: BrowserContext, act: ShotAction, input: ShotArgs['input']): Promise<void> {
  if (act.kind === 'wait') return page.waitForTimeout(act.seconds * 1000);
  if (act.kind === 'tap') {
    const target = formatTarget(act.target);
    if (input === 'engine') return page.evaluate((s) => (window as EngineWindow).__engine!.tap(s), target);
    const at = await locate(page, target);
    if (input === 'touch') await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y, { delay: 50 });
    return frames(page, 2);
  }
  const from = formatTarget(act.from);
  const to = formatTarget(act.to);
  if (input === 'engine') {
    return page.evaluate(([f, t, n]) => (window as EngineWindow).__engine!.drag(f, t, n), [from, to, DRAG_STEPS] as const);
  }
  const a = await locate(page, from);
  const b = await locate(page, to);
  if (input === 'mouse') {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: DRAG_STEPS });
    await page.mouse.up();
    return frames(page, 2);
  }
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
    await frames(page, 1);
    for (let i = 1; i <= DRAG_STEPS; i++) {
      const k = i / DRAG_STEPS;
      const p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, id: 1 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
      await frames(page, 1);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frames(page, 2);
  } finally {
    await cdp.detach();
  }
}

async function main(): Promise<void> {
  const args = shotArgsOrExit(process.argv.slice(2), 'shot:browser');
  const tmp = mkdtempSync(join(tmpdir(), 'engine-shot-'));
  let browser: Browser | null = null;
  let server: Awaited<ReturnType<typeof serveDir>> | null = null;
  let errors = 0;
  let lintErrors = 0;
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
      if (args.params !== undefined) q.set('params', JSON.stringify(args.params));
      if (args.insets) {
        const si = dev.safeInsets;
        q.set('insets', `${si.top},${si.right},${si.bottom},${si.left}`);
      }
      q.set('seed', String(args.seed));
      await page.goto(`${server.url}/?${q}`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => !!(window as EngineWindow).__engine || !!document.getElementById('__engine_error'),
        null,
        { timeout: args.timeout * 1000 },
      );
      const bootError = await page.evaluate(() => document.getElementById('__engine_error')?.textContent ?? null);
      const booted = !bootError;
      if (bootError) {
        logs.push(`boot error: ${bootError}`);
        errors++;
      } else {
        for (const act of args.actions) {
          try {
            await runAction(page, context, act, args.input);
          } catch (e) {
            const msg = (e instanceof Error ? e.message : String(e)).replace(/^page\.evaluate: (Error: )?/, '');
            throw new ActionError(`${describeAction(act)} failed on ${name}: ${msg}`);
          }
        }
      }
      await page.waitForTimeout(args.seconds * 1000);
      const info = await page.evaluate(() => {
        const e = (window as EngineWindow).__engine;
        return e ? { scene: e.scene() || 'none', w: e.game.view.width, h: e.game.view.height } : null;
      });
      const scene = info?.scene ?? args.scene ?? 'error';
      const file = resolve(shotFile('shot:browser', args, scene, name));
      mkdirSync(dirname(file), { recursive: true });
      await page.screenshot({ path: file, scale: args.scale === 'device' ? 'device' : 'css' });
      const view = info ? `, view=${Math.round(info.w)}x${Math.round(info.h)}` : '';
      console.log(`shot: ${file}  (scene=${scene}, device=${name}${view})`);
      if (booted && args.bounds) {
        const boundsFile = file.replace(/(\.png)?$/i, '-bounds.png');
        await page.evaluate(() => (window as EngineWindow).__engine!.bounds(true));
        await frames(page, 2);
        await page.screenshot({ path: boundsFile, scale: args.scale === 'device' ? 'device' : 'css' });
        await page.evaluate(() => (window as EngineWindow).__engine!.bounds(false));
        console.log(`bounds: ${boundsFile}`);
      }
      if (booted && args.dump) console.log(await page.evaluate(() => (window as EngineWindow).__engine!.dump()));
      if (booted && args.lint) {
        const lint = await page.evaluate(() => (window as EngineWindow).__engine!.lint());
        lintErrors += lint.errors;
        console.log(`[${name}] ${lint.report}`);
      }
      for (const l of logs) console.log(`  ${l}`);
      await context.close();
    }
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  if (errors) console.error(`${errors} page error(s)`);
  if (errors || lintErrors) process.exit(1);
}

main().catch(exitOnError);
