import { ApiError } from '../errors';
import type { RequestOptions } from '../transport';
import type { WireOperation } from '../registry';

export type Params = Record<string, unknown>;
export type Wire = (
  operation: WireOperation,
  params: Params,
  options?: RequestOptions,
) => Promise<unknown>;
export type Context = { wire: Wire; options: RequestOptions };
export function record(value: unknown): Params {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    incompatible('Ожидался объект API.');
  return value as Params;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) incompatible('Ожидался список API.');
  return value;
}
export function text(value: unknown, fallback?: string): string {
  if (typeof value === 'string') return value;
  if (value == null && fallback !== undefined) return fallback;
  return incompatible('Ожидалась строка API.');
}
export function integer(value: unknown): string {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value).toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return incompatible('API вернул неточное или отрицательное целое число.');
}
export function incompatible(message: string): never {
  throw new ApiError('INCOMPATIBLE_RESPONSE', message);
}
export function page(raw: unknown) {
  const value = record(raw);
  const nested = value.page ? record(value.page) : {};
  return {
    items: array(value.items),
    nextCursor: text(value.nextCursor ?? nested.nextCursor, '') || null,
    ...(value.total == null ? {} : { total: integer(value.total) }),
  };
}
export function cursor(value: unknown) {
  return value === '0' ? undefined : value;
}
export function bytes(value: unknown): number[] {
  if (typeof value !== 'string') return incompatible('API не вернул байты base64.');
  try {
    return Array.from(atob(value), (byte) => byte.charCodeAt(0));
  } catch {
    return incompatible('Повреждены байты base64.');
  }
}
export async function parallel<T, R>(
  items: T[],
  convert: (item: T) => Promise<R>,
  limit = 6,
): Promise<R[]> {
  const result = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        result[index] = await convert(items[index]!);
      }
    }),
  );
  return result;
}
export function job(raw: unknown, owner: 'Workspace' | 'Capture' | 'Analysis') {
  const data = record(raw);
  const state = text(data.status);
  const error = data.error ? record(data.error) : undefined;
  return {
    jobId: text(data.jobId),
    projectId: text(data.projectId),
    owner,
    status:
      state === 'SUCCEEDED'
        ? 'COMPLETED'
        : data.cancelRequested === true && (state === 'QUEUED' || state === 'RUNNING')
          ? 'CANCEL_REQUESTED'
          : state === 'FAILED' && data.stage === 'INTERRUPTED'
            ? 'INTERRUPTED'
            : state,
    stage: text(data.stage, 'QUEUED'),
    completed: integer(data.completed ?? 0),
    total: data.total == null ? null : integer(data.total),
    unit: text(data.unit, 'ед.'),
    ...(typeof data.resourceId === 'string' ? { resourceId: data.resourceId } : {}),
    ...(error ? { diagnostic: text(error.message, '') } : {}),
  };
}
export async function readJob(ctx: Context, projectId: unknown, jobId: unknown) {
  const raw = record(await ctx.wire('job', { projectId, jobId }, ctx.options));
  const result = checkedJob(raw, projectId, jobId);
  const owner = result.owner;
  if (owner === 'Workspace' && raw.kind === 'ACTION_LOG_IMPORT' && raw.status === 'SUCCEEDED') {
    const journal = record(
      await ctx.wire('actionImportStatus', { projectId, importId: raw.resourceId }, ctx.options),
    );
    const diagnostics = array(journal.diagnostics ?? []).map((raw) => {
      const item = record(raw);
      return `Строка ${integer(item.line)}: ${text(item.message)}`;
    });
    if (diagnostics.length)
      result.diagnostic = `Частичный импорт: ${integer(journal.acceptedRows)} из ${integer(journal.totalRows)} строк. ${diagnostics.join('; ')}`;
  }
  return result;
}

export function checkedJob(raw: Params, projectId: unknown, jobId: unknown) {
  const id = text(raw.jobId);
  if (id !== jobId || raw.projectId !== projectId)
    incompatible('Задание относится к другому проекту.');
  const owner =
    raw.owner === 'Workspace' || raw.owner === 'Capture' || raw.owner === 'Analysis'
      ? raw.owner
      : incompatible('API не сообщил владельца задания.');
  return job(raw, owner);
}
