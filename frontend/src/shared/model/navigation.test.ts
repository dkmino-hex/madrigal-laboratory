import { it, expect } from 'vitest';
import { goldenLocation } from '../../mocks/fixtures/corpus';
import { decimal } from './precision';
import { readLocation, sameContext, sourceLink, safeReturnPath } from './navigation';
it.each(['9007199254740991', '9007199254740992', '9007199254740993'])(
  'URL восстанавливает точную координату %s',
  (value) => {
    const location = { ...goldenLocation, start: decimal(value) };
    const link = sourceLink(location, { runId: 'old-run', revisionId: 'old-revision' });
    expect(
      readLocation(new URL(link, 'http://localhost').searchParams, location.projectId),
    ).toEqual(location);
    expect(link).toContain(value);
    expect(link).toContain('old-run');
  },
);
it('не подставляет сборку при неполной исторической ссылке', () =>
  expect(() =>
    readLocation(new URLSearchParams({ assemblyId: 'old', start: '1e20' }), 'p'),
  ).toThrow());
it('не переназначает источник из URL другому проекту', () =>
  expect(() => readLocation(new URLSearchParams(goldenLocation), 'other')).toThrow(
    /другому проекту/,
  ));
it('различает поток, проект, направление и сборку', () => {
  for (const key of ['projectId', 'streamId', 'assemblyId', 'captureId', 'sessionId'] as const)
    expect(sameContext(goldenLocation, { ...goldenLocation, [key]: 'other' })).toBe(false);
  expect(sameContext(goldenLocation, { ...goldenLocation, direction: 'B_TO_A' })).toBe(false);
});
it('проверяет локальный контекст возврата', () => {
  expect(safeReturnPath('/projects/demo-laboratory/runs/old', 'demo-laboratory')).not.toBeNull();
  expect(safeReturnPath('//evil.example', 'demo-laboratory')).toBeNull();
  expect(safeReturnPath('/projects/other/actions', 'demo-laboratory')).toBeNull();
});
it('пустая явно заданная сборка не превращается в автоматический выбор', () => {
  const params = new URLSearchParams(goldenLocation);
  params.set('assemblyId', '');
  expect(() => readLocation(params, goldenLocation.projectId)).toThrow();
});
it('контекст возврата не выходит в другой проект через dot segments', () => {
  expect(safeReturnPath('/projects/demo-laboratory/../other/runs', 'demo-laboratory')).toBeNull();
  expect(
    safeReturnPath('/projects/demo-laboratory/%2e%2e/other/runs', 'demo-laboratory'),
  ).toBeNull();
});
