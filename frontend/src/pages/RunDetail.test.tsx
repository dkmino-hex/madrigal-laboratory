import { it, expect, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RunDetail from './RunDetail';
import { api } from '../shared/api/client';
import { queryKey } from '../shared/api/query';
import { initialState } from '../mocks/state';
import { resultsFor, projectId } from '../mocks/fixtures/corpus';
import { decimal } from '../shared/model/precision';

it('завершение run обновляет частичные результаты, даже если job ещё не подтвердил завершение', async () => {
  const state = initialState();
  const run = state.runs[0]!;
  let complete = false;
  vi.spyOn(api, 'run').mockImplementation(async () => ({
    ...run,
    status: complete ? 'COMPLETED' : 'RUNNING',
    summary: { ...run.summary, complete, messages: decimal(complete ? '5' : '1') },
  }));
  vi.spyOn(api, 'results').mockImplementation(async () => ({
    items: resultsFor(projectId).slice(0, complete ? 5 : 1),
    nextCursor: null,
  }));
  vi.spyOn(api, 'job').mockResolvedValue({
    ...state.jobs[0]!,
    projectId,
    jobId: run.jobId,
    status: 'RUNNING',
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        element: <Outlet context={{ project: state.projects[0]! }} />,
        children: [{ path: '/projects/:projectId/runs/:runId', element: <RunDetail /> }],
      },
    ],
    { initialEntries: ['/projects/demo-laboratory/runs/run-baseline'] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(view.container.querySelectorAll('.results-table tbody tr')).toHaveLength(1),
  );
  complete = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKey(projectId, 'run', { runId: run.runId }) });
  });
  await waitFor(() =>
    expect(view.container.querySelectorAll('.results-table tbody tr')).toHaveLength(5),
  );
  view.unmount();
  client.clear();
});
