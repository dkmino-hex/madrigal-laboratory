import { afterEach, it, expect, vi } from 'vitest';

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
  vi.resetModules();
});
it('выбранный API сохраняется после навигации без query и повторной загрузки модулей', async () => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('MODE', 'mock');
  vi.stubEnv('VITE_DATA_MODE', 'mock');
  window.history.replaceState(null, '', '/projects?mode=api');
  expect((await import('./config')).config.mode).toBe('api');
  window.history.replaceState(null, '', '/projects/p/traffic');
  vi.resetModules();
  expect((await import('./config')).config.mode).toBe('api');
});
it('dev:api не наследует выбранный mock другого Vite-режима', async () => {
  window.sessionStorage.setItem('madrigal:data-mode:mock', 'mock');
  vi.stubEnv('DEV', true);
  vi.stubEnv('MODE', 'api');
  vi.stubEnv('VITE_DATA_MODE', 'api');
  expect((await import('./config')).config.mode).toBe('api');
});
it('production игнорирует и query, и сохранённый dev mock', async () => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('MODE', 'api');
  vi.stubEnv('VITE_DATA_MODE', 'api');
  window.history.replaceState(null, '', '/projects?mode=mock');
  window.sessionStorage.setItem('madrigal:data-mode:api', 'mock');
  expect((await import('./config')).config.mode).toBe('api');
});
it('запрет sessionStorage не мешает явному API-режиму', async () => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('MODE', 'mock');
  vi.stubEnv('VITE_DATA_MODE', 'mock');
  window.history.replaceState(null, '', '/projects?mode=api');
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage disabled');
  });
  expect((await import('./config')).config.mode).toBe('api');
  storage.mockRestore();
});
