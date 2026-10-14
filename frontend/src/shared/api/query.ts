import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { config } from '../../app/config';
import { logicalRequest, type RequestOptions } from './transport';
import type { Operation } from './registry';
export const queryKey = (
  projectId: string,
  operation: Operation,
  params: Record<string, unknown> = {},
) => [config.mode, projectId, operation, params] as const;
export function useCommand<T, P>(
  operation: Operation,
  execute: (params: P, options: RequestOptions) => Promise<T>,
  invalidate: QueryKey[] = [],
) {
  const getKey = useRef(logicalRequest());
  const client = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const mutation = useMutation({
    mutationFn: (params: P) => {
      if (operation === 'preview') {
        controller.current?.abort();
        controller.current = new AbortController();
      }
      return execute(params, {
        idempotencyKey: getKey.current(operation, params),
        signal: operation === 'preview' ? controller.current!.signal : undefined,
      });
    },
    retry: false,
    onSuccess: async () => {
      for (const key of invalidate) await client.invalidateQueries({ queryKey: key });
      getKey.current = logicalRequest();
    },
  });
  return {
    ...mutation,
    reset: () => {
      controller.current?.abort();
      mutation.reset();
    },
  };
}
