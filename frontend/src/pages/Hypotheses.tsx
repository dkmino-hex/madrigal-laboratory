import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProject } from '../app/Shell';
import { api } from '../shared/api/client';
import { queryKey, useCommand } from '../shared/api/query';
import { MoreChoices, usePagedChoices } from '../shared/api/paged-choices';
import type { Evidence, Hypothesis } from '../shared/api/contracts/draft';
import { sourceLink } from '../shared/model/navigation';
import { UnsavedGuard } from '../shared/lib/use-unsaved';
import { textError, choiceError } from '../shared/model/validation';
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
type Draft = {
  hypothesisId?: string;
  text: string;
  basis: string;
  type: Hypothesis['type'];
  status: Hypothesis['status'];
  evidence: Evidence[];
};
const emptyDraft: Draft = { text: '', basis: '', type: 'hypothesis', status: 'open', evidence: [] };
export default function Hypotheses() {
  const projectId = useProject().projectId;
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const type = params.get('type') ?? '';
  const cursor = params.get('cursor') ?? '0';
  const typeProblem = choiceError(type, ['', 'hypothesis', 'observation'], 'тип записи');
  const statusProblem = choiceError(status, ['', 'open', 'supported', 'refuted'], 'статус');
  const filterProblem = typeProblem ?? statusProblem;
  const query = useQuery({
    queryKey: queryKey(projectId, 'hypotheses', { status, type, cursor }),
    queryFn: ({ signal }) => api.hypotheses({ projectId, status, type, cursor }, { signal }),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] &&
      Reflect.get(previousQuery.queryKey[3] as object, 'cursor') === cursor
        ? previous
        : undefined,
    enabled: !filterProblem,
  });
  const evidence = usePagedChoices(projectId, 'evidence', (cursor, signal) =>
    api.evidence({ projectId, cursor }, { signal }),
  );
  const [open, setOpen] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [touched, setTouched] = useState({ text: false, basis: false });
  const [attachedChoices, setAttachedChoices] = useState<Evidence[]>([]);
  const [evidenceRoles, setEvidenceRoles] = useState<Record<string, Evidence['kind']>>({});
  const [deleting, setDeleting] = useState<Hypothesis | null>(null);
  const [baseline, setBaseline] = useState(JSON.stringify(emptyDraft));
  const dirty = JSON.stringify(draft) !== baseline;
  const save = useCommand(
    'saveHypothesis',
    (input: Draft, options) => api.saveHypothesis({ projectId, ...input }, options),
    [queryKey(projectId, 'hypotheses')],
  );
  const remove = useCommand(
    'deleteHypothesis',
    (hypothesisId: string, options) => api.deleteHypothesis(projectId, hypothesisId, options),
    [queryKey(projectId, 'hypotheses')],
  );
  const textProblem = textError(draft.text, 'формулировку', 4000);
  const basisProblem = textError(draft.basis, 'основания и открытые вопросы', 8000);
  const availableEvidence = [
    ...new Map(
      [...(evidence.data?.items ?? []), ...attachedChoices].map((item) => [item.evidenceId, item]),
    ).values(),
  ];
  function edit(value: Draft) {
    setDraft(value);
    setTouched({ text: false, basis: false });
    setAttachedChoices(value.evidence);
    setEvidenceRoles(
      Object.fromEntries(value.evidence.map((item) => [item.evidenceId, item.kind])),
    );
    setBaseline(JSON.stringify(value));
    setOpen(true);
    save.reset();
  }
  function close(value: boolean) {
    if (save.isPending) return;
    if (!value && dirty) setDiscard(true);
    else setOpen(value);
  }
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'cursor') next.delete('cursor');
    setParams(next, { replace: true, flushSync: true });
  }
  return (
    <>
      <UnsavedGuard dirty={open && dirty} />
      <PageHeading
        title="Наблюдения и гипотезы"
        subtitle="Формулировка, основания, поддерживающие примеры и контрпримеры."
        actions={
          <Button variant="primary" onClick={() => edit(emptyDraft)}>
            Создать наблюдение / гипотезу
          </Button>
        }
      />
      <Banner>
        Извлечённое значение подтверждает только результат разбора. PASS не меняет статус смысловой
        гипотезы.
      </Banner>
      <div className="form-grid">
        <Field label="Тип записи" error={typeProblem}>
          {(id) => (
            <select id={id} value={type} onChange={(event) => filter('type', event.target.value)}>
              <option value="">Все типы</option>
              {typeProblem && (
                <option value={type} disabled>
                  Недоступный тип: {type}
                </option>
              )}
              <option value="hypothesis">Гипотеза</option>
              <option value="observation">Наблюдение</option>
            </select>
          )}
        </Field>
        <Field label="Статус гипотезы" error={statusProblem}>
          {(id) => (
            <select
              id={id}
              value={status}
              onChange={(event) => filter('status', event.target.value)}
            >
              <option value="">Все статусы</option>
              {statusProblem && (
                <option value={status} disabled>
                  Недоступный статус: {status}
                </option>
              )}
              <option value="open">Открыта</option>
              <option value="supported">Поддерживается примерами</option>
              <option value="refuted">Опровергнута</option>
            </select>
          )}
        </Field>
      </div>
      <div className="query-updating" role="status">
        {query.isFetching && query.data ? 'Обновление исследовательских записей…' : ''}
      </div>
      <QueryState
        pending={query.isPending && !filterProblem}
        error={filterProblem ? new Error(filterProblem) : query.error}
        retry={!filterProblem ? () => void query.refetch() : undefined}
      >
        {query.data?.items.length ? (
          <div className="hypothesis-list">
            {query.data.items.map((item) => (
              <article className="panel hypothesis-card" key={item.hypothesisId}>
                <div className="panel-heading">
                  <div>
                    <span className="muted">
                      {item.type === 'hypothesis' ? 'Гипотеза' : 'Наблюдение'}
                    </span>
                    <h2>{item.text}</h2>
                  </div>
                  <div className="toolbar">
                    <Button disabled={query.isFetching} onClick={() => edit(item)}>
                      Редактировать
                    </Button>
                    <Button
                      variant="danger"
                      disabled={query.isFetching}
                      onClick={() => {
                        remove.reset();
                        setDeleting(item);
                      }}
                    >
                      Удалить
                    </Button>
                  </div>
                </div>
                <div className="context-line">
                  <Badge status={item.status} />
                  <code>{item.hypothesisId}</code>
                </div>
                <p>{item.basis}</p>
                <div className="evidence-grid">
                  {item.evidence.map((proof) => (
                    <div key={proof.evidenceId} className={'evidence-card ' + proof.kind}>
                      <h3>{proof.kind === 'support' ? 'Поддерживающий пример' : 'Контрпример'}</h3>
                      <Badge status={proof.status} />
                      <p>{proof.basis}</p>
                      <small>Действие: {proof.actionId ?? 'не связано'}</small>
                      <code>{proof.location.assemblyId}</code>
                      <p className="mono">
                        [{proof.location.start},{' '}
                        {BigInt(proof.location.start) + BigInt(proof.location.length)}) ·{' '}
                        {proof.sources.length} источников
                      </p>
                      <Link
                        className="button ghost"
                        to={sourceLink(proof.location, {
                          runId: proof.runId,
                          revisionId: proof.revisionId,
                          returnTo: '/projects/' + projectId + '/hypotheses',
                        })}
                      >
                        Открыть исходные пакеты
                      </Link>
                    </div>
                  ))}
                </div>
                {!item.evidence.length && (
                  <p className="muted">Примеры ещё не прикреплены. Основание требует проверки.</p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="Исследовательских записей нет"
            description="Сохраните наблюдение или проверяемую гипотезу."
          />
        )}
        {query.data && (
          <Pagination
            cursor={cursor}
            busy={query.isFetching}
            nextCursor={query.data.nextCursor}
            total={query.data.total}
            onChange={(value) => filter('cursor', value)}
          />
        )}
      </QueryState>
      <Modal
        title={
          draft.hypothesisId
            ? 'Редактировать исследовательскую запись'
            : 'Новая исследовательская запись'
        }
        description="Статус задаёт исследователь; результаты запуска остаются самостоятельными."
        open={open}
        onOpenChange={close}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (textProblem || basisProblem || save.isPending) return;
            save.mutate(
              { ...draft, text: draft.text.trim(), basis: draft.basis.trim() },
              {
                onSuccess: () => {
                  setBaseline(JSON.stringify(draft));
                  setOpen(false);
                },
              },
            );
          }}
        >
          <div className="form-grid">
            <Field label="Тип">
              {(id) => (
                <select
                  id={id}
                  value={draft.type}
                  onChange={(event) =>
                    setDraft({ ...draft, type: event.target.value as Draft['type'] })
                  }
                >
                  <option value="hypothesis">Гипотеза</option>
                  <option value="observation">Наблюдение</option>
                </select>
              )}
            </Field>
            <Field label="Статус">
              {(id) => (
                <select
                  id={id}
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value as Draft['status'] })
                  }
                >
                  <option value="open">Открыта</option>
                  <option value="supported">Поддерживается примерами</option>
                  <option value="refuted">Опровергнута</option>
                </select>
              )}
            </Field>
          </div>
          <Field
            label="Формулировка"
            hint="Опишите наблюдение или проверяемое предположение, до 4000 символов."
            error={touched.text ? textProblem : undefined}
          >
            {(id) => (
              <textarea
                id={id}
                required
                value={draft.text}
                maxLength={4000}
                onChange={(event) => {
                  setDraft({ ...draft, text: event.target.value });
                  setTouched({ ...touched, text: true });
                }}
              />
            )}
          </Field>
          <Field
            label="Основания и открытые вопросы"
            hint="Укажите основания и то, что ещё нужно проверить, до 8000 символов."
            error={touched.basis ? basisProblem : undefined}
          >
            {(id) => (
              <textarea
                id={id}
                required
                value={draft.basis}
                maxLength={8000}
                onChange={(event) => {
                  setDraft({ ...draft, basis: event.target.value });
                  setTouched({ ...touched, basis: true });
                }}
              />
            )}
          </Field>
          <fieldset>
            <legend>Примеры из сохранённых связей</legend>
            {availableEvidence.map((item) => (
              <div key={item.evidenceId}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.evidence.some((proof) => proof.evidenceId === item.evidenceId)}
                    onChange={(event) => {
                      if (!attachedChoices.some((proof) => proof.evidenceId === item.evidenceId))
                        setAttachedChoices([...attachedChoices, item]);
                      setDraft({
                        ...draft,
                        evidence: event.target.checked
                          ? [
                              ...draft.evidence,
                              { ...item, kind: evidenceRoles[item.evidenceId] ?? item.kind },
                            ]
                          : draft.evidence.filter((proof) => proof.evidenceId !== item.evidenceId),
                      });
                    }}
                  />
                  {item.basis || 'Связь ' + item.evidenceId + ' · основание не указано'}
                </label>
                {draft.evidence.some((proof) => proof.evidenceId === item.evidenceId) && (
                  <Field label={'Роль примера ' + item.evidenceId}>
                    {(id) => (
                      <select
                        id={id}
                        value={
                          draft.evidence.find((proof) => proof.evidenceId === item.evidenceId)!.kind
                        }
                        onChange={(event) => {
                          setEvidenceRoles({
                            ...evidenceRoles,
                            [item.evidenceId]: event.target.value as Evidence['kind'],
                          });
                          setDraft({
                            ...draft,
                            evidence: draft.evidence.map((proof) =>
                              proof.evidenceId === item.evidenceId
                                ? { ...proof, kind: event.target.value as Evidence['kind'] }
                                : proof,
                            ),
                          });
                        }}
                      >
                        <option value="support">Поддерживающий пример</option>
                        <option value="counterexample">Контрпример</option>
                      </select>
                    )}
                  </Field>
                )}
              </div>
            ))}
            <MoreChoices label="связи" query={evidence} />
            {evidence.error && !evidence.isFetchNextPageError && (
              <ErrorState error={evidence.error} retry={() => void evidence.refetch()} />
            )}
          </fieldset>
          {save.error && <ErrorState error={save.error} />}
          <Button
            type="submit"
            variant="primary"
            disabled={!!textProblem || !!basisProblem || save.isPending}
          >
            Сохранить исследовательскую запись
          </Button>
        </form>
      </Modal>
      <Modal
        title="Удалить исследовательскую запись?"
        description="Формулировка и список прикреплённых примеров будут удалены. Сохранённые связи, исходные пакеты и результаты запусков останутся доступны."
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
      >
        {deleting && <p>{deleting.text}</p>}
        {remove.error && <ErrorState error={remove.error} />}
        <div className="toolbar">
          <Button disabled={remove.isPending} onClick={() => setDeleting(null)}>
            Оставить запись
          </Button>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() =>
              deleting &&
              remove.mutate(deleting.hypothesisId, { onSuccess: () => setDeleting(null) })
            }
          >
            {remove.isPending ? 'Удаление…' : 'Удалить запись'}
          </Button>
        </div>
      </Modal>
      <Modal
        title="Закрыть без сохранения?"
        description="Изменения формулировки и оснований будут потеряны."
        open={discard}
        onOpenChange={setDiscard}
      >
        <div className="toolbar">
          <Button onClick={() => setDiscard(false)}>Продолжить редактирование</Button>
          <Button
            variant="danger"
            onClick={() => {
              setDiscard(false);
              setOpen(false);
            }}
          >
            Отбросить изменения
          </Button>
        </div>
      </Modal>
    </>
  );
}
