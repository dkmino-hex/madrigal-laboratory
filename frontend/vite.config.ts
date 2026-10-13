import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    watch: {
      ignored: [
        '**/playwright-report*/**',
        '**/test-results/**',
        '**/docs/frontend/**',
        '**/.tools/**',
      ],
    },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 550 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
