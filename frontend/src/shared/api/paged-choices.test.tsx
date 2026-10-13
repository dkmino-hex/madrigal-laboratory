import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { usePagedChoices } from './paged-choices';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
it('ошибка следующей страницы сохраняет уже доступный выбор и позволяет повторить тот же cursor', async () => {
  let fail = true;
  const cursors: string[] = [];
  const { result } = renderHook(
    () =>
      usePagedChoices('project', 'interpretations', async (cursor) => {
        cursors.push(cursor);
        if (cursor === 'next' && fail) throw new Error('Временный отказ');
        return {
          items: cursor === '0' ? ['Первая модель'] : ['Двадцать первая модель'],
          nextCursor: cursor === '0' ? 'next' : null,
        };
      }),
    { wrapper: wrapper() },
  );
  await waitFor(() => expect(result.current.data?.items).toEqual(['Первая модель']));
  await act(async () => {
    await result.current.fetchNextPage();
  });
  await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
  expect(result.current.data?.items).toEqual(['Первая модель']);
  expect(result.current.initialError).toBeNull();
  expect(result.current.isFetchNextPageError).toBe(true);
  fail = false;
  await act(async () => {
    await result.current.fetchNextPage();
  });
  await waitFor(() => expect(result.current.data?.items).toHaveLength(2));
  expect(result.current.data?.items).toEqual(['Первая модель', 'Двадцать первая модель']);
  expect(result.current.hasNextPage).toBe(false);
  expect(cursors).toEqual(['0', 'next', 'next']);
});
it('запоздавшая страница предыдущего проекта не добавляется в выбор нового проекта', async () => {
  let resolveOld!: (value: { items: string[]; nextCursor: null }) => void;
  const { result, rerender } = renderHook(
    ({ project }) =>
      usePagedChoices(project, 'captures', async (cursor) => {
        if (project === 'a' && cursor === 'next')
          return new Promise<{ items: string[]; nextCursor: null }>((resolve) => {
            resolveOld = resolve;
          });
        return { items: [project + ':capture'], nextCursor: project === 'a' ? 'next' : null };
      }),
    { wrapper: wrapper(), initialProps: { project: 'a' } },
  );
  await waitFor(() => expect(result.current.data?.items).toEqual(['a:capture']));
  act(() => {
    void result.current.fetchNextPage();
  });
  await waitFor(() => expect(resolveOld).toBeDefined());
  rerender({ project: 'b' });
  await waitFor(() => expect(result.current.data?.items).toEqual(['b:capture']));
  await act(async () => {
    resolveOld({ items: ['a:old-page'], nextCursor: null });
  });
  expect(result.current.data?.items).toEqual(['b:capture']);
});
it('историческая сборка из ссылки разрешается по страницам без подстановки первой версии', async () => {
  const cursors: string[] = [];
  const { result } = renderHook(
    () =>
      usePagedChoices(
        'project',
        'assemblies',
        async (cursor) => {
          cursors.push(cursor);
          return {
            items: [{ assemblyId: cursor === '0' ? 'current' : 'historical' }],
            nextCursor: cursor === '0' ? 'next' : 'older',
          };
        },
        {},
        true,
        'historical',
      ),
    { wrapper: wrapper() },
  );
  await waitFor(() =>
    expect(result.current.data?.items.some((item) => item.assemblyId === 'historical')).toBe(true),
  );
  expect(result.current.resolving).toBe(false);
  expect(cursors).toEqual(['0', 'next']);
  expect(result.current.hasNextPage).toBe(true);
});

it('пересекающиеся страницы не дублируют одну модель и сохраняют её актуальные данные', async () => {
  const { result } = renderHook(
    () =>
      usePagedChoices('project', 'interpretations', async (cursor) => ({
        items:
          cursor === '0'
            ? [{ interpretationId: 'a', name: 'Старая подпись' }]
            : [
                { interpretationId: 'a', name: 'Новая подпись' },
                { interpretationId: 'b', name: 'Другая модель' },
              ],
        nextCursor: cursor === '0' ? 'next' : null,
      })),
    { wrapper: wrapper() },
  );
  await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
  await act(async () => {
    await result.current.fetchNextPage();
  });
  await waitFor(() => expect(result.current.data?.items).toHaveLength(2));
  expect(result.current.data?.items.map((item) => item.name)).toEqual([
    'Новая подпись',
    'Другая модель',
  ]);
});

it('повторяющийся cursor не запускает бесконечный поиск отсутствующей сборки', async () => {
  let requests = 0;
  const { result } = renderHook(
    () =>
      usePagedChoices(
        'project',
        'assemblies',
        async () => {
          requests++;
          return { items: [{ assemblyId: 'other' }], nextCursor: '0' };
        },
        {},
        true,
        'missing',
      ),
    { wrapper: wrapper() },
  );
  await waitFor(() => expect(result.current.paginationError?.code).toBe('INCOMPATIBLE_RESPONSE'));
  expect(result.current.hasNextPage).toBe(false);
  expect(requests).toBe(1);
});
it('направление без сборки на первой странице находит первую готовую версию своего направления', async () => {
  const cursors: string[] = [];
  const { result } = renderHook(
    () =>
      usePagedChoices(
        'project',
        'assemblies',
        async (cursor) => {
          cursors.push(cursor);
          return {
            items: [
              {
                assemblyId: cursor === '0' ? 'a' : 'b',
                direction: cursor === '0' ? 'A_TO_B' : 'B_TO_A',
                status: 'READY',
              },
            ],
            nextCursor: cursor === '0' ? 'next' : null,
          };
        },
        {},
        true,
        '',
        (item) => item.direction === 'B_TO_A' && item.status === 'READY',
      ),
    { wrapper: wrapper() },
  );
  await waitFor(() =>
    expect(result.current.data?.items.some((item) => item.direction === 'B_TO_A')).toBe(true),
  );
  expect(result.current.resolving).toBe(false);
  expect(cursors).toEqual(['0', 'next']);
});
