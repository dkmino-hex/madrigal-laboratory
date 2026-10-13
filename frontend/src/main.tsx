import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell, ProjectLayout } from './app/Shell';
import { ErrorBoundary } from './app/ErrorBoundary';
import { Loading } from './shared/ui/common';
import { config } from './app/config';
import { stopOwnMockWorker } from './app/mock-lifecycle';
import { ApiError } from './shared/api/transport';
import './shared/ui/styles.css';
const Projects = lazy(() => import('./pages/Projects'));
const Overview = lazy(() => import('./pages/Overview'));
const Traffic = lazy(() => import('./pages/Traffic'));
const Actions = lazy(() => import('./pages/Actions'));
const Compare = lazy(() => import('./pages/Compare'));
const Interpretations = lazy(() => import('./pages/Interpretations'));
const Editor = lazy(() => import('./pages/Editor'));
const Hypotheses = lazy(() => import('./pages/Hypotheses'));
const Runs = lazy(() => import('./pages/Runs'));
const RunDetail = lazy(() => import('./pages/RunDetail'));
const RunCompare = lazy(() => import('./pages/RunCompare'));
const Artifacts = lazy(() => import('./pages/Artifacts'));
const Settings = lazy(() => import('./pages/Settings'));
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15000,
      gcTime: 60000,
      retry: (count, error) =>
        count < 1 && error instanceof ApiError && ['NETWORK_ERROR', 'TIMEOUT'].includes(error.code),
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});
// Не более восьми неактивных окон bytes, включая сравнение и точные большие координаты.
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated' || event.query.queryKey[2] !== 'bytes') return;
  const windows = queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.queryKey[2] === 'bytes' && query.getObserversCount() === 0)
    .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt);
  for (const query of windows.slice(0, Math.max(0, windows.length - config.maxByteWindows)))
    queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
});
if (import.meta.env.DEV)
  Object.assign(window, {
    __madrigalDiagnostics: () => {
      const entries = queryClient
        .getQueryCache()
        .getAll()
        .filter((query) => query.queryKey[2] === 'bytes' && query.state.data);
      return {
        byteWindows: entries.length,
        inactiveByteWindows: entries.filter((query) => query.getObserversCount() === 0).length,
        cacheJsonBytes: entries.reduce(
          (total, query) =>
            total + new TextEncoder().encode(JSON.stringify(query.state.data)).length,
          0,
        ),
      };
    },
  });
const screen = (node: React.ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>;
const router = createBrowserRouter([
  {
    element: <Shell />,
    errorElement: (
      <main className="fatal">
        <h1>Некорректная ссылка или ошибка интерфейса</h1>
        <a href="/projects">Открыть проекты</a>
      </main>
    ),
    children: [
      { path: '/', element: <Navigate to="/projects" replace /> },
      { path: '/projects', element: screen(<Projects />) },
      {
        path: '/projects/:projectId',
        element: <ProjectLayout />,
        children: [
          { index: true, element: screen(<Overview />) },
          { path: 'traffic', element: screen(<Traffic />) },
          { path: 'actions', element: screen(<Actions />) },
          { path: 'compare', element: screen(<Compare />) },
          { path: 'interpretations', element: screen(<Interpretations />) },
          { path: 'interpretations/:interpretationId', element: screen(<Editor />) },
          { path: 'hypotheses', element: screen(<Hypotheses />) },
          { path: 'runs', element: screen(<Runs />) },
          { path: 'runs/compare', element: screen(<RunCompare />) },
          { path: 'runs/:runId', element: screen(<RunDetail />) },
          { path: 'artifacts', element: screen(<Artifacts />) },
          { path: 'settings', element: screen(<Settings />) },
        ],
      },
      {
        path: '*',
        element: (
          <main id="main" className="fatal">
            <h1>Страница не найдена</h1>
            <a href="/projects">Открыть проекты</a>
          </main>
        ),
      },
    ],
  },
]);
async function start() {
  if (import.meta.env.MODE === 'mock' || (import.meta.env.DEV && config.mode === 'mock')) {
    if (config.mode === 'mock') {
      const { startMocks } = await import('./mocks/browser');
      await startMocks();
    } else await stopOwnMockWorker();
  } else await stopOwnMockWorker();
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
void start().catch(() => {
  const root = document.getElementById('root')!;
  root.replaceChildren();
  const text = document.createElement('p');
  text.textContent =
    'Не удалось запустить интерфейс. Проверьте локальные ресурсы, режим и mockServiceWorker. Обновите страницу.';
  root.append(text);
});
