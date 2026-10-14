import { http, HttpResponse, delay } from 'msw';
import { z } from 'zod';
import { operations, type Operation } from '../shared/api/registry';
import * as dto from '../shared/api/contracts/draft';
import {
  decimal,
  boundedIndex,
  intersect,
  timestampNanoseconds,
  shiftTimestamp,
} from '../shared/model/precision';
import { cellAt, validateSearch } from '../shared/model/bytes';
import { textError, timeOffsetInput, timeZoneError } from '../shared/model/validation';
import { schemaProblems } from '../shared/model/schema-validation';
import { addJob, loadState, nextId, saveState, settleJob, type DemoState } from './state';
import {
  assembliesFor,
  baselineRun,
  capturesFor,
  demoPcap,
  demoPcapng,
  fixedTime,
  fixturePacket,
  fixtureWindow,
  goldenSources,
  resultsFor,
  schemaText,
  sessionsFor,
} from './fixtures/corpus';

type Params = Record<string, unknown>;
const mockScenario =
  typeof window === 'undefined'
    ? 'baseline'
    : (new URLSearchParams(window.location.search).get('scenario') ?? 'baseline');
const text = (params: Params, key: string, fallback = '') =>
  typeof params[key] === 'string' ? (params[key] as string) : fallback;
const page = <T>(items: T[], params: Params) => {
  const cursor = text(params, 'cursor', '0');
  if (!/^\d{1,6}$/.test(cursor)) throw new MockError('BAD_CURSOR', 'Некорректный cursor');
  const offset = boundedIndex(BigInt(cursor), 100000);
  const limit = 20;
  return {
    items: items.slice(offset, offset + limit),
    nextCursor: offset + limit < items.length ? String(offset + limit) : null,
    total: decimal(String(items.length)),
  };
};
export class MockError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
    public status = 400,
  ) {
    super(message);
  }
}
function requireProject(state: DemoState, projectId: string, ready = false) {
  const project = state.projects.find((item) => item.projectId === projectId);
  if (!project) throw new MockError('NOT_FOUND', 'Проект недоступен', undefined, 404);
  if (ready && project.status !== 'READY')
    throw new MockError('PROJECT_NOT_READY', 'Проект ещё не готов для исследования');
  return project;
}
function requireCapture(state: DemoState, projectId: string, captureId: string) {
  requireProject(state, projectId, true);
  const capture = state.captures.find(
    (item) => item.captureId === captureId && item.projectId === projectId,
  );
  if (!capture || capture.status !== 'READY')
    throw new MockError(
      'SOURCE_UNAVAILABLE',
      'Исходная запись недоступна в этом проекте',
      undefined,
      404,
    );
  return capture;
}
function requireLocation(state: DemoState, params: Params) {
  const parsed = dto.locationSchema.safeParse(params);
  if (!parsed.success)
    throw new MockError('INVALID_LOCATION', 'Некорректные координаты', parsed.error.issues);
  const loc = parsed.data;
  requireCapture(state, loc.projectId, loc.captureId);
  const assembly = assembliesFor(loc.captureId, loc.sessionId).find(
    (item) =>
      item.assemblyId === loc.assemblyId &&
      item.streamId === loc.streamId &&
      item.direction === loc.direction,
  );
  if (!assembly || assembly.status !== 'READY')
    throw new MockError(
      'ASSEMBLY_UNAVAILABLE',
      'Указанная историческая сборка недоступна. Подстановка другой сборки запрещена.',
      undefined,
      404,
    );
  if (
    BigInt(loc.start) > BigInt(assembly.length) ||
    BigInt(loc.start) + BigInt(loc.length) > BigInt(assembly.length)
  )
    throw new MockError('RANGE_OUTSIDE_STREAM', 'Диапазон выходит за пределы этой сборки');
  return { loc, assembly };
}
export function sourceRanges(loc: dto.Location): dto.Source[] {
  if (loc.streamId.includes('precision')) return [];
  if (loc.direction !== 'A_TO_B' || !loc.sessionId.endsWith('-1'))
    throw new MockError(
      'DEMO_LIMITATION',
      'Для этого направления или поколения демо-корпус не содержит исходных кадров. Источники другой сессии не подставляются.',
    );
  const alternatives: dto.Source[] = loc.streamId.includes('precision')
    ? []
    : [10, 11].map((packetNo) => ({
        ...goldenSources[0]!,
        captureId: loc.captureId,
        packetNo,
        frameOffset: decimal('54'),
        streamStart: decimal('96'),
        length: decimal('4'),
        relation: 'conflict-alternative',
        alternativeGroupId: 'overlap-1',
      }));
  const allSources: dto.Source[] = loc.captureId.includes('large-frame')
    ? [
        {
          ...goldenSources[0]!,
          packetNo: 1,
          streamStart: decimal('1000'),
          frameOffset: decimal('60000'),
          length: decimal('8'),
        },
      ]
    : loc.captureId.includes('many-sources')
      ? Array.from({ length: 125 }, (_, index) => ({
          ...goldenSources[0]!,
          packetNo: index + 1,
          streamStart: decimal('1000'),
          frameOffset: decimal('54'),
          length: decimal('4'),
          relation: index === 0 ? 'primary' : 'retransmission',
        }))
      : [
          ...goldenSources,
          {
            ...goldenSources[1]!,
            streamStart: decimal('1004'),
            frameOffset: decimal(loc.captureId.includes('-fixture2') ? '68' : '70'),
            length: decimal('4'),
          },
          {
            ...goldenSources[0]!,
            packetNo: 1,
            streamStart: decimal('0'),
            frameOffset: decimal('54'),
            length: decimal('8'),
          },
          ...alternatives,
        ];
  return allSources.flatMap((source) => {
    const range = intersect(loc, { start: source.streamStart, length: source.length });
    return range
      ? [
          {
            ...source,
            captureId: loc.captureId,
            streamStart: range.start,
            length: range.length,
            frameOffset: decimal(
              BigInt(source.frameOffset) + BigInt(range.start) - BigInt(source.streamStart),
            ),
          },
        ]
      : [];
  });
}
const schemaValidator = z
  .object({
    format: z.literal('madrigal-demo-v1'),
    framing: z
      .object({ kind: z.literal('fixed'), length: z.number().int().min(1).max(4096) })
      .passthrough(),
    endian: z.enum(['little', 'big']),
    scope: z.object({ direction: z.enum(['A_TO_B', 'B_TO_A']) }).passthrough(),
    fields: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
            type: z.literal('uint32'),
            offset: z.string().regex(/^\d+$/),
          })
          .passthrough(),
      )
      .min(1),
    rules: z.array(
      z
        .object({ id: z.string(), field: z.string(), maximum: z.string().regex(/^\d+$/) })
        .passthrough(),
    ),
  })
  .passthrough();
