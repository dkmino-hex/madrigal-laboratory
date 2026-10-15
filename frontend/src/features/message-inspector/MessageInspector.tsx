import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Location } from '../../shared/api/contracts/models';
import { api } from '../../shared/api/client';
import { queryKey } from '../../shared/api/query';
import { MoreChoices, usePagedChoices } from '../../shared/api/paged-choices';
import {
  activeMessage,
  discoveredMessages,
  messageAnnotations,
  overlaps,
  schemaMessages,
  selectedField,
} from '../../shared/model/message-inspection';
import { Badge, Banner, Button, Empty, Field, QueryState } from '../../shared/ui/common';

export function useMessageInspection(
  window: Location | null,
  selection: Location | null,
  enabled: boolean,
  availableCaptures: { captureId: string; status: string }[] = [],
) {
  const [params, setParams] = useSearchParams();
  const projectId = window?.projectId ?? '';
  const models = usePagedChoices(
    projectId,
    'interpretations',
    (cursor, signal) => api.interpretations({ projectId, cursor }, { signal }),
    {},
    enabled && !!window,
    params.get('decodeModel') === 'auto' ? '' : (params.get('decodeModel') ?? ''),
  );
  const explicitRevision = params.get('decodeRevision') ?? params.get('revisionId');
  const modelId =
    params.get('decodeModel') ??
    models.data?.items.find((model) =>
      model.revisions.some((revision) => revision.revisionId === explicitRevision),
    )?.interpretationId ??
    (explicitRevision
      ? 'missing-revision'
      : (models.data?.items.find((model) => model.revisions.length)?.interpretationId ?? 'auto'));
  const model = models.data?.items.find((item) => item.interpretationId === modelId);
  const revision =
    model?.revisions.find((item) => item.revisionId === explicitRevision) ??
    (!explicitRevision || !params.has('decodeRevision') ? model?.revisions.at(-1) : undefined);
  const automatic = modelId === 'auto';
  const learningCaptures = window
    ? [
        { captureId: window.captureId, assemblyId: window.assemblyId },
        ...availableCaptures
          .filter((item) => item.status === 'READY' && item.captureId !== window.captureId)
          .slice(0, 7)
          .map((item) => ({ captureId: item.captureId })),
      ]
    : [];
  const preview = useQuery({
    queryKey: queryKey(projectId, 'preview', {
      revisionId: revision?.revisionId,
      location: window,
    }),
    queryFn: ({ signal }) =>
      api.preview(
        {
          projectId,
          interpretationId: modelId,
          revisionId: revision!.revisionId,
          location: window,
        },
        { signal },
      ),
    enabled: enabled && !!window && !!revision,
    staleTime: 30000,
  });
  const discovery = useQuery({
    queryKey: queryKey(projectId, 'discover', {
      captureId: window?.captureId,
      assemblyId: window?.assemblyId,
      direction: window?.direction,
      learningCaptures,
    }),
    queryFn: ({ signal }) =>
      api.discover(
        {
          projectId,
          captures: learningCaptures,
          direction: window!.direction,
        },
        { signal },
      ),
    enabled: enabled && !!window && automatic && !models.isPending,
    staleTime: 30000,
  });
  const messages = window
    ? automatic
      ? discovery.data
        ? discoveredMessages(discovery.data, window)
        : []
      : preview.data && revision
        ? schemaMessages(preview.data, model?.name ?? 'Схема', revision.json)
        : []
    : [];
  const selected = selection ? activeMessage(messages, selection) : undefined;
  function chooseModel(value: string) {
    const next = new URLSearchParams(params);
    next.set('decodeModel', value);
    next.delete('decodeRevision');
    setParams(next, { replace: true });
  }
  function chooseRevision(value: string) {
    const next = new URLSearchParams(params);
    next.set('decodeModel', modelId);
    next.set('decodeRevision', value);
    setParams(next, { replace: true });
  }
  return {
    models,
    model,
    modelId,
    revision,
    automatic,
    preview,
    discovery,
    learningCaptureCount: learningCaptures.length,
    messages,
    selected,
    annotations: messageAnnotations(selected),
    chooseModel,
    chooseRevision,
  };
}

