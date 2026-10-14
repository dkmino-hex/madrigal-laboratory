import { test, expect, type Page } from '@playwright/test';
import { initialState } from '../src/mocks/state';
import { goldenLocation, schemaText } from '../src/mocks/fixtures/corpus';
import { sourceLink } from '../src/shared/model/navigation';
import { decimal } from '../src/shared/model/precision';
import { root, golden, traffic, editJson } from './helpers';

const evidenceDirectory = 'docs/frontend/audit-2026-10-12/screenshots';
const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /importing a module script failed|failed to fetch dynamically imported module|react router caught/i.test(
        message.text(),
      )
    )
      errors.push(message.text());
  });
});
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === 'passed') expect(runtimeErrors.get(page) ?? []).toEqual([]);
});

async function seed(page: Page, state: ReturnType<typeof initialState>) {
  await page.addInitScript((value) => {
    localStorage.setItem('madrigal:demo:v2', JSON.stringify(value));
  }, state);
}

test('Аудит: длинные подписи RangePicker сохраняют общий уровень полей', async ({
  page,
}, testInfo) => {
  for (const width of [1920, 1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(root + '/settings');
    const picker = page.getByRole('group', { name: 'Основание новой сборки', exact: true });
    await expect(picker.getByLabel('Основание новой сборки: сборка и направление')).toHaveValue(
      'assembly-baseline-fixture2-v1',
    );
    const controls = await picker.locator('select, input').evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        const label = element.parentElement!.querySelector('label')!.getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom, labelTop: label.top };
      }),
    );
    await picker.screenshot({
      path: `${evidenceDirectory}/${testInfo.project.name ? testInfo.project.name + '-' : ''}range-picker-${width}.png`,
    });
    if (width >= 1440) {
      expect(
        Math.max(...controls.map((item) => item.top)) -
          Math.min(...controls.map((item) => item.top)),
      ).toBeLessThan(1);
    }
    expect(Math.abs(controls[3]!.top - controls[4]!.top)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('Аудит: сравнение двух сообщений не теряет повторяющееся поле схемы', async ({ page }) => {
  const link = sourceLink({ ...goldenLocation, length: decimal('8') });
  await page.goto(root + '/compare?' + new URLSearchParams({ left: link, right: link }));
  await page.getByRole('button', { name: 'Получить поля сохранённых ревизий' }).click();
  const table = page.getByRole('table').filter({ hasText: 'Левое значение' });
  await expect(table.locator('tbody tr')).toHaveCount(2);
  const values = await table
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) =>
        [...row.querySelectorAll('td')].slice(1, 3).map((cell) => cell.textContent),
      ),
    );
  expect(values).toEqual([
    ['21', '21'],
    ['42', '42'],
  ]);
});

test('Аудит: результаты запуска переходят на вторую страницу и сохраняют cursor', async ({
  page,
}) => {
  const state = initialState();
  const capture = state.captures[0]!;
  const run = state.runs[0]!;
  run.manifest.corpus = Array.from({ length: 5 }, (_, index) => {
    const captureId = `capture-extra-${index}`;
    state.captures.push({ ...capture, captureId });
    return { captureId, assemblyId: `assembly-extra-${index}-v1`, sha256: capture.sha256 };
  });
  run.summary.messages = decimal('25');
  run.summary.captures = decimal('5');
  run.summary.sessions = decimal('5');
  run.summary.knownBytes = decimal('60');
  run.summary.unknownBytes = decimal('60');
  for (const status of Object.keys(run.summary.rules) as (keyof typeof run.summary.rules)[])
    run.summary.rules[status] = decimal('5');
  await seed(page, state);
  await page.goto(root + '/runs/run-baseline');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(20);
  await page.getByRole('button', { name: 'Следующая страница' }).click();
  await expect(page).toHaveURL(/cursor=20/);
  await expect(page.locator('.results-table tbody tr')).toHaveCount(5);
  await page.reload();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(5);
  await page.getByLabel('Статус проверки').selectOption('PASS');
  await expect(page).not.toHaveURL(/cursor=/);
  await expect(page.locator('.results-table tbody tr')).toHaveCount(5);
});

