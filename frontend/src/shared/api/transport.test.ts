import { afterEach, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { config } from '../../app/config';
import { ApiError, decodeResponse, logicalRequest, request, safeArtifactUrl } from './transport';
afterEach(() => vi.restoreAllMocks());
it('HTML не становится API-ответом или контрпримером', async () =>
  expect(
    decodeResponse(
      new Response('<html>', { headers: { 'Content-Type': 'text/html' } }),
      z.string(),
    ),
  ).rejects.toMatchObject({ code: 'UNEXPECTED_CONTENT' }));
it('неверный DTO имеет отдельное состояние', async () =>
  expect(
    decodeResponse(
      Response.json({ data: { size: 9007199254740992 } }),
      z.object({ size: z.string() }),
    ),
  ).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' }));
it('ошибка API сохраняет code, requestId и безопасные details', async () => {
  await expect(
    decodeResponse(
      Response.json(
        {
          error: {
            code: 'SOURCE_UNAVAILABLE',
            message: 'Источник недоступен',
            details: { token: 'secret', path: '/home/private/capture.pcap' },
          },
          requestId: 'req-1',
        },
        { status: 404 },
      ),
      z.string(),
    ),
  ).rejects.toMatchObject({
    code: 'SOURCE_UNAVAILABLE',
    requestId: 'req-1',
    details: { path: '[приватный путь]' },
  });
});
it('невалидный JSON диагностируется отдельно', async () =>
  expect(
    decodeResponse(
      new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      z.string(),
    ),
  ).rejects.toMatchObject({ code: 'INVALID_JSON' }));
it('один логический запрос сохраняет ключ; другое тело или операция меняет ключ', () => {
  const key = logicalRequest();
  const first = key('createProject', { name: 'a' });
  expect(key('createProject', { name: 'a' })).toBe(first);
  expect(key('createProject', { name: 'b' })).not.toBe(first);
  expect(key('saveRevision', { name: 'b' })).not.toBe(first);
});
it('отсутствующий API mapping не выполняет выдуманный запрос', async () => {
  config.mode = 'api';
  const fetch = vi.spyOn(globalThis, 'fetch');
  await expect(request('projects', {}, z.string())).rejects.toMatchObject({
    code: 'CONTRACT_PENDING',
  });
  expect(fetch).not.toHaveBeenCalled();
});
it('различает сеть и неопределённый результат мутации', async () => {
  config.mode = 'mock';
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'));
  await expect(request('projects', {}, z.string())).rejects.toMatchObject({
    code: 'NETWORK_ERROR',
  });
  await expect(request('createProject', { name: 'x' }, z.string())).rejects.toMatchObject({
    code: 'RESULT_UNKNOWN',
  });
});
it('отмена чтения отличается от сетевой ошибки', async () => {
  config.mode = 'mock';
  const controller = new AbortController();
  controller.abort();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('abort'));
  await expect(
    request('bytes', {}, z.string(), { signal: controller.signal }),
  ).rejects.toMatchObject({ code: 'ABORTED' });
});
it('таймаут не выполняет повтор POST', async () => {
  config.mode = 'mock';
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      (_url, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener('abort', () => reject(new Error('abort'))),
        ),
    );
  await expect(request('createRun', {}, z.string(), { timeoutMs: 15 })).rejects.toMatchObject({
    code: 'TIMEOUT',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each(['https://evil.example/file.zip', 'javascript:alert(1)', '/internal/v1/file'])(
  'запрещает непубличный артефакт %s',
  (url) => expect(() => safeArtifactUrl(url)).toThrow(ApiError),
);
it('разрешает прямое локальное скачивание с Gateway', () =>
  expect(new URL(safeArtifactUrl('/artifact/ready')).pathname).toBe('/artifact/ready'));
