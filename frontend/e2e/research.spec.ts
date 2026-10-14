import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { demoPcap, schemaText } from '../src/mocks/fixtures/corpus';
import { root, golden, createRun, editJson, traffic, changeRange } from './helpers';

test('Исследование целиком: новый проект → PCAP → CSV → связь → сравнение → гипотеза → две ревизии/runs → старый источник', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название проекта').fill('Полный исследовательский сценарий');
  await dialog.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('Полный исследовательский сценарий');
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Добавить PCAP / PCAPNG' }).click();
  await page.getByLabel('Запись PCAP / PCAPNG').setInputFiles({
    name: 'synthetic.pcap',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(demoPcap()),
  });
  await dialog.getByRole('button', { name: 'Добавить запись', exact: true }).click();
  await expect(dialog.getByText('COMPLETED · Завершено')).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть диалог' }).click();
  await page.getByRole('link', { name: 'Обмен и байты', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await changeRange(page, '1000', '4');
  const capture = await page.getByLabel('Исходная запись', { exact: true }).inputValue();
  await expect(page.getByText('3 исходных участка.', { exact: false })).toBeVisible();
  const oldSource = page.url();
  await page.getByRole('link', { name: 'Связать с действием журнала' }).click();
  await page.getByRole('button', { name: 'Импортировать CSV' }).click();
  await page.getByLabel('Журнал CSV', { exact: true }).setInputFiles({
    name: 'experiment.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'timestamp,name,type,parameters\n2026-10-11T12:34:56.123456789Z,Уставка 21,setpoint,21\n',
    ),
  });
  await dialog.getByRole('button', { name: 'Импортировать журнал' }).click();
  await expect(dialog.getByText(/Импортировано строк: 1/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть диалог' }).click();
  await page.getByRole('button', { name: 'Выбрать действие' }).click();
  await page
    .getByLabel('Основание связи')
    .fill('Сопоставление времени CSV и поля 21; требуется контрпример.');
  await page.getByRole('button', { name: 'Сохранить ручную связь' }).click();
  await expect(page.getByText(/Связь сохранена:/)).toBeVisible();
  await page.getByRole('link', { name: 'Сравнение примеров', exact: true }).click();
  await page.getByLabel('Правый пример: начало', { exact: true }).fill('1004');
  await expect(page.getByText('Различается').first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Правый пример: начало', { exact: true })).toHaveValue('1004');
  await page.getByRole('link', { name: 'Наблюдения и гипотезы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать наблюдение / гипотезу' }).click();
  await dialog.getByLabel('Формулировка').fill('Поле value может быть уставкой');
  await dialog
    .getByLabel('Основания и открытые вопросы')
    .fill('Значение 21 сопоставлено вручную; другое значение 42 проверяется отдельно.');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Сохранить исследовательскую запись' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Поле value может быть уставкой')).toBeVisible();
  await page.getByRole('link', { name: 'Интерпретации', exact: true }).click();
  await page.getByRole('link', { name: 'Открыть редактор' }).click();
  const editorPath = new URL(page.url()).pathname;
  await page.locator('.cm-content').waitFor();
  await editJson(
    page,
    schemaText.replace(
      'Это синтетическая схема frontend, не формат AN-03',
      'Исследовательский черновик; расширение сохраняется',
    ),
  );
  await page.getByLabel('Максимум первого правила').fill('30');
  await expect(page.locator('.cm-content')).toContainText('расширение сохраняется');
  await page.getByRole('button', { name: 'Сохранить новую ревизию и выполнить preview' }).click();
  await expect(page.getByRole('table').filter({ hasText: 'message.value' })).toBeVisible();
  const revisionA = new URL(page.url()).searchParams.get('revisionId')!;
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать точный JSON ревизии' }).click();
  const json = await readFile((await (await download).path())!, 'utf8');
  expect(JSON.parse(json).extensions.note).toContain('расширение сохраняется');
  const runA = await createRun(page, capture, { base, revisionId: revisionA });
  await expect(page.getByText('COMPLETED · Завершено').first()).toBeVisible();
  await page.getByLabel('Статус проверки').selectOption('FAIL');
  await expect(page.getByText(/Значение 42 превышает максимум 30/)).toBeVisible();
  await page.getByRole('link', { name: 'Открыть исходные пакеты', exact: true }).click();
  await page.getByText('Кадр №8', { exact: true }).click();
  await expect(page.locator('[data-frame-offset="68"]')).toHaveAttribute('data-selected', 'true');
  await page.goto(editorPath + '?revisionId=' + revisionA);
  await page.getByLabel('Максимум первого правила').fill('60');
  await page.getByRole('button', { name: 'Сохранить новую ревизию', exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp('revisionId=' + revisionA + '$'));
  const revisionB = new URL(page.url()).searchParams.get('revisionId')!;
  const runB = await createRun(page, capture, { base, revisionId: revisionB });
  await expect(page.getByText('COMPLETED · Завершено').first()).toBeVisible();
  await page.goto(base + '/runs/compare?left=' + runA + '&right=' + runB);
  await expect(page.getByText(/Корпус, сборки, настройки и фильтры совпадают/)).toBeVisible();
  await expect(page.getByText('Изменение нарушений FAIL: -1')).toBeVisible();
  await page.goto(oldSource);
  await page.reload();
  for (const number of [7, 8, 9]) await page.getByText('Кадр №' + number, { exact: true }).click();
  await expect(page.getByText('4 байт · A→B', { exact: true })).toBeVisible();
  await expect(
    page
      .locator('.source-packet')
      .filter({ hasText: 'Кадр №7' })
      .locator('[data-frame-offset="54"]'),
  ).toHaveAttribute('data-selected', 'true');
  await page.goto(base + '/hypotheses');
  await expect(page.getByText('open · Открыта')).toBeVisible();
});

test('AT-18 пустой завершённый run не объявляется успехом', async ({ page }) => {
  await createRun(page, 'capture-baseline-fixture2', { scenario: 'zero-messages' });
  await expect(page.getByText('COMPLETED · Завершено').first()).toBeVisible();
  await expect(page.getByText('Нет сообщений: проверка протокола не подтверждена')).toBeVisible();
  await expect(page.getByText('Нет результатов по этим условиям')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Нет сообщений: проверка протокола не подтверждена')).toBeVisible();
});
test('AT-18/23 прерывание сервиса, неизвестный total и чтение во время фоновой работы', async ({
  page,
}) => {
  const id = await createRun(page, 'capture-baseline-fixture2', {
    scenario: 'partial-and-cancelled',
  });
  await expect(page.getByText('Общее количество неизвестно').first()).toBeVisible();
  await page.getByRole('link', { name: 'Обмен и байты', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.goto(root + '/runs/' + id);
  await expect(page.getByText('INTERRUPTED · Прервано').first()).toBeVisible();
  await expect(page.getByText('Частичный или незавершённый результат')).toBeVisible();
  await page.reload();
  await expect(page.getByText('INTERRUPTED · Прервано').first()).toBeVisible();
});
test('AT-04 checksum предупреждение сохраняет политику и не становится FAIL', async ({ page }) => {
  await traffic(page, golden.replaceAll('baseline', 'defects'));
  await expect(page.getByText(/Checksum: политика warn · settings-v1/)).toBeVisible();
  await expect(page.getByText(/offloading не доказывает нарушение/)).toBeVisible();
});
