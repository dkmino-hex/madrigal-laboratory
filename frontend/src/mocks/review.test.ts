// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from './handlers';
import { initialState, resetState } from './state';
import { api } from '../shared/api/client';
import { config } from '../app/config';
import { goldenLocation, projectId } from './fixtures/corpus';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  config.mode = 'mock';
  resetState();
});
afterEach(() => server.resetHandlers());

it('связь с пустым основанием создаётся и перечитывается с прежним источником', async () => {
  const saved = await api.saveEvidence({
    projectId,
    location: goldenLocation,
    actionId: 'action-21',
    basis: '   ',
    kind: 'support',
    status: 'tentative',
  });
  expect(saved.basis).toBe('');
  const page = await api.evidence({ projectId, actionId: 'action-21' });
  expect(page.items.find((item) => item.evidenceId === saved.evidenceId)).toMatchObject({
    basis: '',
    location: goldenLocation,
  });
});
it('удаление гипотезы идемпотентно, связи и запуски сохраняются', async () => {
  const options = { idempotencyKey: 'delete-once' };
  const first = await api.deleteHypothesis(projectId, 'hypothesis-setpoint', options);
  expect(await api.deleteHypothesis(projectId, 'hypothesis-setpoint', options)).toEqual(first);
  expect((await api.hypotheses({ projectId })).items).toHaveLength(0);
  expect((await api.evidence({ projectId })).items).toHaveLength(initialState().evidence.length);
  expect((await api.runs({ projectId })).items).toHaveLength(initialState().runs.length);
});
it('чужой проект не может удалить или перезаписать исследовательскую запись', async () => {
  const other = await api.createProject({ name: 'Другой проект', description: '' });
  await expect(api.deleteHypothesis(other.projectId, 'hypothesis-setpoint')).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(
    api.saveHypothesis({
      ...initialState().hypotheses[0],
      projectId: other.projectId,
      evidence: [],
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await api.hypotheses({ projectId })).items).toHaveLength(1);
});
it('наблюдение и гипотеза фильтруются независимо, очистка фильтра возвращает оба типа', async () => {
  await api.saveHypothesis({
    projectId,
    type: 'observation',
    text: 'Наблюдение',
    basis: 'Исходный диапазон',
    status: 'supported',
    evidence: [],
  });
  expect(
    (await api.hypotheses({ projectId, type: 'observation' })).items.map((item) => item.type),
  ).toEqual(['observation']);
  expect(
    (await api.hypotheses({ projectId, type: 'hypothesis' })).items.map((item) => item.type),
  ).toEqual(['hypothesis']);
  expect((await api.hypotheses({ projectId, status: 'refuted' })).items).toEqual([]);
  expect((await api.hypotheses({ projectId, status: '', type: '' })).items).toHaveLength(2);
});
it('одинаковая ретрансляция не скрывает работу фильтра дефектов', async () => {
  const params = { projectId, captureId: goldenLocation.captureId };
  expect(
    (await api.sessions({ ...params, defects: 'true' })).items.map((item) => item.generation),
  ).toEqual([2]);
  expect((await api.sessions({ ...params, defects: '' })).items).toHaveLength(2);
});
it.each(['', '  ', 'a'.repeat(121), 'name\u0000'])(
  'название %j отклоняется и для проекта, и для интерпретации',
  async (name) => {
    await expect(api.createProject({ name, description: '' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(api.createInterpretation({ projectId, name })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  },
);
it('настройки и импорт журнала одинаково отклоняют неверную зону и поправку', async () => {
  for (const input of [
    { timeZone: 'Missing/Zone', offsetNanoseconds: '0' },
    { timeZone: 'UTC', offsetNanoseconds: '1.5' },
    { timeZone: 'UTC', offsetNanoseconds: '9'.repeat(30) },
  ]) {
    await expect(
      api.saveSettings(projectId, { ...input, checksum: 'warn', overlap: 'preserve-alternatives' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      api.importActions(
        { projectId, ...input },
        { file: new File(['timestamp,name,type,parameters\n'], 'actions.csv') },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  }
});
it('CSV сообщает номер строки, если поправка выводит её дату за календарные границы', async () => {
  const file = new File(
    ['timestamp,name,type,parameters\n9999-12-31T23:59:59Z,Команда,setpoint,21\n'],
    'actions.csv',
  );
  const result = await api.importActions(
    { projectId, timeZone: 'UTC', offsetNanoseconds: '1000000000' },
    { file },
  );
  expect(result).toMatchObject({
    imported: 0,
    partial: true,
    errors: [{ row: 2, reason: expect.stringContaining('календарный диапазон') }],
  });
});
