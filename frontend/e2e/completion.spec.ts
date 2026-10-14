import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { demoStorageKey, initialState } from '../src/mocks/state';
import { goldenLocation, schemaText } from '../src/mocks/fixtures/corpus';
import { decimal } from '../src/shared/model/precision';
import { sourceLink } from '../src/shared/model/navigation';
import { golden, root } from './helpers';

const screenshots = 'docs/frontend/completion-2026-10-13/screenshots';
test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
});
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const collected: string[] = [];
  errors.set(page, collected);
  page.on('pageerror', (error) => collected.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /Uncaught|Unhandled|React Router caught|dynamically imported module/i.test(message.text())
    )
      collected.push(message.text());
  });
});
test.afterEach(({ page }, info) => {
  if (info.status === 'passed') expect(errors.get(page)).toEqual([]);
});

async function seed(page: Page, state = initialState()) {
  await page.addInitScript(
    ({ state, key }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
    },
    { state, key: demoStorageKey },
  );
}
function manyModels() {
  const state = initialState();
  for (let index = 2; index <= 25; index++) {
    const model = structuredClone(state.interpretations[0]!);
    model.interpretationId = 'model-' + index;
    model.name = 'Модель ' + index;
    model.revisions = [
      {
        ...model.revisions[0]!,
        interpretationId: model.interpretationId,
        revisionId: 'revision-' + index,
        json: index === 25 ? schemaText.replace('"setpoint"', '"alternate"') : schemaText,
      },
    ];
    state.interpretations.push(model);
  }
  return state;
}
function manyEvidence() {
  const state = initialState();
  state.evidence = Array.from({ length: 25 }, (_, index) => ({
    ...structuredClone(state.evidence[0]!),
    evidenceId: 'evidence-' + index,
    basis: 'Основание ' + index,
  }));
  return state;
}