test('Аудит: прямая ссылка на BUILDING не запрашивает готовые байты и источники', async ({
  page,
}) => {
  const reads: string[] = [];
  page.on('request', (request) => {
    if (/\/v1\/(bytes|sources)\?/.test(request.url())) reads.push(request.url());
  });
  await page.goto(
    golden.replace('assembly-baseline-fixture2-v1', 'assembly-baseline-fixture2-pending'),
  );
  await expect(page.getByText(/Сборка ещё не готова/)).toBeVisible();
  await expect(page.getByRole('grid')).toHaveCount(0);
  expect(reads).toEqual([]);
});

test('Аудит: диапазон прямой ссылки за пределами потока отклоняется до чтения', async ({
  page,
}) => {
  const reads: string[] = [];
  page.on('request', (request) => {
    if (/\/v1\/(bytes|sources)\?/.test(request.url())) reads.push(request.url());
  });
  await page.goto(golden.replace('start=1000', 'start=65535'));
  await expect(page.getByText(/Диапазон.*предел/)).toBeVisible();
  await expect(page.getByRole('grid')).toHaveCount(0);
  expect(reads).toEqual([]);
});

test('Аудит: повтор CSV сохраняет ключ, изменение временного контекста меняет ключ', async ({
  page,
}) => {
  const keys: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/v1/importActions'))
      keys.push(request.headers()['idempotency-key']!);
  });
  await page.goto(root + '/actions');
  await page.getByRole('button', { name: 'Импортировать CSV' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Журнал CSV').setInputFiles({
    name: 'audit.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'timestamp,name,type,parameters\n2026-10-11T12:34:56.123456789Z,Аудит CSV,test,21',
    ),
  });
  const submit = dialog.getByRole('button', { name: 'Импортировать журнал', exact: true });
  await submit.click();
  await expect(dialog.getByText(/Импортировано строк: 1/)).toBeVisible();
  await submit.click();
  await expect.poll(() => keys.length).toBe(2);
  await expect(submit).toBeEnabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(keys[1]).toBe(keys[0]);
  await dialog.getByLabel('Часовой пояс журнала').selectOption('Europe/Moscow');
  await submit.click();
  await expect.poll(() => keys.length).toBe(3);
  await expect(submit).toBeEnabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(keys[2]).not.toBe(keys[0]);
});

test('Аудит: чтение старых кадров ожидает завершённую фильтрацию результатов', async ({ page }) => {
  await page.goto(root + '/runs/run-baseline');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(5);
  await page.getByLabel('Статус проверки').selectOption('PASS');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: 'Открыть исходные пакеты', exact: true }).click();
  await expect(page).toHaveURL(/assembly-baseline-fixture2-v1/);
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByText('Кадр №7', { exact: true })).toBeVisible();
  await page.reload();
  for (const number of [7, 8, 9])
    await expect(page.getByText('Кадр №' + number, { exact: true })).toBeVisible();
});

