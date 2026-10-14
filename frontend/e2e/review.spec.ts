import { expect, test } from '@playwright/test';
import { golden, root, traffic } from './helpers';
import { editJson } from './helpers';
import { schemaText } from '../src/mocks/fixtures/corpus';
import { mkdir } from 'node:fs/promises';

test('Правки 3/6: повторная смена типа и статуса показывает соответствующие записи', async ({
  page,
}) => {
  await page.goto(root + '/hypotheses');
  await page.getByRole('button', { name: 'Создать наблюдение / гипотезу' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Тип', { exact: true }).selectOption('observation');
  await dialog.getByLabel('Формулировка').fill('Наблюдение для проверки фильтра');
  await dialog.getByLabel('Основания и открытые вопросы').fill('Сохранённый исходный диапазон');
  await dialog.getByRole('button', { name: 'Сохранить исследовательскую запись' }).click();
  await expect(dialog).toBeHidden();
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByLabel('Тип записи').selectOption('observation');
    await expect(page.locator('.hypothesis-card h2')).toHaveText([
      'Наблюдение для проверки фильтра',
    ]);
    await page.getByLabel('Тип записи').selectOption('hypothesis');
    await expect(page.locator('.hypothesis-card h2')).toHaveText([
      'Поле value может передавать уставку температуры',
    ]);
    await page.getByLabel('Статус гипотезы').selectOption('refuted');
    await expect(page.getByText('Исследовательских записей нет')).toBeVisible();
    await page.getByLabel('Статус гипотезы').selectOption('');
    await expect(page.locator('.hypothesis-card')).toHaveCount(1);
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Правки 4/5/9: фильтр дефектов снимается, список восстанавливается без лишних пунктов', async ({
  page,
}) => {
  await traffic(page);
  const list = page.locator('.traffic-list');
  await expect(list.locator('.session-card')).toHaveCount(2);
  await page.getByLabel('Только с дефектами').check();
  await expect(list.locator('.session-card')).toHaveCount(1);
  await page.getByLabel('Только с дефектами').uncheck();
  await expect(list.locator('.session-card')).toHaveCount(2);
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(
    page.getByLabel('Исходная запись', { exact: true }).locator('option[value=""]'),
  ).toHaveCount(0);
  await expect(list.getByRole('button', { name: 'Следующая страница', exact: true })).toHaveCount(
    0,
  );
  await expect(list).not.toContainText('cursor');
});

test('Правка 13: снятые примеры остаются в форме с прежней подписью и ролью', async ({ page }) => {
  await page.goto(root + '/hypotheses');
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const label of [
    'Наблюдение на команде 21',
    'Дополнительная запись с числом 42 противоречит ограничению 30',
  ]) {
    const checkbox = dialog.getByRole('checkbox', { name: label, exact: true });
    await checkbox.uncheck();
    await expect(checkbox).toBeVisible();
    await checkbox.check();
  }
  await expect(dialog.getByLabel('Роль примера evidence-counter')).toHaveValue('counterexample');
});

test('Правка 8: ручная связь создаётся и редактируется без основания', async ({ page }) => {
  await page.goto(root + '/actions?actionId=action-21');
  const save = page.getByRole('button', { name: 'Сохранить ручную связь' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(/Связь сохранена:/)).toBeVisible();
  const card = page.locator('.evidence-card').filter({ hasText: 'Основание не указано' });
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'Редактировать связь' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Основание сохранённой связи')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Сохранить изменения связи' }).click();
  await expect(dialog).toBeHidden();
});

