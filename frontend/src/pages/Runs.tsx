import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProject } from '../app/Shell';
import { api } from '../shared/api/client';
import { queryKey, useCommand } from '../shared/api/query';
import { MoreChoices, usePagedChoices } from '../shared/api/paged-choices';
import type { Location } from '../shared/api/contracts/draft';
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
import { RangePicker } from '../shared/ui/RangePicker';
import { JobCard, trackJob } from '../features/jobs/Jobs';
import { formatTimestamp } from '../shared/model/precision';
import { UnsavedGuard } from '../shared/lib/use-unsaved';
export default function Runs() {
  const project = useProject();
  const projectId = project.projectId;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const cursor = params.get('cursor') ?? '0';
  const history = useQuery({
    queryKey: queryKey(projectId, 'runs', { cursor }),
    queryFn: ({ signal }) => api.runs({ projectId, cursor }, { signal }),
  });
  const interpretations = usePagedChoices(projectId, 'interpretations', (cursor, signal) =>
    api.interpretations({ projectId, cursor }, { signal }),
  );
  const settings = useQuery({
    queryKey: queryKey(projectId, 'settings'),
    queryFn: ({ signal }) => api.settings(projectId, undefined, { signal }),
  });
  const [interpretationChoice, setInterpretation] = useState(params.get('interpretationId') ?? '');
  const [revisionChoice, setRevision] = useState(params.get('revisionId') ?? '');
  const [settingsChoice, setSettings] = useState(
    params.get('settingsVersion') ?? project.settingsVersion,
  );
  const filters = 'Все сообщения выбранных сборок';
  const [location, setLocation] = useState<Location | null>(null);
  const [corpus, setCorpus] = useState<(Location & { settingsVersion: string })[]>([]);
  const [assemblySettings, setAssemblySettings] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [createdRun, setCreatedRun] = useState('');
  useEffect(() => {
    if (createdRun) void navigate('/projects/' + projectId + '/runs/' + createdRun);
  }, [createdRun, navigate, projectId]);
  const interpretationId =
    interpretationChoice ||
    interpretations.data?.items.find((item) =>
      item.revisions.some((revision) => revision.revisionId === revisionChoice),
    )?.interpretationId ||
    (!revisionChoice ? interpretations.data?.items[0]?.interpretationId : '') ||
    '';
  const selectedInterpretation = useQuery({
    queryKey: queryKey(projectId, 'interpretation', { interpretationId }),
    queryFn: ({ signal }) => api.interpretation(projectId, interpretationId, { signal }),
    enabled:
      !!interpretationId &&
      !interpretations.data?.items.some((item) => item.interpretationId === interpretationId),
  });
  const interpretation =
    interpretations.data?.items.find((item) => item.interpretationId === interpretationId) ??
    selectedInterpretation.data;
  const revisionId = revisionChoice || interpretation?.revisions.at(-1)?.revisionId || '';
  const alreadyInCorpus =
    !!location &&
    corpus.some(
      (item) => item.captureId === location.captureId && item.assemblyId === location.assemblyId,
    );
  const valid =
    corpus.length > 0 &&
    corpus.every((item) => item.settingsVersion === settingsChoice) &&
    !!filters.trim() &&
    interpretation?.revisions.some((item) => item.revisionId === revisionId) &&
    settings.data?.some((item) => item.settingsVersion === settingsChoice);
  const create = useCommand(
    'createRun',
    (input: Record<string, unknown>, options) => api.createRun(input, options),
    [queryKey(projectId, 'runs')],
  );
  return (
    <>
      <UnsavedGuard dirty={corpus.length > 0} searchKeys={[]} />
      <PageHeading
        title="Проверки корпуса"
        subtitle="Запуски закрепляют ревизию, сборки и настройки. Проверка охватывает весь выбранный корпус."
        actions={
          <Link className="button secondary" to={'/projects/' + projectId + '/runs/compare'}>
            Сравнить два запуска
          </Link>
        }
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Новая проверка</h2>
        </div>
        <div className="form-grid">
          <Field label="Интерпретация">
            {(id) => (
              <select
                id={id}
                value={interpretationId}
                onChange={(event) => {
                  setInterpretation(event.target.value);
                  setRevision('');
                  const next = new URLSearchParams(params);
                  next.set('interpretationId', event.target.value);
                  next.delete('revisionId');
                  setParams(next, { replace: true });
                }}
              >
                {interpretation &&
                  !interpretations.data?.items.some(
                    (item) => item.interpretationId === interpretationId,
                  ) && <option value={interpretationId}>{interpretation.name}</option>}
                {interpretations.data?.items.map((item) => (
                  <option value={item.interpretationId} key={item.interpretationId}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Сохранённая ревизия"
            error={
              interpretation &&
              !interpretation.revisions.some((item) => item.revisionId === revisionId)
                ? 'Выберите сохранённую ревизию этой интерпретации.'
                : undefined
            }
          >
            {(id) => (
              <select
                id={id}
                value={revisionId}
                onChange={(event) => {
                  setRevision(event.target.value);
                  const next = new URLSearchParams(params);
                  next.set('interpretationId', interpretationId);
                  next.set('revisionId', event.target.value);
                  setParams(next, { replace: true });
                }}
              >
                {revisionId &&
                  interpretation &&
                  !interpretation.revisions.some((item) => item.revisionId === revisionId) && (
                    <option value={revisionId} disabled>
                      {revisionId} · недоступна в этой интерпретации
                    </option>
                  )}
                {interpretation?.revisions.map((item) => (
                  <option key={item.revisionId} value={item.revisionId}>
                    {item.revisionId}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Версия настроек"
            error={
              settings.data &&
              !settings.data.some((item) => item.settingsVersion === settingsChoice)
                ? 'Выберите доступную версию настроек.'
                : undefined
            }
          >
            {(id) => (
              <select
                id={id}
                value={settingsChoice}
                onChange={(event) => {
                  setSettings(event.target.value);
                  const next = new URLSearchParams(params);
                  next.set('settingsVersion', event.target.value);
                  setParams(next, { replace: true });
                }}
              >
                {settings.data &&
                  !settings.data.some((item) => item.settingsVersion === settingsChoice) && (
                    <option value={settingsChoice} disabled>
                      {settingsChoice} · недоступна
                    </option>
                  )}
                {settings.data?.map((item) => (
                  <option key={item.settingsVersion} value={item.settingsVersion}>
                    {item.settingsVersion} · {item.checksum}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <MoreChoices label="интерпретации" query={interpretations} />
        {revisionChoice && !interpretationId && (
          <Banner>
            Выберите интерпретацию, которой принадлежит указанная ревизия. Модель другого запуска
            автоматически не подставляется.
          </Banner>
        )}
        <RangePicker
          projectId={projectId}
          label="Сборка для корпуса"
          onChange={(value, version) => {
            setLocation(value);
            setAssemblySettings(version);
          }}
        />
        <Button
          disabled={!location || !assemblySettings || alreadyInCorpus}
          title={alreadyInCorpus ? 'Эта сборка уже включена в корпус' : undefined}
          onClick={() =>
            location &&
            assemblySettings &&
            setCorpus((old) =>
              old.some(
                (item) =>
                  item.captureId === location.captureId && item.assemblyId === location.assemblyId,
              )
                ? old
                : [...old, { ...location, settingsVersion: assemblySettings }],
            )
          }
        >
          Добавить сборку в корпус
        </Button>
        {alreadyInCorpus && (
          <p className="muted">Эта сборка уже включена в корпус. Выберите другую для добавления.</p>
        )}
        <div className="corpus-list">
          {corpus.map((item) => (
            <div className="row between" key={item.captureId + item.assemblyId}>
              <span className="mono">
                {item.captureId} / {item.assemblyId}
                {' · ' + item.settingsVersion}
              </span>
              <Button
                variant="ghost"
                onClick={() => setCorpus(corpus.filter((entry) => entry !== item))}
              >
                Исключить из корпуса
              </Button>
            </div>
          ))}
        </div>
        {corpus.some((item) => item.settingsVersion !== settingsChoice) && (
          <Banner tone="warning">
            Версии настроек выбранных сборок не совпадают с настройками проверки. Выберите
            соответствующую версию или измените корпус.
          </Banner>
        )}
        <Field
          label="Область и фильтры проверки"
          hint="Проверяются все сообщения каждой добавленной сборки. Диапазон выше помогает выбрать сборку и не ограничивает корпус."
        >
          {(id) => (
            <select id={id} value={filters} onChange={() => {}}>
              <option value={filters}>Все сообщения выбранных сборок</option>
            </select>
          )}
        </Field>
        <Button
          variant="primary"
          disabled={!valid || create.isPending}
          onClick={() => setConfirm(true)}
        >
          Проверить корпус
        </Button>
        {[interpretations.error, selectedInterpretation.error, settings.error, create.error]
          .filter(Boolean)
          .map((error, index) => (
            <ErrorState error={error} key={index} />
          ))}
        {create.data && !create.data.run && (
          <>
            <Banner tone="success">
              Задание принято. После обработки запуск появится в истории ниже.
            </Banner>
            <JobCard projectId={projectId} jobId={create.data.job.jobId} />
          </>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>История запусков</h2>
        </div>
        <QueryState
          pending={history.isPending}
          error={history.error}
          retry={() => void history.refetch()}
        >
          {history.data?.items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Запуск</th>
                    <th>Выполнение</th>
                    <th>Ревизия / настройки</th>
                    <th>Охват</th>
                    <th>Результат</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.items.map((run) => (
                    <tr key={run.runId}>
                      <td>
                        <Link to={'/projects/' + projectId + '/runs/' + run.runId}>
                          <strong>{run.runId}</strong>
                        </Link>
                        <small className="mono timestamp">{formatTimestamp(run.createdAt)}</small>
                      </td>
                      <td>
                        <Badge status={run.status} />
                        {run.historical && <small>Исторический контекст</small>}
                        {!run.summary.complete && <small>Частичный результат</small>}
                      </td>
                      <td>
                        <code>{run.manifest.revisionId}</code>
                        <small className="mono">{run.manifest.settingsVersion}</small>
                      </td>
                      <td>
                        {run.summary.messages} сообщений / {run.summary.captures} записей
                      </td>
                      <td>
                        <Link
                          className="button ghost"
                          to={'/projects/' + projectId + '/runs/' + run.runId}
                        >
                          Открыть сводку
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Нет запусков"
              description="Выберите сохранённую ревизию и добавьте сборки в корпус."
            />
          )}
          {history.data && (
            <Pagination
              cursor={cursor}
              total={history.data.total}
              nextCursor={history.data.nextCursor}
              onChange={(value) => setParams({ cursor: value })}
            />
          )}
        </QueryState>
      </section>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Проверить выбранный корпус?"
        description="Входы закрепляются при создании запуска. Изменение схемы или настроек не изменит уже начатую проверку."
      >
        <dl className="metadata">
          <div>
            <dt>revisionId</dt>
            <dd>
              <code>{revisionId}</code>
            </dd>
          </div>
          <div>
            <dt>settingsVersion</dt>
            <dd>
              <code>{settingsChoice}</code>
            </dd>
          </div>
        </dl>
        {corpus.map((item) => (
          <p key={item.captureId + item.assemblyId}>
            <code>
              {item.captureId} / {item.assemblyId}
            </code>
          </p>
        ))}
        <p>Область: {filters}</p>
        <Banner>
          Авторитетные хеши записей и версия движка появятся в manifest принятого запуска.
        </Banner>
        <Button
          variant="primary"
          disabled={!valid || create.isPending}
          onClick={() =>
            create.mutate(
              {
                projectId,
                interpretationId,
                revisionId,
                settingsVersion: settingsChoice,
                corpus: corpus.map(({ captureId, assemblyId }) => ({ captureId, assemblyId })),
                filters,
              },
              {
                onSuccess: (result) => {
                  trackJob(projectId, result.job.jobId);
                  setConfirm(false);
                  setCorpus([]);
                  if (result.run) {
                    setCreatedRun(result.run.runId);
                  }
                },
              },
            )
          }
        >
          {create.isPending ? 'Создание запуска…' : 'Создать запуск'}
        </Button>
        {create.error && <ErrorState error={create.error} />}
      </Modal>
    </>
  );
}
