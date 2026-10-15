import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProject } from '../app/Shell';
import { api } from '../shared/api/client';
import { queryKey, useCommand } from '../shared/api/query';
import type { Action, Evidence, Location } from '../shared/api/contracts/models';
import { UnsavedGuard } from '../shared/lib/use-unsaved';
import { useBufferedParam } from '../shared/lib/use-buffered-param';
import { textError, timeRangeInput } from '../shared/model/validation';
import { formatTimestamp, formatShiftedTimestamp } from '../shared/model/precision';
import { readLocation, sourceLink } from '../shared/model/navigation';
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
import { UploadWidget } from '../features/projects/Upload';
export default function Actions() {
  const projectId = useProject().projectId;
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const search = useBufferedParam('q');
  const typeSearch = useBufferedParam('type');
  const type = params.get('type') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const cursor = params.get('cursor') ?? '0';
  const actionId = params.get('actionId') ?? '';
  const [chosenAction, setChosenAction] = useState<Action | null>(null);
  const evidenceCursor = params.get('evidenceCursor') ?? '0';
  const timeRange = timeRangeInput(from, to);
  const timeError = timeRange.fromError ?? timeRange.toError;
  const actions = useQuery({
    queryKey: queryKey(projectId, 'actions', { q, type, from, to, cursor }),
    queryFn: ({ signal }) => api.actions({ projectId, q, type, from, to, cursor }, { signal }),
    enabled: !timeError,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] &&
      Reflect.get(previousQuery.queryKey[3] as object, 'cursor') === cursor
        ? previous
        : undefined,
  });
  const evidence = useQuery({
    queryKey: queryKey(projectId, 'evidence', { actionId, cursor: evidenceCursor }),
    queryFn: ({ signal }) =>
      api.evidence({ projectId, actionId, cursor: evidenceCursor }, { signal }),
  });
  let initial: Location | null = null;
  let sourceError: Error | undefined;
  try {
    if (params.get('source'))
      initial = readLocation(
        new URL(params.get('source')!, window.location.origin).searchParams,
        projectId,
      );
    if (params.get('source') && !initial)
      throw new Error('Ссылка на источник содержит неполный контекст сборки.');
  } catch (error) {
    sourceError = error as Error;
  }
  const [location, setLocation] = useState<Location | null>(initial);
  const [basis, setBasis] = useState('');
  const [confidence, setConfidence] = useState('tentative');
  const rangeBaseline = useRef<Location | null | undefined>(undefined);
  const [rangeDirty, setRangeDirty] = useState(false);
  const [editing, setEditing] = useState<Evidence | null>(null);
  const [editBasis, setEditBasis] = useState('');
  const basisProblem = textError(basis, 'основание связи', 4000, false);
  const editBasisProblem = textError(editBasis, 'основание связи', 4000, false);
  const [editStatus, setEditStatus] = useState<Evidence['status']>('tentative');
  const [discardEdit, setDiscardEdit] = useState(false);
  const selectedAction =
    actions.data?.items.find((item) => item.actionId === actionId) ??
    (chosenAction?.actionId === actionId ? chosenAction : null);
  const editDirty = !!editing && (editBasis !== editing.basis || editStatus !== editing.status);
  const save = useCommand(
    'saveEvidence',
    (input: Record<string, unknown>, options) => api.saveEvidence({ projectId, ...input }, options),
    [queryKey(projectId, 'evidence')],
  );
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key !== 'cursor') next.delete('cursor');
    if (key === 'actionId') next.delete('evidenceCursor');
    setParams(next, { replace: true });
  }
  return (
    <>
      <UnsavedGuard
        dirty={basis !== '' || confidence !== 'tentative' || rangeDirty || editDirty}
        searchKeys={['actionId', 'source']}
      />
      <PageHeading
        title="Журнал действий"
        subtitle="Что ты делал с устройством и в какое время. Эти сведения импортированы из CSV."
        actions={
          <Modal
            title="Импортировать журнал CSV"
            description="Загрузи журнал с временем, названием действия и его параметрами. Ошибки строк будут показаны после обработки."
            trigger={<Button variant="primary">Импортировать CSV</Button>}
          >
            <UploadWidget kind="csv" projectId={projectId} />
          </Modal>
        }
      />
      <section className="panel guide-intro">
        <h2>Откуда взялись эти названия?</h2>
        <p>
          Названия действий и параметры ниже прочитаны из CSV. Например, <code>period_ms: 200</code>
          означает, что в журнале записан период 200 мс. Где он находится в пакетах, ещё нужно
          установить.
        </p>
        <p>
          Выбери действие в таблице. Затем открой его предполагаемые байты в «Обмене и байтах»,
          выдели участок и нажми «Связать с действием журнала». Вернувшись сюда, проверь выбранное
          действие, поясни связь и сохрани её.
        </p>
        <Link to={'/projects/' + projectId + '/guide#fields'}>
          Что такое поле и как его искать →
        </Link>
      </section>
      <div className="form-grid">
        <Field label="Поиск по действиям">
          {(id) => (
            <input
              id={id}
              type="search"
              value={search.value}
              onChange={(event) => search.setValue(event.target.value)}
            />
          )}
        </Field>
        <Field label="Тип действия">
          {(id) => (
            <input
              id={id}
              value={typeSearch.value}
              onChange={(event) => typeSearch.setValue(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="Время от, ISO с timezone"
          hint="Например, 2026-10-11T12:00:00Z или 2026-10-11T15:00:00+03:00."
          error={timeRange.fromError}
        >
          {(id) => (
            <input
              id={id}
              value={from}
              onChange={(event) => filter('from', event.target.value)}
              placeholder="2026-10-11T12:00:00Z…"
            />
          )}
        </Field>
        <Field
          label="Время до, ISO с timezone"
          hint="Укажите полный момент времени с часовым поясом."
          error={timeRange.toError}
        >
          {(id) => (
            <input id={id} value={to} onChange={(event) => filter('to', event.target.value)} />
          )}
        </Field>
      </div>
      {timeError && <Banner tone="error">{timeError}</Banner>}
      <div className="query-updating" role="status">
        {search.pending || typeSearch.pending || actions.isFetching
          ? 'Обновление списка действий…'
          : ''}
      </div>
      <section className="panel">
        <QueryState
          pending={actions.isPending && !timeError}
          error={actions.error}
          retry={() => void actions.refetch()}
        >
          {actions.data?.items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Действие</th>
                    <th>Время и поправка</th>
                    <th>Параметры из CSV</th>
                    <th>Строка CSV</th>
                    <th>Связь</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.data.items.map((action) => (
                    <tr key={action.actionId}>
                      <td>
                        <strong>{action.name}</strong>
                        <small>{action.type}</small>
                      </td>
                      <td className="timestamp">
                        <span className="mono">{formatTimestamp(action.timestamp)}</span>
                        <small>
                          {action.timeZone} · поправка {action.offsetNanoseconds} нс
                        </small>
                        <small>
                          Скорректировано:{' '}
                          {formatShiftedTimestamp(action.timestamp, action.offsetNanoseconds)}
                        </small>
                      </td>
                      <td>
                        <code>{action.parameters}</code>
                      </td>
                      <td>
                        {action.sourceFile}
                        <small>
                          Строка {action.row} · {action.importId}
                        </small>
                      </td>
                      <td>
                        <Button
                          variant={actionId === action.actionId ? 'primary' : 'secondary'}
                          onClick={() => {
                            setChosenAction(action);
                            filter('actionId', action.actionId);
                          }}
                          disabled={actions.isFetching || search.pending || typeSearch.pending}
                        >
                          Выбрать действие
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Действий нет"
              description="Импортируйте CSV. Названия действий не угадываются по пакетам."
            />
          )}
          {actions.data && (
            <Pagination
              cursor={cursor}
              busy={actions.isFetching || search.pending || typeSearch.pending}
              nextCursor={actions.data.nextCursor}
              total={actions.data.total}
              onChange={(value) => filter('cursor', value)}
            />
          )}
        </QueryState>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Ручная связь с байтами</h2>
        </div>
        {selectedAction ? (
          <div className="selected-action">
            <span className="muted">Выбранное действие из журнала</span>
            <h3>{selectedAction.name}</h3>
            <p>
              {formatShiftedTimestamp(selectedAction.timestamp, selectedAction.offsetNanoseconds)}
            </p>
            <p>
              Параметры из CSV: <code>{selectedAction.parameters}</code>
            </p>
          </div>
        ) : (
          <p>
            {actionId
              ? 'Действие выбрано по ссылке; его строка сейчас не показана в таблице.'
              : 'Сначала нажми «Выбрать действие» в таблице выше.'}
          </p>
        )}
        {actionId && (
          <details className="technical-details">
            <summary>ID действия</summary>
            <code>{actionId}</code>
          </details>
        )}
        <p>
          Начало и длина ниже задают участок байтов в потоке. Его положение нужно выбрать по записи
          обмена. Параметры CSV сами по себе не определяют этот участок.
        </p>
        <Link
          className="button secondary"
          to={
            location
              ? sourceLink(location, {
                  returnTo: '/projects/' + projectId + '/actions?' + params.toString(),
                })
              : '/projects/' +
                projectId +
                '/traffic?' +
                new URLSearchParams({
                  returnTo: '/projects/' + projectId + '/actions?' + params.toString(),
                }).toString()
          }
        >
          {location ? 'Посмотреть выбранные байты и пакеты' : 'Найти байты в записи обмена'}
        </Link>
        <Banner>
          «Подтверждено» — оценка исследователя. Совпадение числа и успешный разбор не устанавливают
          причинность.
        </Banner>
        {sourceError && <ErrorState error={sourceError} />}
        {!sourceError && (
          <RangePicker
            projectId={projectId}
            label="Связанный диапазон"
            initial={initial}
            onChange={(value) => {
              if (rangeBaseline.current === undefined && value) rangeBaseline.current = value;
              setRangeDirty(
                rangeBaseline.current !== undefined &&
                  JSON.stringify(value) !== JSON.stringify(rangeBaseline.current),
              );
              setLocation(value);
            }}
          />
        )}
        <Field
          label="Основание связи"
          error={basisProblem}
          hint="Опиши, почему считаешь эти байты связанными с действием. Необязательно, до 4000 символов."
        >
          {(id) => (
            <textarea
              id={id}
              value={basis}
              disabled={save.isPending}
              onChange={(event) => setBasis(event.target.value)}
              maxLength={4000}
              placeholder="Например: после изменения периода с 100 на 200 в этом месте изменились два байта."
            />
          )}
        </Field>
        <Field label="Уверенность исследователя">
          {(id) => (
            <select
              id={id}
              value={confidence}
              disabled={save.isPending}
              onChange={(event) => setConfidence(event.target.value)}
            >
              <option value="tentative">Предположительно</option>
              <option value="confirmed">Подтверждено исследователем</option>
            </select>
          )}
        </Field>
        <Button
          variant="primary"
          disabled={
            !!sourceError ||
            !actionId ||
            !location ||
            location.length === '0' ||
            !!basisProblem ||
            save.isPending
          }
          onClick={() =>
            save.mutate(
              { actionId, location, basis: basis.trim(), status: confidence, kind: 'support' },
              {
                onSuccess: () => {
                  setBasis('');
                  setConfidence('tentative');
                  rangeBaseline.current = location;
                  setRangeDirty(false);
                },
              },
            )
          }
        >
          Сохранить ручную связь
        </Button>
        {save.error && <ErrorState error={save.error} />}
        {save.data && (
          <Banner tone="success">
            Связь сохранена: {save.data.evidenceId}. Источники закреплены за{' '}
            {save.data.location.assemblyId}.{' '}
            <Link to={'/projects/' + projectId + '/hypotheses'}>
              Открыть наблюдения и прикрепить эту связь →
            </Link>
          </Banner>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Сохранённые связи</h2>
        </div>
        <QueryState
          pending={evidence.isPending}
          error={evidence.error}
          retry={() => void evidence.refetch()}
        >
          {evidence.data?.items.length ? (
            evidence.data.items.map((item) => (
              <article className="evidence-card" key={item.evidenceId}>
                <Badge status={item.status} />
                <p>{item.basis || 'Основание не указано'}</p>
                <Button
                  disabled={save.isPending}
                  onClick={() => {
                    setEditing(item);
                    setEditBasis(item.basis);
                    setEditStatus(item.status);
                    save.reset();
                  }}
                >
                  Редактировать связь
                </Button>
                <code>
                  {item.location.assemblyId} · [{item.location.start},{' '}
                  {BigInt(item.location.start) + BigInt(item.location.length)})
                </code>
                <p>
                  {item.sources.length} исходных участков; логическая длина {item.location.length}{' '}
                  байт
                </p>
                <Link
                  className="button ghost"
                  to={sourceLink(item.location, {
                    returnTo: '/projects/' + projectId + '/actions?' + params.toString(),
                  })}
                >
                  Открыть исходные пакеты
                </Link>
              </article>
            ))
          ) : (
            <Empty
              title="Связей пока нет"
              description="Выберите действие и диапазон. Основание можно добавить по желанию."
            />
          )}
          {evidence.data && (
            <div role="group" aria-label="Страницы сохранённых связей">
              <Pagination
                cursor={evidenceCursor}
                nextCursor={evidence.data.nextCursor}
                total={evidence.data.total}
                onChange={(value) => {
                  const next = new URLSearchParams(params);
                  next.set('evidenceCursor', value);
                  setParams(next);
                }}
              />
            </div>
          )}
        </QueryState>
      </section>
      <Modal
        title="Редактирование ручной связи"
        description="Основание и уверенность можно уточнить. Исходный диапазон и кадры закреплены за прежней сборкой."
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && save.isPending) return;
          if (!open && editDirty) setDiscardEdit(true);
          else if (!open) setEditing(null);
        }}
      >
        {editing && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (editBasisProblem || save.isPending) return;
              save.mutate(
                {
                  evidenceId: editing.evidenceId,
                  actionId: editing.actionId,
                  location: editing.location,
                  kind: editing.kind,
                  basis: editBasis.trim(),
                  status: editStatus,
                },
                { onSuccess: () => setEditing(null) },
              );
            }}
          >
            <code>
              {editing.evidenceId} · {editing.location.assemblyId} · [{editing.location.start},{' '}
              {BigInt(editing.location.start) + BigInt(editing.location.length)})
            </code>
            <Field
              label="Основание сохранённой связи"
              error={editBasisProblem}
              hint="Необязательно, до 4000 символов."
            >
              {(id) => (
                <textarea
                  id={id}
                  value={editBasis}
                  disabled={save.isPending}
                  maxLength={4000}
                  onChange={(event) => setEditBasis(event.target.value)}
                />
              )}
            </Field>
            <Field label="Уверенность сохранённой связи">
              {(id) => (
                <select
                  id={id}
                  value={editStatus}
                  disabled={save.isPending}
                  onChange={(event) => setEditStatus(event.target.value as Evidence['status'])}
                >
                  <option value="tentative">Предположительно</option>
                  <option value="confirmed">Подтверждено исследователем</option>
                </select>
              )}
            </Field>
            {save.error && <ErrorState error={save.error} />}
            <Button type="submit" variant="primary" disabled={!!editBasisProblem || save.isPending}>
              Сохранить изменения связи
            </Button>
          </form>
        )}
      </Modal>
      <Modal
        title="Закрыть без сохранения?"
        description="Изменения основания и уверенности будут потеряны."
        open={discardEdit}
        onOpenChange={setDiscardEdit}
      >
        <div className="toolbar">
          <Button onClick={() => setDiscardEdit(false)}>Продолжить редактирование</Button>
          <Button
            variant="danger"
            onClick={() => {
              setDiscardEdit(false);
              setEditing(null);
            }}
          >
            Отбросить изменения
          </Button>
        </div>
      </Modal>
    </>
  );
}
