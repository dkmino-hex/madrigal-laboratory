import type { Location, Source } from '../contracts/models';
import { config } from '../../../app/config';
import { decimal } from '../../model/precision';
import {
  array,
  bytes,
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

const sessions = new Map<string, Params>();
const cacheKey = (p: Params) =>
  JSON.stringify([config.gateway, p.projectId, p.assemblyId, p.sessionId]);
const diagnostics = (value: unknown) =>
  array(value ?? []).map((item) =>
    typeof item === 'string' ? item : text(record(item).code ?? record(item).message, 'diagnostic'),
  );
export function capture(raw: unknown, projectId: unknown) {
  const value = record(raw);
  if (value.projectId !== undefined && value.projectId !== projectId)
    incompatible('Запись относится к другому проекту.');
  return {
    captureId: text(value.captureId),
    projectId: text(projectId),
    name: text(value.originalName),
    size: integer(value.sizeBytes),
    packets: integer(value.packetCount ?? 0),
    sha256: text(value.sha256),
    status: text(value.status),
    importedAt: text(value.createdAt),
    synthetic: false,
    ...(diagnostics(value.diagnostics).length
      ? { diagnostic: diagnostics(value.diagnostics).join('; ') }
      : {}),
  };
}
export async function captures(ctx: Context, p: Params) {
  const data = page(
    await ctx.wire(
      'captures',
      { projectId: p.projectId, cursor: cursor(p.cursor), limit: p.limit ?? config.pageSize },
      ctx.options,
    ),
  );
  return { ...data, items: data.items.map((item) => capture(item, p.projectId)) };
}
export async function session(ctx: Context, p: Params): Promise<Params> {
  const key = cacheKey(p);
  const cached = sessions.get(key);
  if (cached) {
    if (p.captureId && cached.captureId !== p.captureId)
      incompatible('Сессия относится к другой записи.');
    return cached;
  }
  const value = record(
    await ctx.wire(
      'session',
      { projectId: p.projectId, sessionId: p.sessionId, assemblyId: p.assemblyId },
      ctx.options,
    ),
  );
  if (
    value.sessionId !== p.sessionId ||
    value.assemblyId !== p.assemblyId ||
    (p.captureId && value.captureId !== p.captureId)
  )
    incompatible('Сессия относится к другой записи или сборке.');
  sessions.set(key, value);
  if (sessions.size > 128) sessions.delete(sessions.keys().next().value!);
  return value;
}

export async function sessionForStream(ctx: Context, p: Params) {
  for (const [key, value] of sessions) {
    if (key !== cacheKey({ ...p, sessionId: value.sessionId })) continue;
    if (
      array(value.streams)
        .map(record)
        .some((stream) => stream.streamId === p.streamId)
    )
      return value;
  }
  const data = page(
    await ctx.wire(
      'sessions',
      { projectId: p.projectId, assemblyId: p.assemblyId, streamId: p.streamId, limit: 1 },
      ctx.options,
    ),
  );
  if (data.items.length !== 1) incompatible('Сессия потока не найдена в сборке.');
  const item = record(data.items[0]);
  return session(ctx, { ...p, sessionId: item.sessionId, captureId: item.captureId });
}
export async function locateSession(ctx: Context, p: Params) {
  for (const [key, value] of sessions)
    if (
      key === cacheKey({ ...p, assemblyId: value.assemblyId }) &&
      value.sessionId === p.sessionId &&
      value.captureId === p.captureId
    )
      return value;
  let next: string | null | undefined;
  const seen = new Set<string>();
  do {
    const data = page(
      await ctx.wire(
        'sessions',
        { projectId: p.projectId, captureId: p.captureId, cursor: next, limit: 100 },
        ctx.options,
      ),
    );
    const found = data.items.map(record).find((item) => item.sessionId === p.sessionId);
    if (found) return session(ctx, { ...p, assemblyId: found.assemblyId });
    next = data.nextCursor;
    if (next && seen.has(next)) incompatible('Повторяется cursor списка сессий.');
    if (next) seen.add(next);
  } while (next);
  return incompatible('Сессия не найдена в выбранной записи.');
}
export async function sessionPage(ctx: Context, p: Params) {
  const data = page(
    await ctx.wire(
      'sessions',
      {
        projectId: p.projectId,
        captureId: p.captureId,
        assemblyId: p.assemblyId,
        cursor: cursor(p.cursor),
        limit: p.limit ?? config.pageSize,
        q: p.q,
        defects: p.defects,
      },
      ctx.options,
    ),
  );
  const items = await parallel(data.items, async (item) => {
    const value = record(item);
    const detail = await session(ctx, {
      ...p,
      assemblyId: value.assemblyId,
      sessionId: value.sessionId,
    });
    const streams = array(detail.streams).map(record);
    const a = record(detail.endpointA),
      b = record(detail.endpointB);
    const streamA = streams.find((stream) => stream.direction === 'A_TO_B');
    const streamB = streams.find((stream) => stream.direction === 'B_TO_A');
    if (!streamA || !streamB) incompatible('У сессии отсутствуют направления.');
    return {
      sessionId: text(detail.sessionId),
      captureId: text(detail.captureId),
      generation: Number(integer(detail.generation)),
      sideA: `${text(a.ip)}:${integer(a.port)}`,
      sideB: `${text(b.ip)}:${integer(b.port)}`,
      role: detail.roleStatus === 'KNOWN' ? 'KNOWN' : 'UNKNOWN',
      startTime: text(detail.firstSeen),
      endTime: text(detail.lastSeen),
      bytes: String(
        streams.reduce((total, stream) => total + BigInt(integer(stream.logicalLength)), 0n),
      ),
      defects: [
        ...new Set([
          ...diagnostics(detail.diagnostics),
          ...streams.flatMap((stream) => diagnostics(stream.diagnostics)),
        ]),
      ],
      streamA: text(streamA.streamId),
      streamB: text(streamB.streamId),
    };
  });
  return { ...data, items };
}
export async function assemblies(ctx: Context, p: Params) {
  const selected = await locateSession(ctx, p);
  const data = page(
    await ctx.wire('assemblies', { projectId: p.projectId, captureId: p.captureId }, ctx.options),
  );
  const metadata = data.items.map(record).find((item) => item.assemblyId === selected.assemblyId);
  if (!metadata) incompatible('Сборка сессии не найдена.');
  return {
    items: array(selected.streams).map((raw) => {
      const stream = record(raw);
      return {
        assemblyId: text(metadata.assemblyId),
        captureId: text(p.captureId),
        sessionId: text(p.sessionId),
        streamId: text(stream.streamId),
        direction: text(stream.direction),
        settingsVersion: text(metadata.settingsVersion),
        status: metadata.status === 'BUILDING' ? 'BUILDING' : text(metadata.status),
        length: integer(stream.logicalLength),
      };
    }),
    nextCursor: null,
  };
}
export async function checkedLocation(ctx: Context, location: Location) {
  const detail = await session(ctx, location);
  const stream = array(detail.streams)
    .map(record)
    .find((item) => item.streamId === location.streamId && item.direction === location.direction);
  if (!stream) incompatible('Направление не соответствует потоку сборки.');
  return stream;
}
function span(raw: unknown, location: Location, seen: Set<string>): Source {
  const value = record(raw);
  const start = integer(value.streamStart),
    end = integer(value.streamEnd);
  const alternative = text(value.alternativeId, '');
  const signature = `${start}:${end}`;
  const relation = alternative
    ? 'conflict-alternative'
    : seen.has(signature)
      ? 'retransmission'
      : 'primary';
  seen.add(signature);
  return {
    captureId: location.captureId,
    packetNo: Number(integer(value.packetNo)),
    frameOffset: decimal(integer(value.frameStart)),
    length: decimal(String(BigInt(end) - BigInt(start))),
    streamStart: decimal(start),
    relation,
    ...(alternative ? { alternativeGroupId: alternative } : {}),
  };
}
export async function sources(ctx: Context, location: Location): Promise<Source[]> {
  await checkedLocation(ctx, location);
  const value = record(
    await ctx.wire(
      'sources',
      {
        projectId: location.projectId,
        assemblyId: location.assemblyId,
        streamId: location.streamId,
        offset: location.start,
        length: location.length,
      },
      ctx.options,
    ),
  );
  if (value.assemblyId !== location.assemblyId || value.streamId !== location.streamId)
    incompatible('SourceMap относится к другому потоку.');
  const seen = new Set<string>();
  return array(value.sources).map((item) => span(item, location, seen));
}
export async function window(ctx: Context, location: Location) {
  const stream = await checkedLocation(ctx, location);
  const value = record(
    await ctx.wire(
      'bytes',
      {
        projectId: location.projectId,
        assemblyId: location.assemblyId,
        streamId: location.streamId,
        offset: location.start,
        length: location.length,
      },
      ctx.options,
    ),
  );
  if (value.assemblyId !== location.assemblyId || value.streamId !== location.streamId)
    incompatible('Байты относятся к другому потоку.');
  const segments = await parallel(array(value.intervals), async (raw) => {
    const item = record(raw),
      start = integer(item.startOffset),
      end = integer(item.endOffset);
    if (item.kind === 'DATA') return { kind: 'known', start, bytes: bytes(item.data) };
    if (item.kind === 'CONFLICT') {
      const proof = await sources(ctx, {
        ...location,
        start: decimal(start),
        length: decimal(String(BigInt(end) - BigInt(start))),
      });
      const ids = [
        ...new Set(proof.map((s) => s.alternativeGroupId).filter((s): s is string => !!s)),
      ].sort();
      const alternatives = array(item.alternatives);
      if (ids.length !== alternatives.length)
        incompatible('Альтернативы и SourceMap конфликта не совпадают.');
      return {
        kind: 'conflict',
        start,
        length: String(BigInt(end) - BigInt(start)),
        alternatives: alternatives.map((data, index) => ({
          bytes: bytes(data),
          sources: proof.filter((s) => s.alternativeGroupId === ids[index]),
        })),
      };
    }
    if (item.kind !== 'GAP') incompatible('Неизвестный интервал Capture.');
    return {
      kind: 'gap',
      start,
      length: String(BigInt(end) - BigInt(start)),
      reason: 'Байты отсутствуют в записи.',
    };
  });
  return { location, streamLength: integer(stream.logicalLength), segments };
}
export async function packet(ctx: Context, p: Params) {
  const value = record(await ctx.wire('packet', p, ctx.options));
  return {
    captureId: text(value.captureId),
    packetNo: Number(integer(value.packetNo)),
    timestamp: text(value.timestamp),
    capturedLength: integer(value.capturedLength),
    originalLength: integer(value.originalLength),
    headers: [
      `${text(value.sourceIp, '')}:${integer(value.sourcePort ?? 0)} → ${text(value.destinationIp, '')}:${integer(value.destinationPort ?? 0)}`,
      `TCP checksum: ${text(value.checksumStatus)}`,
      ...diagnostics(value.diagnostics),
    ],
    bytes: bytes(value.frame),
  };
}
export async function search(ctx: Context, p: Params) {
  const location = p as unknown as Location;
  const stream = await checkedLocation(ctx, location);
  const value = record(
    await ctx.wire(
      'search',
      {
        projectId: p.projectId,
        assemblyId: p.assemblyId,
        streamId: p.streamId,
        mode: p.mode,
        pattern: p.pattern,
        cursor: p.cursor,
        limit: 20,
      },
      ctx.options,
    ),
  );
  const data = page(value);
  return {
    ...data,
    items: data.items.map((raw) => {
      const item = record(raw);
      return {
        ...location,
        start: integer(item.startOffset),
        length: String(BigInt(integer(item.endOffset)) - BigInt(integer(item.startOffset))),
      };
    }),
    complete: !data.nextCursor,
    searchedBytes: integer(stream.logicalLength),
  };
}
export async function captureJob(
  ctx: Context,
  operation: 'uploadCapture' | 'createAssembly',
  p: Params,
) {
  const raw = record(
    await ctx.wire(
      operation,
      operation === 'createAssembly'
        ? { projectId: p.projectId, captureId: p.captureId, settingsVersion: p.settingsVersion }
        : p,
      ctx.options,
    ),
  );
  return {
    job: await readJob(ctx, p.projectId, raw.jobId),
    ...(operation === 'uploadCapture' ? { duplicate: raw.duplicate === true } : {}),
  };
}
