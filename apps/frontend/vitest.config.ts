import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vitest has its own config because vite.config.ts sets `root` to one
// app target folder. Tests live under tests/ and next to the code.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@tests': path.resolve(import.meta.dirname, 'tests'),
    },
  },
  define: {
    'import.meta.env.VITE_APP_TARGET': JSON.stringify('test'),
  },
  test: {
    // The ported avatar tests use describe/it/expect/vi without importing them.
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
    ],
    restoreMocks: true,
    poolOptions: {
      forks: {
        // Node 22+ ships its own empty `localStorage` global (needs
        // --localstorage-file). It hides jsdom's localStorage, so turn it off.
        execArgv: ['--no-experimental-webstorage'],
      },
    },
  },
});
