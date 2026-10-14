// @vitest-environment node
import { it, expect, vi, afterEach } from 'vitest';
import { config } from '../../app/config';
import { interceptedDownload } from './download';
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('API скачивает через менеджер браузера, без чтения ZIP в JS', () => {
  config.mode = 'api';
  const fetch = vi.spyOn(globalThis, 'fetch');
  expect(interceptedDownload('/artifacts/ready', 'project.zip', 'application/zip')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it('demo не скачивает HTML вместо Markdown', async () => {
  config.mode = 'mock';
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('<html>', { headers: { 'Content-Type': 'text/html' } }),
  );
  await expect(
    interceptedDownload('/__madrigal_mock/artifact/a', 'report.md', 'text/markdown'),
  ).rejects.toMatchObject({ code: 'UNEXPECTED_CONTENT' });
});
it('неготовый артефакт даёт состояние ошибки', async () => {
  config.mode = 'mock';
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('waiting', { status: 409 }));
  await expect(
    interceptedDownload('/__madrigal_mock/artifact/a', 'report.md', 'text/markdown'),
  ).rejects.toMatchObject({ code: 'DOWNLOAD_UNAVAILABLE', httpStatus: 409 });
});
it('demo освобождает object URL после скачивания', async () => {
  config.mode = 'mock';
  vi.useFakeTimers();
  const anchor = { href: '', download: '', click: vi.fn() };
  vi.stubGlobal('document', { createElement: () => anchor });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('# Demo', { headers: { 'Content-Type': 'text/markdown' } }),
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  await interceptedDownload('/__madrigal_mock/artifact/a', 'report.md', 'text/markdown');
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.download).toBe('report.md');
  await vi.advanceTimersByTimeAsync(1000);
  expect(revoke).toHaveBeenCalledWith('blob:demo');
  vi.unstubAllGlobals();
});
