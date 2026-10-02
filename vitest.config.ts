import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      // `server-only` throws outside the react-server condition; tests import server modules directly.
      'server-only': path.resolve(__dirname, './test/server-only-stub.ts'),
    },
  },
});
