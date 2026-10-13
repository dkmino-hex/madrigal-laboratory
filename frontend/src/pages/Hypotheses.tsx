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
  const query = useQuery({
    queryKey: queryKey(projectId, 'hypotheses', { status, type, cursor }),
    queryFn: ({ signal }) => api.hypotheses({ projectId, status, type, cursor }, { signal }),
  });
  const evidence = usePagedChoices(projectId, 'evidence', (cursor, signal) =>
    api.evidence({ projectId, cursor }, { signal }),
  );
  const [open, setOpen] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [baseline, setBaseline] = useState(JSON.stringify(emptyDraft));
  const dirty = JSON.stringify(draft) !== baseline;
  const save = useCommand(
    'saveHypothesis',
    (input: Draft, options) => api.saveHypothesis({ projectId, ...input }, options),
    [queryKey(projectId, 'hypotheses')],
  );
  const availableEvidence = [
    ...new Map(
      [...(evidence.data?.items ?? []), ...draft.evidence].map((item) => [item.evidenceId, item]),
    ).values(),
  ];
  function edit(value: Draft) {
    setDraft(value);
    setBaseline(JSON.stringify(value));
    setOpen(true);
    save.reset();
  }
  function close(value: boolean) {
    if (!value && dirty) setDiscard(true);
    else setOpen(value);
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
        <Field label="Тип записи">
          {(id) => (
            <select
              id={id}
              value={type}
              onChange={(event) => setParams({ type: event.target.value, status })}
            >
              <option value="">Все типы</option>
              <option value="hypothesis">Гипотеза</option>
              <option value="observation">Наблюдение</option>
            </select>
          )}
        </Field>
        <Field label="Статус гипотезы">
          {(id) => (
            <select
              id={id}
              value={status}
              onChange={(event) => setParams({ status: event.target.value, type })}
            >
              <option value="">Все статусы</option>
              <option value="open">Открыта</option>
              <option value="supported">Поддерживается примерами</option>
              <option value="refuted">Опровергнута</option>
            </select>
          )}
        </Field>
      </div>
      <QueryState pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
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
                  <Button onClick={() => edit(item)}>Редактировать</Button>
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
            nextCursor={query.data.nextCursor}
            total={query.data.total}
            onChange={(value) => setParams({ type, status, cursor: value })}
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
            save.mutate(draft, {
              onSuccess: () => {
                setBaseline(JSON.stringify(draft));
                setOpen(false);
              },
            });
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
          <Field label="Формулировка">
            {(id) => (
              <textarea
                id={id}
                required
                value={draft.text}
                maxLength={4000}
                onChange={(event) => setDraft({ ...draft, text: event.target.value })}
              />
            )}
          </Field>
          <Field label="Основания и открытые вопросы">
            {(id) => (
              <textarea
                id={id}
                required
                value={draft.basis}
                maxLength={8000}
                onChange={(event) => setDraft({ ...draft, basis: event.target.value })}
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
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        evidence: event.target.checked
                          ? [...draft.evidence, item]
                          : draft.evidence.filter((proof) => proof.evidenceId !== item.evidenceId),
                      })
                    }
                  />
                  {item.basis}
                </label>
                {draft.evidence.some((proof) => proof.evidenceId === item.evidenceId) && (
                  <Field label={'Роль примера ' + item.evidenceId}>
                    {(id) => (
                      <select
                        id={id}
                        value={
                          draft.evidence.find((proof) => proof.evidenceId === item.evidenceId)!.kind
                        }
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            evidence: draft.evidence.map((proof) =>
                              proof.evidenceId === item.evidenceId
                                ? { ...proof, kind: event.target.value as Evidence['kind'] }
                                : proof,
                            ),
                          })
                        }
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
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Сохранить исследовательскую запись
          </Button>
        </form>
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