export function validateDraft(json: string) {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new MockError('SCHEMA_SYNTAX', 'JSON содержит синтаксическую ошибку');
  }
  const parsed = schemaValidator.safeParse(value);
  if (!parsed.success)
    throw new MockError(
      'SCHEMA_VALIDATION',
      'Схема не поддерживается демонстрационным форматом',
      parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
    );
  const problems = schemaProblems(value);
  if (Object.keys(problems).length)
    throw new MockError(
      'SCHEMA_VALIDATION',
      'Исправьте значения полей схемы.',
      Object.entries(problems).map(([path, message]) => ({ path, message })),
    );
  return parsed.data;
}
function revision(state: DemoState, project: string, interpretationId: string, revisionId: string) {
  const interpretation = state.interpretations.find(
    (item) => item.projectId === project && item.interpretationId === interpretationId,
  );
  const found = interpretation?.revisions.find((item) => item.revisionId === revisionId);
  if (!found)
    throw new MockError('REVISION_UNAVAILABLE', 'Сохранённая ревизия недоступна', undefined, 404);
  return { interpretation: interpretation!, revision: found };
}
function seedProject(state: DemoState, project: string) {
  if (state.interpretations.some((item) => item.projectId === project)) return;
  state.interpretations.push({
    projectId: project,
    interpretationId: nextId(state, 'interpretation'),
    name: 'Рабочая модель · demo',
    revisions: [],
  });
  const interp = state.interpretations[state.interpretations.length - 1]!;
  interp.revisions.push({
    revisionId: nextId(state, 'revision'),
    interpretationId: interp.interpretationId,
    createdAt: fixedTime,
    json: schemaText,
    label: 'Синтетическая начальная модель',
  });
  state.settings[project] = [
    {
      settingsVersion: 'settings-v1',
      timeZone: 'UTC',
      offsetNanoseconds: '0',
      checksum: 'warn',
      overlap: 'preserve-alternatives',
    },
  ];
}
function requireJob(state: DemoState, projectId: string, jobId: string) {
  const job = state.jobs.find((job) => job.projectId === projectId && job.jobId === jobId);
  if (!job)
    throw new MockError(
      'JOB_UNAVAILABLE',
      'Задание недоступно после перезапуска сервиса',
      undefined,
      404,
    );
  return settleJob(state, job);
}
function preparedResults(
  state: DemoState,
  project: string,
  interpretationId: string,
  revisionId: string,
  captureId: string,
  context: Partial<dto.Location> = {},
) {
  if (
    captureId.includes('precision') ||
    captureId.includes('large-frame') ||
    captureId.includes('many-sources') ||
    (context.direction && context.direction !== 'A_TO_B') ||
    (context.sessionId && !context.sessionId.endsWith('-1'))
  )
    throw new MockError(
      'DEMO_LIMITATION',
      'Подготовленный Analysis-корпус относится к направлению A→B первого поколения. Технические демо-записи служат для HEX, точности, источников и нагрузки.',
    );
  const saved = revision(state, project, interpretationId, revisionId).revision;
  const schema = validateDraft(saved.json);
  const maximum = schema.rules[0]?.maximum ?? '30';
  if (
    !['30', '60'].includes(maximum) ||
    schema.endian !== 'little' ||
    schema.scope.direction !== 'A_TO_B' ||
    schema.framing.length !== 4 ||
    schema.fields.length !== 1 ||
    schema.rules.length !== 1 ||
    schema.rules[0]?.field !== schema.fields[0]?.name ||
    schema.fields[0]?.offset !== '0'
  )
    throw new MockError(
      'DEMO_LIMITATION',
      'Demo показывает подготовленные сценарии uint32 little-endian, размер 4, максимум 30 / 60. Произвольную схему применяет Analysis.',
    );
  const axes = Object.fromEntries(
    Object.entries(context).filter(([key]) => !['start', 'length'].includes(key)),
  ) as Partial<dto.Location>;
  return resultsFor(project, revisionId, captureId, maximum, axes).map((result) => ({
    ...result,
    rule: result.rule === 'value-bound' ? schema.rules[0]!.id : result.rule,
    fields: result.fields.map((field) => ({ ...field, fieldId: schema.fields[0]!.id })),
  }));
}
function snapshotFor(state: DemoState, projectId: string) {
  return structuredClone({
    captures: state.captures.filter((item) => item.projectId === projectId),
    actions: state.actions.filter((item) => item.projectId === projectId),
    evidence: state.evidence.filter((item) => item.location.projectId === projectId),
    hypotheses: state.hypotheses.filter((item) => item.projectId === projectId),
    interpretations: state.interpretations.filter((item) => item.projectId === projectId),
    settings: state.settings[projectId] ?? [],
    runs: state.runs.filter((item) => item.projectId === projectId),
  });
}
function restoreSnapshot(
  state: DemoState,
  projectId: string,
  snapshot: ReturnType<typeof snapshotFor>,
) {
  const withProject = <T extends { projectId: string }>(item: T) => ({ ...item, projectId });
  const withEvidence = (item: dto.Evidence) => ({ ...item, location: withProject(item.location) });
  state.captures.push(...snapshot.captures.map(withProject));
  state.actions.push(...snapshot.actions.map(withProject));
  state.evidence.push(...snapshot.evidence.map(withEvidence));
  state.hypotheses.push(
    ...snapshot.hypotheses.map((item) => ({
      ...withProject(item),
      evidence: item.evidence.map(withEvidence),
    })),
  );
  state.interpretations.push(...snapshot.interpretations.map(withProject));
  state.settings[projectId] = snapshot.settings;
  state.runs.push(
    ...snapshot.runs.map((item) => ({
      ...withProject(item),
      historical: true,
      ...(['RUNNING', 'QUEUED'].includes(item.status)
        ? { status: 'INTERRUPTED' as const, summary: { ...item.summary, complete: false } }
        : {}),
    })),
  );
}
async function demoZipBytes(snapshotId: string, url: string) {
  const base = new Uint8Array(await (await fetch(new URL('/demo-project.zip', url))).arrayBuffer());
  const comment = new TextEncoder().encode('MADRIGAL_DEMO_V1:' + snapshotId);
  const bytes = new Uint8Array(base.length + comment.length);
  bytes.set(base);
  bytes.set(comment, base.length);
  new DataView(bytes.buffer).setUint16(base.length - 2, comment.length, true);
  return bytes;
}
export async function dispatch(
  operation: Operation,
  params: Params,
  file?: File,
): Promise<unknown> {
  const state = loadState();
  const projectId = text(params, 'projectId');
  const captureId = text(params, 'captureId');
  const query = text(params, 'q').toLowerCase();
  if (projectId) requireProject(state, projectId);
  let result: unknown;
  switch (operation) {
    case 'projects':
      result = page(
        state.projects.filter((project) => project.name.toLowerCase().includes(query)),
        params,
      );
      break;
    case 'project':
      result = requireProject(state, projectId);
      break;
    case 'createProject': {
      const name = text(params, 'name').trim();
      const problem =
        textError(name, 'название проекта', 120) ??
        textError(text(params, 'description'), 'описание', 2000, false);
      if (problem) throw new MockError('VALIDATION', problem);
      const project: dto.Project = {
        projectId: nextId(state, 'project'),
        name,
        description: text(params, 'description'),
        status: 'READY',
        updatedAt: fixedTime,
        captures: 0,
        settingsVersion: 'settings-v1',
      };
      state.projects.push(project);
      seedProject(state, project.projectId);
      result = project;
      break;
    }
    case 'captures': {
      state.jobs
        .filter((job) => job.projectId === projectId)
        .forEach((job) => settleJob(state, job));
      result = page(
        state.captures.filter((capture) => capture.projectId === projectId),
        params,
      );
      break;
    }
    case 'uploadCapture': {
      requireProject(state, projectId, true);
      if (!file || !/\.(pcap|pcapng)$/i.test(file.name))
        throw new MockError('UNSUPPORTED_FILE', 'Выберите PCAP или PCAPNG');
      // Только маленькая синтетическая fixture. Большие capture здесь не читаются и не анализируются.
      if (file.size > 65536)
        throw new MockError(
          'DEMO_LIMITATION',
          'Demo принимает только предоставленный синтетический пример до 64 КиБ. Реальный анализ выполняет Capture через Gateway.',
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      const expected = [demoPcap(), demoPcapng()];
      if (
        !expected.some(
          (sample) =>
            sample.length === bytes.length &&
            sample.every((value, index) => value === bytes[index]),
        )
      )
        throw new MockError(
          'DEMO_LIMITATION',
          'Этот файл не входит в синтетический корпус. Произвольный PCAP анализирует backend; скачайте demo-пример.',
        );
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const duplicate = state.captures.find(
        (capture) => capture.projectId === projectId && capture.sha256 === sha,
      );
      if (duplicate) {
        const job = state.jobs.find((job) => job.jobId === duplicate.jobId)!;
        result = { capture: duplicate, job, duplicate: true };
        break;
      }
      const job = addJob(state, projectId, 'Capture');
      const capture = {
        ...capturesFor(projectId)[0]!,
        captureId: 'capture-upload-fixture2-' + state.sequence,
        name: file.name,
        size: decimal(String(file.size)),
        sha256: sha,
        status: 'IMPORTING' as const,
        jobId: job.jobId,
      };
      state.captures.push(capture);
      requireProject(state, projectId).captures++;
      result = { capture, job, duplicate: false };
      break;
    }
    case 'sessions': {
      requireCapture(state, projectId, captureId);
      const sessions = sessionsFor(captureId);
      const onlyDefects = text(params, 'defects') === 'true';
      if (mockScenario === 'large-paginated') {
        const offset = boundedIndex(BigInt(text(params, 'cursor', '0')), 1000);
        result = {
          items: Array.from({ length: Math.min(20, 1000 - offset) }, (_, index) => ({
            ...sessions[0]!,
            sessionId: 'session-' + captureId.replace('capture-', '') + '-' + (offset + index + 1),
            streamA:
              'stream-' +
              captureId.replace('capture-', '') +
              '-a' +
              (offset + index === 0 ? '' : String(offset + index + 1)),
            streamB:
              'stream-' +
              captureId.replace('capture-', '') +
              '-b' +
              (offset + index === 0 ? '' : String(offset + index + 1)),
            generation: offset + index + 1,
          })),
          nextCursor: offset + 20 < 1000 ? String(offset + 20) : null,
          total: decimal('1000'),
        };
      } else
        result = page(
          sessions.filter(
            (item) =>
              (item.sideA + item.sideB).toLowerCase().includes(query) &&
              (!onlyDefects ||
                item.defects.some((defect) => defect !== 'Ретрансляция сохранена как источник')),
          ),
          params,
        );
      break;
    }
    case 'assemblies':
      requireCapture(state, projectId, captureId);
      result = page(assembliesFor(captureId, text(params, 'sessionId')), params);
      break;
    case 'bytes': {
      const { loc, assembly } = requireLocation(state, params);
      if (BigInt(loc.length) > 4096n)
        throw new MockError('WINDOW_LIMIT', 'Максимум 4096 байтов за чтение');
      result = fixtureWindow(loc, assembly.length);
      break;
    }
    case 'sources':
      result = sourceRanges(requireLocation(state, params).loc);
      break;
    case 'packet': {
      const capture = requireCapture(state, projectId, captureId);
      const packetNo = z
        .number()
        .int()
        .positive()
        .max(Number(capture.packets))
        .parse(Number(text(params, 'packetNo')));
      result = fixturePacket(captureId, packetNo);
      break;
    }
    case 'search': {
      const { loc, assembly } = requireLocation(state, { ...params, length: '0' });
      const mode = text(params, 'mode') === 'ASCII' ? 'ASCII' : 'HEX';
      const pattern = text(params, 'pattern');
      const error = validateSearch(mode, pattern);
      if (error) throw new MockError('INVALID_PATTERN', error);
      const needle =
        mode === 'ASCII'
          ? Array.from(pattern).map((char) => char.charCodeAt(0))
          : pattern
              .replace(/\s/g, '')
              .match(/../g)!
              .map((hex) => Number.parseInt(hex, 16));
      const start = BigInt(decimal(text(params, 'cursor', '0')));
      if (start > BigInt(assembly.length))
        throw new MockError('BAD_CURSOR', 'Cursor находится за пределами потока');
      const limit =
        start + 4096n < BigInt(assembly.length) ? start + 4096n : BigInt(assembly.length);
      const window = fixtureWindow(
        { ...loc, start: decimal(start), length: decimal(limit - start) },
        assembly.length,
      );
      const items: dto.Location[] = [];
      for (let offset = start; offset + BigInt(needle.length) <= limit; offset++) {
        const equal = needle.every((value, index) => {
          const cell = cellAt(window, decimal(offset + BigInt(index)));
          return cell.kind === 'known' && cell.value === value;
        });
        if (equal) {
          items.push({ ...loc, start: decimal(offset), length: decimal(String(needle.length)) });
          if (items.length === 20) {
            result = {
              items,
              nextCursor: String(offset + 1n),
              complete: false,
              searchedBytes: String(offset - start + 1n),
            };
            break;
          }
        }
      }
      result ??= {
        items,
        nextCursor:
          limit < BigInt(assembly.length) ? String(limit - BigInt(needle.length) + 1n) : null,
        complete: limit === BigInt(assembly.length),
        searchedBytes: String(limit - start),
      };
      break;
    }
    case 'settings':
      result = (state.settings[projectId] ?? []).filter(
        (setting) => !params.settingsVersion || setting.settingsVersion === params.settingsVersion,
      );
      break;
    case 'saveSettings': {
      requireProject(state, projectId, true);
      const offset = timeOffsetInput(text(params, 'offsetNanoseconds'));
      const problem = timeZoneError(text(params, 'timeZone')) ?? offset.error;
      if (problem) throw new MockError('VALIDATION', problem);
      const settings = dto.settingsSchema.parse({
        ...params,
        offsetNanoseconds: offset.value,
        settingsVersion: nextId(state, 'settings'),
      });
      (state.settings[projectId] ??= []).push(settings);
      requireProject(state, projectId).settingsVersion = settings.settingsVersion;
      result = settings;
      break;
    }
    case 'createAssembly': {
      requireCapture(state, projectId, captureId);
      const job = addJob(state, projectId, 'Capture', text(params, 'assemblyId'));
      job.diagnostic =
        'Новая произвольная сборка требует Capture API. В demo доступны фиксированные v1/v2; историческая v1 сохранена.';
      result = { job };
      break;
    }
    case 'actions': {
      const from = params.from ? timestampNanoseconds(String(params.from)) : null;
      const to = params.to ? timestampNanoseconds(String(params.to)) : null;
      result = page(
        state.actions.filter((action) => {
          const corrected = timestampNanoseconds(
            shiftTimestamp(action.timestamp, action.offsetNanoseconds),
          );
          return (
            action.projectId === projectId &&
            (action.name + action.type + action.parameters).toLowerCase().includes(query) &&
            (!params.type || action.type === params.type) &&
            (from === null || corrected >= from) &&
            (to === null || corrected <= to)
          );
        }),
        params,
      );
      break;
    }
    case 'importActions': {
      requireProject(state, projectId, true);
      const timeZone = text(params, 'timeZone', 'UTC');
      const offset = timeOffsetInput(text(params, 'offsetNanoseconds', '0'));
      const timeProblem = timeZoneError(timeZone) ?? offset.error;
      if (timeProblem) throw new MockError('VALIDATION', timeProblem);
      if (!file || file.size > 65536)
        throw new MockError(
          'DEMO_LIMITATION',
          'Demo CSV: максимум 64 КиБ, UTF-8; реальный импорт выполняет Workspace',
        );
      const rows = (await file.text()).split(/\r?\n/);
      const header = rows.shift();
      if (header !== 'timestamp,name,type,parameters')
        throw new MockError(
          'CSV_FORMAT',
          'Временный demo CSV: timestamp,name,type,parameters; без запятых внутри полей',
        );
      const errors: { row: number; reason: string }[] = [];
      let imported = 0;
      const importId = nextId(state, 'csv');
      rows.forEach((row, index) => {
        if (!row.trim()) return;
        const [timestamp, name, type, ...parameters] = row.split(',');
        if (
          !dto.actionSchema.shape.timestamp.safeParse(timestamp).success ||
          textError(name ?? '', 'название действия', 120) ||
          textError(type ?? '', 'тип действия', 120)
        ) {
          errors.push({
            row: index + 2,
            reason: 'Нужно точное ISO-время с timezone, название и тип',
          });
          return;
        }
        try {
          shiftTimestamp(timestamp!, offset.value!);
        } catch {
          errors.push({
            row: index + 2,
            reason: 'Поправка выводит время действия за поддерживаемый календарный диапазон.',
          });
          return;
        }
        state.actions.push({
          actionId: nextId(state, 'action'),
          projectId,
          name: name!.trim(),
          type: type!.trim(),
          parameters: parameters.join(','),
          timestamp: timestamp!,
          timeZone,
          offsetNanoseconds: offset.value!,
          sourceFile: file.name,
          row: index + 2,
          importId,
        });
        imported++;
      });
      result = { imported, partial: errors.length > 0, errors };
      break;
    }
    case 'evidence':
      result = page(
        state.evidence.filter(
          (item) =>
            item.location.projectId === projectId &&
            (!params.actionId || item.actionId === params.actionId),
        ),
        params,
      );
      break;
    case 'saveEvidence': {
      const evidenceId = text(params, 'evidenceId');
      const existing = evidenceId
        ? state.evidence.find(
            (item) => item.evidenceId === evidenceId && item.location.projectId === projectId,
          )
        : undefined;
      if (evidenceId && !existing)
        throw new MockError(
          'EVIDENCE_UNAVAILABLE',
          'Связь недоступна или принадлежит другому проекту',
          undefined,
          404,
        );
      const loc = existing
        ? dto.locationSchema.parse(params.location)
        : requireLocation(state, params.location as Params).loc;
      if (
        existing &&
        (Object.keys(existing.location).some(
          (key) => existing.location[key as keyof dto.Location] !== loc[key as keyof dto.Location],
        ) ||
          params.actionId !== existing.actionId ||
          params.kind !== existing.kind)
      )
        throw new MockError(
          'IMMUTABLE_SOURCE',
          'Редактирование основания не меняет закреплённый источник или действие. Создайте новую связь для другого диапазона.',
        );
      if (loc.projectId !== projectId)
        throw new MockError('CROSS_PROJECT', 'Нельзя связать источники другого проекта');
      if (loc.length === '0')
        throw new MockError('VALIDATION', 'Выберите диапазон длиной больше нуля.');
      const actionId = text(params, 'actionId');
      if (
        !existing &&
        actionId &&
        !state.actions.some((item) => item.actionId === actionId && item.projectId === projectId)
      )
        throw new MockError('ACTION_UNAVAILABLE', 'Действие другого проекта или недоступно');
      const evidence = dto.evidenceSchema.parse({
        ...existing,
        ...params,
        evidenceId: existing?.evidenceId ?? nextId(state, 'evidence'),
        sources: existing?.sources ?? sourceRanges(loc),
        location: loc,
        revisionId: existing?.revisionId ?? params.revisionId,
        runId: existing?.runId ?? params.runId,
      });
      const problem = textError(evidence.basis, 'основание связи', 4000, false);
      if (problem) throw new MockError('VALIDATION', problem);
      evidence.basis = evidence.basis.trim();
      if (existing) state.evidence[state.evidence.indexOf(existing)] = evidence;
      else state.evidence.push(evidence);
      result = evidence;
      break;
    }
    case 'hypotheses':
      result = page(
        state.hypotheses.filter(
          (item) =>
            item.projectId === projectId &&
            (!params.status || item.status === params.status) &&
            (!params.type || item.type === params.type),
        ),
        params,
      );
      break;
    case 'saveHypothesis': {
      const hypothesisId = text(params, 'hypothesisId') || nextId(state, 'hypothesis');
      const hypothesis = dto.hypothesisSchema.parse({
        ...params,
        hypothesisId,
        evidence: params.evidence ?? [],
      });
      const problem =
        textError(hypothesis.text, 'формулировку', 4000) ??
        textError(hypothesis.basis, 'основания и открытые вопросы', 8000);
      if (problem) throw new MockError('VALIDATION', problem);
      hypothesis.text = hypothesis.text.trim();
      hypothesis.basis = hypothesis.basis.trim();
      if (hypothesis.evidence.some((item) => item.location.projectId !== projectId))
        throw new MockError('CROSS_PROJECT', 'Источник другого проекта');
      const existing = state.hypotheses.findIndex(
        (item) => item.hypothesisId === hypothesisId && item.projectId === projectId,
      );
      if (params.hypothesisId && existing < 0)
        throw new MockError('NOT_FOUND', 'Исследовательская запись недоступна', undefined, 404);
      if (existing >= 0) state.hypotheses[existing] = hypothesis;
      else state.hypotheses.push(hypothesis);
      result = hypothesis;
      break;
    }
    case 'deleteHypothesis': {
      const hypothesisId = text(params, 'hypothesisId');
      const existing = state.hypotheses.findIndex(
        (item) => item.projectId === projectId && item.hypothesisId === hypothesisId,
      );
      if (existing < 0)
        throw new MockError('NOT_FOUND', 'Исследовательская запись недоступна', undefined, 404);
      state.hypotheses.splice(existing, 1);
      result = { projectId, hypothesisId, deleted: true };
      break;
    }
    case 'interpretations':
      result = page(
        state.interpretations.filter((item) => item.projectId === projectId),
        params,
      );
      break;
    case 'interpretation':
      result = state.interpretations.find(
        (item) => item.projectId === projectId && item.interpretationId === params.interpretationId,
      );
      if (!result) throw new MockError('NOT_FOUND', 'Интерпретация недоступна', undefined, 404);
      break;
    case 'createInterpretation': {
      requireProject(state, projectId, true);
      const problem = textError(text(params, 'name'), 'название интерпретации', 120);
      if (problem) throw new MockError('VALIDATION', problem);
      const interpretation = {
        projectId,
        interpretationId: nextId(state, 'interpretation'),
        name: text(params, 'name').trim(),
        revisions: [],
      };
      state.interpretations.push(interpretation);
      result = interpretation;
      break;
    }
    case 'saveRevision': {
      requireProject(state, projectId, true);
      validateDraft(text(params, 'json'));
      const interpretation = state.interpretations.find(
        (item) => item.projectId === projectId && item.interpretationId === params.interpretationId,
      );
      if (!interpretation)
        throw new MockError('NOT_FOUND', 'Интерпретация недоступна', undefined, 404);
      const revision: dto.Revision = {
        revisionId: nextId(state, 'revision'),
        interpretationId: interpretation.interpretationId,
        createdAt: fixedTime,
        json: text(params, 'json'),
        label: text(params, 'label', 'Новая ревизия'),
        ...(params.parentRevisionId ? { parentRevisionId: text(params, 'parentRevisionId') } : {}),
      };
      interpretation.revisions.push(revision);
      state.runs
        .filter((run) => run.projectId === projectId)
        .forEach((run) => {
          run.historical = true;
        });
      result = revision;
      break;
    }
    case 'preview': {
      const { loc } = requireLocation(state, params.location as Params);
      revision(state, projectId, text(params, 'interpretationId'), text(params, 'revisionId'));
      if (loc.projectId !== projectId || BigInt(loc.length) > 4096n)
        throw new MockError('PREVIEW_LIMIT', 'Preview ограничен 4096 байтами своего проекта');
      const results = preparedResults(
        state,
        projectId,
        text(params, 'interpretationId'),
        text(params, 'revisionId'),
        loc.captureId,
        loc,
      );
      result = {
        revisionId: params.revisionId,
        location: loc,
        results: results.filter((item) => intersect(loc, item.location)),
        unknown: results
          .filter((item) => item.status === 'UNKNOWN' && intersect(loc, item.location))
          .map((item) => item.location),
        complete: true,
        diagnostic:
          'Подготовленный синтетический результат; произвольный анализ выполняет Analysis',
      };
      break;
    }
    case 'runs':
      state.jobs
        .filter((job) => job.projectId === projectId)
        .forEach((job) => settleJob(state, job));
      result = page(
        [...state.runs].reverse().filter((item) => item.projectId === projectId),
        params,
      );
      break;
    case 'run': {
      const run = state.runs.find(
        (item) => item.projectId === projectId && item.runId === params.runId,
      );
      if (!run)
        throw new MockError('RUN_UNAVAILABLE', 'Исторический запуск недоступен', undefined, 404);
      const job = state.jobs.find((job) => job.jobId === run.jobId);
      if (job) settleJob(state, job);
      result = run;
      break;
    }
    case 'createRun': {
      requireProject(state, projectId, true);
      revision(state, projectId, text(params, 'interpretationId'), text(params, 'revisionId'));
      const corpus = z
        .array(z.object({ captureId: z.string(), assemblyId: z.string() }))
        .min(1)
        .parse(params.corpus);
      corpus.forEach((item) => {
        requireCapture(state, projectId, item.captureId);
        if (
          ![
            ...assembliesFor(
              item.captureId,
              'session-' + item.captureId.replace('capture-', '') + '-1',
            ),
            ...assembliesFor(
              item.captureId,
              'session-' + item.captureId.replace('capture-', '') + '-2',
            ),
          ].some(
            (assembly) => assembly.assemblyId === item.assemblyId && assembly.status === 'READY',
          )
        )
          throw new MockError('ASSEMBLY_UNAVAILABLE', 'Сборка корпуса недоступна');
      });
      const runId = nextId(state, 'run');
      const job = addJob(
        state,
        projectId,
        'Analysis',
        runId,
        mockScenario === 'partial-and-cancelled' ? null : '3',
      );
      if (mockScenario === 'partial-and-cancelled') state.clock[job.jobId + ':interrupt'] = 1;
      const run = baselineRun(projectId, runId, text(params, 'revisionId'), corpus[0]!.captureId);
      run.jobId = job.jobId;
      run.historical = false;
      run.status = 'QUEUED';
      run.summary.complete = false;
      run.manifest.corpus = corpus.map((item) => ({
        ...item,
        sha256: state.captures.find(
          (capture) => capture.projectId === projectId && capture.captureId === item.captureId,
        )!.sha256,
      }));
      run.manifest.settingsVersion = text(params, 'settingsVersion', 'settings-v1');
      run.manifest.filters = text(params, 'filters', 'Без фильтра');
      run.summary.captures = decimal(String(corpus.length));
      run.summary.sessions = decimal(String(corpus.length));
      const prepared = corpus.flatMap((item) =>
        preparedResults(
          state,
          projectId,
          text(params, 'interpretationId'),
          text(params, 'revisionId'),
          item.captureId,
        ),
      );
      run.summary.messages = decimal(String(prepared.length));
      run.summary.knownBytes = decimal(String(12 * corpus.length));
      run.summary.unknownBytes = decimal(String(12 * corpus.length));
      for (const status of Object.keys(run.summary.rules) as dto.CheckStatus[])
        run.summary.rules[status] = decimal(
          String(prepared.filter((item) => item.status === status).length),
        );
      if (mockScenario === 'zero-messages') {
        run.summary.messages = decimal('0');
        run.summary.knownBytes = decimal('0');
        run.summary.unknownBytes = decimal('0');
        for (const key of Object.keys(run.summary.rules) as dto.CheckStatus[])
          run.summary.rules[key] = decimal('0');
      }
      state.runs.push(run);
      result = { run, job };
      break;
    }
    case 'results': {
      const run = state.runs.find(
        (item) => item.projectId === projectId && item.runId === params.runId,
      );
      if (!run) throw new MockError('RUN_UNAVAILABLE', 'Запуск недоступен', undefined, 404);
      const interpretation = state.interpretations.find(
        (item) =>
          item.projectId === projectId &&
          item.revisions.some((revision) => revision.revisionId === run.manifest.revisionId),
      );
      if (!interpretation)
        throw new MockError('REVISION_UNAVAILABLE', 'Ревизия этого запуска недоступна');
      const results =
        run.summary.messages === '0'
          ? []
          : run.manifest.corpus.flatMap((item) => {
              const assembly = [
                ...assembliesFor(
                  item.captureId,
                  'session-' + item.captureId.replace('capture-', '') + '-1',
                ),
                ...assembliesFor(
                  item.captureId,
                  'session-' + item.captureId.replace('capture-', '') + '-2',
                ),
              ].find((assembly) => assembly.assemblyId === item.assemblyId)!;
              return preparedResults(
                state,
                projectId,
                interpretation.interpretationId,
                run.manifest.revisionId,
                item.captureId,
                {
                  assemblyId: assembly.assemblyId,
                  sessionId: assembly.sessionId,
                  streamId: assembly.streamId,
                  direction: assembly.direction,
                },
              ).map((result) => ({
                ...result,
                resultId: item.captureId + '-' + item.assemblyId + '-' + result.resultId,
              }));
            });
      result = page(
        results.filter(
          (item) =>
            (!params.status || item.status === params.status) &&
            (!params.rule || item.rule.includes(text(params, 'rule'))) &&
            (!params.captureId || item.location.captureId === params.captureId),
        ),
        params,
      );
      break;
    }
    case 'job':
      result = requireJob(state, projectId, text(params, 'jobId'));
      break;
    case 'cancelJob': {
      const job = requireJob(state, projectId, text(params, 'jobId'));
      if (job.status === 'RUNNING' || job.status === 'QUEUED') {
        job.status = 'CANCEL_REQUESTED';
        job.stage = 'Запрос на отмену принят';
      }
      result = job;
      break;
    }
    case 'exportProject':
    case 'createReport': {
      requireProject(state, projectId, true);
      const runId = text(params, 'runId');
      if (
        operation === 'createReport' &&
        !state.runs.some(
          (item) =>
            item.runId === runId && item.projectId === projectId && item.status === 'COMPLETED',
        )
      )
        throw new MockError('RUN_NOT_COMPLETE', 'Отчёт доступен только для завершённого запуска');
      const job = addJob(state, projectId, 'Workspace');
      const artifact: dto.Artifact = {
        artifactId: nextId(state, 'artifact'),
        projectId,
        jobId: job.jobId,
        kind: operation === 'createReport' ? 'report' : 'project',
        status: 'PENDING',
        name:
          operation === 'createReport' ? 'madrigal-' + runId + '.md' : 'madrigal-demo-project.zip',
        contentType:
          operation === 'createReport' ? 'text/markdown; charset=utf-8' : 'application/zip',
        ...(runId ? { runId, snapshotId: nextId(state, 'snapshot') } : {}),
      };
      state.artifacts.push(artifact);
      state.snapshots[artifact.artifactId] = snapshotFor(state, projectId);
      result = { job, artifact };
      break;
    }
    case 'artifacts':
      state.jobs
        .filter((job) => job.projectId === projectId)
        .forEach((job) => settleJob(state, job));
      result = page(
        state.artifacts.filter((item) => item.projectId === projectId),
        params,
      );
      break;
    case 'importProject': {
      if (!file || !file.name.endsWith('.zip'))
        throw new MockError('UNSUPPORTED_FILE', 'Выберите проект ZIP');
      const project: dto.Project = {
        projectId: nextId(state, 'project-import'),
        name: text(params, 'name', 'Перенесённое исследование'),
        description: 'Демонстрационный перенос',
        captures: 0,
        status: 'IMPORTING',
        settingsVersion: 'settings-v1',
        updatedAt: fixedTime,
      };
      state.projects.push(project);
      const job = addJob(state, project.projectId, 'Workspace');
      project.jobId = job.jobId;
      const trailer =
        file.size < 65536
          ? new TextDecoder().decode(await file.slice(Math.max(0, file.size - 220)).arrayBuffer())
          : '';
      const marker = trailer.match(/MADRIGAL_DEMO_V1:(artifact-\d+)/)?.[1];
      const snapshot = marker
        ? (state.snapshots[marker] as ReturnType<typeof snapshotFor> | undefined)
        : undefined;
      const valid = !!snapshot;
      if (!valid)
        job.diagnostic =
          'Архив не входит в синтетический demo-формат: несовместимая версия, хеш или недостающая зависимость. Реальную проверку ZIP выполняет Workspace.';
      else {
        restoreSnapshot(state, project.projectId, snapshot!);
        project.captures = snapshot!.captures.length;
        project.settingsVersion = snapshot!.settings.at(-1)?.settingsVersion ?? 'settings-v1';
      }
      result = { project, job };
      break;
    }
  }
  saveState(state);
  return result;
}
async function parseRequest(request: Request): Promise<{ params: Params; file?: File }> {
  if (request.method === 'GET') {
    const params: Params = Object.fromEntries(new URL(request.url).searchParams);
    return { params };
  }
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    const data = await request.formData();
    const params: Params = {};
    data.forEach((value, key) => {
      if (typeof value === 'string') params[key] = value;
    });
    const file = data.get('file');
    return { params, file: file instanceof File ? file : undefined };
  }
  return { params: (await request.json()) as Params };
}
export const handlers = [
  http.all('*/__madrigal_mock/v1/:operation', async ({ request, params }) => {
    const requestId = request.headers.get('x-request-id') ?? 'mock-request';
    const operation = String(params.operation) as Operation;
    if (!(operation in operations))
      return HttpResponse.json(
        { error: { code: 'UNHANDLED_MOCK', message: 'Необработанная demo-операция' }, requestId },
        { status: 500 },
      );
    await delay(60);
    try {
      const input = await parseRequest(request);
      const key = request.headers.get('idempotency-key');
      const state = loadState();
      // multipart не передаёт lastModified. Fingerprint ограниченного demo-файла
      // строится по содержимому; повтор не зависит от времени разбора FormData.
      const fileHash =
        input.file && input.file.size <= 65536
          ? Array.from(
              new Uint8Array(await crypto.subtle.digest('SHA-256', await input.file.arrayBuffer())),
            )
              .map((byte) => byte.toString(16).padStart(2, '0'))
              .join('')
          : '';
      const fingerprint =
        operation +
        ':' +
        JSON.stringify(input.params) +
        ':' +
        (input.file
          ? input.file.name + ':' + input.file.size + ':' + input.file.type + ':' + fileHash
          : '');
      if (key && state.idempotency[key]) {
        const previous = state.idempotency[key]!;
        if (previous.fingerprint !== fingerprint)
          throw new MockError(
            'IDEMPOTENCY_CONFLICT',
            'Тот же ключ использован для другого тела',
            undefined,
            409,
          );
        return HttpResponse.json({ data: previous.result, requestId });
      }
      if (mockScenario === 'api-failures' && operation === 'bytes')
        return new HttpResponse('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        });
      const result = await dispatch(operation, input.params, input.file);
      if (key && operation !== 'preview') {
        state.idempotency[key] = { fingerprint, result: structuredClone(result) };
        saveState(state);
      }
      return HttpResponse.json(
        { data: result, requestId },
        { headers: { 'x-request-id': requestId } },
      );
    } catch (error) {
      const known =
        error instanceof MockError
          ? error
          : new MockError(
              'MOCK_VALIDATION',
              error instanceof Error ? error.message : 'Ошибка demo',
            );
      return HttpResponse.json(
        { error: { code: known.code, message: known.message, details: known.details }, requestId },
        { status: known.status },
      );
    }
  }),
  http.get('*/__madrigal_mock/artifact/:id', async ({ params, request }) => {
    const state = loadState();
    const artifact = state.artifacts.find((item) => item.artifactId === params.id);
    if (!artifact || artifact.status !== 'READY')
      return new HttpResponse('Артефакт ещё не готов', { status: 409 });
    const snapshot = state.snapshots[artifact.artifactId] as ReturnType<typeof snapshotFor>;
    const run = snapshot?.runs.find((item) => item.runId === artifact.runId);
    const content =
      artifact.kind === 'report'
        ? '# Исследование МАДРИГАЛ\n\nДемонстрационный отчёт, не результат реального анализа.\n\nЗапуск: ' +
          artifact.runId +
          '\nСнимок: ' +
          artifact.snapshotId +
          '\n\nЗакреплённые входы:\n' +
          JSON.stringify(run?.manifest, null, 2) +
          '\n\nСводка синтетического запуска:\n' +
          JSON.stringify(run?.summary, null, 2) +
          '\n\nИсследовательские записи на момент снимка:\n' +
          (snapshot?.hypotheses
            .map(
              (item) =>
                '## ' +
                item.text +
                '\n\nСтатус исследователя: ' +
                item.status +
                '\nОснования: ' +
                item.basis +
                '\n' +
                item.evidence
                  .map(
                    (proof) =>
                      (proof.kind === 'counterexample' ? 'Контрпример' : 'Поддержка') +
                      ': ' +
                      proof.basis +
                      '\nИсточник: ' +
                      JSON.stringify(proof.location) +
                      '\nИсходные участки: ' +
                      JSON.stringify(proof.sources),
                  )
                  .join('\n\n'),
            )
            .join('\n\n') ?? 'Нет записей') +
          '\n\nОткрытый вопрос: смысл поля не доказан. PASS не подтверждает причинность.\n'
        : ((await demoZipBytes(artifact.artifactId, request.url)).buffer as ArrayBuffer);
    return new HttpResponse(content, {
      headers: {
        'Content-Type': artifact.contentType,
        'Content-Disposition': 'attachment; filename="' + artifact.name + '"',
      },
    });
  }),
  http.get(
    '*/__madrigal_mock/example/:format',
    ({ params }) =>
      new HttpResponse(
        (params.format === 'pcapng' ? demoPcapng() : demoPcap()).buffer as ArrayBuffer,
        {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition':
              'attachment; filename="synthetic.' +
              (params.format === 'pcapng' ? 'pcapng' : 'pcap') +
              '"',
          },
        },
      ),
  ),
];
