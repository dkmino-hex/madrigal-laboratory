import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../../shared/api/client';
import { queryKey, useCommand } from '../../shared/api/query';
import type { Job } from '../../shared/api/contracts/models';
import { config } from '../../app/config';
import { readPreference, savePreference } from '../../shared/lib/storage';
import { Badge, Button, Empty, ErrorState, Loading } from '../../shared/ui/common';
const event = 'madrigal-jobs-changed';
const preferenceKey = () => 'tracked-jobs:' + config.mode;
const snapshot = () => readPreference(preferenceKey()) ?? '[]';
const subscribe = (callback: () => void) => {
  window.addEventListener(event, callback);
  return () => window.removeEventListener(event, callback);
};
type Tracked = { projectId: string; jobId: string };
function parseTracked(value: string): Tracked[] {
  try {
    const items: unknown = JSON.parse(value);
    return Array.isArray(items)
      ? items
          .filter(
            (item): item is Tracked =>
              !!item && typeof item.projectId === 'string' && typeof item.jobId === 'string',
          )
          .slice(-40)
      : [];
  } catch {
    return [];
  }
}
export function trackJob(projectId: string, jobId: string) {
  const items = parseTracked(snapshot());
  if (!items.some((item) => item.projectId === projectId && item.jobId === jobId)) {
    savePreference(preferenceKey(), JSON.stringify([...items, { projectId, jobId }].slice(-40)));
    window.dispatchEvent(new Event(event));
  }
}
export const terminalJob = (status: string) =>
  ['COMPLETED', 'CANCELLED', 'FAILED', 'INTERRUPTED'].includes(status);
export function JobCard({ projectId, jobId }: Tracked) {
  const queries = useQueries({ queries: [jobQuery(projectId, jobId)] });
  const query = queries[0]!;
  const client = useQueryClient();
  const cancel = useCommand(
    'cancelJob',
    (id: string, options) => api.cancelJob(projectId, id, options),
    [queryKey(projectId, 'job', { jobId })],
  );
  const job = query.data;
  const status = job?.status;
  useEffect(() => {
    if (!status || !terminalJob(status)) return;
    // Завершение обработки меняет ресурсы, закешированные ещё при IMPORTING.
    // Их следующий читатель обязан перечитать авторитетное состояние Gateway.
    for (const operation of [
      'project',
      'captures',
      'sessions',
      'assemblies',
      'artifacts',
      'actions',
      'runs',
      'run',
      'results',
    ] as const)
      void client.invalidateQueries({ queryKey: queryKey(projectId, operation) });
    void client.invalidateQueries({ queryKey: queryKey('all', 'projects') });
  }, [job?.jobId, status, projectId, client]);
  return (
    <article className="job-card" aria-label={'Задание ' + jobId}>
      {job ? (
        <>
          <div className="row between">
            <strong>{job.owner}</strong>
            <Badge status={job.status} />
          </div>
          <code>{job.jobId}</code>
          <p>{job.stage}</p>
          {job.total && BigInt(job.total) > 0n ? (
            <>
              <progress
                aria-label="Прогресс обработки"
                value={Number((BigInt(job.completed) * 10000n) / BigInt(job.total))}
                max={10000}
              />
              <small>
                {job.completed} / {job.total} {job.unit}
              </small>
            </>
          ) : job.total !== null ? (
            <small>
              {job.completed} / {job.total} {job.unit}
            </small>
          ) : !terminalJob(job.status) ? (
            <>
              <progress aria-label="Обработка, общее количество неизвестно" />
              <small>Общее количество неизвестно</small>
            </>
          ) : null}
          {job.diagnostic && <p className="field-error">{job.diagnostic}</p>}
          {!terminalJob(job.status) && (
            <Button
              disabled={cancel.isPending || job.status === 'CANCEL_REQUESTED'}
              onClick={() => cancel.mutate(jobId)}
            >
              Отменить обработку
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() =>
              void client.invalidateQueries({ queryKey: queryKey(projectId, 'job', { jobId }) })
            }
          >
            Перечитать статус
          </Button>
        </>
      ) : query.isPending ? (
        <Loading text="Перечитывание задания с Gateway…" />
      ) : null}
      {query.error && <ErrorState error={query.error} retry={() => void query.refetch()} />}
      {cancel.error && <ErrorState error={cancel.error} />}
    </article>
  );
}
export function jobQuery(projectId: string, jobId: string) {
  return {
    queryKey: queryKey(projectId, 'job', { jobId }),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.job(projectId, jobId, { signal }),
    staleTime: 0,
    retry: 1,
    refetchOnReconnect: true,
    refetchInterval: (query: { state: { data?: Job; error: unknown; dataUpdateCount: number } }) =>
      query.state.error ||
      query.state.dataUpdateCount >= 120 ||
      (query.state.data && terminalJob(query.state.data.status))
        ? (false as const)
        : 600,
    refetchIntervalInBackground: false,
  };
}
export function JobsCenter({ projectId }: { projectId?: string }) {
  const items = parseTracked(useSyncExternalStore(subscribe, snapshot)).filter(
    (item) => !projectId || item.projectId === projectId,
  );
  return (
    <div>
      <p className="muted">
        Статус перечитывается с Gateway. Отслеживаются последние 40 известных ID; это не глобальный
        серверный список.
      </p>
      {items.length ? (
        <div className="job-list">
          {items.map((item) => (
            <JobCard key={item.jobId + item.projectId} {...item} />
          ))}
        </div>
      ) : (
        <Empty
          title="Нет отслеживаемых заданий"
          description="Задание появится здесь после импорта, проверки или генерации артефакта."
        />
      )}
    </div>
  );
}
