import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { root, golden, traffic, changeRange, editJson } from './helpers';
test('AT-27 локальное приложение не обращается к внешним origins', async ({ page, context }) => {
  const external: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1') {
      await route.continue();
    } else {
      external.push(url.origin);
      await route.abort();
    }
  });
  await traffic(page);
  await page.goto(root + '/interpretations/interpretation-demo');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.goto(root + '/runs/run-baseline');
  await expect(page.getByRole('heading', { name: 'Охват и проверки' })).toBeVisible();
  expect(external).toEqual([]);
});
test('AT-28 клавиатура, фокус диалога, системная тема и узкая ширина', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/projects');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const button = page.getByRole('button', { name: 'Создать проект', exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await traffic(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('grid').scrollIntoViewIfNeeded();
  await expect(page.locator('.hex-byte[data-offset="1000"]')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.hex-byte[data-offset="1003"]')).toBeInViewport({ ratio: 1 });
  const horizontal = await page.locator('.hex-body').evaluate((element) => element.scrollLeft);
  expect(horizontal).toBeGreaterThan(0);
  expect(await page.locator('.hex-header').evaluate((element) => element.scrollLeft)).toBe(
    horizontal,
  );
  await page.getByRole('button', { name: 'Сообщения / пакеты', exact: true }).click();
  await expect(page.getByText('Кадр №7', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть навигацию' }).click();
  await expect(page.getByRole('link', { name: 'Интерпретации', exact: true })).toBeVisible();
});
test('AT-29 ленивый профиль: 1000 сессий, большой offset, ограниченный DOM и память', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const heaps: number[] = [];
  const snapshot = async () =>
    page.evaluate(() => {
      const heap =
        (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? null;
      const diagnostics = (
        window as Window & {
          __madrigalDiagnostics?: () => {
            byteWindows: number;
            inactiveByteWindows: number;
            cacheJsonBytes: number;
          };
        }
      ).__madrigalDiagnostics?.();
      return {
        domNodes: document.querySelectorAll('*').length,
        rows: document.querySelectorAll('.hex-row').length,
        layoutHeight: document.querySelector('.hex-body')?.scrollHeight,
        heapBytes: heap,
        ...diagnostics,
      };
    });
  const sample = async () => {
    const info = await snapshot();
    if (info.heapBytes !== null) heaps.push(info.heapBytes);
    return info;
  };
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/bytes?')) requests.push(request.url());
  });
  const began = Date.now();
  await traffic(page, golden + '&scenario=large-paginated');
  const opened = Date.now() - began;
  await expect(page.getByText('Всего записей: 1000', { exact: true })).toBeVisible();
  await expect(page.locator('.session-card')).toHaveCount(20);
  await expect(page.locator('.hex-byte')).not.toHaveCount(0);
  const selectionBegan = Date.now();
  await changeRange(page, '4095', '2');
  const selectionMs = Date.now() - selectionBegan;
  await page.getByRole('grid').focus();
  const keyBegan = Date.now();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/start=4096/);
  const keyboardSelectionMs = Date.now() - keyBegan;
  await expect(page.locator('.hex-pagination')).toContainText('[4096,');
  const count = await page.locator('*').count();
  expect(count).toBeLessThan(5000);
  const windowDurations: number[] = [];
  for (let index = 0; index < 10; index++) {
    const next = 8192 + index * 4096;
    const windowBegan = Date.now();
    await page.getByRole('button', { name: 'Следующее окно', exact: true }).click();
    await expect(page.locator('.hex-pagination')).toContainText('[' + next + ',');
    windowDurations.push(Date.now() - windowBegan);
    await sample();
  }
  const metrics = await sample();
  expect(metrics.rows).toBeLessThan(40);
  expect(metrics.layoutHeight).toBeLessThan(10000);
  expect(metrics.inactiveByteWindows).toBeLessThanOrEqual(8);
  expect(metrics.cacheJsonBytes).toBeLessThan(500000);
  await page.getByText('Поиск по всему потоку HEX / ASCII', { exact: true }).click();
  const searchBegan = Date.now();
  await page.getByRole('button', { name: 'Найти в потоке' }).click();
  await expect(page.getByRole('button', { name: '1000 · 4 байт' })).toBeVisible();
  const searchMs = Date.now() - searchBegan;
  const filterBegan = Date.now();
  await page.getByLabel('Адрес или порт', { exact: true }).fill('502');
  await expect(page.locator('.session-card')).toHaveCount(20);
  const filteringMs = Date.now() - filterBegan;
  await traffic(page, golden.replaceAll('baseline', 'precision') + '&scenario=large-paginated');
  await changeRange(page, '9007199254740993', '4');
  await expect(page.locator('.hex-pagination')).toContainText('[9007199254740992,');
  const precisionMetrics = await sample();
  expect(precisionMetrics.layoutHeight).toBeLessThan(10000);
  for (const url of requests)
    expect(BigInt(new URL(url).searchParams.get('length')!)).toBeLessThanOrEqual(4096n);
  await mkdir('docs/frontend', { recursive: true });
  await writeFile(
    'docs/frontend/metrics.json',
    JSON.stringify(
      {
        environment:
          'Windows x64, Chromium ' + browser.version() + ', localhost Vite dev; synthetic MSW',
        profile: {
          sessions: 1000,
          streamLogicalBytes: '65536 / 9007199254806528',
          byteWindow: 4096,
        },
        openedMs: opened,
        selectionMs,
        keyboardSelectionMs,
        windowDurations,
        searchMs,
        filteringMs,
        precisionMetrics,
        sampledHeapPeakBytes: heaps.length ? Math.max(...heaps) : null,
        memoryMethod:
          'performance.memory usedJSHeapSize at 12 checkpoints; sampled JS heap, not total process/backend peak.',
        requests: requests.length,
        ...metrics,
      },
      null,
      2,
    ),
  );
});
for (const theme of ['light', 'dark'] as const) {
  test('Визуальный аудит ' + theme + ': экраны, axe, 1366/1440/1920/1024/390', async ({ page }) => {
    test.setTimeout(120000);
    await page.addInitScript((value) => localStorage.setItem('madrigal:v1:theme', value), theme);
    await mkdir('docs/frontend/screenshots', { recursive: true });
    const screens = [
      ['projects', '/projects'],
      ['traffic', golden],
      ['compare', root + '/compare'],
      ['editor', root + '/interpretations/interpretation-demo'],
      ['run', root + '/runs/run-baseline'],
      ['hypothesis', root + '/hypotheses'],
    ] as const;
    for (const [name, path] of screens) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      if (name === 'traffic') {
        await expect(page.getByRole('grid')).toBeVisible();
        await expect(page.locator('.hex-byte[data-offset="1000"]')).toBeVisible();
        await expect(page.locator('.hex-byte[data-offset="1000"]')).toBeInViewport({ ratio: 1 });
        await page.getByText('Кадр №7', { exact: true }).click();
        await expect(page.locator('[data-frame-offset="54"]')).toBeVisible();
      }
      if (name === 'editor') {
        await page.locator('.cm-content').waitFor();
        await editJson(page, '{"framing":');
        await expect(page.getByText(/Синтаксическая ошибка JSON/)).toBeVisible();
      }
      if (name === 'run') await expect(page.getByText('FAIL · Нарушение').first()).toBeVisible();
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(axe.violations, JSON.stringify(axe.violations)).toEqual([]);
      await page.screenshot({
        path: 'docs/frontend/screenshots/' + theme + '-1440-' + name + '.png',
        fullPage: true,
      });
    }
    await page.goto('/projects');
    await page.getByRole('button', { name: 'Задания', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Центр заданий' })).toBeVisible();
    await page.screenshot({ path: 'docs/frontend/screenshots/' + theme + '-1440-jobs.png' });
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([]);
    await page.keyboard.press('Escape');
    await page.goto('/projects?mode=api');
    await expect(page.getByText('CONTRACT_PENDING', { exact: true })).toBeVisible();
    await page.screenshot({
      path: 'docs/frontend/screenshots/' + theme + '-1440-api-unavailable.png',
      fullPage: true,
    });
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([]);
    await page.goto('/projects?mode=mock');
    for (const width of [1366, 1920, 1024, 390]) {
      await page.setViewportSize({
        width,
        height: width === 390 ? 844 : width === 1920 ? 1080 : 768,
      });
      await traffic(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: 'docs/frontend/screenshots/' + theme + '-' + width + '-traffic.png',
        fullPage: true,
      });
      if (width === 390) {
        await page.getByRole('button', { name: 'Сообщения / пакеты', exact: true }).click();
        await page.screenshot({
          path: 'docs/frontend/screenshots/' + theme + '-390-source.png',
          fullPage: true,
        });
      }
    }
  });
}
