import { z } from 'zod';
import * as dto from './contracts/draft';
import { ApiError, request, type RequestOptions } from './transport';
import { sameContext } from '../model/navigation';
import { segmentLength } from '../model/bytes';

// Точка DTO → VM: компоненты получают проверенные предметные модели, без envelope.
export const adaptWindow = (value: dto.ByteWindow): dto.ByteWindow => ({
  ...value,
  location: { ...value.location },
  segments: value.segments.map((segment) =>
    segment.kind === 'known' ? { ...segment, bytes: [...segment.bytes] } : { ...segment },
  ),
});
const fileResult = z.object({
  job: dto.jobSchema,
  duplicate: z.boolean().optional(),
  capture: dto.captureSchema.optional(),
  project: dto.projectSchema.optional(),
});
const jobResult = z.object({
  job: dto.jobSchema,
  artifact: dto.artifactSchema.optional(),
  run: dto.runSchema.optional(),
});
async function checked<T>(response: Promise<T>, matches: (data: T) => boolean): Promise<T> {
  const data = await response;
  if (!matches(data))
    throw new ApiError(
      'INCOMPATIBLE_RESPONSE',
      'Ответ относится к другому объекту или контексту запроса.',
    );
  return data;
}
const ownInterpretation = (item: dto.Interpretation, projectId: unknown) =>
  item.projectId === projectId &&
  item.revisions.every((revision) => revision.interpretationId === item.interpretationId);
const ownEvidence = (item: dto.Evidence, projectId: unknown) =>
  item.location.projectId === projectId &&
  item.sources.every((source) => source.captureId === item.location.captureId);
const ownJobResult = (
  data: z.infer<typeof jobResult>,
  projectId: string,
  owner: dto.Job['owner'],
) =>
  data.job.projectId === projectId &&
  data.job.owner === owner &&
  (!data.artifact || data.artifact.projectId === projectId) &&
  (!data.run || data.run.projectId === projectId);
