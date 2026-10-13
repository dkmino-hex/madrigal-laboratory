import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
export const worker = setupWorker(...handlers);
export async function startMocks() {
  await worker.start({
    quiet: true,
    serviceWorker: { url: '/mockServiceWorker.js' },
    onUnhandledFrame({ frame, defaults }) {
      if (frame.protocol === 'http') {
        const request = (frame.data as { request: Request }).request;
        if (new URL(request.url).pathname.startsWith('/__madrigal_mock/')) defaults.error();
      }
    },
  });
}
