// @vitest-environment node
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { handlers, sourceRanges, validateDraft } from './handlers';
import { resetState, initialState, addJob, settleJob, loadState } from './state';
import {
  goldenLocation,
  projectId,
  schemaText,
  fixtureWindow,
  fixtureByte,
  scenarioNames,
} from './fixtures/corpus';
import { config } from '../app/config';
import { api } from '../shared/api/client';
import { decimal } from '../shared/model/precision';
import { queryKey } from '../shared/api/query';
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  config.mode = 'mock';
  resetState();
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
describe('Клиент → transport → MSW → DTO', () => {
  it('неоднозначный результат сохраняет обе альтернативы и исходные кадры', async () => {
    const results = await api.results({ projectId, runId: 'run-baseline', status: 'INCONCLUSIVE' });
    const result = results.items[0]!;
    expect(result.sources.map((source) => source.packetNo)).toEqual([10, 11]);
    expect(result.sources.every((source) => source.relation === 'conflict-alternative')).toBe(true);
    for (const source of result.sources) {
      const packet = await api.packet({
        projectId,
        captureId: source.captureId,
        packetNo: source.packetNo,
      });
      const frameStart = Number(source.frameOffset);
      expect(packet.bytes.slice(frameStart, frameStart + 4)).toEqual(
        source.packetNo === 10 ? [0x10, 0x11, 0x12, 0x13] : [0x20, 0x21, 0x22, 0x23],
      );
    }
  });
  it('выполняет вертикальный путь проектов и записей', async () => {
    const projects = await api.projects();
    expect(projects.items[0]!.projectId).toBe(projectId);
    const project = await api.project(projectId);
    expect(project.status).toBe('READY');
    const captures = await api.captures({ projectId });
    expect(captures.items).toHaveLength(6);
    const sessions = await api.sessions({ projectId, captureId: captures.items[0]!.captureId });
    expect(sessions.items.map((item) => item.generation)).toEqual([1, 2]);
  });
  it('технический fixture и неподготовленные оси не получают выдуманный анализ', async () => {
    for (const location of [
      {
        ...goldenLocation,
        captureId: 'capture-precision-fixture2',
        sessionId: 'session-precision-fixture2-1',
        streamId: 'stream-precision-fixture2-a',
        assemblyId: 'assembly-precision-fixture2-v1',
      },
      {
        ...goldenLocation,
        direction: 'B_TO_A',
        streamId: 'stream-baseline-fixture2-b',
        assemblyId: 'assembly-baseline-fixture2-b-v1',
      },
      {
        ...goldenLocation,
        sessionId: 'session-baseline-fixture2-2',
        streamId: 'stream-baseline-fixture2-a2',
        assemblyId: 'assembly-baseline-fixture22-v1',
      },
    ])
      await expect(
        api.preview({
          projectId,
          interpretationId: 'interpretation-demo',
          revisionId: 'revision-v1',
          location,
        }),
      ).rejects.toMatchObject({ code: 'DEMO_LIMITATION' });
  });
  it('повтор создания с одним ключом не создаёт дубликат', async () => {
    const options = { idempotencyKey: 'stable-request' };
    const input = { name: 'Проект', description: 'Тест' };
    const a = await api.createProject(input, options);
    const b = await api.createProject(input, options);
    expect(a.projectId).toBe(b.projectId);
    expect(loadState().projects.filter((item) => item.name === 'Проект')).toHaveLength(1);
    await expect(
      api.createProject({ ...input, name: 'Другое тело' }, options),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', httpStatus: 409 });
  });
  it('передаёт огромные offset без округления', async () => {
    const base = {
      ...goldenLocation,
      captureId: 'capture-precision-fixture2',
      sessionId: 'session-precision-fixture2-1',
      streamId: 'stream-precision-fixture2-a',
      assemblyId: 'assembly-precision-fixture2-v1',
      length: decimal('4'),
    };
    for (const start of ['9007199254740991', '9007199254740992', '9007199254740993']) {
      const response = await api.bytes({ ...base, start: decimal(start) });
      expect(response.location.start).toBe(start);
    }
  });
  it('не смешивает keys проекта, сборки, диапазона, ревизии и фильтров', () => {
    const a = queryKey('p', 'bytes', { ...goldenLocation });
    expect(queryKey('q', 'bytes', { ...goldenLocation })).not.toEqual(a);
    expect(queryKey('p', 'bytes', { ...goldenLocation, assemblyId: 'new' })).not.toEqual(a);
    expect(queryKey('p', 'bytes', { ...goldenLocation, start: '1001' })).not.toEqual(a);
    expect(
      queryKey('p', 'results', { runId: 'old', revisionId: 'r1', status: 'FAIL' }),
    ).not.toEqual(queryKey('p', 'results', { runId: 'old', revisionId: 'r2', status: 'PASS' }));
  });
  it('проверяет контекст bytes, не доверяя одному структурному DTO', async () => {
    server.use(
      http.get('*/__madrigal_mock/v1/bytes', () =>
        HttpResponse.json({
          data: fixtureWindow({ ...goldenLocation, assemblyId: 'other' }, '65536'),
        }),
      ),
    );
    await expect(api.bytes(goldenLocation)).rejects.toMatchObject({
      code: 'INCOMPATIBLE_RESPONSE',
    });
  });
  it('не допускает скрытый пропуск между сегментами', async () => {
    const data = fixtureWindow(goldenLocation, '65536');
    data.segments[0]!.start = decimal('1001');
    server.use(http.get('*/__madrigal_mock/v1/bytes', () => HttpResponse.json({ data })));
    await expect(api.bytes(goldenLocation)).rejects.toMatchObject({
      code: 'INCOMPATIBLE_RESPONSE',
    });
  });
  it('старый или чужой источник не заменяется похожим диапазоном', async () => {
    await expect(api.bytes({ ...goldenLocation, assemblyId: 'missing' })).rejects.toMatchObject({
      code: 'ASSEMBLY_UNAVAILABLE',
    });
    await expect(api.bytes({ ...goldenLocation, projectId: 'demo-error' })).rejects.toMatchObject({
      code: 'PROJECT_NOT_READY',
    });
  });
  it('источник начинается с packetNo=1 и frameOffset задан Capture', async () => {
    const sources = await api.sources({
      ...goldenLocation,
      start: decimal('0'),
      length: decimal('4'),
    });
    expect(sources[0]).toMatchObject({ packetNo: 1, frameOffset: '54' });
    const packet = await api.packet({
      projectId,
      captureId: 'capture-baseline-fixture2',
      packetNo: 1,
    });
    expect(packet.bytes[54]).toBe(3);
  });
  it('сохраняет обе альтернативы конфликта и три golden источника', async () => {
    expect(await api.sources(goldenLocation)).toHaveLength(3);
    const sources = sourceRanges({ ...goldenLocation, start: decimal('96'), length: decimal('4') });
    expect(sources.map((item) => item.packetNo)).toEqual([10, 11]);
    expect(sources.every((item) => item.relation === 'conflict-alternative')).toBe(true);
  });
  it('серверный поиск пагинируется и не склеивает дефект', async () => {
    const response = await api.search({ ...goldenLocation, mode: 'HEX', pattern: '15 00 00 00' });
    expect(response.items.some((item) => item.start === '1000')).toBe(true);
    expect(response.complete).toBe(false);
    expect(response.nextCursor).not.toBeNull();
    await expect(
      api.search({ ...goldenLocation, mode: 'HEX', pattern: 'F' }),
    ).rejects.toMatchObject({ code: 'INVALID_PATTERN' });
  });
  it('ручная связь сохраняет точную сборку и оценку исследователя', async () => {
    const result = await api.saveEvidence(
      {
        projectId,
        actionId: 'action-21',
        location: goldenLocation,
        basis: 'Наблюдение',
        status: 'confirmed',
        kind: 'support',
      },
      { idempotencyKey: 'evidence-key' },
    );
    expect(result.sources).toHaveLength(3);
    expect(result.location.length).toBe('4');
    expect(
      (await api.evidence({ projectId, actionId: 'action-21' })).items.find(
        (item) => item.evidenceId === result.evidenceId,
      )?.status,
    ).toBe('confirmed');
  });
  it('контрпример и поддерживающий пример сохраняются при редактировании гипотезы', async () => {
    const original = (await api.hypotheses({ projectId })).items[0]!;
    await api.saveHypothesis({ ...original, text: 'Уточнённая формулировка', status: 'refuted' });
    const found = (await api.hypotheses({ projectId })).items[0]!;
    expect(found.evidence.map((item) => item.kind)).toEqual(['support', 'counterexample']);
    expect(found.status).toBe('refuted');
  });
  it('ошибка схемы содержит путь; неизвестные поля не уничтожаются', () => {
    const object = JSON.parse(schemaText) as { framing: { length: number }; extensions: unknown };
    object.framing.length = 0;
    try {
      validateDraft(JSON.stringify(object));
      throw new Error('Должно быть отклонено');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'SCHEMA_VALIDATION',
        details: expect.arrayContaining([expect.objectContaining({ path: 'framing.length' })]),
      });
    }
    expect(validateDraft(schemaText).extensions).toBeDefined();
  });
  it('новая ревизия не меняет старый JSON, manifest и гипотезу', async () => {
    const before = await api.run(projectId, 'run-baseline');
    const original = (await api.interpretation(projectId, 'interpretation-demo')).revisions[0]!
      .json;
    const json = original.replace('"30"', '"60"');
    const saved = await api.saveRevision(
      { projectId, interpretationId: 'interpretation-demo', json, parentRevisionId: 'revision-v1' },
      { idempotencyKey: 'revision-key' },
    );
    expect(saved.revisionId).not.toBe('revision-v1');
    expect((await api.interpretation(projectId, 'interpretation-demo')).revisions[0]!.json).toBe(
      original,
    );
    expect((await api.run(projectId, 'run-baseline')).manifest).toEqual(before.manifest);
    expect((await api.hypotheses({ projectId })).items[0]!.status).toBe('open');
  });
  it('preview использует сохранённую ревизию и ограничение', async () => {
    const preview = await api.preview({
      projectId,
      interpretationId: 'interpretation-demo',
      revisionId: 'revision-v1',
      location: goldenLocation,
    });
    expect(preview.results[0]!.fields[0]!.sources).toHaveLength(3);
    await expect(
      api.preview({
        projectId,
        interpretationId: 'interpretation-demo',
        revisionId: 'unsaved',
        location: goldenLocation,
      }),
    ).rejects.toMatchObject({ code: 'REVISION_UNAVAILABLE' });
    await expect(
      api.preview({
        projectId,
        interpretationId: 'interpretation-demo',
        revisionId: 'revision-v1',
        location: { ...goldenLocation, length: '4097' },
      }),
    ).rejects.toMatchObject({ code: 'PREVIEW_LIMIT' });
  });
  it('сводка и результаты всех пяти статусов согласованы', async () => {
    const run = await api.run(projectId, 'run-baseline');
    const results = (await api.results({ projectId, runId: run.runId })).items;
    expect(results).toHaveLength(Number(BigInt(run.summary.messages)));
    for (const [status, count] of Object.entries(run.summary.rules))
      expect(results.filter((item) => item.status === status).length).toBe(Number(BigInt(count)));
  });
  it('создание run идемпотентно, уточнение 60 убирает FAIL и сохраняет UNKNOWN', async () => {
    const rev = await api.saveRevision({
      projectId,
      interpretationId: 'interpretation-demo',
      json: schemaText.replace('"30"', '"60"'),
    });
    const input = {
      projectId,
      interpretationId: 'interpretation-demo',
      revisionId: rev.revisionId,
      settingsVersion: 'settings-v1',
      corpus: [
        { captureId: 'capture-baseline-fixture2', assemblyId: 'assembly-baseline-fixture2-v1' },
      ],
      filters: 'Все',
    };
    const a = await api.createRun(input, { idempotencyKey: 'run-key' });
    const b = await api.createRun(input, { idempotencyKey: 'run-key' });
    expect(a.run?.runId).toBe(b.run?.runId);
    expect(a.job.jobId).toBe(b.job.jobId);
    expect(a.run?.summary.rules.FAIL).toBe('0');
    expect(a.run?.summary.rules.UNKNOWN).toBe('1');
  });
  it('несовпадение имени не является дубликатом; arbitrary PCAP честно ограничен', async () => {
    await expect(
      api.uploadCapture({ projectId }, { file: new File(['unknown'], 'test.pcap') }),
    ).rejects.toMatchObject({ code: 'DEMO_LIMITATION' });
  });
  it('HTML имеет отдельный транспортный код', async () => {
    server.use(
      http.get(
        '*/__madrigal_mock/v1/bytes',
        () => new HttpResponse('<html>', { headers: { 'Content-Type': 'text/html' } }),
      ),
    );
    await expect(api.bytes(goldenLocation)).rejects.toMatchObject({ code: 'UNEXPECTED_CONTENT' });
  });
  it('неизвестное задание явно недоступно', async () => {
    await expect(api.job(projectId, 'ana_missing')).rejects.toMatchObject({
      code: 'JOB_UNAVAILABLE',
    });
  });
  it('смешанный диапазон не теряет известные источники из-за соседнего пропуска', () => {
    const sources = sourceRanges({
      ...goldenLocation,
      start: decimal('0'),
      length: decimal('128'),
    });
    expect(sources.some((item) => item.packetNo === 1)).toBe(true);
    expect(sources.filter((item) => item.relation === 'conflict-alternative')).toHaveLength(2);
    expect(
      sourceRanges({ ...goldenLocation, start: decimal('97'), length: decimal('2') }).every(
        (item) => item.frameOffset === '55' && item.length === '2',
      ),
    ).toBe(true);
  });
  it('поиск не теряет совпадение через границу страницы', async () => {
    const pattern = Array.from({ length: 4 }, (_, index) =>
      fixtureByte(4094n + BigInt(index))
        .toString(16)
        .padStart(2, '0'),
    ).join(' ');
    const first = await api.search({ ...goldenLocation, mode: 'HEX', pattern, cursor: '1' });
    const next = await api.search({
      ...goldenLocation,
      mode: 'HEX',
      pattern,
      cursor: first.nextCursor!,
    });
    expect(first.items.some((item) => item.start === '4094')).toBe(false);
    expect(first.nextCursor).toBe('4094');
    expect(next.items.some((item) => item.start === '4094')).toBe(true);
  });
  it('временной фильтр сравнивает скорректированные наносекунды и timezone', async () => {
    loadState().actions.push({
      ...loadState().actions[0]!,
      actionId: 'action-offset',
      timestamp: '2026-10-11T15:34:56.123456790+03:00',
      offsetNanoseconds: '-2',
    });
    const rows = await api.actions({
      projectId,
      from: '2026-10-11T12:34:56.123456788Z',
      to: '2026-10-11T15:34:56.123456788+03:00',
    });
    expect(rows.items.map((item) => item.actionId)).toEqual(['action-offset']);
  });
  it('запрос отчёта и экспорта закрепляет снимок и идемпотентен', async () => {
    const one = await api.createReport(projectId, 'run-baseline', { idempotencyKey: 'report-key' });
    const two = await api.createReport(projectId, 'run-baseline', { idempotencyKey: 'report-key' });
    expect(one.artifact!.artifactId).toBe(two.artifact!.artifactId);
    expect(loadState().snapshots[one.artifact!.artifactId]).toBeDefined();
    const exportOne = await api.exportProject(projectId, { idempotencyKey: 'export-key' });
    expect((await api.exportProject(projectId, { idempotencyKey: 'export-key' })).job.jobId).toBe(
      exportOne.job.jobId,
    );
  });
});
describe('Управляемое время заданий', () => {
  it.each(['Capture', 'Analysis', 'Workspace'] as const)(
    'очередь, выполнение и завершение владельца %s',
    (owner) => {
      vi.spyOn(Date, 'now').mockReturnValue(1000);
      const state = initialState();
      const job = addJob(state, projectId, owner);
      expect(job.status).toBe('QUEUED');
      expect(settleJob(state, job, 1600).status).toBe('RUNNING');
      expect(settleJob(state, job, 4000).status).toBe('COMPLETED');
    },
  );
  it('неопределённый total и ошибка сервиса остаются явными', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const state = initialState();
    const job = addJob(state, projectId, 'Workspace', undefined, null);
    job.diagnostic = 'Неверный хеш';
    expect(job.total).toBeNull();
    expect(settleJob(state, job, 3000).status).toBe('FAILED');
  });
  it('запрос отмены ещё не равен отмене; гонка завершения учитывается', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const state = initialState();
    const cancelled = addJob(state, projectId, 'Analysis');
    cancelled.status = 'CANCEL_REQUESTED';
    expect(settleJob(state, cancelled, 500).status).toBe('CANCELLED');
    const completed = addJob(state, projectId, 'Analysis');
    completed.status = 'CANCEL_REQUESTED';
    expect(settleJob(state, completed, 3000).status).toBe('COMPLETED');
  });
  it('список обязательных сценариев закреплён', () => expect(scenarioNames).toHaveLength(20));
  it('прерванный сервис не становится завершённым при следующем чтении', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const state = initialState();
    const job = addJob(state, projectId, 'Analysis');
    state.clock[job.jobId + ':interrupt'] = 1;
    expect(settleJob(state, job, 1500).status).toBe('INTERRUPTED');
    expect(settleJob(state, job, 10000).status).toBe('INTERRUPTED');
  });
});
