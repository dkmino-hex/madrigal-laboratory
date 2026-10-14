import { afterEach, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { config } from '../../app/config';
import { ApiError, decodeResponse, request, safeArtifactUrl } from './transport';
import { api } from './client';
import { goldenLocation, fixturePacket } from '../../mocks/fixtures/corpus';

afterEach(() => vi.restoreAllMocks());

it.each([null, [], 'bad gateway', { error: null }])(
  'ошибка HTTP с телом %j остаётся ApiError с HTTP-статусом',
  async (body) => {
    await expect(
      decodeResponse(
        Response.json(body, { status: 502, headers: { 'x-request-id': 'audit-http' } }),
        z.string(),
      ),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code: 'HTTP_ERROR',
      httpStatus: 502,
      requestId: 'audit-http',
    });
  },
);

it('malformed HTTP error не превращается в ошибку сети и повторное чтение', async () => {
  config.mode = 'mock';
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(null, { status: 502 }));
  await expect(
    request('project', { projectId: 'demo-laboratory' }, z.string()),
  ).rejects.toMatchObject({ code: 'HTTP_ERROR', httpStatus: 502 });
});

it.each(['/%69nternal/v1/file', '/%2569nternal/v1/file', '/public/%2f../internal/v1/file'])(
  'закодированный непубличный URL %s отклоняется',
  (path) => {
    expect(() => safeArtifactUrl(path)).toThrow(ApiError);
  },
);

it('ответ packet с чужим captureId/packetNo отклоняется вместо показа похожего кадра', async () => {
  config.mode = 'mock';
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ data: fixturePacket('other-capture', 8) }),
  );
  await expect(
    api.packet({
      projectId: goldenLocation.projectId,
      captureId: goldenLocation.captureId,
      packetNo: 7,
    }),
  ).rejects.toMatchObject({ code: 'INCOMPATIBLE_RESPONSE' });
});

it('ответ sources из другой записи отклоняется', async () => {
  config.mode = 'mock';
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      data: [
        {
          captureId: 'other',
          packetNo: 7,
          frameOffset: '54',
          streamStart: '1000',
          length: '4',
          relation: 'primary',
        },
      ],
    }),
  );
  await expect(api.sources(goldenLocation)).rejects.toMatchObject({
    code: 'INCOMPATIBLE_RESPONSE',
  });
});
