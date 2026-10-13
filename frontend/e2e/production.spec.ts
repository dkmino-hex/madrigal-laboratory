import { test, expect } from '@playwright/test';
import { access, readdir, readFile } from 'node:fs/promises';
test('API production build: локальные ресурсы, mock query игнорируется, ошибка контракта остаётся ошибкой', async ({
  page,
  context,
}) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:5174') await route.continue();
    else {
      external.push(route.request().url());
      await route.abort();
    }
  });
  for (const path of ['/projects?mode=mock', '/projects/demo-laboratory/traffic']) {
    await page.goto(path);
    await expect(page.getByText('CONTRACT_PENDING', { exact: true })).toBeVisible();
    await expect(page.getByText('Локальный Gateway · API', { exact: true })).toBeVisible();
    await expect(page.getByText('Демонстрационные данные', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Инструменты разработки', { exact: true })).toHaveCount(0);
  }
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
test('Production не содержит worker, demo ZIP, MSW и fixture-корпус', async () => {
  await expect(access('dist/mockServiceWorker.js')).rejects.toThrow();
  await expect(access('dist/demo-project.zip')).rejects.toThrow();
  const files = (await readdir('dist/assets')).filter((file) => file.endsWith('.js'));
  for (const file of files) {
    const source = await readFile('dist/assets/' + file, 'utf8');
    expect(source).not.toMatch(
      /setupWorker|MADRIGAL_DEMO_V1|frontend-fixture-v[12]|fixtureByte|capture-baseline/,
    );
  }
});