test('ТЗ: настройки защищают черновик, после сохранения уход свободен', async ({ page }, info) => {
  await seed(page);
  await page.goto(root + '/settings');
  await page.getByLabel('Поправка времени, наносекунды', { exact: true }).fill('1234');
  await page.getByRole('link', { name: 'Журнал действий', exact: true }).click();
  const guard = page.getByRole('dialog', { name: 'Есть несохранённые изменения' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
  await expect(page.getByLabel('Поправка времени, наносекунды', { exact: true })).toHaveValue(
    '1234',
  );
  await page.getByRole('button', { name: 'Сохранить новую версию настроек' }).click();
  await expect(page.getByText(/Создана версия/)).toBeVisible();
  await page.screenshot({
    path: `${screenshots}/${info.project.name || 'mock'}-settings.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Журнал действий', exact: true }).click();
  await expect(page).toHaveURL(/\/actions$/);
  await expect(guard).not.toBeVisible();
});

test('ТЗ: основание ручной связи не теряется при отмене ухода и не мешает фильтру', async ({
  page,
}) => {
  await seed(page);
  await page.goto(root + '/actions?actionId=action-21');
  await expect(page.getByLabel('Связанный диапазон: сборка и направление')).toHaveValue(
    goldenLocation.assemblyId,
  );
  await page.getByLabel('Основание связи', { exact: true }).fill('Несохранённое наблюдение');
  await page.getByLabel('Поиск по действиям').fill('уставку');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: 'Настройки проекта', exact: true }).click();
  const guard = page.getByRole('dialog', { name: 'Есть несохранённые изменения' });
  await guard.getByRole('button', { name: 'Остаться' }).click();
  await expect(page.getByLabel('Основание связи', { exact: true })).toHaveValue(
    'Несохранённое наблюдение',
  );
  await page.getByRole('button', { name: 'Сохранить ручную связь', exact: true }).click();
  await expect(page.getByText(/Связь сохранена:/)).toBeVisible();
  await page.getByRole('link', { name: 'Настройки проекта', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test('ТЗ: сохранённая связь редактируется без смены источника, Escape защищает изменения', async ({
  page,
}, info) => {
  const state = initialState();
  await seed(page, state);
  await page.goto(root + '/actions');
  await page.locator('.evidence-card').getByRole('button', { name: 'Редактировать связь' }).click();
  const dialog = page.getByRole('dialog', { name: 'Редактирование ручной связи' });
  await dialog
    .getByLabel('Основание сохранённой связи')
    .fill('Основание после независимой проверки');
  await dialog.getByLabel('Уверенность сохранённой связи').selectOption('confirmed');
  await page.keyboard.press('Escape');
  const discard = page.getByRole('dialog', { name: 'Закрыть без сохранения?' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Продолжить редактирование' }).click();
  await dialog.getByRole('button', { name: 'Сохранить изменения связи' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.evidence-card')).toContainText(
    'Основание после независимой проверки',
  );
  await expect(page.locator('.evidence-card')).toContainText('confirmed');
  await page.screenshot({
    path: `${screenshots}/${info.project.name || 'mock'}-evidence.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator('.evidence-card')).toContainText(
    'Основание после независимой проверки',
  );
  const stored = await page.evaluate(async () => {
    const path = '/src/shared/api/client.ts';
    const { api } = await import(path);
    return api.evidence({ projectId: 'demo-laboratory' });
  });
  expect(stored.items).toHaveLength(1);
  expect(stored.items[0].location).toEqual(state.evidence[0]!.location);
  expect(stored.items[0].sources).toEqual(state.evidence[0]!.sources);
});

test('ТЗ: capture за первой страницей выбирается с сохранением фильтра и reload', async ({
  page,
}) => {
  const state = initialState();
  for (let index = 1; index <= 24; index++)
    state.captures.push({
      ...state.captures[0]!,
      captureId: `capture-extra-${index}-fixture2`,
      name: 'Запись ' + index,
    });
  await seed(page, state);
  await page.goto(root + '/traffic?q=51824');
  await page.getByRole('button', { name: 'Загрузить ещё записи', exact: true }).click();
  await page
    .getByLabel('Исходная запись', { exact: true })
    .selectOption('capture-extra-24-fixture2');
  await expect(page.locator('.context-line')).toContainText('capture-extra-24-fixture2');
  await expect(page.getByRole('grid', { name: /HEX и ASCII/ })).toBeVisible();
  await expect(page.locator('.selection-info')).toContainText('assembly-extra-24-fixture2-v1');
  await expect(page.getByText('Кадр №7', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('q')).toBe('51824');
  await page.reload();
  await expect(page.getByLabel('Исходная запись', { exact: true })).toHaveValue(
    'capture-extra-24-fixture2',
  );
  await expect(page.getByRole('grid', { name: /HEX и ASCII/ })).toBeVisible();
});

test('ТЗ: модель за первой страницей задаёт точную ревизию для run и сохраняется в URL', async ({
  page,
}) => {
  await seed(page, manyModels());
  await page.goto(root + '/runs');
  await page.getByRole('button', { name: 'Загрузить ещё интерпретации' }).click();
  await page.getByLabel('Интерпретация', { exact: true }).selectOption('model-25');
  await expect(page.getByLabel('Сохранённая ревизия', { exact: true })).toHaveValue('revision-25');
  await page.reload();
  await expect(page.getByLabel('Интерпретация', { exact: true })).toHaveValue('model-25');
  await expect(page.getByLabel('Сохранённая ревизия', { exact: true })).toHaveValue('revision-25');
  await expect(page.getByLabel('Сборка для корпуса: сборка и направление')).toHaveValue(
    goldenLocation.assemblyId,
  );
  await page.getByRole('button', { name: 'Добавить сборку в корпус' }).click();
  await page.getByRole('link', { name: 'Журнал действий', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Есть несохранённые изменения' })
    .getByRole('button', { name: 'Остаться' })
    .click();
  await page.getByRole('button', { name: 'Проверить корпус', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Проверить выбранный корпус?' })).toContainText(
    'revision-25',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Создать запуск', exact: true })
    .click();
  await expect(page).toHaveURL(/\/runs\/run-/);
  await expect(page.locator('.metadata')).toContainText('revision-25');
});

test('ТЗ: сравнение отдельных моделей сохраняет ревизии, поля без пары и reload', async ({
  page,
}, info) => {
  await seed(page, manyModels());
  const source = sourceLink(goldenLocation);
  await page.goto(root + '/compare?' + new URLSearchParams({ left: source, right: source }));
  await page.getByRole('button', { name: 'Загрузить ещё интерпретации' }).click();
  await page.getByLabel('Интерпретация левого примера').selectOption('model-25');
  await expect(page.getByLabel('Ревизия левого примера')).toHaveValue('revision-25');
  const fields = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Значения полей после разбора' }) });
  await fields.getByRole('button', { name: 'Получить поля сохранённых ревизий' }).click();
  await expect(fields.locator('tbody tr')).toHaveCount(2);
  await expect(fields.locator('tbody')).toContainText('alternate');
  await expect(fields.locator('tbody')).toContainText('setpoint');
  await expect(fields.locator('tbody')).toContainText('Несопоставимо');
  expect(new URL(page.url()).searchParams.get('leftRevision')).toBe('revision-25');
  await page.screenshot({
    path: `${screenshots}/${info.project.name || 'mock'}-compare-models.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByLabel('Интерпретация левого примера')).toHaveValue('model-25');
  await expect(page.getByLabel('Ревизия левого примера')).toHaveValue('revision-25');
  await fields.getByRole('button', { name: 'Получить поля сохранённых ревизий' }).click();
  await expect(fields.locator('tbody tr')).toHaveCount(2);
});

test('ТЗ: ревизия чужой модели в ссылке сравнения не подменяется существующей', async ({
  page,
}) => {
  await seed(page, manyModels());
  await page.goto(root + '/compare?leftInterpretation=model-25&leftRevision=revision-v1');
  await expect(page.getByLabel('Ревизия левого примера')).toHaveValue('revision-v1');
  await expect(
    page.getByText(
      'Указанная ревизия не принадлежит выбранной модели. Выберите сохранённую ревизию.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Получить поля сохранённых ревизий' }),
  ).toBeDisabled();
});

test('ТЗ: связи на второй странице редактируются и перечитываются без потери cursor', async ({
  page,
}) => {
  await seed(page, manyEvidence());
  await page.goto(root + '/actions');
  const pages = page.getByRole('group', { name: 'Страницы сохранённых связей' });
  await pages.getByRole('button', { name: 'Следующая страница' }).click();
  await expect(page.locator('.evidence-card')).toHaveCount(5);
  const card = page.locator('.evidence-card').filter({ hasText: 'Основание 24' });
  await card.getByRole('button', { name: 'Редактировать связь' }).click();
  const dialog = page.getByRole('dialog', { name: 'Редактирование ручной связи' });
  await dialog
    .getByLabel('Основание сохранённой связи')
    .fill('Уточнённая связь со второй страницы');
  await dialog.getByRole('button', { name: 'Сохранить изменения связи' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator('.evidence-card').filter({ hasText: 'Уточнённая связь со второй страницы' }),
  ).toBeVisible();
  await page.reload();
  expect(new URL(page.url()).searchParams.get('evidenceCursor')).toBe('20');
  await expect(page.locator('.evidence-card')).toHaveCount(5);
  await expect(page.getByText('Уточнённая связь со второй страницы')).toBeVisible();
});

test('ТЗ: гипотеза принимает evidence за первой страницей в качестве контрпримера', async ({
  page,
}) => {
  await seed(page, manyEvidence());
  await page.goto(root + '/hypotheses');
  await page.getByRole('button', { name: 'Создать наблюдение / гипотезу' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая исследовательская запись' });
  await dialog
    .getByLabel('Формулировка', { exact: true })
    .fill('Проверяемая гипотеза со второй страницей');
  await dialog
    .getByLabel('Основания и открытые вопросы')
    .fill('Сопоставление независимых наблюдений');
  await dialog.getByRole('button', { name: 'Загрузить ещё связи' }).click();
  await dialog.getByRole('checkbox', { name: 'Основание 24', exact: true }).check();
  await dialog.getByLabel('Роль примера evidence-24').selectOption('counterexample');
  await dialog.getByRole('button', { name: 'Сохранить исследовательскую запись' }).click();
  await expect(dialog).not.toBeVisible();
  const card = page
    .locator('.hypothesis-card')
    .filter({ hasText: 'Проверяемая гипотеза со второй страницей' });
  await expect(card).toContainText('Основание 24');
  await expect(card).toContainText(/Контрпример/i);
});

test('ТЗ: переданный из HEX source сохраняется при пагинации интерпретаций', async ({ page }) => {
  await seed(page, manyModels());
  const source = sourceLink({ ...goldenLocation, start: decimal('1004') });
  await page.goto(root + '/interpretations?' + new URLSearchParams({ source }));
  await page.getByRole('button', { name: 'Следующая страница' }).click();
  expect(new URL(page.url()).searchParams.get('source')).toBe(source);
  await page
    .getByRole('row')
    .filter({ hasText: 'Модель 25' })
    .getByRole('link', { name: 'Открыть редактор' })
    .click();
  await expect(page.getByLabel('Диапазон preview: начало')).toHaveValue('1004');
  await expect(page.getByRole('link', { name: 'Проверить корпус', exact: true })).toHaveAttribute(
    'href',
    /interpretationId=model-25/,
  );
});

test('ТЗ: отчёт формируется по выбранному run за первой страницей', async ({ page }) => {
  const state = initialState();
  state.runs = Array.from({ length: 25 }, (_, index) => ({
    ...structuredClone(state.runs[0]!),
    runId: 'report-run-' + index,
    jobId: 'ana_report-' + index,
  }));
  await seed(page, state);
  await page.goto(root + '/artifacts');
  await page.getByRole('button', { name: 'Загрузить ещё запуски для отчёта' }).click();
  await page.getByLabel('Завершённый запуск для отчёта').selectOption('report-run-0');
  await page.reload();
  await expect(page.getByLabel('Завершённый запуск для отчёта')).toHaveValue('report-run-0');
  await page.getByRole('button', { name: 'Сформировать Markdown-отчёт' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'report-run-0' })).toContainText('READY');
});

test('ТЗ: сравнение runs отдельно показывает технический статус и историчность', async ({
  page,
}, info) => {
  const state = initialState();
  state.runs[0]!.status = 'FAILED';
  state.runs[0]!.summary.complete = false;
  state.runs[1]!.status = 'INTERRUPTED';
  state.runs[1]!.summary.complete = false;
  await seed(page, state);
  await page.goto(root + '/runs/compare?left=run-baseline&right=run-additional');
  const left = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'run-baseline', exact: true }) });
  const right = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'run-additional', exact: true }) });
  await expect(left).toContainText('FAILED');
  await expect(right).toContainText('INTERRUPTED');
  await expect(left).toContainText('HISTORICAL');
  await expect(right).toContainText('HISTORICAL');
  await page.screenshot({
    path: `${screenshots}/${info.project.name || 'mock'}-run-statuses.png`,
    fullPage: true,
  });
});

test('ТЗ: полный SourceMap показывает соседние участки кадра 8 без пропуска байтов', async ({
  page,
}) => {
  await seed(page);
  await page.goto(sourceLink({ ...goldenLocation, length: decimal('8') }));
  const frames = page.locator('.source-packet').filter({ hasText: 'Кадр №8' });
  await expect(frames).toHaveCount(2);
  await frames.nth(1).locator('summary').click();
  await expect(frames.nth(1).locator('[data-frame-offset="68"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(frames.nth(1).locator('[data-frame-offset="68"]')).toHaveText('2A');
});

test('ТЗ: смена направления оставляет HEX доступным и явно сообщает отсутствие его demo источников', async ({
  page,
}) => {
  await seed(page);
  await page.goto(
    golden
      .replace('A_TO_B', 'B_TO_A')
      .replace('stream-baseline-fixture2-a', 'stream-baseline-fixture2-b')
      .replace('assembly-baseline-fixture2-v1', 'assembly-baseline-fixture2-b-v1'),
  );
  await expect(page.getByRole('grid', { name: /HEX и ASCII/ })).toBeVisible();
  await expect(
    page.getByText(/Для этого направления или поколения демо-корпус не содержит исходных кадров/),
  ).toBeVisible();
  await expect(page.locator('.source-packet')).toHaveCount(0);
});

test('ТЗ: большой исходный кадр открывается на выделении и ограничивает DOM', async ({
  page,
}, info) => {
  await seed(page);
  const location = {
    ...goldenLocation,
    captureId: 'capture-large-frame-fixture2',
    sessionId: 'session-large-frame-fixture2-1',
    streamId: 'stream-large-frame-fixture2-a',
    assemblyId: 'assembly-large-frame-fixture2-v1',
  };
  await page.goto(sourceLink(location));
  await page.getByText('Кадр №1', { exact: true }).click();
  const frame = page.getByRole('region', { name: 'HEX кадра 1, выделение от начала кадра' });
  await expect(frame.locator('[data-frame-offset="60000"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(frame.locator('[data-frame-offset="60000"]')).toHaveText('15');
  expect(await frame.locator('[data-frame-offset]').count()).toBeLessThan(400);
  await page.screenshot({
    path: `${screenshots}/${info.project.name || 'mock'}-large-frame.png`,
    fullPage: true,
  });
  await frame.focus();
  await page.keyboard.press('End');
  await expect(frame.locator('[data-frame-offset="65535"]')).toBeVisible();
  expect(await frame.locator('[data-frame-offset]').count()).toBeLessThan(400);
});

test('ТЗ: более ста источников доступны по страницам, включая последний кадр', async ({ page }) => {
  await seed(page);
  const location = {
    ...goldenLocation,
    captureId: 'capture-many-sources-fixture2',
    sessionId: 'session-many-sources-fixture2-1',
    streamId: 'stream-many-sources-fixture2-a',
    assemblyId: 'assembly-many-sources-fixture2-v1',
  };
  await page.goto(sourceLink(location));
  await expect(page.locator('.source-packet')).toHaveCount(20);
  const pages = page.getByRole('group', { name: 'Страницы исходных участков' });
  await expect(pages).toContainText('125');
  for (let index = 0; index < 6; index++)
    await pages.getByRole('button', { name: 'Следующая страница' }).click();
  await expect(page.locator('.source-packet')).toHaveCount(5);
  await page.getByText('Кадр №125', { exact: true }).click();
  const frame = page.getByRole('region', { name: 'HEX кадра 125, выделение от начала кадра' });
  await expect(frame.locator('[data-frame-offset="54"]')).toHaveAttribute('data-selected', 'true');
  await expect(frame.locator('[data-frame-offset="54"]')).toHaveText('15');
});

test('ТЗ: сохранённый demo-state v1 переносится с прежними кадрами и ссылками', async ({
  page,
}) => {
  const legacy = JSON.parse(
    JSON.stringify(initialState())
      .replaceAll('-fixture2', '')
      .replaceAll('frontend-fixture-v2', 'frontend-fixture-v1'),
  );
  legacy.version = 1;
  legacy.captures = legacy.captures.slice(0, 4);
  legacy.projects[0].captures = 4;
  legacy.evidence[0].basis = 'Мой сохранённый черновик исследования v1';
  await page.addInitScript(
    ({ state, key }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem('madrigal:demo:v1', JSON.stringify(state));
    },
    { state: legacy, key: demoStorageKey },
  );
  const old = {
    ...goldenLocation,
    captureId: 'capture-baseline',
    sessionId: 'session-baseline-1',
    streamId: 'stream-baseline-a',
    assemblyId: 'assembly-baseline-v1',
    start: decimal('1004'),
  };
  await page.goto(sourceLink(old));
  await expect(page.getByText(/Это прежний демонстрационный корпус/)).toBeVisible();
  await page.getByText('Кадр №8', { exact: true }).click();
  await expect(page.locator('[data-frame-offset="70"]')).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('[data-frame-offset="70"]')).toHaveText('2A');
  const stored = await page.evaluate(
    (key) => ({
      current: JSON.parse(localStorage.getItem(key)!),
      previous: JSON.parse(localStorage.getItem('madrigal:demo:v1')!),
    }),
    demoStorageKey,
  );
  expect(stored.current.version).toBe(2);
  expect(stored.current.evidence[0].basis).toBe(legacy.evidence[0].basis);
  expect(
    stored.current.captures.some(
      (capture: { captureId: string }) => capture.captureId === goldenLocation.captureId,
    ),
  ).toBe(true);
  expect(stored.previous).toEqual(legacy);
});
