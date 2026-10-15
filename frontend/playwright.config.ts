import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  testIgnore: /(?:api|production)\.spec\.ts/,
  outputDir: 'test-results/mock',
  fullyParallel: false,
  workers: 2,
  retries: 0,
  timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    channel: process.env.MADRIGAL_BROWSER_CHANNEL,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm run dev:mock -- --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
