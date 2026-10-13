import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProject } from '../app/Shell';
import { api } from '../shared/api/client';
import { queryKey } from '../shared/api/query';
import { compatibleRunInputs } from '../shared/model/runs';
import { Link } from 'react-router-dom';
import {
  Badge,
  Banner,
  Empty,
  Field,
  PageHeading,
  Pagination,
  QueryState,
} from '../shared/ui/common';
import { RunManifest, RunSummary } from '../features/runs/Summary';
export default function RunCompare() {
  const projectId = useProject().projectId;
  const [params, setParams] = useSearchParams();
  const cursor = params.get('historyCursor') ?? '0';
  const history = useQuery({
    queryKey: queryKey(projectId, 'runs', { cursor }),
    queryFn: ({ signal }) => api.runs({ projectId, cursor }, { signal }),
  });
  const leftId = params.get('left') ?? history.data?.items[0]?.runId ?? '';
  const rightId = params.get('right') ?? history.data?.items[1]?.runId ?? '';
  const left = useQuery({
    queryKey: queryKey(projectId, 'run', { runId: leftId }),
    queryFn: ({ signal }) => api.run(projectId, leftId, { signal }),
    enabled: !!leftId,
  });
  const right = useQuery({
    queryKey: queryKey(projectId, 'run', { runId: rightId }),
    queryFn: ({ signal }) => api.run(projectId, rightId, { signal }),
    enabled: !!rightId,
  });
  const choices = [
    ...new Map(
      [
        ...(history.data?.items ?? []),
        ...(left.data ? [left.data] : []),
        ...(right.data ? [right.data] : []),
      ].map((run) => [run.runId, run]),
    ).values(),
  ];
  return (
    <>
      <PageHeading
        title="Сравнение запусков"
        subtitle="Оцените изменение правил вместе с корпусом, версиями и областью проверки."
      />
      <div className="form-grid">
        {[
          ['left', 'Левый запуск', leftId],
          ['right', 'Правый запуск', rightId],
        ].map(([key, label, value]) => (
          <Field label={label!} key={key}>
            {(id) => (
              <select
                id={id}
                value={value}
                onChange={(event) => {
                  const next = new URLSearchParams(params);
                  next.set(key!, event.target.value);
                  setParams(next);
                }}
              >
                {choices.map((run) => (
                  <option key={run.runId}>{run.runId}</option>
                ))}
              </select>
            )}
          </Field>
        ))}
      </div>
      {history.data && (cursor !== '0' || history.data.nextCursor !== null) && (
        <Pagination
          cursor={cursor}
          nextCursor={history.data.nextCursor}
          total={history.data.total}
          onChange={(value) => {
            const next = new URLSearchParams(params);
            next.set('historyCursor', value);
            if (leftId) next.set('left', leftId);
            if (rightId) next.set('right', rightId);
            setParams(next);
          }}
        />
      )}
      <QueryState
        pending={
          history.isPending || (!!leftId && left.isPending) || (!!rightId && right.isPending)
        }
        error={history.error ?? left.error ?? right.error}
        retry={() => {
          void history.refetch();
          void left.refetch();
          void right.refetch();
        }}
      >
        {history.data && !leftId && !rightId && (
          <Empty
            title="Нет запусков для сравнения"
            description="Создайте проверку корпуса, чтобы появилась история."
          >
            <Link className="button primary" to={'/projects/' + projectId + '/runs'}>
              Создать проверку корпуса
            </Link>
          </Empty>
        )}
        {history.data && !!leftId !== !!rightId && (
          <Banner>
            Для сравнения выберите два запуска. Сейчас доступен один участник сравнения.
          </Banner>
        )}
        {left.data && right.data && (
          <>
            <Banner tone={compatibleRunInputs(left.data, right.data) ? 'info' : 'warning'}>
              {compatibleRunInputs(left.data, right.data)
                ? 'Корпус, сборки, настройки и фильтры совпадают. Изменения правил можно сопоставлять в этой области.'
                : 'Входы различаются: корпус, сборки, настройки, движок или фильтры. Уменьшение FAIL не доказывает улучшение схемы.'}
            </Banner>
            <p className="mono">
              Изменение нарушений FAIL:{' '}
              {String(BigInt(right.data.summary.rules.FAIL) - BigInt(left.data.summary.rules.FAIL))}
            </p>
            <div className="comparison-grid">
              <section className="panel">
                <h2>{leftId}</h2>
                <div className="toolbar">
                  <Badge status={left.data.status} />
                  {left.data.historical && <Badge status="HISTORICAL" />}
                </div>
                <RunManifest run={left.data} />
                <RunSummary run={left.data} />
              </section>
              <section className="panel">
                <h2>{rightId}</h2>
                <div className="toolbar">
                  <Badge status={right.data.status} />
                  {right.data.historical && <Badge status="HISTORICAL" />}
                </div>
                <RunManifest run={right.data} />
                <RunSummary run={right.data} />
              </section>
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}
