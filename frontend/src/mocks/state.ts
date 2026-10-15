import { z } from 'zod';
import * as dto from '../shared/api/contracts/models';
import {
  baselineRun,
  capturesFor,
  fixedTime,
  goldenLocation,
  goldenSources,
  projectId,
  schemaText,
} from './fixtures/corpus';
import { decimal } from '../shared/model/precision';
const stateSchema = z.object({
  version: z.literal(2),
  sequence: z.number().int().nonnegative(),
  projects: z.array(dto.projectSchema),
  captures: z.array(dto.captureSchema),
  actions: z.array(dto.actionSchema),
  hypotheses: z.array(dto.hypothesisSchema),
  evidence: z.array(dto.evidenceSchema),
  interpretations: z.array(dto.interpretationSchema),
  settings: z.record(z.string(), z.array(dto.settingsSchema)),
  runs: z.array(dto.runSchema),
  jobs: z.array(dto.jobSchema),
  artifacts: z.array(dto.artifactSchema),
  idempotency: z.record(z.string(), z.object({ fingerprint: z.string(), result: z.unknown() })),
  clock: z.record(z.string(), z.number()),
  snapshots: z.record(z.string(), z.unknown()).default({}),
});
export type DemoState = z.infer<typeof stateSchema>;
export const demoStorageKey = 'madrigal:demo:v2';
const legacyStorageKey = 'madrigal:demo:v1';
export function initialState(): DemoState {
  return {
    version: 2,
    sequence: 0,
    projects: [
      {
        projectId,
        name: 'Термоконтроллер · стенд 04',
        description:
          'Исследование команд уставки и ответов устройства. Синтетический корпус frontend.',
        status: 'READY',
        updatedAt: fixedTime,
        captures: capturesFor(projectId).length,
        settingsVersion: 'settings-v1',
      },
      {
        projectId: 'demo-importing',
        name: 'Импорт архива',
        description: 'Диагностика незавершённого проекта',
        status: 'IMPORTING',
        updatedAt: fixedTime,
        captures: 0,
        settingsVersion: 'settings-v1',
        jobId: 'ws_importing',
      },
      {
        projectId: 'demo-error',
        name: 'Повреждённый проект',
        description: 'Пример ошибки целостности',
        status: 'ERROR',
        updatedAt: fixedTime,
        captures: 0,
        settingsVersion: 'settings-v1',
        diagnostic: 'Хеш исходной записи не совпал с manifest',
      },
    ],
    captures: capturesFor(projectId),
    settings: {
      [projectId]: [
        {
          settingsVersion: 'settings-v1',
          timeZone: 'UTC',
          offsetNanoseconds: '0',
          checksum: 'warn',
          overlap: 'preserve-alternatives',
        },
        {
          settingsVersion: 'settings-v2',
          timeZone: 'Europe/Moscow',
          offsetNanoseconds: '1000000000',
          checksum: 'strict',
          overlap: 'preserve-alternatives',
        },
      ],
    },
    actions: [21, 42].map((value, index) => ({
      actionId: 'action-' + value,
      projectId,
      name: 'Задать уставку ' + value,
      type: 'setpoint',
      parameters: '{"value":' + value + '}',
      timestamp: index === 0 ? fixedTime : '2026-10-11T12:34:58.123456790Z',
      timeZone: 'UTC',
      offsetNanoseconds: '0',
      sourceFile: 'actions-demo.csv',
      row: index + 2,
      importId: 'csv-baseline',
    })),
    evidence: [
      {
        evidenceId: 'evidence-baseline',
        location: goldenLocation,
        sources: goldenSources,
        status: 'tentative',
        basis: 'После команды 21 в обмене наблюдается число 21; причинность ещё не установлена',
        actionId: 'action-21',
        kind: 'support',
      },
    ],
    hypotheses: [
      {
        hypothesisId: 'hypothesis-setpoint',
        projectId,
        type: 'hypothesis',
        text: 'Поле value может передавать уставку температуры',
        basis: 'Совпадение числа 21 с журналом действий требует проверки на другой записи',
        status: 'open',
        evidence: [
          {
            evidenceId: 'evidence-baseline',
            location: goldenLocation,
            sources: goldenSources,
            status: 'tentative',
            basis: 'Наблюдение на команде 21',
            actionId: 'action-21',
            kind: 'support',
          },
          {
            evidenceId: 'evidence-counter',
            location: {
              ...goldenLocation,
              captureId: 'capture-additional-fixture2',
              sessionId: 'session-additional-fixture2-1',
              streamId: 'stream-additional-fixture2-a',
              assemblyId: 'assembly-additional-fixture2-v1',
            },
            sources: goldenSources.map((source) => ({
              ...source,
              captureId: 'capture-additional-fixture2',
            })),
            status: 'tentative',
            basis: 'Дополнительная запись с числом 42 противоречит ограничению 30',
            actionId: 'action-42',
            kind: 'counterexample',
            revisionId: 'revision-v1',
            runId: 'run-additional',
          },
        ],
      },
    ],
    interpretations: [
      {
        interpretationId: 'interpretation-demo',
        projectId,
        name: 'Команда уставки · рабочая модель',
        revisions: [
          {
            revisionId: 'revision-v1',
            interpretationId: 'interpretation-demo',
            createdAt: fixedTime,
            json: schemaText,
            label: 'Начальная гипотеза структуры',
          },
        ],
      },
    ],
    runs: [
      baselineRun(projectId),
      baselineRun(projectId, 'run-additional', 'revision-v1', 'capture-additional-fixture2'),
    ],
    jobs: [
      {
        jobId: 'ws_importing',
        projectId: 'demo-importing',
        owner: 'Workspace',
        status: 'QUEUED',
        stage: 'Ожидает ресурсы',
        completed: decimal('0'),
        total: null,
        unit: 'этапы',
      },
    ],
    artifacts: [],
    idempotency: {},
    clock: {},
    snapshots: {},
  };
}
let memory: DemoState | undefined;
export function migrateDemoState(input: unknown): DemoState {
  const current = stateSchema.safeParse(input);
  const legacy = current.success
    ? null
    : stateSchema.extend({ version: z.literal(1) }).parse(input);
  const state: DemoState = current.success ? current.data : { ...legacy!, version: 2 };
  const project = state.projects.find(
    (item) => item.projectId === projectId && item.status === 'READY',
  );
  if (project) {
    const additions = capturesFor(projectId).filter(
      (capture) =>
        !state.captures.some(
          (item) => item.projectId === projectId && item.captureId === capture.captureId,
        ),
    );
    state.captures = [...additions, ...state.captures];
    project.captures += additions.length;
  }
  return state;
}
export function loadState(): DemoState {
  if (memory) return memory;
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? (localStorage.getItem(demoStorageKey) ?? localStorage.getItem(legacyStorageKey))
        : null;
    memory = raw ? migrateDemoState(JSON.parse(raw)) : initialState();
  } catch {
    memory = initialState();
  }
  return memory;
}
export function saveState(state: DemoState) {
  memory = state;
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(demoStorageKey, JSON.stringify(state));
  } catch {
    throw new Error(
      'Не удалось сохранить demo-state: локальное хранилище недоступно или заполнено. Сбросьте демонстрационные данные.',
    );
  }
}
export function resetState() {
  memory = initialState();
  saveState(memory);
}
export const nextId = (state: DemoState, prefix: string) => prefix + '-' + ++state.sequence;
export function addJob(
  state: DemoState,
  projectId: string,
  owner: dto.Job['owner'],
  resourceId?: string,
  total: string | null = '3',
) {
  const prefix = owner === 'Capture' ? 'cap_' : owner === 'Analysis' ? 'ana_' : 'ws_';
  const job: dto.Job = {
    jobId: nextId(state, prefix),
    projectId,
    owner,
    status: 'QUEUED',
    stage: 'В очереди',
    completed: decimal('0'),
    total: total === null ? null : decimal(total),
    unit: 'этапы',
    resourceId,
  };
  state.jobs.push(job);
  state.clock[job.jobId] = Date.now();
  return job;
}
export function settleJob(state: DemoState, job: dto.Job, now = Date.now()) {
  if (!['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(job.status)) return job;
  const elapsed = now - (state.clock[job.jobId] ?? now);
  if (job.status === 'CANCEL_REQUESTED' && elapsed < 2400) {
    job.status = 'CANCELLED';
    job.stage = 'Обработка отменена';
  } else if (state.clock[job.jobId + ':interrupt'] && elapsed >= 1400) {
    job.status = 'INTERRUPTED';
    job.stage = 'Сервис анализа прерван; результат частичный';
    job.diagnostic = 'Синтетический сценарий перезапуска сервиса. Полный результат не получен.';
  } else if (elapsed >= 2400) {
    job.status = job.diagnostic ? 'FAILED' : 'COMPLETED';
    job.completed = job.total ?? decimal('3');
    job.stage = job.diagnostic ? 'Операция завершилась ошибкой' : 'Готово';
  } else if (elapsed >= 400) {
    job.status = 'RUNNING';
    job.stage = elapsed < 1400 ? 'Чтение входов' : 'Сохранение результата';
    job.completed = decimal(elapsed < 1400 ? '1' : '2');
  }
  const run = state.runs.find((run) => run.jobId === job.jobId);
  if (run) {
    run.status =
      job.status === 'COMPLETED'
        ? 'COMPLETED'
        : job.status === 'FAILED'
          ? 'FAILED'
          : job.status === 'CANCELLED'
            ? 'CANCELLED'
            : job.status === 'INTERRUPTED'
              ? 'INTERRUPTED'
              : 'RUNNING';
    run.summary.complete = run.status === 'COMPLETED';
  }
  const artifact = state.artifacts.find((item) => item.jobId === job.jobId);
  if (artifact) {
    artifact.status =
      job.status === 'COMPLETED'
        ? 'READY'
        : job.status === 'FAILED'
          ? 'FAILED'
          : job.status === 'CANCELLED'
            ? 'CANCELLED'
            : 'PENDING';
    if (artifact.status === 'READY')
      artifact.downloadUrl = '/__madrigal_mock/artifact/' + artifact.artifactId;
  }
  const capture = state.captures.find((item) => item.jobId === job.jobId);
  if (capture)
    capture.status =
      job.status === 'COMPLETED'
        ? 'READY'
        : job.status === 'FAILED' || job.status === 'CANCELLED'
          ? 'ERROR'
          : 'IMPORTING';
  const project = state.projects.find((item) => item.jobId === job.jobId);
  if (project) {
    project.status =
      job.status === 'COMPLETED'
        ? 'READY'
        : job.status === 'FAILED' || job.status === 'CANCELLED'
          ? 'ERROR'
          : 'IMPORTING';
    project.diagnostic = job.diagnostic;
  }
  return job;
}
