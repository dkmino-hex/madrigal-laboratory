import { config } from '../../../app/config';
import type { Location, Source } from '../contracts/models';
import { decimal } from '../../model/precision';
import {
  array,
  checkedJob,
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
import { session, sessionForStream } from './capture';

const projectContexts = new WeakMap<Context, Promise<Params>>();
function currentProject(ctx: Context, projectId: unknown) {
  let current = projectContexts.get(ctx);
  if (!current) {
    current = ctx.wire('project', { projectId }, ctx.options).then(record);
    projectContexts.set(ctx, current);
  }
  return current;
}

function revision(raw: unknown) {
  const item = record(raw);
  return {
    revisionId: text(item.revisionId),
    interpretationId: text(item.interpretationId),
    createdAt: text(item.createdAt),
    json: text(item.schemaJson),
    label: text(item.changeComment, '') || `Ревизия ${integer(item.version)}`,
    ...(item.parentRevisionId ? { parentRevisionId: text(item.parentRevisionId) } : {}),
  };
}
async function revisions(ctx: Context, p: Params) {
  const items: Params[] = [];
  let next: string | null | undefined;
  const seen = new Set<string>();
  do {
    const data = page(await ctx.wire('revisions', { ...p, cursor: next, limit: 100 }, ctx.options));
    items.push(...data.items.map(record));
    next = data.nextCursor;
    if (next && seen.has(next)) incompatible('Повторяется cursor ревизий.');
    if (next) seen.add(next);
  } while (next);
  return items
    .sort((a, b) => Number(integer(a.version)) - Number(integer(b.version)))
    .map(revision);
}
export async function interpretation(ctx: Context, raw: unknown) {
  const item = record(raw);
  return {
    interpretationId: text(item.interpretationId),
    projectId: text(item.projectId),
    name: text(item.name),
    revisions: await revisions(ctx, {
      projectId: item.projectId,
      interpretationId: item.interpretationId,
    }),
  };
}
export async function interpretations(ctx: Context, p: Params) {
  const data = page(
    await ctx.wire('interpretations', { ...p, cursor: cursor(p.cursor) }, ctx.options),
  );
  return { ...data, items: await parallel(data.items, (item) => interpretation(ctx, item)) };
}
export async function createInterpretation(ctx: Context, p: Params) {
  const result = await ctx.wire(
    'createInterpretation',
    {
      projectId: p.projectId,
      name: p.name,
      description: p.description ?? '',
      schemaJson: p.json ?? '{"fields":[]}',
    },
    ctx.options,
  );
  return interpretation(ctx, result);
}
export async function saveRevision(ctx: Context, p: Params) {
  return revision(
    await ctx.wire(
      'saveRevision',
      {
        projectId: p.projectId,
        interpretationId: p.interpretationId,
        schemaJson: p.json,
        changeComment: p.label ?? '',
        parentRevisionId: p.parentRevisionId ?? '',
      },
      ctx.options,
    ),
  );
}
async function location(
  ctx: Context,
  projectId: unknown,
  raw: unknown,
  hint?: Location,
): Promise<Location> {
  const span = record(raw);
  if (hint && (span.assemblyId !== hint.assemblyId || span.streamId !== hint.streamId))
    incompatible('Analysis вернул другой поток.');
  let detail: Params;
  if (hint) detail = await session(ctx, hint);
  else
    detail = await sessionForStream(ctx, {
      projectId,
      assemblyId: span.assemblyId,
      streamId: span.streamId,
    });
  const stream = array(detail.streams)
    .map(record)
    .find((item) => item.streamId === span.streamId);
  if (!stream) incompatible('Поток результата не найден в сессии.');
  const start = integer(span.startOffset),
    end = integer(span.endOffset);
  if (BigInt(end) < BigInt(start) || BigInt(end) > BigInt(integer(stream.logicalLength)))
    incompatible('Диапазон результата выходит за пределы потока.');
  return {
    projectId: text(projectId),
    captureId: text(detail.captureId),
    sessionId: text(detail.sessionId),
    assemblyId: text(span.assemblyId),
    streamId: text(span.streamId),
    direction: text(stream.direction) as Location['direction'],
    start: decimal(start),
    length: decimal(String(BigInt(end) - BigInt(start))),
  };
}
function proof(raw: unknown, at: Location): Source[] {
  const span = record(raw),
    seen = new Set<string>();
  return array(span.packetRefs ?? []).flatMap((raw) => {
    const item = record(raw),
      lo = BigInt(integer(item.streamStart)),
      hi = BigInt(integer(item.streamEnd));
    const start = lo > BigInt(at.start) ? lo : BigInt(at.start);
    const end =
      hi < BigInt(at.start) + BigInt(at.length) ? hi : BigInt(at.start) + BigInt(at.length);
    if (end <= start) return [];
    const alternative = text(item.alternativeId, ''),
      signature = `${start}:${end}`;
    const relation = alternative
      ? 'conflict-alternative'
      : seen.has(signature)
        ? 'retransmission'
        : 'primary';
    seen.add(signature);
    return [
      {
        captureId: at.captureId,
        packetNo: Number(integer(item.packetNo)),
        frameOffset: decimal(String(BigInt(integer(item.frameStart)) + start - lo)),
        length: decimal(String(end - start)),
        streamStart: decimal(String(start)),
        relation,
        ...(alternative ? { alternativeGroupId: alternative } : {}),
      } satisfies Source,
    ];
  });
}
async function result(ctx: Context, projectId: unknown, raw: unknown, hint?: Location) {
  const item = record(raw),
    at = await location(ctx, projectId, item.sourceSpan, hint),
    checks = array(item.checks ?? []).map(record);
  const id = `${at.assemblyId}:${at.streamId}:${at.start}`;
  const reason =
    checks
      .map((item) => text(item.message, ''))
      .filter(Boolean)
      .join('; ') ||
    (checks.length
      ? 'Проверки применены к известным байтам.'
      : 'Для сообщения не заданы проверки.');
  const fields = await parallel(array(item.fields ?? []), async (raw) => {
    const field = record(raw),
      span = record(field.sourceSpan);
    const fieldLocation = await location(ctx, projectId, span, at);
    const related = checks.filter(
      (check) =>
        check.sourceSpan &&
        record(check.sourceSpan).startOffset === span.startOffset &&
        record(check.sourceSpan).endOffset === span.endOffset,
    );
    const status = related.some((check) => check.status === 'FAIL')
      ? 'FAIL'
      : related.some((check) => check.status === 'INCONCLUSIVE')
        ? 'INCONCLUSIVE'
        : related.length
          ? 'PASS'
          : 'NOT_APPLICABLE';
    return {
      fieldId: `${id}:${text(field.name)}`,
      path: text(field.name),
      type: text(field.type, 'unknown'),
      value:
        field.valueText === undefined
          ? field.value == null
            ? null
            : typeof field.value === 'number' && !Number.isSafeInteger(field.value)
              ? incompatible('У поля нет точного строкового значения.')
              : String(field.value)
          : text(field.valueText),
      location: fieldLocation,
      sources: proof(span, fieldLocation),
      status,
      reason:
        related
          .map((check) => text(check.message, ''))
          .filter(Boolean)
          .join('; ') || 'Проверка поля не задана.',
      rule: related.map((check) => text(check.ruleId)).join(', '),
    };
  });
  return {
    resultId: id,
    messageId: id,
    status: checks.length
      ? text(item.status)
      : item.status === 'INCONCLUSIVE'
        ? 'INCONCLUSIVE'
        : 'NOT_APPLICABLE',
    reason,
    rule: checks.map((item) => text(item.ruleId)).join(', '),
    location: at,
    fields,
    sources: proof(item.sourceSpan, at),
  };
}
export async function preview(ctx: Context, p: Params) {
  const at = p.location as Location;
  const raw = record(
    await ctx.wire(
      'preview',
      {
        projectId: p.projectId,
        revisionId: p.revisionId,
        assemblyId: at.assemblyId,
        streamId: at.streamId,
        offset: at.start,
        length: at.length,
      },
      ctx.options,
    ),
  );
  const unknown = await parallel(array(raw.unknownRegions ?? []), (span) =>
    location(ctx, p.projectId, span, at),
  );
  const errors = array(raw.errors ?? []).map((item) => {
    const error = record(item),
      code = text(error.code, '');
    const titles: Record<string, string> = {
      FIELD_OUT_OF_RANGE: 'Поле выходит за границу сообщения',
      INCONCLUSIVE: 'Недостаточно известных байтов',
      FIELD_DECODE: 'Не удалось прочитать поле',
      LIMIT: 'Достигнут предел разбора',
    };
    return (titles[code] || code ? (titles[code] ?? code) + ': ' : '') + text(error.message);
  });
  return {
    revisionId: p.revisionId,
    location: at,
    results: await parallel(array(raw.messages ?? []), (item) =>
      result(ctx, p.projectId, item, at),
    ),
    unknown,
    complete: unknown.length === 0 && errors.length === 0,
    ...(errors.length ? { diagnostic: errors.join('; ') } : {}),
  };
}
export async function run(ctx: Context, raw: unknown) {
  const item = record(raw),
    manifest = record(JSON.parse(text(item.inputManifestJson, '{}'))),
    summary = record(item.summary);
  const rules = record(summary.rules ?? {}),
    job = item.job
      ? checkedJob(record(item.job), item.projectId, item.jobId)
      : await readJob(ctx, item.projectId, item.jobId);
  const current = await currentProject(ctx, item.projectId);
  const corpus = array(
    manifest.corpus ?? [
      { captureId: item.captureId, assemblyId: item.assemblyId, sha256: item.captureSha256 },
    ],
  );
  return {
    runId: text(item.runId),
    projectId: text(item.projectId),
    jobId: text(item.jobId),
    createdAt: text(item.createdAt),
    status: job.status === 'CANCEL_REQUESTED' ? 'RUNNING' : job.status,
    manifest: {
      revisionId: text(item.revisionId),
      settingsVersion: text(item.settingsVersion),
      engineVersion: text(manifest.engineVersion ?? item.captureEngineVersion),
      filters: 'Все сообщения выбранных сборок',
      synthetic: false,
      ...(typeof manifest.actionsComplete === 'boolean'
        ? {
            actionSnapshotCount: String(array(manifest.actionSnapshot ?? []).length),
            actionsComplete: manifest.actionsComplete,
          }
        : {}),
      corpus,
    },
    summary: {
      messages: integer(summary.messages ?? 0),
      knownBytes: integer(summary.knownBytes ?? 0),
      unknownBytes: integer(summary.unknownBytes ?? 0),
      captures: integer(
        summary.captures ?? new Set(corpus.map((item) => record(item).captureId)).size,
      ),
      sessions: integer(summary.sessions ?? 0),
      rules: Object.fromEntries(
        ['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'UNKNOWN'].map((status) => [
          status,
          integer(rules[status] ?? 0),
        ]),
      ),
      messageStatuses: summary.messageStatuses
        ? Object.fromEntries(
            ['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'UNKNOWN'].map((status) => [
              status,
              integer(record(summary.messageStatuses)[status] ?? 0),
            ]),
          )
        : undefined,
      complete: job.status === 'COMPLETED' && summary.complete === true,
    },
    historical: item.historical === true || current.settingsVersion !== item.settingsVersion,
  };
}
export async function runs(ctx: Context, p: Params) {
  const statuses: Record<string, string> = {
    QUEUED: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    INTERRUPTED: 'interrupted',
  };
  const data = page(
    await ctx.wire(
      'runs',
      {
        ...p,
        status: p.status ? statuses[text(p.status)] : undefined,
        cursor: cursor(p.cursor),
        limit: p.limit ?? config.pageSize,
      },
      ctx.options,
    ),
  );
  return { ...data, items: await parallel(data.items, (item) => run(ctx, item)) };
}
export async function createRun(ctx: Context, p: Params) {
  const raw = record(
    await ctx.wire(
      'createRun',
      {
        projectId: p.projectId,
        revisionId: p.revisionId,
        settingsVersion: p.settingsVersion,
        corpus: p.corpus,
        filters: { scope: 'all' },
      },
      ctx.options,
    ),
  );
  return {
    job: await readJob(ctx, p.projectId, raw.jobId),
    run: await run(
      ctx,
      await ctx.wire('run', { projectId: p.projectId, runId: raw.runId }, ctx.options),
    ),
  };
}
export async function results(ctx: Context, p: Params) {
  if (p.view === 'checks') {
    const data = page(
      await ctx.wire('results', { ...p, ruleId: p.rule, cursor: cursor(p.cursor) }, ctx.options),
    );
    return {
      ...data,
      items: await parallel(data.items, async (raw) => {
        const check = record(raw);
        const at = check.sourceSpan
          ? await location(ctx, p.projectId, check.sourceSpan)
          : undefined;
        return {
          checkId: JSON.stringify([check.ruleId, check.sourceSpan, check.status, check.message]),
          rule: text(check.ruleId),
          status: text(check.status),
          reason: text(check.message, ''),
          ...(at ? { location: at } : {}),
          sources: at ? proof(check.sourceSpan, at) : [],
        };
      }),
    };
  }
  const data = page(
    await ctx.wire(
      'results',
      { ...p, view: 'messages', ruleId: p.rule, cursor: cursor(p.cursor) },
      ctx.options,
    ),
  );
  return { ...data, items: await parallel(data.items, (item) => result(ctx, p.projectId, item)) };
}
