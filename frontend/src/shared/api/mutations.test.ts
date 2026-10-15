import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { config } from '../../app/config';
import { initialState } from '../../mocks/state';
import { goldenLocation, goldenSources, schemaText } from '../../mocks/fixtures/corpus';
import { decimal } from '../model/precision';
import type { Job } from './contracts/models';

beforeEach(() => {
  config.mode = 'mock';
});
afterEach(() => vi.restoreAllMocks());
const respond = (data: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data }));
const job: Job = {
  projectId: goldenLocation.projectId,
  jobId: 'ana_new',
  owner: 'Analysis',
  status: 'QUEUED',
  stage: 'В очереди',
  completed: decimal('0'),
  total: null,
  unit: 'сообщений',
};

it('сохранение ревизии не принимает ID другой интерпретации', async () => {
  const revision = initialState().interpretations[0]!.revisions[0]!;
  respond({ ...revision, interpretationId: 'other-model' });
  await expect(
    api.saveRevision({
      projectId: goldenLocation.projectId,
      interpretationId: revision.interpretationId,
      json: schemaText,
    }),
  ).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
});
it('правильный ID модели не маскирует чужую вложенную ревизию', async () => {
  const model = initialState().interpretations[0]!;
  model.revisions[0]!.interpretationId = 'other-model';
  respond(model);
  await expect(api.interpretation(model.projectId, model.interpretationId)).rejects.toMatchObject({
    code: 'INCOMPATIBLE_RESPONSE',
  });
});
it('создание модели отклоняет ответ другого проекта', async () => {
  respond({ ...initialState().interpretations[0]!, projectId: 'other-project' });
  await expect(
    api.createInterpretation({ projectId: goldenLocation.projectId, name: 'Моя модель' }),
  ).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
});
it('сохранение связи не принимает подменённый диапазон', async () => {
  const evidence = initialState().evidence[0]!;
  respond({ ...evidence, location: { ...evidence.location, start: decimal('1004') } });
  await expect(
    api.saveEvidence({ ...evidence, projectId: goldenLocation.projectId }),
  ).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
});
it('сохранение гипотезы отклоняет чужие кадры внутри правильного проекта', async () => {
  const hypothesis = initialState().hypotheses[0]!;
  hypothesis.evidence[0]!.sources[0]!.captureId = 'other-capture';
  respond(hypothesis);
  await expect(api.saveHypothesis({ ...hypothesis })).rejects.toMatchObject({
    code: 'INCOMPATIBLE_RESPONSE',
  });
});
it.each(['project', 'owner', 'revision', 'corpus'])(
  'создание run отклоняет подмену %s',
  async (axis) => {
    const run = initialState().runs[0]!;
    const params = {
      projectId: run.projectId,
      interpretationId: 'interpretation-demo',
      revisionId: run.manifest.revisionId,
      settingsVersion: run.manifest.settingsVersion,
      corpus: structuredClone(run.manifest.corpus),
    };
    const responseJob = { ...job };
    if (axis === 'project') responseJob.projectId = 'other-project';
    if (axis === 'owner') responseJob.owner = 'Workspace';
    if (axis === 'revision') run.manifest.revisionId = 'other-revision';
    if (axis === 'corpus') run.manifest.corpus[0]!.assemblyId = 'other-assembly';
    respond({ job: responseJob, run });
    await expect(api.createRun(params)).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
  },
);
it('принятое задание без немедленного Run DTO остаётся валидным', async () => {
  respond({ job });
  expect(await api.createRun({ projectId: goldenLocation.projectId })).toEqual({ job });
});
it('импорт capture отклоняет задание другого проекта', async () => {
  respond({ job: { ...job, owner: 'Capture', projectId: 'other-project' } });
  await expect(
    api.uploadCapture({ projectId: goldenLocation.projectId }, {}),
  ).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
});
it('TCP SourceMap с разными линейными смещениями одного кадра не выдаётся за корректный', async () => {
  respond([
    { ...goldenSources[1]! },
    {
      ...goldenSources[1]!,
      streamStart: decimal('1004'),
      frameOffset: decimal('70'),
      length: decimal('4'),
    },
  ]);
  await expect(api.sources({ ...goldenLocation, length: decimal('8') })).rejects.toMatchObject({
    code: 'INCOMPATIBLE_RESPONSE',
  });
});