test('Правка 15: удаление исследовательской записи подтверждается и сохраняется после reload', async ({
  page,
}) => {
  await page.goto(root + '/hypotheses');
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Удалить исследовательскую запись?' });
  await dialog.getByRole('button', { name: 'Оставить запись' }).click();
  await expect(page.locator('.hypothesis-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await dialog.getByRole('button', { name: 'Удалить запись', exact: true }).click();
  await expect(page.getByText('Исследовательских записей нет')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Исследовательских записей нет')).toBeVisible();
});

test('Правки 14/16: параметры выбираются из списка, ошибка поправки понятна', async ({ page }) => {
  await page.goto(root + '/runs');
  await expect(page.getByLabel('Область и фильтры проверки')).toHaveJSProperty('tagName', 'SELECT');
  await page.goto(root + '/settings');
  await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveJSProperty(
    'tagName',
    'SELECT',
  );
  await page.getByLabel('Часовой пояс', { exact: true }).selectOption('Europe/Moscow');
  await page.getByLabel('Поправка времени, наносекунды').fill('123.5');
  await expect(page.getByLabel('Поправка времени, наносекунды')).toHaveAccessibleDescription(
    /Введите целое число/,
  );
  await expect(
    page.getByRole('button', { name: 'Сохранить новую версию настроек' }),
  ).toBeDisabled();
});

test('Правка 17: быстрый поиск отправляется после ввода и сохраняет карточки при ожидании', async ({
  page,
}) => {
  await page.goto('/projects');
  await expect(page.locator('.project-card')).toHaveCount(3);
  const searches: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/projects') && url.pathname.includes('/__madrigal_mock/'))
      searches.push(url.searchParams.get('q') ?? '');
  });
  await page.getByLabel('Найти проект').pressSequentially('Термоконтроллер', { delay: 15 });
  await expect(page.locator('.project-card')).toHaveCount(3);
  await expect(page.locator('.project-card')).toHaveCount(1);
  expect(searches).toEqual(['Термоконтроллер']);
  await page.getByLabel('Найти проект').fill('');
  await expect(page.locator('.project-card')).toHaveCount(3);
});

test('Валидация: пробелы не создают проекты и интерпретации', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название проекта').fill('   ');
  await expect(dialog.getByRole('button', { name: 'Создать проект', exact: true })).toBeDisabled();
  await dialog.getByLabel('Название проекта').fill('\u200b\u200c');
  await expect(dialog.getByRole('button', { name: 'Создать проект', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Название проекта')).toHaveAccessibleDescription(
    /Введите название/,
  );
  await dialog.getByRole('button', { name: 'Закрыть диалог' }).click();
  await page.goto(root + '/interpretations');
  await page.getByRole('button', { name: 'Создать интерпретацию', exact: true }).click();
  await dialog.getByLabel('Название интерпретации').fill('   ');
  await expect(
    dialog.getByRole('button', { name: 'Создать интерпретацию', exact: true }),
  ).toBeDisabled();
});

test('Валидация: пустой диапазон и выход за границы не используются для preview', async ({
  page,
}) => {
  await page.goto(root + '/interpretations/interpretation-demo');
  await page.getByLabel('Диапазон preview: длина', { exact: true }).fill('0');
  await expect(
    page.getByLabel('Диапазон preview: длина', { exact: true }),
  ).toHaveAccessibleDescription(/больше нуля/);
  await page.getByLabel('Диапазон preview: длина', { exact: true }).fill('4');
  await page.getByLabel('Диапазон preview: начало', { exact: true }).fill('999999');
  await expect(page.getByLabel('Диапазон preview: начало', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
});

test('Правка 2: завершение загрузки сборок объясняется и сохраняет текущий выбор', async ({
  page,
}) => {
  await page.goto(root + '/runs');
  const select = page.getByLabel('Сборка для корпуса: сборка и направление', { exact: true });
  await expect(select).toHaveValue('assembly-baseline-fixture2-v1');
  for (const count of [40, 54]) {
    await page.getByRole('button', { name: 'Загрузить ещё версии сборки', exact: true }).click();
    await expect(select.locator('option')).toHaveCount(count);
  }
  await expect(page.getByText('Все версии сборки загружены', { exact: true })).toBeVisible();
  await expect(select).toHaveValue('assembly-baseline-fixture2-v1');
  for (const text of await select.locator('option:disabled').allTextContents())
    expect(text).toContain('Ещё собирается');
});

test('Правки 3/6: API в соседней вкладке не отключает данные демонстрации', async ({
  page,
  context,
}) => {
  await traffic(page, golden);
  const apiPage = await context.newPage();
  await apiPage.goto('/projects?mode=api');
  await expect(apiPage.getByText('CONTRACT_PENDING', { exact: true })).toBeVisible();
  await page.bringToFront();
  await page.getByLabel('Только с дефектами').check();
  await expect(page.locator('.traffic-list .session-card')).toHaveCount(1);
  await page.getByLabel('Только с дефектами').uncheck();
  await expect(page.locator('.traffic-list .session-card')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await apiPage.close();
});

test('Правка 6: чтение демо восстанавливается после завершения перехвата запросов', async ({
  page,
}) => {
  await traffic(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const listener = (event: MessageEvent) => {
          if (event.data?.type !== 'CLIENT_CLOSED') return;
          event.ports[0]?.postMessage(true);
          navigator.serviceWorker.removeEventListener('message', listener);
          resolve();
        };
        navigator.serviceWorker.addEventListener('message', listener);
        navigator.serviceWorker.controller!.postMessage('CLIENT_CLOSE');
      }),
  );
  await page.getByLabel('Только с дефектами').check();
  await expect(page.locator('.traffic-list .session-card')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Только с дефектами').uncheck();
  await expect(page.locator('.traffic-list .session-card')).toHaveCount(2);
});

test('Валидация: редактор сохраняет очищенное поле без null и проверяет зависимости', async ({
  page,
}) => {
  await page.goto(root + '/interpretations/interpretation-demo');
  const size = page.getByLabel('Размер сообщения, байт');
  await size.fill('');
  await expect(size).toHaveValue('');
  await expect(page.locator('.cm-content')).toContainText('"length": ""');
  await expect(
    page.getByRole('button', { name: 'Сохранить новую ревизию', exact: true }),
  ).toBeDisabled();
  await size.fill('1.5');
  await expect(size).toHaveAccessibleDescription(/целое/);
  await size.fill('4');
  await page.getByLabel('Смещение поля в сообщении').fill('1');
  await expect(page.getByLabel('Смещение поля в сообщении')).toHaveAccessibleDescription(/4 байта/);
  await page.getByLabel('Смещение поля в сообщении').fill('0');
  await page.getByLabel('Максимум первого правила').fill('4294967296');
  await expect(
    page.getByRole('button', { name: 'Сохранить новую ревизию', exact: true }),
  ).toBeDisabled();
  await editJson(page, schemaText);
  await page.getByLabel('Имя первого поля').fill('temperature');
  await expect(page.locator('.cm-content')).toContainText('"field": "temperature"');
  await expect(
    page.getByRole('button', { name: 'Сохранить новую ревизию', exact: true }),
  ).toBeEnabled();
});

test('Валидация: устаревшие варианты из ссылок видны и требуют правильного выбора', async ({
  page,
}) => {
  await page.goto(root + '/hypotheses?type=wrong');
  await expect(page.getByLabel('Тип записи')).toHaveAccessibleDescription(/из доступных вариантов/);
  await expect(page.getByLabel('Тип записи')).toHaveValue('wrong');
  await page.getByLabel('Тип записи').selectOption('hypothesis');
  await expect(page.locator('.hypothesis-card')).toHaveCount(1);
  await page.goto(
    root + '/runs?interpretationId=interpretation-demo&revisionId=missing&settingsVersion=missing',
  );
  await expect(page.getByLabel('Сохранённая ревизия')).toHaveValue('missing');
  await expect(page.getByLabel('Сохранённая ревизия')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Версия настроек')).toHaveAccessibleDescription(/доступную версию/);
  await expect(page.getByRole('button', { name: 'Проверить корпус', exact: true })).toBeDisabled();
});

test('Валидация: пустой файл, неверное расширение и поправка CSV не отправляются', async ({
  page,
}) => {
  await page.goto(root + '/actions');
  await page.getByRole('button', { name: 'Импортировать CSV' }).click();
  const dialog = page.getByRole('dialog');
  const upload = dialog.getByLabel('Журнал CSV', { exact: true });
  await upload.setInputFiles({ name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.from('') });
  await expect(upload).toHaveAccessibleDescription(/Файл пуст/);
  await expect(dialog.getByRole('button', { name: 'Импортировать журнал' })).toBeDisabled();
  await upload.setInputFiles({
    name: 'wrong.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('data'),
  });
  await expect(upload).toHaveAccessibleDescription(/Выберите файл .csv/);
  await upload.setInputFiles({
    name: 'valid.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'timestamp,name,type,parameters\n2026-10-11T12:00:00Z,Команда,setpoint,21\n',
    ),
  });
  await dialog.getByLabel('Поправка времени, наносекунды').fill('1e9');
  await expect(dialog.getByLabel('Поправка времени, наносекунды')).toHaveAccessibleDescription(
    /Введите целое число/,
  );
  await expect(dialog.getByRole('button', { name: 'Импортировать журнал' })).toBeDisabled();
});

test('Валидация: повторное добавление сборки поясняется, preview ограничивает длину', async ({
  page,
}) => {
  await page.goto(root + '/runs');
  const add = page.getByRole('button', { name: 'Добавить сборку в корпус' });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(add).toBeDisabled();
  await expect(page.getByText(/Эта сборка уже включена в корпус./)).toBeVisible();
  await page.getByRole('button', { name: 'Исключить из корпуса' }).click();
  await page.goto(root + '/interpretations/interpretation-demo');
  await page.getByLabel('Диапазон preview: длина', { exact: true }).fill('4097');
  await expect(
    page.getByLabel('Диапазон preview: длина', { exact: true }),
  ).toHaveAccessibleDescription(/не больше 4096/);
});

for (const theme of ['light', 'dark']) {
  test(`Правки 1/7/10/11/12: отступы, кнопки и пояснения в теме ${theme}`, async ({ page }) => {
    test.setTimeout(45000);
    await page.addInitScript((theme) => localStorage.setItem('madrigal:v1:theme', theme), theme);
    await mkdir('docs/frontend/screenshots', { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(root + '/hypotheses');
      await expect(page.locator('.hypothesis-card')).toHaveCount(1);
      const card = (await page.locator('.hypothesis-card').boundingBox())!;
      const heading = (await page.locator('.hypothesis-card h2').boundingBox())!;
      expect(heading.x - card.x).toBeGreaterThanOrEqual(12);
      expect(heading.y - card.y).toBeGreaterThanOrEqual(12);
      await page.screenshot({
        path: `docs/frontend/screenshots/review-hypotheses-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.goto(root + '/interpretations/interpretation-demo');
      await expect(page.getByLabel('Имя первого поля')).toHaveValue('value');
      const basics = (await page.locator('.editor-basics').boundingBox())!;
      const name = (await page.getByLabel('Имя первого поля').boundingBox())!;
      expect(name.x - basics.x).toBeGreaterThanOrEqual(12);
      expect(basics.x + basics.width - name.x - name.width).toBeGreaterThanOrEqual(12);
      if (width === 1440)
        expect((await page.locator('.editor-panel').boundingBox())!.height).toBeLessThan(
          basics.height,
        );
      await page.screenshot({
        path: `docs/frontend/screenshots/review-editor-${theme}-${width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(root + '/compare');
    const parse = page.getByRole('button', { name: 'Получить поля сохранённых ревизий' });
    await expect(parse).toBeEnabled();
    await parse.click();
    const table = page.locator('.parsed-fields-table');
    await expect(table.getByRole('cell', { name: '21', exact: true }).first()).toBeVisible();
    const gap =
      (await table.boundingBox())!.y -
      ((await parse.boundingBox())!.y + (await parse.boundingBox())!.height);
    expect(gap).toBeGreaterThanOrEqual(12);
    const sources = table.getByRole('link');
    await expect(sources).toHaveCount(2);
    const firstSource = (await sources.first().boundingBox())!;
    const secondSource = (await sources.last().boundingBox())!;
    expect(
      secondSource.x - firstSource.x - firstSource.width >= 6 ||
        secondSource.y - firstSource.y - firstSource.height >= 6,
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `docs/frontend/screenshots/review-compare-${theme}.png`,
      fullPage: true,
    });
    await page.goto('/projects/demo-importing');
    const refresh = page.getByRole('button', { name: 'Перечитать статус' }).first();
    await expect(refresh).toBeEnabled();
    const buttonStyle = await refresh.evaluate((node) => ({
      border: getComputedStyle(node).borderTopColor,
      background: getComputedStyle(node).backgroundColor,
    }));
    expect(buttonStyle.border).not.toBe('rgba(0, 0, 0, 0)');
    expect(buttonStyle.background).not.toBe('rgba(0, 0, 0, 0)');
    await traffic(page);
    await expect(
      page.getByRole('button', { name: 'Копировать прямую ссылку на источник' }),
    ).toHaveAttribute('title', /выбранный диапазон байтов, его сборку и исходные пакеты/);
  });
}
