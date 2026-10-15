import { defineConfig } from '@playwright/test';
import integration from './playwright.integration.config';
export default defineConfig(integration, {
  testMatch: /research-api\.ts/,
  outputDir: 'test-results/research',
  timeout: 180000,
  use: { ...integration.use, actionTimeout: 15000 },
});
