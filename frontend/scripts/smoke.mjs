import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (error) => process.stderr.write('PAGE ERROR: ' + error.message + '\n'));
page.on('console', (message) => {
  if (message.type() === 'error') process.stderr.write('CONSOLE: ' + message.text() + '\n');
});
await page.addInitScript(() => localStorage.setItem('madrigal:v1:theme', 'dark'));
await page.goto('http://127.0.0.1:5173/projects');
await page.getByRole('link', { name: /Термоконтроллер/ }).waitFor();
await mkdir('docs/frontend/screenshots', { recursive: true });
await page.screenshot({ path: 'docs/frontend/screenshots/smoke-projects.png', fullPage: true });
await page.goto('http://127.0.0.1:5173/projects/demo-laboratory/traffic');
await page.getByRole('grid', { name: /HEX и ASCII/ }).waitFor();
await page.screenshot({ path: 'docs/frontend/screenshots/smoke-traffic.png', fullPage: true });
process.stdout.write((await page.locator('main').innerText()).slice(0, 1800));
await browser.close();
