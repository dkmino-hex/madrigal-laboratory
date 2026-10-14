import { afterEach, it, expect, vi } from 'vitest';
import { config } from '../../app/config';
import { api } from './client';
import { initialState } from '../../mocks/state';
import { goldenLocation, fixtureWindow, resultsFor } from '../../mocks/fixtures/corpus';

afterEach(() => vi.restoreAllMocks());
const respond = (data: unknown) => {
  config.mode = 'mock';
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data }));
};

it('другой projectId в DTO не попадает в контекст текущего проекта', async () => {
  respond({ ...initialState().projects[0]!, projectId: 'other-project' });
  await expect(api.project(goldenLocation.projectId)).rejects.toMatchObject({
    code: 'INCOMPATIBLE_RESPONSE',
  });
});
it('другой runId в DTO не подменяет исторический запуск', async () => {
  respond({ ...initialState().runs[0]!, runId: 'other-run' });
  await expect(api.run(goldenLocation.projectId, 'run-baseline')).rejects.toMatchObject({
    code: 'INCOMPATIBLE_RESPONSE',
  });
});
it('другой jobId/projectId не связывается с локально отслеживаемым заданием', async () => {
  respond(initialState().jobs[0]!);
  await expect(api.job(goldenLocation.projectId, 'ana_requested')).rejects.toMatchObject({
    code: 'INCOMPATIBLE_RESPONSE',
  });
});
it.each(['revision', 'location'])('preview отклоняет несовпадающий %s', async (axis) => {
  respond({
    revisionId: axis === 'revision' ? 'other-revision' : 'revision-v1',
    location: {
      ...goldenLocation,
      assemblyId: axis === 'location' ? 'other-assembly' : goldenLocation.assemblyId,
    },
    results: [],
    unknown: [],
    complete: true,
  });
  await expect(
    api.preview({
      projectId: goldenLocation.projectId,
      interpretationId: 'interpretation-demo',
      revisionId: 'revision-v1',
      location: goldenLocation,
    }),
  ).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
});
it('полное окно bytes не может выходить за заявленную длину потока', async () => {
  respond({ ...fixtureWindow(goldenLocation, '65536'), streamLength: '1003' });
  await expect(api.bytes(goldenLocation)).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
});
it('страница capture не принимает запись другого проекта', async () => {
  respond({
    items: [{ ...initialState().captures[0]!, projectId: 'other-project' }],
    nextCursor: null,
  });
  await expect(api.captures({ projectId: goldenLocation.projectId })).rejects.toMatchObject({
    code: 'INCOMPATIBLE_RESPONSE',
  });
});
it('результат не может направлять поле в другой проект', async () => {
  const result = resultsFor(goldenLocation.projectId)[0]!;
  result.fields[0]!.location = { ...result.location, projectId: 'other-project' };
  respond({ items: [result], nextCursor: null });
  await expect(
    api.results({ projectId: goldenLocation.projectId, runId: 'run-baseline' }),
  ).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
});
