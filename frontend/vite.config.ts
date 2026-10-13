import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mock-api-fallback',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!request.url?.split('?')[0]?.startsWith('/__madrigal_mock/v1/')) return next();
          response.statusCode = 503;
          response.setHeader('Content-Type', 'application/json');
          response.end(
            JSON.stringify({
              error: {
                code: 'MOCK_INACTIVE',
                message:
                  'Демонстрационные данные временно недоступны: перехват запросов отключён. Обновите страницу и повторите чтение.',
              },
            }),
          );
        });
      },
    },
  ],
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
