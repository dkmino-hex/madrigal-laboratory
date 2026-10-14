import { expect, type Page } from '@playwright/test';
export const root = '/projects/demo-laboratory';
export const golden =
  root +
  '/traffic?' +
  new URLSearchParams({
    projectId: 'demo-laboratory',
    captureId: 'capture-baseline-fixture2',
    sessionId: 'session-baseline-fixture2-1',
    streamId: 'stream-baseline-fixture2-a',
    assemblyId: 'assembly-baseline-fixture2-v1',
    direction: 'A_TO_B',
    start: '1000',
    length: '4',
  }).toString();
export async function traffic(page: Page, url = golden) {
  await page.goto(url);
  await expect(page.getByRole('grid', { name: /HEX и ASCII/ })).toBeVisible();
}
export async function changeRange(page: Page, start: string, length: string) {
  await page.getByLabel('Начало, байт', { exact: true }).fill(start);
  await page.getByLabel('Длина, байт', { exact: true }).fill(length);
  await page.getByRole('button', { name: 'Перейти к диапазону' }).click();
  await expect(page).toHaveURL(new RegExp('start=' + start));
}
export async function editJson(page: Page, text: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}
export async function createRun(
  page: Page,
  capture = 'capture-baseline-fixture2',
  options: { base?: string; scenario?: string; revisionId?: string } = {},
) {
  const base = options.base ?? root;
  const query = new URLSearchParams();
  if (options.scenario) query.set('scenario', options.scenario);
  if (options.revisionId) query.set('revisionId', options.revisionId);
  await page.goto(base + '/runs?' + query.toString());
  await page.getByLabel('Сборка для корпуса: запись', { exact: true }).selectOption(capture);
  await expect(
    page.getByLabel('Сборка для корпуса: сборка и направление', { exact: true }),
  ).toHaveValue('assembly-' + capture.replace('capture-', '') + '-v1');
  await page.getByRole('button', { name: 'Добавить сборку в корпус' }).click();
  await page.getByRole('button', { name: 'Проверить корпус', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Создать запуск', exact: true })
    .click();
  await expect(page).toHaveURL(/\/runs\/run-/);
  return new URL(page.url()).pathname.split('/').at(-1)!;
}
