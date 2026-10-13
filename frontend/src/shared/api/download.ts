import { config } from '../../app/config';
import { ApiError, safeArtifactUrl } from './transport';

/** Native Gateway downloads stream to the browser's download manager.
 * MSW cannot intercept navigation downloads: demo files use a bounded fetch. */
export function interceptedDownload(
  path: string,
  name: string,
  contentType: string,
): Promise<void> | null {
  const url = safeArtifactUrl(path);
  if (config.mode !== 'mock') return null;
  return fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
    .then(async (response) => {
      if (!response.ok)
        throw new ApiError(
          'DOWNLOAD_UNAVAILABLE',
          'Файл недоступен. Перечитайте состояние артефакта.',
          response.headers.get('x-request-id') ?? undefined,
          undefined,
          response.status,
        );
      if (!response.headers.get('content-type')?.includes(contentType))
        throw new ApiError('UNEXPECTED_CONTENT', 'Вместо файла получен другой формат.');
      const blob = await response.blob();
      if (blob.size > 2 * 1024 * 1024)
        throw new ApiError('DEMO_LIMITATION', 'Синтетические demo-файлы ограничены 2 МиБ.');
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = name;
      anchor.click();
      globalThis.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    })
    .catch((error: unknown) => {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        'NETWORK_ERROR',
        'Скачивание недоступно. Проверьте Gateway и повторите чтение.',
      );
    });
}
