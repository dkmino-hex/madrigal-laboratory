import type { z } from 'zod';
import { config, gatewayUrl, publicGatewayPath } from '../../app/config';
import { draftMapping, gatewayMapping, type Operation } from './registry';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export const createRequestKey = () => crypto.randomUUID();
export function logicalRequest() {
  let previous = '';
  let key = '';
  return (operation: Operation, body: unknown) => {
    const fingerprint = operation + ':' + JSON.stringify(body);
    if (fingerprint !== previous) {
      previous = fingerprint;
      key = createRequestKey();
    }
    return key;
  };
}
function redactedDetails(details: unknown): unknown {
  if (typeof details === 'string')
    return details.replace(/(?:[A-Z]:\\|\/(?:home|var|Users|etc)\/)[^\s"]+/gi, '[приватный путь]');
  if (Array.isArray(details)) return details.slice(0, 20).map(redactedDetails);
  if (details && typeof details === 'object')
    return Object.fromEntries(
      Object.entries(details)
        .filter(([key]) => !/token|secret|password|authorization/i.test(key))
        .map(([key, value]) => [key, redactedDetails(value)]),
    );
  return details;
}
export async function decodeResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json'))
    throw new ApiError(
      'UNEXPECTED_CONTENT',
      'Gateway вернул HTML или другой формат вместо JSON. Проверьте маршрутизацию API.',
      requestId,
      undefined,
      response.status,
    );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('INVALID_JSON', 'Ответ Gateway содержит некорректный JSON.', requestId);
  }
  if (!response.ok) {
    const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const error =
      data.error && typeof data.error === 'object' ? (data.error as Record<string, unknown>) : {};
    throw new ApiError(
      typeof error.code === 'string' ? error.code : 'HTTP_ERROR',
      String(
        redactedDetails(
          typeof error.message === 'string'
            ? error.message
            : 'Ошибка Gateway. Повторите чтение или проверьте диагностику.',
        ),
      ),
      typeof data.requestId === 'string' ? data.requestId : requestId,
      redactedDetails(error.details),
      response.status,
    );
  }
  const envelope = body as { data?: unknown; requestId?: string };
  const parsed = schema.safeParse(envelope?.data);
  if (!parsed.success)
    throw new ApiError(
      'INCOMPATIBLE_RESPONSE',
      'Ответ не соответствует ожидаемой модели. Необходима сверка контракта.',
      envelope?.requestId ?? requestId,
      parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
    );
  return parsed.data;
}
export type RequestOptions = {
  signal?: AbortSignal;
  idempotencyKey?: string;
  timeoutMs?: number;
  file?: File;
};
export async function request<T>(
  operation: Operation,
  params: Record<string, unknown>,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const mapping = config.mode === 'mock' ? draftMapping(operation) : gatewayMapping[operation];
  if (!mapping)
    throw new ApiError(
      'CONTRACT_PENDING',
      'Операция «' +
        operation +
        '» ожидает согласованного OpenAPI публичного Gateway (BASE-02). Демонстрационные данные доступны в явно выбранном mock-режиме.',
    );
  if (
    !mapping.path.startsWith('/') ||
    mapping.path.startsWith('//') ||
    !publicGatewayPath(mapping.path)
  )
    throw new ApiError('INVALID_MAPPING', 'Операция должна использовать публичный путь Gateway.');
  const used = new Set<string>();
  const path = mapping.path.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (params[key] === undefined)
      throw new ApiError('INVALID_MAPPING', 'В mapping отсутствует параметр ' + key);
    used.add(key);
    return encodeURIComponent(String(params[key]));
  });
  const url = new URL(gatewayUrl(path));
  if (mapping.method === 'GET')
    for (const [key, value] of Object.entries(params))
      if (!used.has(key) && value !== undefined && value !== null)
        url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': crypto.randomUUID(),
  };
  if (mapping.idempotent && options.idempotencyKey)
    headers['Idempotency-Key'] = options.idempotencyKey;
  let body: BodyInit | undefined;
  if (options.file) {
    const form = new FormData();
    form.set('file', options.file);
    for (const [key, value] of Object.entries(params))
      form.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    body = form;
  } else if (mapping.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(params);
  }
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 15000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    return await decodeResponse(
      await fetch(url, {
        method: mapping.method,
        headers,
        body,
        signal,
        credentials: 'same-origin',
      }),
      schema,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw new ApiError('ABORTED', 'Чтение отменено.');
    if (timeout.aborted)
      throw new ApiError(
        'TIMEOUT',
        mapping.method === 'GET'
          ? 'Gateway не ответил вовремя. Повторите чтение.'
          : 'Результат запроса неизвестен. Перечитайте ресурс или задания перед повтором с тем же ключом.',
      );
    throw new ApiError(
      mapping.method === 'GET' ? 'NETWORK_ERROR' : 'RESULT_UNKNOWN',
      mapping.method === 'GET'
        ? 'Локальный Gateway недоступен. Проверьте его запуск и повторите чтение.'
        : 'Результат запроса неизвестен. Перечитайте состояние; повторите тот же запрос с тем же ключом.',
    );
  }
}
export function safeArtifactUrl(path: string) {
  const url = new URL(path, gatewayUrl('/'));
  const base = new URL(gatewayUrl('/'));
  if (
    url.origin !== base.origin ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !publicGatewayPath(url.pathname)
  )
    throw new ApiError(
      'UNSAFE_ARTIFACT_URL',
      'Ссылка артефакта не принадлежит публичному Gateway.',
    );
  return url.href;
}