export function MessageInspector({
  inspection,
  selection,
  onSelect,
  onSources,
}: {
  inspection: ReturnType<typeof useMessageInspection>;
  selection: Location;
  onSelect: (start: string, length: string) => void;
  onSources: () => void;
}) {
  const [search, setSearch] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const { models, model, modelId, revision, automatic, preview, discovery, selected, messages } =
    inspection;
  const field = selected ? selectedField(selected, selection) : undefined;
  const filtered = messages.filter((message) =>
    [
      message.title,
      message.location.start,
      ...message.fields.flatMap((item) => [item.name, item.value ?? '']),
    ].some((value) => value.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))),
  );
  const query = automatic ? discovery : preview;
  useEffect(() => {
    const body = list.current;
    if (!body) return;
    function reveal() {
      const chosen = body!.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!chosen || !body!.clientHeight) return;
      const top =
        chosen.getBoundingClientRect().top - body!.getBoundingClientRect().top + body!.scrollTop;
      body!.scrollTop = Math.max(0, top - (body!.clientHeight - chosen.offsetHeight) / 2);
    }
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(body);
    return () => observer.disconnect();
  }, [selected?.id, search, query.isPending]);
  return (
    <section className="message-inspector" aria-label="Сообщения и поля">
      <h2>Сообщения и поля</h2>
      <Field label="Разбирать по схеме">
        {(id) => (
          <select
            id={id}
            value={modelId}
            onChange={(event) => inspection.chooseModel(event.target.value)}
          >
            <option value="auto">Автопоиск · кандидаты без схемы</option>
            {models.data?.items.map((item) => (
              <option key={item.interpretationId} value={item.interpretationId}>
                {item.name}
              </option>
            ))}
            {modelId !== 'auto' && !model && (
              <option value={modelId}>Выбери схему для указанной ревизии</option>
            )}
          </select>
        )}
      </Field>
      <MoreChoices label="схемы" query={models} />
      {model && (
        <Field label="Ревизия для просмотра">
          {(id) => (
            <select
              id={id}
              value={revision?.revisionId ?? ''}
              onChange={(event) => inspection.chooseRevision(event.target.value)}
            >
              {!revision && <option value="">Выбери сохранённую ревизию</option>}
              {model.revisions.map((item) => (
                <option key={item.revisionId} value={item.revisionId}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <p className="muted">
        {selection.direction === 'A_TO_B' ? 'A → B' : 'B → A'} · сообщения текущего окна HEX. Выбери
        сообщение, затем поле.
      </p>
      {automatic && <Banner>Названия взяты из журнала. Найденные поля — гипотезы.</Banner>}
      {automatic && (
        <p className="muted">
          Записей для подбора: {discovery.data?.captures.length ?? inspection.learningCaptureCount}{' '}
          (до 8). В списке — выбранный поток.
        </p>
      )}
      <QueryState
        pending={models.isPending}
        error={models.initialError}
        retry={() => void models.refetch()}
      >
        {!automatic && !revision ? (
          <Empty title="Нет сохранённой ревизии" description="Выбери ревизию или автопоиск." />
        ) : (
          <QueryState
            pending={query.isPending}
            error={query.error}
            retry={() => void query.refetch()}
          >
            {(automatic
              ? discovery.data && !discovery.data.complete
              : preview.data && !preview.data.complete) && (
              <Banner tone="warning">
                Разбор неполный: есть ограничения, пропуски или ошибки. Все байты доступны в HEX.
              </Banner>
            )}
            {preview.data?.diagnostic && !automatic && (
              <p className="message-diagnostic">{preview.data.diagnostic}</p>
            )}
            {automatic && discovery.data?.warnings.length ? (
              <details>
                <summary>Ограничения автопоиска</summary>
                {discovery.data.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </details>
            ) : null}
            <Field label="Найти сообщение или поле">
              {(id) => (
                <input
                  id={id}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Название, значение, позиция"
                />
              )}
            </Field>
            <div className="message-list" ref={list} role="group" aria-label="Список сообщений">
              {filtered.map((message, index) => (
                <button
                  key={message.id}
                  type="button"
                  className="message-pick"
                  aria-pressed={message.id === selected?.id}
                  onClick={() => onSelect(message.location.start, message.location.length)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                    event.preventDefault();
                    const next = Math.min(
                      filtered.length - 1,
                      Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)),
                    );
                    const target = filtered[next]!;
                    onSelect(target.location.start, target.location.length);
                    (
                      event.currentTarget.parentElement?.children[next] as
                        HTMLButtonElement | undefined
                    )?.focus();
                  }}
                >
                  <strong>
                    #{messages.indexOf(message) + 1} · {message.title}
                  </strong>
                  <small>
                    С позиции {message.location.start} · {message.location.length} байт ·{' '}
                    {message.fields.length} полей
                  </small>
                </button>
              ))}
            </div>
            {!filtered.length && (
              <Empty
                title={
                  messages.length ? 'Нет совпадений по поиску' : 'В этом окне сообщения не выделены'
                }
                description="Измени поиск, схему или окно HEX. Неизвестные байты остаются доступными для исследования."
              />
            )}
          </QueryState>
        )}
      </QueryState>
      {selected && (
        <>
          <div className="message-selected-heading">
            <h3>Поля сообщения #{messages.indexOf(selected) + 1}</h3>
            {selected.status && <Badge status={selected.status} />}
          </div>
          <p className="muted">{selected.note}</p>
          <div className="message-field-map" role="group" aria-label="Карта полей сообщения">
            {selected.fields.map((item, index) => (
              <button
                key={item.id}
                type="button"
                data-field-color={index % 6}
                aria-pressed={item.id === field?.id}
                onClick={() => onSelect(item.location.start, item.location.length)}
                title={item.name}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="message-field-head" aria-hidden="true">
            <span>Поле / тип</span>
            <span>Позиция</span>
            <span>Значение</span>
          </div>
          {selected.fields.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className="message-field"
              data-field-color={index % 6}
              aria-pressed={item.id === field?.id}
              onClick={() => onSelect(item.location.start, item.location.length)}
            >
              <span>
                <strong>{item.name}</strong>
                <small>{item.type}</small>
              </span>
              <span title="Позиция от начала сообщения; ниже — длина">
                {String(BigInt(item.location.start) - BigInt(selected.location.start))}
                <small>{item.location.length} байт</small>
              </span>
              <span className="message-field-value">{item.value ?? 'Недоступно'}</span>
              <small className="message-field-note">
                {item.hypothesis ? 'Гипотеза · ' : 'По схеме · '}
                {item.note}
              </small>
            </button>
          ))}
          {!selected.fields.length && (
            <p>
              {automatic
                ? 'Для этого сообщения пока нет числовых кандидатов. Сравни больше опытов или опиши поля в схеме.'
                : 'Эта схема не описывает поля данного сообщения.'}
            </p>
          )}
          {field && (
            <div className="message-field-actions">
              <p>
                Выделено: <strong>{field.name}</strong> · {field.location.length} байт с позиции{' '}
                {field.location.start} в потоке.
              </p>
              <Button onClick={onSources}>Исходные пакеты выделения</Button>
              {field.parameter && (
                <Link
                  to={
                    '/projects/' +
                    selection.projectId +
                    '/compare?' +
                    new URLSearchParams({
                      parameter: field.parameter,
                      direction: selection.direction,
                    })
                  }
                >
                  Сравнить это поле на других примерах →
                </Link>
              )}
            </div>
          )}
        </>
      )}
      {selected && !overlaps(selected.location, selection) && (
        <p className="muted">Выделенные байты находятся вне показанных сообщений.</p>
      )}
    </section>
  );
}
