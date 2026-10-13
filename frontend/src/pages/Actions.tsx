import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProject } from '../app/Shell';
import { api } from '../shared/api/client';
import { queryKey, useCommand } from '../shared/api/query';
import type { Evidence, Location } from '../shared/api/contracts/draft';
import { UnsavedGuard } from '../shared/lib/use-unsaved';
import {
  formatTimestamp,
  shiftTimestamp,
  timestampSchema,
  timestampNanoseconds,
} from '../shared/model/precision';
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
  const type = params.get('type') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const cursor = params.get('cursor') ?? '0';
  const actionId = params.get('actionId') ?? '';
  const evidenceCursor = params.get('evidenceCursor') ?? '0';
  const timeError =
    (from && !timestampSchema.safeParse(from).success) ||
    (to && !timestampSchema.safeParse(to).success)
      ? 'Нужно полное ISO-время с timezone; точность до наносекунды.'
      : from && to && timestampNanoseconds(from) > timestampNanoseconds(to)
        ? 'Начало времени позже конца.'
        : '';
  const actions = useQuery({
    queryKey: queryKey(projectId, 'actions', { q, type, from, to, cursor }),
    queryFn: ({ signal }) => api.actions({ projectId, q, type, from, to, cursor }, { signal }),
    enabled: !timeError,
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
  const [editStatus, setEditStatus] = useState<Evidence['status']>('tentative');
  const [discardEdit, setDiscardEdit] = useState(false);
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
        subtitle="Названия и параметры происходят из журнала, время относится к наблюдению."
        actions={
          <Modal
            title="Импортировать журнал CSV"
            description="Ошибки строк и частичный импорт остаются видимыми. Формат CSV уточняется с Workspace."
            trigger={<Button variant="primary">Импортировать CSV</Button>}
          >
            <UploadWidget kind="csv" projectId={projectId} />
          </Modal>
        }
      />
      <div className="form-grid">
        <Field label="Поиск по действиям">
          {(id) => (
            <input
              id={id}
              type="search"
              value={q}
              onChange={(event) => filter('q', event.target.value)}
            />
          )}
        </Field>
        <Field label="Тип действия">
          {(id) => (
            <input id={id} value={type} onChange={(event) => filter('type', event.target.value)} />
          )}
        </Field>
        <Field label="Время от, ISO с timezone">
          {(id) => (
            <input
              id={id}
              value={from}
              onChange={(event) => filter('from', event.target.value)}
              placeholder="2026-10-11T12:00:00Z…"
            />
          )}
        </Field>
        <Field label="Время до, ISO с timezone">
          {(id) => (
            <input id={id} value={to} onChange={(event) => filter('to', event.target.value)} />
          )}
        </Field>
      </div>
      {timeError && <Banner tone="error">{timeError}</Banner>}
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
                    <th>Параметры</th>
                    <th>Источник названия</th>
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
                          {formatTimestamp(
                            shiftTimestamp(action.timestamp, action.offsetNanoseconds),
                          )}
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
                          onClick={() => filter('actionId', action.actionId)}
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
          <code>{actionId || 'Действие не выбрано'}</code>
        </div>
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
        <Field label="Основание связи">
          {(id) => (
            <textarea
              id={id}
              value={basis}
              disabled={save.isPending}
              onChange={(event) => setBasis(event.target.value)}
              maxLength={4000}
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
            !basis.trim() ||
            save.isPending
          }
          onClick={() =>
            save.mutate(
              { actionId, location, basis, status: confidence, kind: 'support' },
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
            {save.data.location.assemblyId}.
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
                <p>{item.basis}</p>
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
              description="Выберите действие, диапазон и запишите основание."
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
              if (!editBasis.trim() || save.isPending) return;
              save.mutate(
                {
                  evidenceId: editing.evidenceId,
                  actionId: editing.actionId,
                  location: editing.location,
                  kind: editing.kind,
                  basis: editBasis,
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
            <Field label="Основание сохранённой связи">
              {(id) => (
                <textarea
                  id={id}
                  value={editBasis}
                  disabled={save.isPending}
                  maxLength={4000}
                  required
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
            <Button type="submit" variant="primary" disabled={!editBasis.trim() || save.isPending}>
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
