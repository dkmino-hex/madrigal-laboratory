// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers, sourceRanges } from './handlers';
import { initialState, loadState, migrateDemoState, resetState } from './state';
import { assembliesFor, fixtureByte, fixturePacket, goldenLocation } from './fixtures/corpus';
import { schemaText } from './fixtures/corpus';
import { api } from '../shared/api/client';
import { config } from '../app/config';
import { decimal } from '../shared/model/precision';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  config.mode = 'mock';
  resetState();
});
afterEach(() => server.resetHandlers());

it('preview другой модели возвращает её ID поля вместо фиксированного ID первого шаблона', async () => {
  const model = await api.createInterpretation({
    projectId: goldenLocation.projectId,
    name: 'Модель другого поля',
  });
  const revision = await api.saveRevision({
    projectId: goldenLocation.projectId,
    interpretationId: model.interpretationId,
    json: schemaText.replace('"setpoint"', '"alternate"'),
  });
  const preview = await api.preview({
    projectId: goldenLocation.projectId,
    interpretationId: model.interpretationId,
    revisionId: revision.revisionId,
    location: goldenLocation,
  });
  expect(preview.results[0]!.fields[0]!.fieldId).toBe('alternate');
  expect(preview.results[0]!.fields[0]!.value).toBe('21');
});

it('полный пример из двух сообщений имеет непрерывную карту каждого кадра и совпадающие raw bytes', async () => {
  const location = { ...goldenLocation, length: decimal('8') };
  const sources = await api.sources(location);
  const deltas = new Map<number, Set<string>>();
  for (const source of sources) {
    const packet = await api.packet({
      projectId: location.projectId,
      captureId: source.captureId,
      packetNo: source.packetNo,
    });
    const bytes = packet.bytes.slice(
      Number(source.frameOffset),
      Number(BigInt(source.frameOffset) + BigInt(source.length)),
    );
    expect(bytes).toEqual(
      Array.from({ length: Number(source.length) }, (_, index) =>
        fixtureByte(BigInt(source.streamStart) + BigInt(index), source.captureId),
      ),
    );
    const offsets = deltas.get(source.packetNo) ?? new Set<string>();
    offsets.add(String(BigInt(source.frameOffset) - BigInt(source.streamStart)));
    deltas.set(source.packetNo, offsets);
  }
  expect([...deltas.values()].every((offsets) => offsets.size === 1)).toBe(true);
  expect(
    sources
      .filter((source) => source.relation === 'primary')
      .reduce((sum, source) => sum + BigInt(source.length), 0n),
  ).toBe(8n);
  expect(sources.some((source) => source.relation === 'retransmission')).toBe(true);
});

it('новая fixture не переписывает исходные байты старого captureId', () => {
  expect(fixturePacket('capture-baseline', 8).bytes.slice(66, 74)).toEqual([
    0, 0, 220, 227, 42, 0, 0, 0,
  ]);
  expect(fixturePacket(goldenLocation.captureId, 8).bytes.slice(66, 72)).toEqual([
    0, 0, 42, 0, 0, 0,
  ]);
  expect(goldenLocation.captureId).not.toBe('capture-baseline');
});

it('packet DTO принимает полный кадр больше окна HEX и сохраняет его выделение', async () => {
  const captureId = 'capture-large-frame-fixture2';
  const packet = await api.packet({ projectId: goldenLocation.projectId, captureId, packetNo: 1 });
  expect(packet.bytes).toHaveLength(65536);
  expect(packet.capturedLength).toBe('65536');
  expect(packet.bytes.slice(60000, 60008)).toEqual([21, 0, 0, 0, 42, 0, 0, 0]);
});

it('все 125 источников доступны и ретрансляции не увеличивают логический диапазон', async () => {
  const location = {
    ...goldenLocation,
    captureId: 'capture-many-sources-fixture2',
    sessionId: 'session-many-sources-fixture2-1',
    streamId: 'stream-many-sources-fixture2-a',
    assemblyId: 'assembly-many-sources-fixture2-v1',
  };
  const sources = await api.sources(location);
  expect(sources).toHaveLength(125);
  expect(
    sources
      .filter((source) => source.relation === 'primary')
      .reduce((sum, source) => sum + BigInt(source.length), 0n),
  ).toBe(4n);
  for (const source of sources)
    expect(
      fixturePacket(source.captureId, source.packetNo).bytes.slice(
        Number(source.frameOffset),
        Number(source.frameOffset) + Number(source.length),
      ),
    ).toEqual([21, 0, 0, 0]);
});

