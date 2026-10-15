import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProject } from '../app/Shell';
import { api } from '../shared/api/client';
import { queryKey, useCommand } from '../shared/api/query';
import { MoreChoices, usePagedChoices } from '../shared/api/paged-choices';
import type { Artifact } from '../shared/api/contracts/models';
import { DownloadLink } from '../shared/ui/DownloadLink';
import {
  Badge,
  Banner,
  Button,
  Empty,
  ErrorState,
  Field,
  Modal,
  PageHeading,
  Pagination,
  QueryState,
} from '../shared/ui/common';
import { UploadWidget } from '../features/projects/Upload';
import { JobsCenter, trackJob } from '../features/jobs/Jobs';
function ArtifactDownload({ artifact }: { artifact: Artifact }) {
  if (artifact.status !== 'READY' || !artifact.downloadUrl)
    return <span className="muted">Скачивание недоступно</span>;
  return (
    <DownloadLink
      path={artifact.downloadUrl}
      name={artifact.name}
      contentType={artifact.contentType}
    >
      Скачать {artifact.kind === 'report' ? 'Markdown' : 'ZIP'}
    </DownloadLink>
  );
}
export default function Artifacts() {
  const projectId = useProject().projectId;
  const [params, setParams] = useSearchParams();
  const cursor = params.get('cursor') ?? '0';
  const runChoice = params.get('runId') ?? '';
  const query = useQuery({
    queryKey: queryKey(projectId, 'artifacts', { cursor }),
    queryFn: ({ signal }) => api.artifacts({ projectId, cursor }, { signal }),
    refetchInterval: (query) =>
      query.state.error || query.state.dataUpdateCount >= 120
        ? false
        : query.state.data?.items.some((item) => item.status === 'PENDING')
          ? 600
          : false,
  });
  const runs = usePagedChoices(projectId, 'runs', (cursor, signal) =>
    api.runs({ projectId, cursor }, { signal }),
  );
  const runId =
    runChoice || runs.data?.items.find((run) => run.status === 'COMPLETED')?.runId || '';
  const selected = useQuery({
    queryKey: queryKey(projectId, 'run', { runId }),
    queryFn: ({ signal }) => api.run(projectId, runId, { signal }),
    enabled: !!runId && !runs.data?.items.some((run) => run.runId === runId),
  });
  const choices = [
    ...new Map(
      [...(runs.data?.items ?? []), ...(selected.data ? [selected.data] : [])].map((run) => [
        run.runId,
        run,
      ]),
    ).values(),
  ];
  const completed = choices.some((run) => run.runId === runId && run.status === 'COMPLETED');
  const exportProject = useCommand(
    'exportProject',
    (id: string, options) => api.exportProject(id, options),
    [queryKey(projectId, 'artifacts')],
  );
  const report = useCommand(
    'createReport',
    (id: string, options) => api.createReport(projectId, id, options),
    [queryKey(projectId, 'artifacts')],
  );
  return (
    <>
      <PageHeading
        title="Отчёты и перенос"
        subtitle="Артефакты публикуются после завершения серверного задания."
        actions={
          <>
            <Modal
              title="Импортировать проект ZIP"
              description="Создаёт отдельный проект в IMPORTING. Проверка версии, хешей и зависимостей выполняется Workspace."
              trigger={<Button>Импортировать ZIP</Button>}
            >
              <UploadWidget kind="project" />
            </Modal>
            <Button
              variant="primary"
              disabled={exportProject.isPending}
              onClick={() =>
                exportProject.mutate(projectId, {
                  onSuccess: (result) => trackJob(projectId, result.job.jobId),
                })
              }
            >
              Экспортировать проект ZIP
            </Button>
          </>
        }
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Отчёт по закреплённому запуску</h2>
        </div>
        <Field label="Завершённый запуск для отчёта">
          {(id) => (
            <select
              id={id}
              value={runId}
              onChange={(event) => {
                const next = new URLSearchParams(params);
                next.set('runId', event.target.value);
                setParams(next);
              }}
            >
              {choices
                .filter((run) => run.status === 'COMPLETED')
                .map((run) => (
                  <option key={run.runId}>{run.runId}</option>
                ))}
            </select>
          )}
        </Field>
        <MoreChoices label="запуски для отчёта" query={runs} />
        {(runs.error ?? selected.error) && (
          <ErrorState
            error={runs.error ?? selected.error}
            retry={() => {
              void runs.refetch();
              if (runId) void selected.refetch();
            }}
          />
        )}
        <Button
          disabled={!completed || report.isPending}
          onClick={() =>
            report.mutate(runId, { onSuccess: (result) => trackJob(projectId, result.job.jobId) })
          }
        >
          Сформировать Markdown-отчёт
        </Button>
        <p className="muted">
          Отчёт связывает runId со снимком исследовательских записей. Незавершённый артефакт
          недоступен.
        </p>
        {[report.error, exportProject.error, runs.error].filter(Boolean).map((error, index) => (
          <ErrorState key={index} error={error} />
        ))}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Готовые и ожидаемые артефакты</h2>
        </div>
        <QueryState
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        >
          {query.data?.items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Файл</th>
                    <th>Состояние</th>
                    <th>Контекст</th>
                    <th>Скачивание</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((artifact) => (
                    <tr key={artifact.artifactId}>
                      <td>
                        <strong>{artifact.name}</strong>
                        <small>{artifact.contentType}</small>
                        <small className="mono">{artifact.artifactId}</small>
                      </td>
                      <td>
                        <Badge status={artifact.status} />
                      </td>
                      <td>
                        <code>{artifact.runId ?? projectId}</code>
                        <small className="mono">{artifact.snapshotId ?? 'Снимок проекта'}</small>
                        <small className="mono">{artifact.jobId}</small>
                      </td>
                      <td>
                        <ArtifactDownload artifact={artifact} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Артефактов пока нет" description="Запросите отчёт или экспорт проекта." />
          )}
          {query.data && (
            <Pagination
              cursor={cursor}
              nextCursor={query.data.nextCursor}
              total={query.data.total}
              onChange={(value) => setParams({ cursor: value })}
            />
          )}
        </QueryState>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Повторное применение без GUI</h2>
        </div>
        <Banner tone="warning">
          CLI и его подтверждённый синтаксис отсутствуют (AN-16, Backend 2). Команда повторного
          применения пока недоступна. После передачи backend-документации здесь появятся проверенная
          команда, формат входов и условия запуска.
        </Banner>
        <p>
          Точный JSON сохранённой ревизии доступен в редакторе интерпретации. Копирование команды не
          будет означать её выполнение.
        </p>
      </section>
      <JobsCenter projectId={projectId} />
    </>
  );
}
