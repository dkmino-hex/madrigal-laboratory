import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProject } from '../../app/Shell';
import { api } from '../../shared/api/client';
import { useCommand } from '../../shared/api/query';
import { MoreChoices, usePagedChoices } from '../../shared/api/paged-choices';
import type { DiscoveryInput } from '../../shared/api/contracts/research';
import { ComparisonWorkbench } from './ComparisonWorkbench';
import { Button, Empty, ErrorState, Field, PageHeading } from '../../shared/ui/common';

export function ResearchCompare() {
  const project = useProject();
  const [params, setParams] = useSearchParams();
  const captures = usePagedChoices(project.projectId, 'captures', (cursor, signal) =>
    api.captures({ projectId: project.projectId, cursor }, { signal }),
  );
  const [selected, setSelected] = useState<string[] | null>(() =>
    params.has('captures') ? params.get('captures')!.split(',').filter(Boolean).slice(0, 8) : null,
  );
  const [direction, setDirection] = useState(params.get('direction') ?? '');
  const [revisionId, setRevisionId] = useState(params.get('revisionId') ?? '');
  const interpretations = usePagedChoices(project.projectId, 'interpretations', (cursor, signal) =>
    api.interpretations({ projectId: project.projectId, cursor }, { signal }),
  );
  const discovery = useCommand('discover', (input: DiscoveryInput, options) =>
    api.discover(input, options),
  );
  const started = useRef(false);
  const ready = captures.data?.items.filter((capture) => capture.status === 'READY') ?? [];
  const chosen = selected ?? ready.slice(0, 8).map((capture) => capture.captureId);
  useEffect(() => {
    if (!started.current && captures.data) {
      started.current = true;
      if (chosen.length)
        discovery.mutate({
          projectId: project.projectId,
          captures: chosen.map((captureId) => ({ captureId })),
          direction,
          ...(revisionId ? { revisionId } : {}),
        });
    }
  }, [captures.data, chosen, direction, revisionId, discovery, project.projectId]);
  return (
    <>
      <PageHeading
        title="Сравнение примеров"
        subtitle="Выбери известное значение из журнала. Посмотри, какие байты ему соответствуют, сохрани наблюдение и проверь объяснение на другой записи."
      />
      <section className="panel research-toolbar">
        <details>
          <summary>
            Записи для подбора: {chosen.length} из {ready.length}
          </summary>
          <div className="research-captures">
            {ready.map((capture) => (
              <label className="checkbox" key={capture.captureId}>
                <input
                  type="checkbox"
                  checked={chosen.includes(capture.captureId)}
                  disabled={
                    discovery.isPending ||
                    (!chosen.includes(capture.captureId) && chosen.length >= 8)
                  }
                  onChange={(event) => {
                    const values = event.target.checked
                      ? [...chosen, capture.captureId]
                      : chosen.filter((id) => id !== capture.captureId);
                    setSelected(values);
                    const next = new URLSearchParams(params);
                    next.set('captures', values.join(','));
                    setParams(next, { replace: true });
                    discovery.reset();
                  }}
                />
                {capture.name}
              </label>
            ))}
          </div>
          <MoreChoices label="записи" query={captures} />
        </details>
        <Field label="Направление автосравнения">
          {(id) => (
            <select
              id={id}
              value={direction}
              disabled={discovery.isPending}
              onChange={(event) => {
                setDirection(event.target.value);
                const next = new URLSearchParams(params);
                next.set('direction', event.target.value);
                setParams(next, { replace: true });
                discovery.reset();
              }}
            >
              <option value="">Оба направления</option>
              <option value="A_TO_B">A→B</option>
              <option value="B_TO_A">B→A</option>
            </select>
          )}
        </Field>
        <Field
          label="Границы сообщений для автосравнения"
          hint="Ревизия задаёт размер или поле длины. Имена и смысл кандидатов по-прежнему определяются из журнала."
        >
          {(id) => (
            <select
              id={id}
              value={revisionId}
              disabled={discovery.isPending}
              onChange={(event) => {
                setRevisionId(event.target.value);
                const next = new URLSearchParams(params);
                if (event.target.value) next.set('revisionId', event.target.value);
                else next.delete('revisionId');
                setParams(next, { replace: true });
                discovery.reset();
              }}
            >
              <option value="">Определить автоматически из данных</option>
              {revisionId &&
                !interpretations.data?.items.some((model) =>
                  model.revisions.some((rev) => rev.revisionId === revisionId),
                ) && <option value={revisionId}>{revisionId} · из ссылки</option>}
              {interpretations.data?.items.map((model) => (
                <optgroup key={model.interpretationId} label={model.name}>
                  {model.revisions.map((rev, index) => (
                    <option key={rev.revisionId} value={rev.revisionId}>
                      {model.name} · версия {index + 1} · {rev.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
        <MoreChoices label="интерпретации" query={interpretations} />
        <Button
          variant="primary"
          disabled={!chosen.length || discovery.isPending}
          onClick={() =>
            discovery.mutate({
              projectId: project.projectId,
              captures: chosen.map((captureId) => ({ captureId })),
              direction,
              ...(revisionId ? { revisionId } : {}),
            })
          }
        >
          {discovery.isPending ? 'Поиск примеров и полей…' : 'Найти примеры и кандидаты'}
        </Button>
      </section>
      {captures.error && <ErrorState error={captures.error} />}{' '}
      {interpretations.error && <ErrorState error={interpretations.error} />}
      {discovery.error && <ErrorState error={discovery.error} />}
      {discovery.isPending && (
        <p role="status">Восстанавливаем контекст примеров и сопоставляем значения с журналом…</p>
      )}
      {discovery.data && (
        <ComparisonWorkbench key={discovery.data.fingerprint} result={discovery.data} />
      )}
      {!ready.length && !captures.isPending && (
        <Empty
          title="Сначала добавь запись"
          description="Загрузи PCAP / PCAPNG в обзоре проекта. Журнал CSV добавит названия и известные значения параметров."
        />
      )}
    </>
  );
}
