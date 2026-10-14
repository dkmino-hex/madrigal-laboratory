import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { demoPcap, demoPcapng, schemaText } from '../src/mocks/fixtures/corpus';
import { root, golden, traffic, changeRange, editJson, createRun } from './helpers';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('madrigal:v1:theme'))
      localStorage.setItem('madrigal:v1:theme', 'dark');
  });
});
test('AT-01 mock → api → mock, worker не подменяет API', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByText('Демонстрационные данные', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Термоконтроллер/ })).toBeVisible();
  await page.getByText('Инструменты разработки', { exact: true }).click();
  await page.getByRole('button', { name: 'Переключить в API' }).click();
  await expect(page.getByText('CONTRACT_PENDING', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Термоконтроллер/ })).toHaveCount(0);
  expect(
    await page.evaluate(
      async () =>
        !(await navigator.serviceWorker.getRegistrations()).some((item) =>
          item.active?.scriptURL.endsWith('/mockServiceWorker.js'),
        ),
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByText('CONTRACT_PENDING', { exact: true })).toBeVisible();
  await page.getByText('Инструменты разработки', { exact: true }).click();
  await page.getByRole('button', { name: 'Переключить в mock' }).click();
  await expect(page.getByRole('link', { name: /Термоконтроллер/ })).toBeVisible();
});
test('AT-02 проект создаётся один раз, IMPORTING блокирует исследование', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название проекта').fill('Исследование нового устройства');
  await dialog.getByRole('button', { name: 'Создать проект', exact: true }).dblclick();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Исследование нового устройства' }),
  ).toBeVisible();
  await expect(page.getByText('Исходных записей пока нет')).toBeVisible();
  await page.goto('/projects');
  await expect(page.getByRole('link', { name: /Исследование нового устройства/ })).toHaveCount(1);
  await page.goto('/projects/demo-importing/traffic');
  await expect(page.getByRole('heading', { name: 'Проект ещё не готов' })).toBeVisible();
  await expect(page.getByRole('grid')).toHaveCount(0);
});
test('AT-03 PCAP/PCAPNG, дубликат по содержимому и раздельные этапы', async ({ page }) => {
  await page.goto(root);
  await page.getByRole('button', { name: 'Добавить PCAP / PCAPNG' }).click();
  const dialog = page.getByRole('dialog');
  const payload = {
    name: 'sample.pcap',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(demoPcap()),
  };
  await dialog.getByLabel('Запись PCAP / PCAPNG').setInputFiles(payload);
  await dialog.getByRole('button', { name: 'Добавить запись', exact: true }).click();
  await expect(dialog.getByText(/Передача завершена/)).toBeVisible();
  await expect(dialog.getByText('COMPLETED · Завершено')).toBeVisible();
  await dialog
    .getByLabel('Запись PCAP / PCAPNG')
    .setInputFiles({ ...payload, name: 'other-name.pcap' });
  await dialog.getByRole('button', { name: 'Добавить запись', exact: true }).click();
  await expect(dialog.getByText(/Дубликат подтверждён ответом сервера/)).toBeVisible();
  await dialog.getByLabel('Запись PCAP / PCAPNG').setInputFiles({
    name: 'sample.pcapng',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(demoPcapng()),
  });
  await dialog.getByRole('button', { name: 'Добавить запись', exact: true }).click();
  await expect(dialog.getByText(/Передача завершена/)).toBeVisible();
});
test('AT-04 версии, направления, поколения и недоступная сборка', async ({ page }) => {
  await traffic(page);
  await page.getByRole('button', { name: /TCP · поколение 2/ }).click();
  await expect(page.getByText(/Начало и роли соединения неизвестны/)).toBeVisible();
  await page.getByLabel('Направление', { exact: true }).selectOption('B_TO_A');
  await expect(page.getByLabel('Сборка', { exact: true })).toHaveValue(
    'assembly-baseline-fixture2-b2-v1',
  );
  await page.getByLabel('Сборка', { exact: true }).selectOption('assembly-baseline-fixture2-b2-v2');
  await page.getByRole('dialog').getByRole('button', { name: 'Открыть другую сборку' }).click();
  await expect(page).toHaveURL(/assembly-baseline-fixture2-b2-v2/);
  await page.reload();
  await expect(page.getByLabel('Сборка', { exact: true })).toHaveValue(
    'assembly-baseline-fixture2-b2-v2',
  );
  await page.goto(golden.replace('assembly-baseline-fixture2-v1', 'assembly-missing'));
  await expect(page.getByText(/Историческая ссылка не перенаправляется/)).toBeVisible();
  await expect(page.getByRole('grid')).toHaveCount(0);
});
test('AT-05 выделение через страницу сохраняет фокус, точное начало и длину', async ({ page }) => {
  await traffic(page);
  await changeRange(page, '4094', '1');
  const grid = page.getByRole('grid');
  await grid.focus();
  await page.keyboard.down('Shift');
  for (let index = 0; index < 5; index++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await expect(page).toHaveURL(/start=4094/);
  await expect(page).toHaveURL(/length=6/);
  await expect(page).toHaveURL(/window=4096/);
  await expect(page.getByLabel('Длина, байт', { exact: true })).toHaveValue('6');
  await expect(grid).toBeFocused();
  await page.reload();
  await expect(page.getByLabel('Начало, байт', { exact: true })).toHaveValue('4094');
  await expect(page.getByLabel('Длина, байт', { exact: true })).toHaveValue('6');
});
test('AT-22 прямая ссылка прокручивает HEX к выбранным байтам после открытия и reload', async ({
  page,
}) => {
  await traffic(page);
  const selected = page.locator('.hex-byte[data-offset="1000"]');
  await expect(selected).toBeVisible();
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await expect(selected).toHaveText('15');
  await expect(selected).toBeInViewport({ ratio: 1 });
  await page.reload();
  await expect(selected).toBeVisible();
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await changeRange(page, '3000', '4');
  await expect(page.locator('.hex-byte[data-offset="3000"]')).toBeVisible();
  await expect(page.locator('.hex-byte[data-offset="3000"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
test('AT-06 точность вокруг 2^53 в URL, запросах, HEX и копировании ссылки', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const base = golden.replaceAll('baseline', 'precision');
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/bytes?')) requests.push(request.url());
  });
  await traffic(page, base);
  for (const value of ['9007199254740991', '9007199254740992', '9007199254740993']) {
    await changeRange(page, value, '1');
    await expect(
      page.getByText('[' + value + ', ' + (BigInt(value) + 1n) + ')', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Копировать прямую ссылку на источник' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('start=' + value);
  }
  expect(requests.some((url) => url.includes('start=9007199254740992'))).toBe(true);
  await expect(page.getByText(/123456789 UTC/).first()).toBeVisible();
});
test('AT-07/08/09 пропуск, усечение, конфликт и три источника четырёх байтов', async ({ page }) => {
  await traffic(page);
  await expect(page.getByText('3 исходных участка.', { exact: false })).toBeVisible();
  await expect(page.getByText('4 байт · A→B', { exact: true })).toBeVisible();
  await changeRange(page, '64', '8');
  await expect(page.getByRole('gridcell', { name: 'Байт 64: ??' })).toBeVisible();
  await page.getByRole('button', { name: 'Копировать HEX' }).click();
  await expect(page.getByText(/Точная копия недоступна/)).toBeVisible();
  await changeRange(page, '96', '4');
  await page.getByText(/Конфликт \[96, 100\)/).click();
  await expect(page.getByText('Альтернатива 1')).toBeVisible();
  await expect(page.getByText('Альтернатива 2')).toBeVisible();
  await expect(page.getByRole('gridcell', { name: 'Байт 96: ≠?' })).toBeVisible();
  await changeRange(page, '120', '8');
  await expect(page.getByRole('gridcell', { name: 'Байт 120: ??' })).toBeVisible();
});
test('AT-10 поиск валидирует HEX, показывает пагинацию и открывает диапазон', async ({ page }) => {
  await traffic(page);
  await page.getByText('Поиск по всему потоку HEX / ASCII', { exact: true }).click();
  await page.getByLabel('Образец', { exact: true }).fill('F');
  await expect(page.getByText(/чётное число полубайтов/)).toBeVisible();
  await page.getByLabel('Образец', { exact: true }).fill('15 00 00 00');
  await page.getByRole('button', { name: 'Найти в потоке' }).click();
  await expect(page.getByText(/Результат неполный/)).toBeVisible();
  await page.getByRole('button', { name: '1000 · 4 байт' }).click();
  await expect(page).toHaveURL(/start=1000/);
  await expect(page.getByRole('button', { name: 'Продолжить поиск' })).toBeEnabled();
});
test('AT-11/12 CSV с ошибкой строки, timezone, поправка и ручная связь после reload', async ({
  page,
}) => {
  await page.goto(root + '/actions');
  await page.getByRole('button', { name: 'Импортировать CSV' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Журнал CSV').setInputFiles({
    name: 'experiment.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'timestamp,name,type,parameters\n2026-10-11T15:34:56.123456789+03:00,Установить 21,setpoint,21\nbad,Неверная строка,setpoint,?\n',
    ),
  });
  await dialog.getByLabel('Часовой пояс журнала').selectOption('Europe/Moscow');
  await dialog.getByLabel('Поправка времени, наносекунды').fill('-1');
  await dialog.getByRole('button', { name: 'Импортировать журнал' }).click();
  await expect(dialog.getByText(/Частичный импорт/)).toBeVisible();
  await expect(dialog.getByText(/Строка 3/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть диалог' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Установить 21' });
  await expect(row).toContainText('123456788 UTC');
  await row.getByRole('button', { name: 'Выбрать действие' }).click();
  await page
    .getByLabel('Основание связи')
    .fill('CSV: время и значение 21; проверяется на других параметрах');
  await page.getByLabel('Уверенность исследователя').selectOption('confirmed');
  await page.getByRole('button', { name: 'Сохранить ручную связь' }).click();
  await expect(page.getByText(/Связь сохранена:/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('CSV: время и значение 21; проверяется на других параметрах'),
  ).toBeVisible();
  await expect(page.getByText('confirmed · Подтверждено исследователем')).toBeVisible();
});
test('AT-13 сравнение значений, разных длин и недостатка данных', async ({ page }) => {
  await page.goto(root + '/compare');
  await expect(page.locator('.compare-byte-row')).toHaveCount(8);
  expect(
    await page
      .locator('.compare-bytes')
      .first()
      .evaluate((element) => element.clientHeight),
  ).toBeLessThan(200);
  await page
    .getByLabel('Правый пример: запись', { exact: true })
    .selectOption('capture-additional-fixture2');
  await expect(page.getByText('Различается').first()).toBeVisible();
  await page.getByLabel('Правый пример: длина', { exact: true }).fill('2');
  await expect(page.getByText('Хвост диапазона').first()).toBeVisible();
  await page.getByLabel('Левый пример: начало', { exact: true }).fill('64');
  await page.getByLabel('Левый пример: длина', { exact: true }).fill('4');
  await expect(page.getByText('Недостаточно данных', { exact: true }).first()).toBeVisible();
});
test('AT-14/15 редактор защищает черновик, сохраняет новую ревизию и preview', async ({ page }) => {
  await page.goto(root + '/interpretations/interpretation-demo?revisionId=revision-v1');
  await page.locator('.cm-content').waitFor();
  await editJson(page, '{"framing":');
  await expect(page.getByText(/Синтаксическая ошибка JSON:/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Сохранить новую ревизию', exact: true }),
  ).toBeDisabled();
  await page.getByRole('link', { name: 'Журнал действий', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Есть несохранённые изменения' })).toBeVisible();
  await page.getByRole('button', { name: 'Остаться', exact: true }).click();
  await editJson(page, schemaText.replace('"length": 4', '"length": 0'));
  await expect(
    page.getByRole('button', { name: 'Сохранить новую ревизию', exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel('Размер сообщения, байт')).toHaveAccessibleDescription(
    /больше нуля/,
  );
  await editJson(page, schemaText.replace('"30"', '"60"'));
  await page.getByRole('button', { name: 'Сохранить новую ревизию и выполнить preview' }).click();
  await expect(
    page.getByText('Предварительный разбор выбранного диапазона — не проверка всего корпуса.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole('table').filter({ hasText: 'message.value' })).toBeVisible();
  await expect(page).not.toHaveURL(/revisionId=revision-v1$/);
  await page.getByRole('link', { name: /revision-v1/ }).click();
  await expect(page.locator('.cm-content')).toContainText('"30"');
});
test('AT-16 гипотеза сохраняет основания, поддержку и контрпример', async ({ page }) => {
  await page.goto(root + '/hypotheses');
  await expect(page.getByText('Поддерживающий пример', { exact: true })).toBeVisible();
  await expect(page.getByText('Контрпример', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Формулировка')
    .fill('Поле value связано с уставкой; причинность уточняется');
  await dialog.getByLabel('Статус', { exact: true }).selectOption('supported');
  await dialog.getByRole('button', { name: 'Сохранить исследовательскую запись' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText('Поле value связано с уставкой; причинность уточняется'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Поле value связано с уставкой; причинность уточняется'),
  ).toBeVisible();
  await expect(page.getByText('Контрпример', { exact: true })).toBeVisible();
  await expect(page.getByText(/supported ·/)).toBeVisible();
});
test('AT-17/18/20 создание run, пять статусов, закреплённые входы и сравнение', async ({
  page,
}) => {
  const runId = await createRun(page);
  await expect(page.locator('.context-line').getByText('COMPLETED · Завершено')).toBeVisible();
  for (const status of ['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'UNKNOWN'])
    await expect(page.getByText(new RegExp('^' + status + ' ·')).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Закреплённые входы' })).toBeVisible();
  await page.getByLabel('Статус проверки').selectOption('FAIL');
  await expect(page.getByRole('table').filter({ hasText: 'message.value' })).toContainText('FAIL');
  await page.goto(root + '/runs/compare?left=run-baseline&right=run-additional');
  await expect(page.getByText(/Входы различаются/)).toBeVisible();
  expect(runId).toMatch(/^run-/);
});
test('AT-19/21/22 старые кадры 7/8/9 и frameOffset после новых настроек', async ({ page }) => {
  await page.goto(root + '/settings');
  await page.getByLabel('Поправка времени, наносекунды').fill('123456789');
  await page.getByRole('button', { name: 'Сохранить новую версию настроек' }).click();
  await expect(page.getByText(/Создана версия/)).toBeVisible();
  await page.goto(root + '/runs/run-baseline');
  await page.getByLabel('Статус проверки').selectOption('PASS');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: 'Открыть исходные пакеты', exact: true }).click();
  await expect(page).toHaveURL(/assembly-baseline-fixture2-v1/);
  await page.reload();
  for (const packetNo of [7, 8, 9])
    await page.getByText('Кадр №' + packetNo, { exact: true }).click();
  const packet7 = page.locator('.source-packet').filter({ hasText: 'Кадр №7' });
  await expect(packet7.locator('[data-frame-offset="54"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(packet7.locator('[data-frame-offset="56"]')).toHaveAttribute(
    'data-selected',
    'false',
  );
  const packet8 = page.locator('.source-packet').filter({ hasText: 'Кадр №8' });
  await expect(packet8.locator('[data-frame-offset="66"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(page.getByRole('link', { name: 'Вернуться к результату' })).toBeVisible();
});
test('AT-23 отмена, чтение готовых байтов во время job и reload', async ({ page }) => {
  const runId = await createRun(page);
  const cancel = page.getByRole('button', { name: 'Отменить обработку' });
  await cancel.click();
  await expect(page.getByText('CANCELLED · Отменено').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('CANCELLED · Отменено').first()).toBeVisible();
  await traffic(page);
  await expect(page.getByRole('grid')).toBeVisible();
  await page.goto(root + '/runs/' + runId);
  await expect(page.getByText(/Частичный или незавершённый результат/)).toBeVisible();
});
test('AT-24 HTML вместо JSON виден как транспортная ошибка', async ({ page }) => {
  await page.goto(golden + '&scenario=api-failures');
  await expect(page.getByText('UNEXPECTED_CONTENT', { exact: true })).toBeVisible();
  await expect(page.getByText(/HTML или другой формат/)).toBeVisible();
  await traffic(page);
  await expect(page.getByText('UNEXPECTED_CONTENT', { exact: true })).toHaveCount(0);
  await expect(page.locator('.hex-byte[data-offset="1000"]')).toHaveText('15');
  await expect(page.getByText('Кадр №7', { exact: true })).toBeVisible();
});
test('AT-25/26 отчёт и ZIP доступны после готовности, перенос сохраняет историю', async ({
  page,
}) => {
  await page.goto(root + '/artifacts');
  await page.getByRole('button', { name: 'Сформировать Markdown-отчёт' }).click();
  await expect(page.getByRole('link', { name: 'Скачать Markdown' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Скачать Markdown' })).toBeVisible();
  const reportDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Скачать Markdown' }).click();
  const report = await reportDownload;
  const markdown = await readFile((await report.path())!, 'utf8');
  expect(markdown).toContain('Снимок:');
  expect(markdown).toContain('Демонстрационный отчёт');
  await page.getByRole('button', { name: 'Экспортировать проект ZIP' }).click();
  await expect(page.getByRole('link', { name: 'Скачать ZIP', exact: true })).toBeVisible();
  const zipDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Скачать ZIP', exact: true }).click();
  const zip = await zipDownload;
  await page.getByRole('button', { name: 'Импортировать ZIP', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Проект ZIP', { exact: true }).setInputFiles({
    name: zip.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: await readFile((await zip.path())!),
  });
  await dialog.getByRole('button', { name: 'Импортировать проект ZIP', exact: true }).click();
  await expect(dialog.getByText('COMPLETED · Завершено')).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть диалог' }).click();
  await page.goto('/projects');
  await page.getByRole('link', { name: /Перенесённое исследование/ }).click();
  await page.getByRole('link', { name: 'Проверки корпуса', exact: true }).click();
  await expect(page.getByRole('link', { name: 'run-baseline', exact: true })).toBeVisible();
  await expect(page.getByText(/CLI и его/)).toHaveCount(0);
});
test('AT-25 повреждённый ZIP не создаёт READY', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Импортировать ZIP' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Проект ZIP', { exact: true }).setInputFiles({
    name: 'broken.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('broken'),
  });
  await dialog.getByRole('button', { name: 'Импортировать проект ZIP', exact: true }).click();
  await expect(dialog.getByText('FAILED · Ошибка')).toBeVisible();
  await expect(dialog.getByText(/несовместимая версия, хеш/)).toBeVisible();
});
test('AT-30 новый проект не наследует действия и источники другого', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название проекта').fill('Другой проект');
  await dialog.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByRole('link', { name: 'Журнал действий', exact: true }).click();
  await expect(page.getByText('Действий нет', { exact: true })).toBeVisible();
  await expect(page.getByText('Задать уставку 21')).toHaveCount(0);
});