export const api = {
  projects: (params: Record<string, unknown> = {}, options?: RequestOptions) =>
    request('projects', params, dto.pageSchema(dto.projectSchema), options),
  project: (projectId: string, options?: RequestOptions) =>
    checked(
      request('project', { projectId }, dto.projectSchema, options),
      (data) => data.projectId === projectId,
    ),
  createProject: (params: { name: string; description: string }, options?: RequestOptions) =>
    request('createProject', params, dto.projectSchema, options),
  captures: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('captures', params, dto.pageSchema(dto.captureSchema), options), (data) =>
      data.items.every((item) => item.projectId === params.projectId),
    ),
  uploadCapture: (params: { projectId: string }, options: RequestOptions) =>
    checked(
      request('uploadCapture', params, fileResult, options),
      (data) =>
        data.job.projectId === params.projectId &&
        data.job.owner === 'Capture' &&
        (!data.capture || data.capture.projectId === params.projectId) &&
        (!data.project || data.project.projectId === params.projectId),
    ),
  importProject: (params: Record<string, unknown>, options: RequestOptions) =>
    request('importProject', params, fileResult, options),
  exportProject: (projectId: string, options?: RequestOptions) =>
    checked(request('exportProject', { projectId }, jobResult, options), (data) =>
      ownJobResult(data, projectId, 'Workspace'),
    ),
  sessions: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('sessions', params, dto.pageSchema(dto.sessionSchema), options), (data) =>
      data.items.every((item) => item.captureId === params.captureId),
    ),
  assemblies: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('assemblies', params, dto.pageSchema(dto.assemblySchema), options), (data) =>
      data.items.every(
        (item) => item.captureId === params.captureId && item.sessionId === params.sessionId,
      ),
    ),
  bytes: async (location: dto.Location, options?: RequestOptions) => {
    const window = await request('bytes', location, dto.windowSchema, options);
    if (
      !sameContext(window.location, location) ||
      window.location.start !== location.start ||
      window.location.length !== location.length ||
      BigInt(location.start) + BigInt(location.length) > BigInt(window.streamLength)
    )
      throw new ApiError(
        'INCOMPATIBLE_RESPONSE',
        'Ответ bytes относится к другой сборке или диапазону.',
      );
    let position = BigInt(location.start);
    for (const segment of window.segments) {
      if (BigInt(segment.start) !== position || segmentLength(segment) <= 0n)
        throw new ApiError(
          'INCOMPATIBLE_RESPONSE',
          'Сегменты bytes имеют неверные границы или скрытый пропуск.',
        );
      if (
        segment.kind === 'conflict' &&
        segment.alternatives.some((item) => BigInt(item.bytes.length) !== segmentLength(segment))
      )
        throw new ApiError(
          'INCOMPATIBLE_RESPONSE',
          'Длины альтернатив конфликта не соответствуют диапазону.',
        );
      position += segmentLength(segment);
    }
    if (position !== BigInt(location.start) + BigInt(location.length))
      throw new ApiError('INCOMPATIBLE_RESPONSE', 'Ответ bytes не охватывает запрошенное окно.');
    return adaptWindow(window);
  },
  sources: async (location: dto.Location, options?: RequestOptions) => {
    const sources = await request('sources', location, z.array(dto.sourceSchema), options);
    if (
      sources.some(
        (source) =>
          source.captureId !== location.captureId ||
          BigInt(source.length) === 0n ||
          BigInt(source.streamStart) >= BigInt(location.start) + BigInt(location.length) ||
          BigInt(source.streamStart) + BigInt(source.length) <= BigInt(location.start),
      )
    )
      throw new ApiError(
        'INCOMPATIBLE_RESPONSE',
        'Источники относятся к другой записи или диапазону.',
      );
    const frameDeltas = new Map<number, bigint>();
    for (const source of sources) {
      const delta = BigInt(source.frameOffset) - BigInt(source.streamStart);
      if (frameDeltas.has(source.packetNo) && frameDeltas.get(source.packetNo) !== delta)
        throw new ApiError(
          'INCOMPATIBLE_RESPONSE',
          'Участки одного TCP-кадра имеют несогласованные координаты потока. Другой источник не подставляется.',
        );
      frameDeltas.set(source.packetNo, delta);
    }
    return sources;
  },
  packet: async (
    params: { projectId: string; captureId: string; packetNo: number },
    options?: RequestOptions,
  ) => {
    const packet = await request('packet', params, dto.packetSchema, options);
    if (
      packet.captureId !== params.captureId ||
      packet.packetNo !== params.packetNo ||
      BigInt(packet.capturedLength) !== BigInt(packet.bytes.length) ||
      BigInt(packet.originalLength) < BigInt(packet.capturedLength)
    )
      throw new ApiError(
        'INCOMPATIBLE_RESPONSE',
        'Ответ packet относится к другому кадру или имеет неверные длины.',
      );
    return packet;
  },
  search: (params: Record<string, unknown>, options?: RequestOptions) =>
    request(
      'search',
      params,
      z.object({
        items: z.array(dto.locationSchema).max(20),
        nextCursor: z.string().nullable(),
        complete: z.boolean(),
        searchedBytes: z.string(),
      }),
      options,
    ),
  settings: (projectId: string, settingsVersion?: string, options?: RequestOptions) =>
    request('settings', { projectId, settingsVersion }, z.array(dto.settingsSchema), options),
  saveSettings: (
    projectId: string,
    settings: Omit<dto.Settings, 'settingsVersion'>,
    options?: RequestOptions,
  ) => request('saveSettings', { projectId, ...settings }, dto.settingsSchema, options),
  createAssembly: (params: Record<string, unknown>, options?: RequestOptions) =>
    request('createAssembly', params, jobResult, options),
  actions: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('actions', params, dto.pageSchema(dto.actionSchema), options), (data) =>
      data.items.every((item) => item.projectId === params.projectId),
    ),
  importActions: (params: Record<string, unknown>, options: RequestOptions) =>
    request(
      'importActions',
      params,
      z.object({
        imported: z.number().int(),
        partial: z.boolean(),
        errors: z.array(z.object({ row: z.number().int(), reason: z.string() })),
      }),
      options,
    ),
  evidence: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('evidence', params, dto.pageSchema(dto.evidenceSchema), options), (data) =>
      data.items.every((item) => ownEvidence(item, params.projectId)),
    ),
  saveEvidence: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('saveEvidence', params, dto.evidenceSchema, options), (data) => {
      const location = dto.locationSchema.safeParse(params.location);
      return (
        location.success &&
        ownEvidence(data, params.projectId) &&
        sameContext(data.location, location.data) &&
        data.location.start === location.data.start &&
        data.location.length === location.data.length &&
        (!params.evidenceId || data.evidenceId === params.evidenceId)
      );
    }),
  hypotheses: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('hypotheses', params, dto.pageSchema(dto.hypothesisSchema), options), (data) =>
      data.items.every(
        (item) =>
          item.projectId === params.projectId &&
          item.evidence.every((proof) => ownEvidence(proof, params.projectId)),
      ),
    ),
  saveHypothesis: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(
      request('saveHypothesis', params, dto.hypothesisSchema, options),
      (data) =>
        data.projectId === params.projectId &&
        (!params.hypothesisId || data.hypothesisId === params.hypothesisId) &&
        data.evidence.every((proof) => ownEvidence(proof, params.projectId)),
    ),
  deleteHypothesis: (projectId: string, hypothesisId: string, options?: RequestOptions) =>
    checked(
      request(
        'deleteHypothesis',
        { projectId, hypothesisId },
        z.object({ projectId: z.string(), hypothesisId: z.string(), deleted: z.literal(true) }),
        options,
      ),
      (data) => data.projectId === projectId && data.hypothesisId === hypothesisId,
    ),
  interpretations: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(
      request('interpretations', params, dto.pageSchema(dto.interpretationSchema), options),
      (data) => data.items.every((item) => ownInterpretation(item, params.projectId)),
    ),
  interpretation: (projectId: string, interpretationId: string, options?: RequestOptions) =>
    checked(
      request('interpretation', { projectId, interpretationId }, dto.interpretationSchema, options),
      (data) => ownInterpretation(data, projectId) && data.interpretationId === interpretationId,
    ),
  createInterpretation: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('createInterpretation', params, dto.interpretationSchema, options), (data) =>
      ownInterpretation(data, params.projectId),
    ),
  saveRevision: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(
      request('saveRevision', params, dto.revisionSchema, options),
      (data) => data.interpretationId === params.interpretationId,
    ),
  preview: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('preview', params, dto.previewSchema, options), (data) => {
      const requested = dto.locationSchema.safeParse(params.location);
      return (
        requested.success &&
        data.revisionId === params.revisionId &&
        sameContext(data.location, requested.data) &&
        data.location.start === requested.data.start &&
        data.location.length === requested.data.length &&
        data.results.every(
          (result) =>
            sameContext(result.location, requested.data) &&
            result.fields.every((field) => sameContext(field.location, requested.data)),
        ) &&
        data.unknown.every((location) => sameContext(location, requested.data))
      );
    }),
  runs: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('runs', params, dto.pageSchema(dto.runSchema), options), (data) =>
      data.items.every((item) => item.projectId === params.projectId),
    ),
  run: (projectId: string, runId: string, options?: RequestOptions) =>
    checked(
      request('run', { projectId, runId }, dto.runSchema, options),
      (data) => data.projectId === projectId && data.runId === runId,
    ),
  createRun: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('createRun', params, jobResult, options), (data) => {
      if (!ownJobResult(data, String(params.projectId), 'Analysis')) return false;
      if (!data.run) return true;
      const requested = z
        .array(z.object({ captureId: z.string(), assemblyId: z.string() }))
        .safeParse(params.corpus);
      const keys = (items: { captureId: string; assemblyId: string }[]) =>
        items.map((item) => JSON.stringify([item.captureId, item.assemblyId])).sort();
      return (
        requested.success &&
        data.run.manifest.revisionId === params.revisionId &&
        data.run.manifest.settingsVersion === params.settingsVersion &&
        JSON.stringify(keys(requested.data)) === JSON.stringify(keys(data.run.manifest.corpus))
      );
    }),
  results: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('results', params, dto.pageSchema(dto.resultSchema), options), (data) =>
      data.items.every(
        (item) =>
          item.location.projectId === params.projectId &&
          item.fields.every((field) => field.location.projectId === params.projectId),
      ),
    ),
  job: (projectId: string, jobId: string, options?: RequestOptions) =>
    checked(
      request('job', { projectId, jobId }, dto.jobSchema, options),
      (data) => data.projectId === projectId && data.jobId === jobId,
    ),
  cancelJob: (projectId: string, jobId: string, options?: RequestOptions) =>
    request('cancelJob', { projectId, jobId }, dto.jobSchema, options),
  artifacts: (params: Record<string, unknown>, options?: RequestOptions) =>
    checked(request('artifacts', params, dto.pageSchema(dto.artifactSchema), options), (data) =>
      data.items.every((item) => item.projectId === params.projectId),
    ),
  createReport: (projectId: string, runId: string, options?: RequestOptions) =>
    checked(
      request('createReport', { projectId, runId }, jobResult, options),
      (data) =>
        ownJobResult(data, projectId, 'Workspace') &&
        (!data.artifact?.runId || data.artifact.runId === runId),
    ),
};
