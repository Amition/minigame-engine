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
