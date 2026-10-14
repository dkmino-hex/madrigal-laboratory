import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKey } from './query';
import type { Operation } from './registry';
import { Button, ErrorState } from '../ui/common';
import { ApiError } from './transport';

const identityKeys: Partial<Record<Operation, string>> = {
  captures: 'captureId',
  assemblies: 'assemblyId',
  interpretations: 'interpretationId',
  runs: 'runId',
  evidence: 'evidenceId',
};

type Page<T> = { items: T[]; nextCursor: string | null; total?: string };
export function usePagedChoices<T>(
  projectId: string,
  operation: Operation,
  load: (cursor: string, signal: AbortSignal) => Promise<Page<T>>,
  params: Record<string, unknown> = {},
  enabled = true,
  selectedId = '',
  resolveFirst?: (item: T) => boolean,
) {
  const query = useInfiniteQuery({
    queryKey: queryKey(projectId, operation, { ...params, choices: true }),
    queryFn: ({ pageParam, signal }) => load(pageParam, signal),
    initialPageParam: '0',
    getNextPageParam: (page, _pages, _cursor, cursors) =>
      page.nextCursor && !cursors.includes(page.nextCursor) ? page.nextCursor : undefined,
    enabled,
  });
  const identity = identityKeys[operation];
  const identify = (item: T) =>
    identity && item && typeof item === 'object'
      ? (Reflect.get(item, identity) as unknown)
      : undefined;
  const seen = new Map<string, number>();
  const items: T[] = [];
  for (const item of query.data?.pages.flatMap((page) => page.items) ?? []) {
    const id = identify(item);
    if (typeof id === 'string' && seen.has(id)) items[seen.get(id)!] = item;
    else {
      if (typeof id === 'string') seen.set(id, items.length);
      items.push(item);
    }
  }
  const nextCursor = query.data?.pages.at(-1)?.nextCursor;
  const paginationError =
    nextCursor !== undefined &&
    nextCursor !== null &&
    (!nextCursor || query.data?.pageParams.includes(nextCursor))
      ? new ApiError(
          'INCOMPATIBLE_RESPONSE',
          'API вернул повторяющийся или пустой cursor. Дальнейшие страницы не подставляются.',
        )
      : null;
  const unresolved =
    selectedId && identity
      ? !items.some((item) => identify(item) === selectedId)
      : !!resolveFirst && !items.some(resolveFirst);
  const { hasNextPage, isFetching, fetchNextPage, error } = query;
  useEffect(() => {
    if (enabled && unresolved && hasNextPage && !isFetching && !error)
      void fetchNextPage({ cancelRefetch: false });
  }, [enabled, unresolved, hasNextPage, isFetching, fetchNextPage, error]);
  return {
    ...query,
    initialError: query.isFetchNextPageError ? null : query.error,
    paginationError,
    resolving: enabled && unresolved && (query.isPending || query.hasNextPage),
    data: query.data
      ? {
          items,
          total: query.data.pages[0]?.total,
        }
      : undefined,
  };
}

export function MoreChoices({
  label,
  query,
}: {
  label: string;
  query: {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: (options?: { cancelRefetch?: boolean }) => Promise<unknown>;
    isFetchNextPageError: boolean;
    error: unknown;
    paginationError: unknown;
    refetch: () => Promise<unknown>;
    data?: { items: unknown[] };
  };
}) {
  return (
    <div className="choices-pagination">
      {query.hasNextPage && (
        <Button
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
        >
          {query.isFetchingNextPage ? 'Загрузка…' : 'Загрузить ещё ' + label}
        </Button>
      )}
      {!query.hasNextPage && query.data && !query.error && !query.paginationError && (
        <small className="muted" role="status">
          Все {label} загружены
        </small>
      )}
      {query.isFetchNextPageError && (
        <ErrorState error={query.error} retry={() => void query.fetchNextPage()} />
      )}
      {!!query.paginationError && (
        <ErrorState error={query.paginationError} retry={() => void query.refetch()} />
      )}
    </div>
  );
}
