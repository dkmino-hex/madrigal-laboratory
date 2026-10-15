import { expect, it, vi } from 'vitest';
import { decimal } from '../../model/precision';
import type { Location } from '../contracts/models';
import type { Context, Params, Wire } from './common';
import { saveEvidence } from './workspace';

function setup(
  spans: unknown[] = [
    { packetNo: 7, frameStart: '54', streamStart: '10', streamEnd: '12' },
    { packetNo: 8, frameStart: '58', streamStart: '12', streamEnd: '14' },
  ],
) {
  const location: Location = {
    projectId: 'project-manual',
    captureId: 'capture-manual',
    assemblyId: 'assembly-pinned',
    sessionId: crypto.randomUUID(),
    streamId: 'stream-manual',
    direction: 'A_TO_B',
    start: decimal('10'),
    length: decimal('4'),
  };
  const wire = vi.fn<Wire>(async (operation, input) => {
    if (operation === 'captures')
      return { items: [{ captureId: location.captureId, sha256: 'a'.repeat(64) }] };
    if (operation === 'session')
      return {
        ...location,
        streams: [{ streamId: location.streamId, direction: location.direction }],
      };
    if (operation === 'sources')
      return { assemblyId: location.assemblyId, streamId: location.streamId, sources: spans };
    if (operation === 'saveEvidence' || operation === 'patchEvidence')
      return { ...input, evidenceId: input.evidenceId ?? 'evidence-saved' };
    throw new Error('Unexpected operation: ' + operation);
  });
  const ctx: Context = { wire, options: { idempotencyKey: 'manual-request' } };
  const input: Params = {
    projectId: location.projectId,
    location,
    actionId: 'action-manual',
    basis: 'Изменение температуры',
    kind: 'support',
    status: 'tentative',
  };
  return { location, ctx, wire, input };
}

it('ручная связь без sources получает SourceMap закреплённого диапазона перед сохранением', async () => {
  const { location, ctx, wire, input } = setup();
  const saved = (await saveEvidence(ctx, input)) as Params;
  expect(wire).toHaveBeenCalledWith(
    'sources',
    {
      projectId: location.projectId,
      assemblyId: location.assemblyId,
      streamId: location.streamId,
      offset: '10',
      length: '4',
    },
    ctx.options,
  );
  expect(saved.sources).toEqual([
    {
      captureId: location.captureId,
      packetNo: 7,
      frameOffset: '54',
      streamStart: '10',
      length: '2',
      relation: 'primary',
    },
    {
      captureId: location.captureId,
      packetNo: 8,
      frameOffset: '58',
      streamStart: '12',
      length: '2',
      relation: 'primary',
    },
  ]);
  expect(wire.mock.calls.at(-1)).toEqual([
    'saveEvidence',
    { ...input, sources: saved.sources, captureSha256: 'a'.repeat(64) },
    ctx.options,
  ]);
});

it('редактирование связи сохраняет прежние источники без повторного выбора сборки', async () => {
  const { ctx, wire, input, location } = setup();
  const proof = [
    {
      captureId: location.captureId,
      packetNo: 7,
      frameOffset: '54',
      streamStart: '10',
      length: '4',
      relation: 'primary',
    },
  ];
  await saveEvidence(ctx, { ...input, evidenceId: 'evidence-pinned', sources: proof });
  expect(wire.mock.calls.map(([operation]) => operation)).toEqual(['captures', 'patchEvidence']);
  expect(wire.mock.calls.at(-1)?.[1]).toMatchObject({
    evidenceId: 'evidence-pinned',
    sources: proof,
  });
});

it('диапазон без исходных пакетов поясняет причину и не отправляет пустую связь', async () => {
  const { ctx, wire, input } = setup([]);
  await expect(saveEvidence(ctx, input)).rejects.toMatchObject({
    code: 'SOURCE_UNAVAILABLE',
    message: expect.stringContaining('исходных пакетов'),
  });
  expect(wire.mock.calls.some(([operation]) => operation === 'saveEvidence')).toBe(false);
});

it('ошибка SourceMap не приводит к сохранению неполной связи', async () => {
  const { ctx, wire, input } = setup();
  const original = ctx.wire;
  ctx.wire = async (operation, params, options) => {
    if (operation === 'sources') throw new Error('SourceMap недоступен');
    return original(operation, params, options);
  };
  await expect(saveEvidence(ctx, input)).rejects.toThrow('SourceMap недоступен');
  expect(wire.mock.calls.some(([operation]) => operation === 'saveEvidence')).toBe(false);
});
