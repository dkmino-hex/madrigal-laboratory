import { test, expect, type Locator, type Page } from '@playwright/test';
import { traffic } from './helpers';

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let step = 0; step < 100; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Клавиатура не достигает элемента: ' + (await target.textContent()));
}

test('AT-28 клавиатурный исследовательский путь: HEX → пакет → редактор → preview → run', async ({
  page,
}) => {
  test.setTimeout(60000);
  await traffic(page);
  await tabTo(page, page.getByRole('grid'));
  await page.keyboard.down('Shift');
  for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await expect(page).toHaveURL(/start=1000&length=4/);
  await tabTo(page, page.locator('.source-packet summary').filter({ hasText: 'Кадр №8' }));
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-frame-offset="66"]')).toHaveAttribute('data-selected', 'true');
  await tabTo(page, page.getByRole('link', { name: 'Открыть интерпретации для диапазона' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('link', { name: 'Открыть редактор' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByLabel('Максимум первого правила'));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('60');
  await tabTo(
    page,
    page.getByRole('button', { name: 'Сохранить новую ревизию и выполнить preview' }),
  );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table').filter({ hasText: 'message.value' })).toBeVisible();
  await tabTo(page, page.getByRole('link', { name: 'Проверки корпуса', exact: true }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByLabel('Сборка для корпуса: запись', { exact: true }));
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Сборка для корпуса: сборка и направление')).toHaveValue(
    'assembly-baseline-fixture2-v1',
  );
  await tabTo(page, page.getByRole('button', { name: 'Добавить сборку в корпус' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Проверить корпус', exact: true }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await tabTo(page, dialog.getByRole('button', { name: 'Создать запуск', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/runs\/run-/);
  await expect(page.getByText('COMPLETED · Завершено').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Охват и проверки' })).toBeVisible();
});
