import { config, gatewayUrl } from '../../../app/config';
import { shiftTimestamp } from '../../model/precision';
import { ApiError } from '../errors';
import {
  array,
  cursor,
  incompatible,
  integer,
  page,
  parallel,
  readJob,
  record,
  text,
  type Context,
  type Params,
} from './common';

export async function project(ctx: Context, raw: unknown) {
  const item = record(raw);
  const counts = record(
    await ctx.wire('captures', { projectId: item.projectId, limit: 1 }, ctx.options),
  );
  return {
    projectId: text(item.projectId),
    name: text(item.name),
    description: text(item.description, ''),
    status: text(item.status),
    updatedAt: text(item.updatedAt),
    captures: Number(integer(counts.total)),
    settingsVersion: text(item.settingsVersion),
  };
}
export async function projects(ctx: Context, p: Params) {
  const data = page(
    await ctx.wire(
      'projects',
      { cursor: cursor(p.cursor), limit: p.limit ?? config.pageSize, q: p.q },
      ctx.options,
    ),
  );
  return { ...data, items: await parallel(data.items, (item) => project(ctx, item)) };
}
export function settings(raw: unknown) {
  const item = record(raw),
    data = record(item.settings);
  return {
    settingsVersion: text(item.settingsVersion),
    timeZone: text(data.timeZone ?? data.timezone, 'UTC'),
    offsetNanoseconds: text(data.offsetNanoseconds ?? data.timeOffsetNs, '0'),
    checksum: text(data.checksum, 'warn'),
    overlap: text(data.overlap, 'preserve-alternatives'),
  };
}
export async function settingList(ctx: Context, p: Params) {
  const data = record(await ctx.wire('settings', p, ctx.options));
  return array(data.items).map(settings);
}
export async function saveSettings(ctx: Context, p: Params) {
  return settings(
    await ctx.wire(
      'saveSettings',
      {
        projectId: p.projectId,
        settings: {
          timeZone: p.timeZone,
          offsetNanoseconds: p.offsetNanoseconds,
          checksum: p.checksum,
          overlap: p.overlap,
        },
      },
      ctx.options,
    ),
  );
}
export async function actions(ctx: Context, p: Params) {
  const data = page(await ctx.wire('actions', { ...p, cursor: cursor(p.cursor) }, ctx.options));
  return {
    ...data,
    items: data.items.map((raw) => {
      const item = record(raw);
      return {
        actionId: text(item.actionId),
        projectId: text(item.projectId),
        name: text(item.name),
        type: text(item.type),
        parameters: text(item.parametersJson),
        timestamp: shiftTimestamp(text(item.start), String(-BigInt(text(item.timeOffsetNs)))),
        timeZone: text(item.timezone),
        offsetNanoseconds: text(item.timeOffsetNs),
        sourceFile: text(item.sourceFile),
        row: Number(integer(item.sourceLine)),
        importId: text(item.importId),
      };
    }),
  };
}
export async function importActions(ctx: Context, p: Params) {
  const raw = record(
    await ctx.wire(
      'importActions',
      {
        projectId: p.projectId,
        timezone: p.timeZone ?? 'UTC',
        timeOffsetNs: p.offsetNanoseconds ?? '0',
      },
      ctx.options,
    ),
  );
  return { job: await readJob(ctx, p.projectId, raw.jobId) };
}
export async function saveEvidence(ctx: Context, p: Params) {
  const location = record(p.location);
  const captures = await findCapture(ctx, location.projectId, location.captureId);
  const { projectId, ...body } = p;
  return ctx.wire(
    p.evidenceId ? 'patchEvidence' : 'saveEvidence',
    { ...body, projectId, captureSha256: captures.sha256 },
    ctx.options,
  );
}
export async function findCapture(ctx: Context, projectId: unknown, captureId: unknown) {
  let next: string | null | undefined;
  const seen = new Set<string>();
  do {
    const data = page(
      await ctx.wire('captures', { projectId, cursor: next, limit: 100 }, ctx.options),
    );
    const found = data.items.map(record).find((item) => item.captureId === captureId);
    if (found) return found;
    next = data.nextCursor;
    if (next && seen.has(next)) incompatible('Повторяется cursor записей.');
    if (next) seen.add(next);
  } while (next);
  throw new ApiError('NOT_FOUND', 'Запись не найдена в проекте.');
}
const toStatus: Record<string, string> = {
  open: 'DRAFT',
  supported: 'SUPPORTED',
  refuted: 'REFUTED',
  inconclusive: 'INCONCLUSIVE',
};
const fromStatus: Record<string, string> = Object.fromEntries(
  Object.entries(toStatus).map(([a, b]) => [b, a]),
);
export function hypothesis(raw: unknown, projectId: unknown) {
  const item = record(raw);
  return {
    hypothesisId: text(item.observationId),
    projectId: text(projectId),
    type: item.kind === 'OBSERVATION' ? 'observation' : 'hypothesis',
    text: text(item.text),
    basis: text(item.basis, ''),
    status: fromStatus[text(item.status)] ?? incompatible('Неизвестный статус наблюдения.'),
    evidence: array(item.sourceLinks ?? []),
    legacyEvidence: array(item.evidence ?? []),
    generation:
      item.generation && Object.keys(record(item.generation)).length ? item.generation : undefined,
  };
}
export async function saveAutomaticObservation(ctx: Context, p: Params) {
  const cache = new Map<unknown, Promise<Params>>();
  const examples = await parallel(array(p.examples), async (value) => {
    const example = record(value),
      location = record(example.location);
    if (example.captureSha256) return example;
    if (!cache.has(location.captureId))
      cache.set(location.captureId, findCapture(ctx, p.projectId, location.captureId));
    const capture = await cache.get(location.captureId)!;
    return { ...example, captureSha256: capture.sha256 };
  });
  return hypothesis(
    await ctx.wire('saveAutomaticObservation', { ...p, examples }, ctx.options),
    p.projectId,
  );
}
export async function hypotheses(ctx: Context, p: Params) {
  const data = page(
    await ctx.wire(
      'hypotheses',
      {
        projectId: p.projectId,
        cursor: cursor(p.cursor),
        limit: p.limit ?? config.pageSize,
        kind: p.type ? String(p.type).toUpperCase() : undefined,
        status: p.status ? toStatus[text(p.status)] : undefined,
        source: p.source,
      },
      ctx.options,
    ),
  );
  return { ...data, items: data.items.map((item) => hypothesis(item, p.projectId)) };
}
export async function saveHypothesis(ctx: Context, p: Params) {
  const sourceLinks = array(p.evidence ?? []).map((raw) => {
    const item = record(raw);
    return { evidenceId: item.evidenceId, kind: item.kind };
  });
  const input = {
    projectId: p.projectId,
    text: p.text,
    basis: p.basis,
    status: toStatus[text(p.status)],
    sourceLinks,
    kind: text(p.type).toUpperCase(),
  };
  const result = p.hypothesisId
    ? await ctx.wire('patchHypothesis', { ...input, hypothesisId: p.hypothesisId }, ctx.options)
    : await ctx.wire('saveHypothesis', input, ctx.options);
  return hypothesis(result, p.projectId);
}
function artifact(raw: unknown) {
  const item = record(raw);
  return {
    artifactId: text(item.artifactId),
    projectId: text(item.projectId),
    jobId: text(item.jobId),
    ...(item.runId ? { runId: text(item.runId) } : {}),
    ...(item.snapshotId ? { snapshotId: text(item.snapshotId) } : {}),
    kind: item.kind === 'PROJECT_ZIP' ? 'project' : 'report',
    status:
      item.status === 'BUILDING'
        ? 'PENDING'
        : item.status === 'ERROR'
          ? 'FAILED'
          : text(item.status),
    name: text(item.name),
    contentType: text(item.contentType),
    ...(item.status === 'READY' ? { downloadUrl: gatewayUrl(text(item.downloadUrl)) } : {}),
  };
}
export async function artifacts(ctx: Context, p: Params) {
  const data = page(await ctx.wire('artifacts', { ...p, cursor: cursor(p.cursor) }, ctx.options));
  return { ...data, items: data.items.map(artifact) };
}
export async function workspaceJob(
  ctx: Context,
  operation: 'createReport' | 'exportProject' | 'importProject',
  p: Params,
) {
  const input =
    operation === 'importProject'
      ? { ...p, importId: p.importId ?? ctx.options.idempotencyKey ?? crypto.randomUUID() }
      : p;
  const raw = record(await ctx.wire(operation, input, ctx.options));
  return { job: await readJob(ctx, raw.projectId ?? p.projectId, raw.jobId) };
}
