import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: /api\.spec\.ts/,
  outputDir: 'test-results/api',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-api', open: 'never' }]],
  use: {
    baseURL: process.env.MADRIGAL_GATEWAY_URL,
    serviceWorkers: 'block',
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
});
