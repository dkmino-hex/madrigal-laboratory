import { expect, test } from '@playwright/test';
import { demoStorageKey, initialState } from '../src/mocks/state';
import { goldenLocation } from '../src/mocks/fixtures/corpus';
import { sourceLink } from '../src/shared/model/navigation';
import { root } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, state }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
    },
    { key: demoStorageKey, state: initialState() },
  );
});
test('ТЗ: неполная ссылка сравнения не превращается в локальный диапазон', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/bytes')) requests.push(request.url());
  });
  await page.goto(
    root +
      '/compare?' +
      new URLSearchParams({ left: root + '/traffic?captureId=' + goldenLocation.captureId }),
  );
  await expect(page.getByText(/Ссылка сравнения содержит неполный контекст сборки/)).toBeVisible();
  await expect(page.getByLabel('Левый пример: начало')).not.toBeVisible();
  expect(requests).toEqual([]);
});
test('ТЗ: сборка за первой страницей разрешается из исторической ссылки и после reload', async ({
  page,
}) => {
  const location = { ...goldenLocation, assemblyId: 'assembly-baseline-fixture2-retained-25' };
  await page.goto(sourceLink(location));
  await expect(page.getByRole('grid', { name: /HEX и ASCII/ })).toBeVisible();
  await expect(
    page
      .locator('select')
      .filter({ has: page.locator('option[value="' + location.assemblyId + '"]') }),
  ).toHaveValue(location.assemblyId);
  await page.reload();
  await expect(page.getByRole('grid', { name: /HEX и ASCII/ })).toBeVisible();
  await expect(
    page
      .locator('select')
      .filter({ has: page.locator('option[value="' + location.assemblyId + '"]') }),
  ).toHaveValue(location.assemblyId);
});
test('ТЗ: RangePicker выбирает сборку за первой страницей для точного корпуса', async ({
  page,
}) => {
  await page.goto(root + '/runs');
  const picker = page.getByRole('group', { name: 'Сборка для корпуса', exact: true });
  await picker.getByRole('button', { name: 'Загрузить ещё версии сборки' }).click();
  await picker
    .getByLabel('Сборка для корпуса: сборка и направление')
    .selectOption('assembly-baseline-fixture2-retained-25');
  await page.getByRole('button', { name: 'Добавить сборку в корпус' }).click();
  await expect(page.locator('.corpus-list')).toContainText(
    'assembly-baseline-fixture2-retained-25',
  );
});
test('ТЗ: несовместимые настройки корпуса выявляются до отправки нового run', async ({ page }) => {
  await page.goto(root + '/runs');
  await expect(page.getByLabel('Сборка для корпуса: сборка и направление')).toHaveValue(
    goldenLocation.assemblyId,
  );
  await page.getByRole('button', { name: 'Добавить сборку в корпус' }).click();
  await page.getByLabel('Версия настроек', { exact: true }).selectOption('settings-v2');
  await expect(page.getByText(/Версии настроек выбранных сборок не совпадают/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Проверить корпус', exact: true })).toBeDisabled();
  await page.getByLabel('Версия настроек', { exact: true }).selectOption('settings-v1');
  await expect(page.getByRole('button', { name: 'Проверить корпус', exact: true })).toBeEnabled();
});
test('ТЗ: клонирование настроек предупреждает о перезаписи несохранённого черновика', async ({
  page,
}) => {
  await page.goto(root + '/settings');
  await page.getByLabel('Поправка времени, наносекунды', { exact: true }).fill('777');
  await page.getByLabel('settingsVersion', { exact: true }).selectOption('settings-v2');
  await page.getByRole('button', { name: 'Создать черновик от этой версии' }).click();
  const dialog = page.getByRole('dialog', { name: 'Заменить несохранённый черновик?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Продолжить редактирование' }).click();
  await expect(page.getByLabel('Поправка времени, наносекунды', { exact: true })).toHaveValue(
    '777',
  );
  await page.getByRole('button', { name: 'Создать черновик от этой версии' }).click();
  await dialog.getByRole('button', { name: 'Заменить черновик', exact: true }).click();
  await expect(page.getByLabel('Поправка времени, наносекунды', { exact: true })).toHaveValue(
    '1000000000',
  );
  await expect(page.getByRole('button', { name: 'Запросить новую сборку' })).toBeDisabled();
});