test('Аудит: быстрые переходы и недоверенный текст не ломают интерфейс', async ({ page }) => {
  const state = initialState();
  state.projects[0]!.name = '<img src=x onerror=alert(1)> & «Аудит»';
  await seed(page, state);
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await traffic(page);
  await page.getByLabel('Направление', { exact: true }).selectOption('B_TO_A');
  await page.getByLabel('Направление', { exact: true }).selectOption('A_TO_B');
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.locator('.project-label')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('Аудит: выбор сессии на второй странице сохраняет страницу и фильтры', async ({ page }) => {
  await traffic(page, golden + '&scenario=large-paginated&q=502');
  await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
  await expect(page).toHaveURL(/sessionCursor=20/);
  await expect(page.locator('.session-card')).toHaveCount(20);
  const selectedId = await page.locator('.session-card').first().textContent();
  await page.locator('.session-card').first().click();
  await expect(page).toHaveURL(/sessionCursor=20/);
  await expect(page.getByLabel('Адрес или порт')).toHaveValue('502');
  await expect(page.locator('.session-card.active')).toContainText(selectedId!.trim().slice(0, 19));
  await expect(page.locator('.context-line')).toContainText('session-baseline-fixture2-21');
  await expect(page.getByLabel('Сборка', { exact: true })).toHaveValue(
    'assembly-baseline-fixture221-v1',
  );
  await expect(page.getByRole('grid', { name: /HEX и ASCII/ })).toBeVisible();
  await expect(page.locator('.traffic-source')).toContainText('DEMO_LIMITATION');
  await page.reload();
  await expect(page).toHaveURL(/scenario=large-paginated/);
  await expect(page.locator('.session-card.active')).toHaveCount(1);
  await expect(page.getByLabel('Адрес или порт')).toHaveValue('502');
  await expect(page.getByLabel('Сборка', { exact: true })).toHaveValue(
    'assembly-baseline-fixture221-v1',
  );
  await expect(page.getByRole('grid', { name: /HEX и ASCII/ })).toBeVisible();
  await expect(page.locator('.traffic-source')).toContainText('DEMO_LIMITATION');
});

test('Аудит: сравнение запусков показывает отсутствие истории', async ({ page }) => {
  const state = initialState();
  state.runs = [];
  await seed(page, state);
  await page.goto(root + '/runs/compare');
  await expect(page.getByRole('heading', { name: 'Нет запусков для сравнения' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Создать проверку корпуса' })).toBeVisible();
});

test('Аудит: для сравнения можно выбрать запуск за первой страницей истории', async ({ page }) => {
  const state = initialState();
  state.runs = Array.from({ length: 23 }, (_, index) => ({
    ...state.runs[0]!,
    runId: 'run-audit-' + index,
  }));
  await seed(page, state);
  await page.goto(root + '/runs/compare');
  await expect(page.getByLabel('Левый запуск')).toHaveValue('run-audit-22');
  await page.getByRole('button', { name: 'Следующая страница' }).click();
  await page.getByLabel('Правый запуск').selectOption('run-audit-0');
  await expect(page.getByRole('heading', { name: 'run-audit-0', exact: true })).toBeVisible();
  await expect(page.getByLabel('Левый запуск')).toHaveValue('run-audit-22');
  await page.reload();
  await expect(page.getByLabel('Правый запуск')).toHaveValue('run-audit-0');
});

test('Аудит: запуск по revisionId выбирает соответствующую интерпретацию', async ({ page }) => {
  const state = initialState();
  const original = state.interpretations[0]!;
  state.interpretations.push({
    ...original,
    interpretationId: 'interpretation-second',
    name: 'Вторая модель',
    revisions: [
      {
        ...original.revisions[0]!,
        revisionId: 'revision-second',
        interpretationId: 'interpretation-second',
      },
    ],
  });
  await seed(page, state);
  await page.goto(root + '/runs?revisionId=revision-second');
  await expect(page.getByLabel('Интерпретация', { exact: true })).toHaveValue(
    'interpretation-second',
  );
  await expect(page.getByLabel('Сохранённая ревизия')).toHaveValue('revision-second');
});

test('Аудит: редактор не заменяет ошибочную ссылку на чужой проект локальным диапазоном', async ({
  page,
}) => {
  const source = sourceLink({ ...goldenLocation, projectId: 'another-project' });
  await page.goto(root + '/interpretations/interpretation-demo?' + new URLSearchParams({ source }));
  await expect(page.getByText(/Источник принадлежит другому проекту/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выполнить preview', exact: true })).toBeDisabled();
});

test('Аудит: формы RangePicker выровнены в двух темах и при ошибке поля', async ({
  page,
}, testInfo) => {
  for (const theme of ['light', 'dark']) {
    await page.addInitScript((value) => localStorage.setItem('madrigal:v1:theme', value), theme);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(root + '/settings');
    const picker = page.getByRole('group', { name: 'Основание новой сборки', exact: true });
    await expect(picker.locator('select').last()).toHaveValue('assembly-baseline-fixture2-v1');
    await picker.getByLabel('Основание новой сборки: длина', { exact: true }).fill('bad-length');
    const tops = await picker
      .locator('select, input')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
    await expect(
      picker.getByLabel('Основание новой сборки: длина', { exact: true }),
    ).toHaveAttribute('aria-invalid', 'true');
    await page.screenshot({
      path: `${evidenceDirectory}/${testInfo.project.name ? testInfo.project.name + '-' : ''}settings-${theme}-validation.png`,
      fullPage: true,
    });
  }
});

test('Аудит: форма и форматирование JSON сохраняют неизвестные точные числа', async ({ page }) => {
  await page.goto(root + '/interpretations/interpretation-demo');
  await editJson(
    page,
    schemaText.trimEnd().slice(0, -1) +
      ',"extension":{"integer":9007199254740993,"fraction":0.123456789012345678901,"huge":1e400}}',
  );
  await page.getByLabel('Порядок байтов').selectOption('big');
  await expect(page.locator('.cm-content')).toContainText('9007199254740993');
  await expect(page.locator('.cm-content')).toContainText('0.123456789012345678901');
  await expect(page.locator('.cm-content')).toContainText('1e400');
  await page.getByRole('button', { name: 'Форматировать JSON' }).click();
  await expect(page.locator('.cm-content')).toContainText('9007199254740993');
  await expect(page.locator('.cm-content')).toContainText('0.123456789012345678901');
  await expect(page.locator('.cm-content')).toContainText('1e400');
  await page.getByRole('button', { name: 'Сохранить новую ревизию', exact: true }).click();
  await expect(page.getByText('Сохранённый JSON', { exact: true })).toBeVisible();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать точный JSON ревизии' }).click();
  const download = await event;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = Buffer.concat(chunks).toString('utf8');
  expect(exported).toContain('9007199254740993');
  expect(exported).toContain('0.123456789012345678901');
  expect(exported).toContain('1e400');
});

test('Аудит: ошибочная ссылка журнала не создаёт связь с подставленным локальным диапазоном', async ({
  page,
}) => {
  const source = sourceLink({ ...goldenLocation, projectId: 'another-project' });
  await page.goto(root + '/actions?' + new URLSearchParams({ source, actionId: 'action-21' }));
  await expect(page.getByText(/Источник принадлежит другому проекту/)).toBeVisible();
  await page.getByLabel('Основание связи').fill('Проверка принадлежности источника');
  await expect(
    page.getByLabel('Связанный диапазон: сборка и направление', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Сохранить ручную связь' })).toBeDisabled();
});

test('Аудит: явно пустой assemblyId не подменяется первой готовой сборкой', async ({ page }) => {
  await page.goto(golden.replace('assemblyId=assembly-baseline-fixture2-v1', 'assemblyId='));
  await expect(page.getByText(/некорректные координаты|неполный контекст/i)).toBeVisible();
  await expect(page.getByRole('grid')).toHaveCount(0);
});

test('Аудит: API-режим сохраняется после перехода без mode и reload', async ({ page }) => {
  await page.goto(root + '?mode=api');
  await expect(page.getByText('CONTRACT_PENDING', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Обмен и байты', exact: true }).click();
  await expect(page).not.toHaveURL(/mode=/);
  await page.reload();
  await expect(page.getByText('CONTRACT_PENDING', { exact: true })).toBeVisible();
  await expect(page.getByText('Локальный Gateway · API', { exact: true })).toBeVisible();
  await expect(page.getByRole('grid')).toHaveCount(0);
});
