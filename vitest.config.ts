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
  },
});