it('перенос demo-state v1 сохраняет пользовательские записи и добавляет отдельные новые capture', () => {
  const legacy = {
    ...initialState(),
    version: 1,
    captures: [
      { ...initialState().captures[0]!, captureId: 'capture-baseline', sha256: 'old-sha' },
    ],
  };
  legacy.projects[0]!.captures = 1;
  legacy.evidence[0]!.basis = 'Пользовательское основание';
  const before = structuredClone(legacy);
  const migrated = migrateDemoState(legacy);
  expect(migrated.version).toBe(2);
  expect(migrated.evidence).toEqual(before.evidence);
  expect(migrated.runs).toEqual(before.runs);
  expect(migrated.captures.find((capture) => capture.captureId === 'capture-baseline')).toEqual(
    before.captures[0],
  );
  expect(migrated.captures.some((capture) => capture.captureId === goldenLocation.captureId)).toBe(
    true,
  );
  expect(migrated.projects[0]!.captures).toBe(7);
  expect(migrateDemoState(migrated)).toEqual(migrated);
  expect(legacy).toEqual(before);
});

it.each(['direction', 'generation'])(
  'SourceMap не подставляет кадры другой сессии: %s',
  async (axis) => {
    const sessionId =
      axis === 'generation'
        ? goldenLocation.sessionId.replace(/-1$/, '-2')
        : goldenLocation.sessionId;
    const assembly = assembliesFor(goldenLocation.captureId, sessionId).find(
      (item) =>
        item.status === 'READY' && item.direction === (axis === 'direction' ? 'B_TO_A' : 'A_TO_B'),
    )!;
    await expect(
      api.sources({
        ...goldenLocation,
        sessionId,
        streamId: assembly.streamId,
        assemblyId: assembly.assemblyId,
        direction: assembly.direction,
      }),
    ).rejects.toMatchObject({ code: 'DEMO_LIMITATION' });
  },
);

it('техническая precision fixture не выдаёт источники обычного capture', () => {
  expect(sourceRanges({ ...goldenLocation, streamId: 'stream-precision-fixture2-a' })).toEqual([]);
});

it('редактирование основания сохраняет ID, источник, количество связей и прежние снимки', async () => {
  const state = loadState();
  const original = structuredClone(state.evidence[0]!);
  const hypothesisSnapshot = structuredClone(state.hypotheses[0]!);
  state.snapshots['saved-report'] = { evidence: [structuredClone(original)] };
  const params = {
    ...original,
    projectId: original.location.projectId,
    basis: 'Основание уточнено вручную',
    status: 'confirmed',
  };
  const result = await api.saveEvidence(params, { idempotencyKey: 'edit-evidence-once' });
  const retry = await api.saveEvidence(params, { idempotencyKey: 'edit-evidence-once' });
  expect(result.evidenceId).toBe(original.evidenceId);
  expect(result.location).toEqual(original.location);
  expect(result.sources).toEqual(original.sources);
  expect(retry).toEqual(result);
  expect(loadState().evidence).toHaveLength(1);
  expect(loadState().hypotheses[0]).toEqual(hypothesisSnapshot);
  expect(loadState().snapshots['saved-report']).toEqual({ evidence: [original] });
});

it('редактирование не позволяет перепривязать историческую связь к новому диапазону', async () => {
  const original = structuredClone(loadState().evidence[0]!);
  await expect(
    api.saveEvidence({
      ...original,
      projectId: original.location.projectId,
      location: { ...original.location, start: decimal('1004') },
    }),
  ).rejects.toMatchObject({ code: 'IMMUTABLE_SOURCE' });
  expect(loadState().evidence[0]).toEqual(original);
});

it('чужая сохранённая связь не превращается в новую запись текущего проекта', async () => {
  const original = loadState().evidence[0]!;
  await expect(
    api.saveEvidence({
      ...original,
      projectId: 'demo-importing',
      basis: 'Изменение чужого проекта',
    }),
  ).rejects.toMatchObject({ code: 'EVIDENCE_UNAVAILABLE' });
  expect(loadState().evidence).toHaveLength(1);
});

it('основание исторической связи можно уточнить без подстановки доступной assembly', async () => {
  const original = loadState().evidence[0]!;
  original.location.assemblyId = 'retired-assembly';
  const result = await api.saveEvidence({
    ...original,
    projectId: original.location.projectId,
    basis: 'Историческое уточнение',
  });
  expect(result.location.assemblyId).toBe('retired-assembly');
  expect(result.sources).toEqual(original.sources);
});
