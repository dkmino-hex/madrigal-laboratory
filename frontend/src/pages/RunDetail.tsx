import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProject } from '../app/Shell';
import { api } from '../shared/api/client';
import { queryKey, useCommand } from '../shared/api/query';
import {
  Badge,
  Banner,
  Button,
  Empty,
  ErrorState,
  Field,
  PageHeading,
  Pagination,
  QueryState,
} from '../shared/ui/common';
import { RunManifest, RunSummary } from '../features/runs/Summary';
import { ResultsTable } from '../features/interpretations/Results';
import { JobCard, trackJob } from '../features/jobs/Jobs';
import { useBufferedParam } from '../shared/lib/use-buffered-param';
export default function RunDetail() {
  const projectId = useProject().projectId;
  const runId = useParams().runId!;
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const rule = params.get('rule') ?? '';
  const ruleSearch = useBufferedParam('rule');
  const captureId = params.get('captureId') ?? '';
  const cursor = params.get('cursor') ?? '0';
  const query = useQuery({
    queryKey: queryKey(projectId, 'run', { runId }),
    queryFn: ({ signal }) => api.run(projectId, runId, { signal }),
    refetchInterval: (query) =>
      query.state.error ||
      query.state.dataUpdateCount > 120 ||
      !query.state.data ||
      ['COMPLETED', 'CANCELLED', 'FAILED', 'INTERRUPTED'].includes(query.state.data.status)
        ? false
        : 600,
  });
  const results = useQuery({
    queryKey: queryKey(projectId, 'results', { runId, status, rule, captureId, cursor }),
    queryFn: ({ signal }) =>
      api.results({ projectId, runId, status, rule, captureId, cursor }, { signal }),
    enabled: !!query.data,
  });
  const run = query.data;
  const resultVersion = run ? JSON.stringify([run.status, run.summary]) : '';
  useEffect(() => {
    if (resultVersion)
      void client.invalidateQueries({ queryKey: queryKey(projectId, 'results', { runId }) });
  }, [client, projectId, runId, resultVersion]);
  const report = useCommand(
    'createReport',
    (id: string, options) => api.createReport(projectId, id, options),
    [queryKey(projectId, 'artifacts')],
  );
  useEffect(() => {
    if (run && !['COMPLETED', 'CANCELLED', 'FAILED', 'INTERRUPTED'].includes(run.status))
      trackJob(projectId, run.jobId);
  }, [projectId, run]);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key !== 'cursor') next.delete('cursor');
    setParams(next, { replace: true });
  }
  return (
    <QueryState pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {run && (
        <>
          <PageHeading
            title={'Проверка ' + run.runId}
            subtitle="Состояние задания и результат правил — независимые вещи."
            actions={
              <>
                <Link
                  className="button secondary"
                  to={'/projects/' + projectId + '/runs/compare?left=' + runId}
                >
                  Сравнить запуск
                </Link>
                <Button
                  variant="primary"
                  disabled={report.isPending || run.status !== 'COMPLETED'}
                  onClick={() =>
                    report.mutate(runId, {
                      onSuccess: (result) => trackJob(projectId, result.job.jobId),
                    })
                  }
                >
                  Сформировать Markdown-отчёт
                </Button>
              </>
            }
          />
          <div className="context-line">
            <Badge status={run.status} />
            <code>{run.jobId}</code>
            {run.historical && <span className="draft-badge">Исторический контекст</span>}
          </div>
          {run.historical && (
            <Banner>
              Результат закреплён за {run.manifest.revisionId} и исходными сборками. Текущая схема
              не изменяет эти данные.
            </Banner>
          )}
          {run.status !== 'COMPLETED' && <JobCard projectId={projectId} jobId={run.jobId} />}
          {report.error && <ErrorState error={report.error} />}
          {report.data && (
            <>
              <JobCard projectId={projectId} jobId={report.data.job.jobId} />
              <Link className="button secondary" to={'/projects/' + projectId + '/artifacts'}>
                Открыть артефакты отчёта
              </Link>
            </>
          )}
          <div className="run-detail-layout">
            <section className="panel">
              <div className="panel-heading">
                <h2>Охват и проверки</h2>
              </div>
              <RunSummary run={run} />
            </section>
            <section className="panel">
              <RunManifest run={run} />
            </section>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>Результаты и контрпримеры</h2>
              {!run.summary.complete && <span className="draft-badge dirty">Частичные данные</span>}
            </div>
            <div className="form-grid">
              <Field label="Статус проверки">
                {(id) => (
                  <select
                    id={id}
                    value={status}
                    onChange={(event) => filter('status', event.target.value)}
                  >
                    <option value="">Все статусы</option>
                    {['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'UNKNOWN'].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Правило">
                {(id) => (
                  <input
                    id={id}
                    value={ruleSearch.value}
                    onChange={(event) => ruleSearch.setValue(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Исходная запись">
                {(id) => (
                  <select
                    id={id}
                    value={captureId}
                    onChange={(event) => filter('captureId', event.target.value)}
                  >
                    <option value="">Все записи</option>
                    {run.manifest.corpus.map((item) => (
                      <option key={item.captureId}>{item.captureId}</option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <QueryState
              pending={results.isPending}
              error={results.error}
              retry={() => void results.refetch()}
            >
              {results.data?.items.length ? (
                <ResultsTable
                  results={results.data.items}
                  runId={runId}
                  revisionId={run.manifest.revisionId}
                />
              ) : (
                <Empty
                  title="Нет результатов по этим условиям"
                  description="Ноль результатов не подтверждает выполнение правил."
                />
              )}
              {results.data && (
                <Pagination
                  cursor={cursor}
                  total={results.data.total}
                  nextCursor={results.data.nextCursor}
                  onChange={(value) => filter('cursor', value)}
                />
              )}
            </QueryState>
          </section>
        </>
      )}
    </QueryState>
  );
}
