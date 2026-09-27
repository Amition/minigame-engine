import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@engine$/, replacement: fileURLToPath(new URL('./engine/index.ts', import.meta.url)) },
      { find: /^@engine\/(.*)$/, replacement: fileURLToPath(new URL('./engine/$1', import.meta.url)) },
    ],
  },
  test: {
    include: ['engine/**/*.test.ts', 'tools/**/*.test.ts', 'tests/**/*.test.ts', 'sandbox/**/*.test.ts', 'game/**/*.test.ts', 'archer/**/*.test.ts'],
    environment: 'node',
    // Worker threads start much faster than forked processes on Windows (~30% off the full run). Keep files
    // isolated: without isolation, process-wide state such as the texture registry leaks between files.
    pool: 'threads',
    // One budget for every test: ~7x the slowest play-through (~4 s), because parallel files and other processes on
    // a shared machine slow tests down 3-5x. Don't add per-test timeouts; make slow tests cheaper instead
    // (render: 'none', pixelRatio: 1).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
