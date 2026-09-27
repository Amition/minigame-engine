// Default `--app` for every CLI: package.json "engine": { "app": "<dir>" }, else 'sandbox'.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let cached: string | null = null;

/** App directory used when a tool gets no `--app` (relative to the repo root). */
export function defaultApp(): string {
  if (cached !== null) return cached;
  let app = 'sandbox';
  const pkgFile = join(ROOT, 'package.json');
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { engine?: { app?: unknown } };
    if (typeof pkg.engine?.app === 'string' && pkg.engine.app.trim() !== '') app = pkg.engine.app.trim();
  }
  cached = app;
  return app;
}

/** Usage text of a CLI: the first `/** ... *\/` comment of its source file (pass `import.meta.url`). */
export function cliUsage(moduleUrl: string): string {
  const src = readFileSync(fileURLToPath(moduleUrl), 'utf8');
  const m = /\/\*\*([\s\S]*?)\*\//.exec(src);
  const text = (m?.[1] ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*\* ?/, ''))
    .join('\n')
    .trim();
  return `${text}\n\nDefault --app: ${defaultApp()} (package.json "engine.app")`;
}

/** Handles `--help` / a bad command line for CLIs whose usage is their header comment. */
export function exitWithUsage(moduleUrl: string, error?: string): never {
  if (error) {
    console.error(`${cliUsage(moduleUrl)}\n\nerror: ${error}`);
    process.exit(1);
  }
  console.log(cliUsage(moduleUrl));
  process.exit(0);
}
