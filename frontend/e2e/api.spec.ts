import { test, expect } from '@playwright/test';
test('реальный Gateway: проекты, run, происхождение и reload без MSW', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByText('Демонстрационные данные', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  const projectId = process.env.MADRIGAL_PROJECT_ID!;
  const runId = process.env.MADRIGAL_RUN_ID!;
  await page.goto(
    '/projects/' + encodeURIComponent(projectId) + '/runs/' + encodeURIComponent(runId),
  );
  await expect(page.getByRole('heading', { name: 'Закреплённые входы' })).toBeVisible();
  await page.goto(process.env.MADRIGAL_SOURCE_LINK!);
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.locator('.source-packet').first()).toBeVisible();
  const url = page.url();
  await page.reload();
  expect(page.url()).toBe(url);
  await expect(page.getByRole('grid')).toBeVisible();
});
