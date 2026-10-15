import { defineConfig, devices } from '@playwright/test';

if (!process.env.MADRIGAL_GATEWAY_URL)
  throw new Error('Set MADRIGAL_GATEWAY_URL to the running Docker Gateway.');

export default defineConfig({
  testDir: './e2e',
  testMatch: /integration\.ts/,
  outputDir: 'test-results/integration',
  workers: 1,
  retries: 0,
  timeout: 120000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.MADRIGAL_BROWSER_CHANNEL,
    baseURL: 'http://localhost:5173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev:api -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    env: { VITE_API_BASE_URL: process.env.MADRIGAL_GATEWAY_URL },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
