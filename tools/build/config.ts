// Shared by the build CLI, the dev server and the browser screenshot tool: app metadata, generated entries and
// esbuild options.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildOptions } from 'esbuild';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Bundle targets (233 reuses the wx bundle). */
export type BundleTarget = 'web' | 'wx' | 'tt' | 'tap';
export type MiniGameTarget = Exclude<BundleTarget, 'web'>;

/** `<app>/app.json`: store metadata that is not part of the runtime AppDef. */
export interface AppMeta {
  name: string;
  version?: string;
  orientation: 'portrait' | 'landscape';
  /** Page / loading background (web index.html). */
  background?: string;
  appid?: Partial<Record<MiniGameTarget, string>>;
  /** Ad unit ids per platform, e.g. ads.wx.rewarded. Game code imports app.json to read them. */
  ads?: Partial<Record<MiniGameTarget, Record<string, string>>>;
  /** Passive share (menu) content on mini-games. */
  share?: { title?: string; imageUrl?: string; query?: string };
}

export function readAppMeta(appDir: string): AppMeta {
  const file = join(appDir, 'app.json');
  const raw = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<AppMeta>) : {};
  const orientation = raw.orientation === 'landscape' ? 'landscape' : 'portrait';
  return { ...raw, name: raw.name || basename(appDir), orientation };
}

export function resolveApp(app: string): string {
  const dir = resolve(app);
  if (!existsSync(join(dir, 'main.ts'))) throw new Error(`no main.ts in ${dir} (--app must point at an app directory)`);
  return dir;
}

const posix = (p: string) => p.replace(/\\/g, '/');

const PLATFORM_FACTORY: Record<MiniGameTarget, string> = {
  wx: 'createWxPlatform',
  tt: 'createTtPlatform',
  tap: 'createTapPlatform',
};

/** Source of the generated entry: imports the app's default AppDef and starts it on the target's platform. */
export function entrySource(target: BundleTarget, appDir: string, meta: AppMeta, dev: boolean): string {
  const main = JSON.stringify(posix(join(appDir, 'main.ts')));
  if (target === 'web') {
    const boot = JSON.stringify(posix(join(ROOT, 'tools/build/web-entry.ts')));
    const opts = { dev, storagePrefix: `${basename(appDir)}:` };
    return [`import app from ${main};`, `import { bootWeb } from ${boot};`, `void bootWeb(app, ${JSON.stringify(opts)});`].join('\n');
  }
  const fn = PLATFORM_FACTORY[target];
  const opts = meta.share ? { share: meta.share } : {};
  return [
    `import app from ${main};`,
    `import { runApp } from '@engine';`,
    `import { ${fn} } from '@engine/platform/${target}';`,
    `runApp(app, ${fn}(${JSON.stringify(opts)})).catch((e) => console.error('[boot] failed:', e));`,
  ].join('\n');
}

/** esbuild options for one target: single IIFE game.js, ES2017, tsconfig paths ('@engine'), sourcemap in dev. */
export function esbuildOptions(
  target: BundleTarget,
  appDir: string,
  meta: AppMeta,
  o: { dev: boolean; minify: boolean; outfile: string },
): BuildOptions {
  return {
    stdin: {
      contents: entrySource(target, appDir, meta, o.dev),
      resolveDir: ROOT,
      sourcefile: `entry-${target}.ts`,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    // Mini-game JS engines (iOS JavaScriptCore, V8) run ES2017; wx/tt devtools then need no ES6→ES5 pass.
    target: 'es2017',
    platform: 'browser',
    tsconfig: join(ROOT, 'tsconfig.json'),
    outfile: o.outfile,
    minify: o.minify,
    sourcemap: o.dev ? 'linked' : false,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify(o.dev ? 'development' : 'production') },
  };
}

/**
 * Problems that would break a mini-game runtime (no node, no require). Returns human-readable findings.
 * Checks for module specifiers, not for the plain word "node:".
 */
export function findNodeImports(code: string): string[] {
  const found: string[] = [];
  const spec = /["'`](node:[\w/]+)["'`]/.exec(code);
  if (spec) found.push(`node module specifier ${spec[1]}`);
  if (code.includes('@napi-rs')) found.push('@napi-rs reference');
  const req = /(^|[^\w$.])require\s*\(\s*["'`]([^"'`]+)["'`]/m.exec(code);
  if (req) found.push(`require("${req[2]}")`);
  if (code.includes('__require')) found.push('esbuild __require shim (a CommonJS require was bundled)');
  return found;
}
