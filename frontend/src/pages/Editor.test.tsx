import { it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Editor from './Editor';
import { api } from '../shared/api/client';
import type { Location, Revision } from '../shared/api/contracts/draft';
import { initialState } from '../mocks/state';
import { assembliesFor, sessionsFor } from '../mocks/fixtures/corpus';

// Геометрию CodeMirror проверяет настоящий браузер; этот тест проверяет асинхронный workflow.
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange }: { value: string; onChange: (text: string) => void }) => (
    <textarea
      aria-label="JSON схемы"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

it('смена диапазона во время сохранения не запускает устаревший автоматический preview', async () => {
  const state = initialState();
  const interpretation = state.interpretations[0]!;
  vi.spyOn(api, 'interpretation').mockImplementation(async () => ({
    ...interpretation,
    revisions: [...interpretation.revisions],
  }));
  vi.spyOn(api, 'captures').mockResolvedValue({ items: state.captures, nextCursor: null });
  vi.spyOn(api, 'sessions').mockImplementation(async (params) => ({
    items: sessionsFor(String(params.captureId)),
    nextCursor: null,
  }));
  vi.spyOn(api, 'assemblies').mockImplementation(async (params) => ({
    items: assembliesFor(String(params.captureId), String(params.sessionId)),
    nextCursor: null,
  }));
  let resolveSave!: (revision: Revision) => void;
  vi.spyOn(api, 'saveRevision').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
  );
  const preview = vi.spyOn(api, 'preview').mockImplementation(async (params) => ({
    revisionId: String(params.revisionId),
    location: params.location as Location,
    results: [],
    unknown: [],
    complete: true,
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        element: <Outlet context={{ project: state.projects[0]! }} />,
        children: [
          { path: '/projects/:projectId/interpretations/:interpretationId', element: <Editor /> },
        ],
      },
    ],
    { initialEntries: ['/projects/demo-laboratory/interpretations/interpretation-demo'] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const maximum = await screen.findByLabelText('Максимум первого правила');
  await user.clear(maximum);
  await user.type(maximum, '60');
  const save = screen.getByRole('button', { name: 'Сохранить новую ревизию и выполнить preview' });
  await waitFor(() => expect(save).toBeEnabled());
  await user.click(save);
  const start = screen.getByLabelText('Диапазон preview: начало');
  await user.clear(start);
  await user.type(start, '1004');
  const revision: Revision = {
    ...interpretation.revisions[0]!,
    revisionId: 'revision-race',
    json: String(vi.mocked(api.saveRevision).mock.calls[0]![0].json),
  };
  interpretation.revisions.push(revision);
  await act(async () => {
    resolveSave(revision);
  });
  await waitFor(() => expect(router.state.location.search).toContain('revisionId=revision-race'));
  expect(preview).not.toHaveBeenCalled();
  expect(start).toHaveValue('1004');
  view.unmount();
  client.clear();
});
