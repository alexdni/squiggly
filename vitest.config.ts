import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // tsconfig keeps JSX for Next ("preserve"); component tests need the React 17+ runtime transform.
  esbuild: { jsx: 'automatic' },
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
