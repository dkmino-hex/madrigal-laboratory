import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../../app/Shell';
import { api } from '../../shared/api/client';
import { useCommand, queryKey } from '../../shared/api/query';
import { MoreChoices, usePagedChoices } from '../../shared/api/paged-choices';
import type {
  AutomaticInput,
  Discovery,
  DiscoveryInput,
  ResearchCandidate,
  ResearchRow,
} from '../../shared/api/contracts/research';
import type { Interpretation } from '../../shared/api/contracts/models';
import { researchBytes, candidateValue } from '../../shared/model/research';
import { sourceLink } from '../../shared/model/navigation';
import { decimal } from '../../shared/model/precision';
import { AutomaticObservation } from '../observations/AutomaticObservation';
import {
  Banner,
  Button,
  Empty,
  ErrorState,
  Field,
  PageHeading,
  Pagination,
} from '../../shared/ui/common';

export function ResearchCompare() {
  const project = useProject();
  const captures = usePagedChoices(project.projectId, 'captures', (cursor, signal) =>
    api.captures({ projectId: project.projectId, cursor }, { signal }),
  );
  const [selected, setSelected] = useState<string[] | null>(null);
  const [direction, setDirection] = useState('');
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
        });
    }
  }, [captures.data, chosen, direction, discovery, project.projectId]);
  return (
    <>
      <PageHeading
        title="Сравнение примеров"
        subtitle="Примеры из записей, изменяющиеся байты и кандидаты в поля. Наблюдение заполняется автоматически вместе с источниками."
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
                    setSelected(
                      event.target.checked
                        ? [...chosen, capture.captureId]
                        : chosen.filter((id) => id !== capture.captureId),
                    );
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
                discovery.reset();
              }}
            >
              <option value="">Оба направления</option>
              <option value="A_TO_B">A→B</option>
              <option value="B_TO_A">B→A</option>
            </select>
          )}
        </Field>
        <Button
          variant="primary"
          disabled={!chosen.length || discovery.isPending}
          onClick={() =>
            discovery.mutate({
              projectId: project.projectId,
              captures: chosen.map((captureId) => ({ captureId })),
              direction,
            })
          }
        >
          {discovery.isPending ? 'Поиск примеров и полей…' : 'Найти примеры и кандидаты'}
        </Button>
      </section>
      {captures.error && <ErrorState error={captures.error} />}{' '}
      {discovery.error && <ErrorState error={discovery.error} />}
      {discovery.isPending && (
        <p role="status">Восстанавливаем контекст примеров и сопоставляем значения с журналом…</p>
      )}
      {discovery.data && <Comparison key={discovery.data.fingerprint} result={discovery.data} />}
      {!ready.length && !captures.isPending && (
        <Empty
          title="Сначала добавь запись"
          description="Загрузи PCAP / PCAPNG в обзоре проекта. Журнал CSV добавит названия и известные значения параметров."
        />
      )}
    </>
  );
}
function fieldLocation(row: ResearchRow, candidate: ResearchCandidate | null) {
  if (!candidate || candidate.offset + candidate.length > Number(row.location.length))
    return row.location;
  return {
    ...row.location,
    start: decimal(BigInt(row.location.start) + BigInt(candidate.offset)),
    length: decimal(String(candidate.length)),
  };
}
function Comparison({ result }: { result: Discovery }) {
  const first =
    result.candidates.find((candidate) => candidate.kind === 'parameter') ?? result.candidates[0];
  const [groupId, setGroup] = useState(first?.groupId ?? result.groups[0]?.id ?? '');
  const [parameter, setParameter] = useState(first?.parameter ?? '');
  const [pickedId, setPicked] = useState(first?.id ?? '');
  const [page, setPage] = useState('0');
  const [proposal, setProposal] = useState<AutomaticInput | null>(null);
  const [saved, setSaved] = useState<Record<string, Interpretation>>({});
  const group = result.groups.find((item) => item.id === groupId);
  const rows = result.rows.filter((row) => row.groupId === groupId);
  const candidates = result.candidates.filter(
    (candidate) =>
      candidate.groupId === groupId &&
      (!parameter || !candidate.parameter || candidate.parameter === parameter),
  );
  const picked = candidates.find((candidate) => candidate.id === pickedId) ?? candidates[0] ?? null;
  const model = picked ? saved[picked.id] : undefined;
  const schema = useCommand(
    'createInterpretation',
    (candidate: ResearchCandidate, options) =>
      api.createInterpretation(
        {
          projectId: result.projectId,
          name: ('Кандидат: ' + candidate.name + ' @' + candidate.offset).slice(0, 120),
          description: candidate.statement,
          json: candidate.schemaJson,
        },
        options,
      ),
    [queryKey(result.projectId, 'interpretations')],
  );
  function observe(candidate: ResearchCandidate) {
    setPicked(candidate.id);
    setProposal({
      projectId: result.projectId,
      text: candidate.statement,
      basis:
        candidate.basis +
        ` Приложено ${candidate.examples.length} источников из выборки ${candidate.total}.`,
      generation: {
        engineVersion: result.engineVersion,
        fingerprint: result.fingerprint,
        candidateId: candidate.id,
        kind: candidate.kind,
        parameter: candidate.parameter,
        matches: candidate.matches,
        total: candidate.total,
      },
      examples: candidate.examples,
    });
  }
  const shown = rows.slice(Number(page), Number(page) + 24);
  return (
    <>
      <div className="research-summary">
        <strong>
          {result.rows.length} примеров · {result.groups.length} групп ·{' '}
          {result.candidates.filter((item) => item.kind === 'parameter').length} кандидатов по
          журналу
        </strong>
        <span>
          {result.complete
            ? 'Выбранные записи прочитаны в пределах интерактивного анализа'
            : 'Показана ограниченная выборка'}
        </span>
      </div>
      <details className="research-explanations">
        <summary>Как получены примеры и что ещё не доказано</summary>
        {result.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
        <p>
          Связь с журналом определяется по имени файла и времени источника. При совпадающих окнах
          противоречивое значение остаётся неизвестным. Цвет показывает изменчивость; он не
          устанавливает смысл поля.
        </p>
      </details>
      <div className="research-filters">
        <Field label="Группа примеров">
          {(id) => (
            <select
              id={id}
              value={groupId}
              onChange={(event) => {
                setGroup(event.target.value);
                setParameter('');
                setPicked('');
                setPage('0');
              }}
            >
              {result.groups.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · {item.rows} примеров
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Сопоставить со значением журнала">
          {(id) => (
            <select
              id={id}
              value={parameter}
              onChange={(event) => {
                setParameter(event.target.value);
                setPicked('');
              }}
            >
              <option value="">Все параметры и изменчивость</option>
              {group?.parameters.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="research-workbench">
        <section className="panel research-matrix-panel">
          <div className="panel-heading">
            <h2>Байты рядом с известными значениями</h2>
            <span>{rows.length} примеров в группе</span>
          </div>
          <div className="research-matrix">
            <table>
              <thead>
                <tr>
                  <th>Пример и источник</th>
                  <th title={picked?.parameter}>Журнал</th>
                  <th>Прочитано</th>
                  {group?.columns.map((column) => (
                    <th
                      key={column.offset}
                      data-heat={column.heat}
                      data-kind={column.kind}
                      data-candidate={
                        !!picked &&
                        column.offset >= picked.offset &&
                        column.offset < picked.offset + picked.length
                      }
                    >
                      {column.offset.toString(16).toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const bytes = researchBytes(row),
                    status = picked?.support.includes(row.id)
                      ? 'match'
                      : picked?.counterexamples.includes(row.id)
                        ? 'counterexample'
                        : 'unknown';
                  return (
                    <tr key={row.id} data-example-status={status}>
                      <td>
                        <Link
                          to={sourceLink(fieldLocation(row, picked), {
                            returnTo: '/projects/' + result.projectId + '/compare',
                          })}
                        >
                          {row.label}
                        </Link>
                        <small>
                          {row.captureName} · @{row.location.start} ·{' '}
                          {row.boundary === 'tcp-fragment' ? 'TCP-фрагмент' : 'сообщение'}
                        </small>
                        {row.association === 'overlapping-windows' && (
                          <small>Несколько действий в окне времени</small>
                        )}
                      </td>
                      <td>
                        {picked?.parameter
                          ? (row.values[picked.parameter] ?? 'нет однозначного значения')
                          : '—'}
                      </td>
                      <td>{picked ? (candidateValue(bytes, picked) ?? '—') : '—'}</td>
                      {group?.columns.map((column) => (
                        <td
                          key={column.offset}
                          data-heat={column.heat}
                          data-kind={column.kind}
                          data-candidate={
                            !!picked &&
                            column.offset >= picked.offset &&
                            column.offset < picked.offset + picked.length
                          }
                          title={
                            'Позиция ' + column.offset + ', ' + column.distinct + ' разных значений'
                          }
                        >
                          {bytes[column.offset]?.toString(16).padStart(2, '0').toUpperCase() ?? '—'}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="research-legend">
            <span data-kind="constant">Постоянно</span>
            <span data-kind="variable">Изменяется</span>
            <span data-kind="partial">Есть не во всех примерах</span>
            <span data-kind="candidate">Выбранный кандидат</span>
          </div>
          <Pagination
            cursor={page}
            nextCursor={Number(page) + 24 < rows.length ? String(Number(page) + 24) : null}
            total={String(rows.length)}
            onChange={setPage}
          />
        </section>
        <aside className="panel research-candidates">
          <div className="panel-heading">
            <h2>Кандидаты и наблюдения</h2>
          </div>
          {candidates.map((candidate) => (
            <article
              key={candidate.id}
              className="research-candidate"
              data-active={picked?.id === candidate.id}
            >
              <button
                type="button"
                className="research-candidate-pick"
                onClick={() => setPicked(candidate.id)}
                aria-pressed={picked?.id === candidate.id}
              >
                <strong>
                  Байты {candidate.offset}–{candidate.offset + candidate.length - 1} ·{' '}
                  {candidate.kind === 'parameter'
                    ? candidate.encoding +
                      (candidate.divisor !== 1 ? ' ÷ ' + candidate.divisor : '')
                    : candidate.kind === 'constant'
                      ? 'постоянный участок'
                      : 'изменяющийся участок'}
                </strong>
                <span>
                  {candidate.matches}/{candidate.total} ·{' '}
                  {candidate.kind === 'parameter' ? candidate.parameter : 'наблюдение из байтов'}
                </span>
              </button>
              {candidate.counterexamples.length > 0 && (
                <p className="candidate-counterexamples">
                  Контрпримеров: {candidate.counterexamples.length}
                </p>
              )}
              <Button onClick={() => observe(candidate)} disabled={!candidate.examples.length}>
                Создать наблюдение
              </Button>
            </article>
          ))}
          {!candidates.length && (
            <p>
              Для этой группы пока нет достаточных примеров. Добавь другую запись или выбери другой
              параметр. Для числового кандидата нужны минимум два разных совпавших значения.
            </p>
          )}
        </aside>
      </div>
      {picked && (
        <section className="panel candidate-detail">
          <h2>Выбранный кандидат: {picked.name}</h2>
          <p>{picked.statement}</p>
          <p>{picked.basis}</p>
          <div className="toolbar">
            <Button onClick={() => observe(picked)}>Заполнить наблюдение с источниками</Button>
            {picked.schemaJson && (
              <Button
                disabled={schema.isPending || !!model}
                onClick={() =>
                  schema.mutate(picked, {
                    onSuccess: (interpretation) =>
                      setSaved((previous) => ({ ...previous, [picked.id]: interpretation })),
                  })
                }
              >
                {schema.isPending
                  ? 'Сохранение схемы…'
                  : model
                    ? 'Схема сохранена'
                    : 'Создать схему из кандидата'}
              </Button>
            )}
          </div>
          {schema.error && <ErrorState error={schema.error} />}{' '}
          {model && (
            <Banner tone="success">
              Схема сохранена.{' '}
              <Link
                to={
                  '/projects/' +
                  result.projectId +
                  '/interpretations/' +
                  model.interpretationId +
                  (rows[0]
                    ? '?' + new URLSearchParams({ source: sourceLink(rows[0].location) }).toString()
                    : '')
                }
              >
                Открыть спецификацию →
              </Link>{' '}
              <Link
                to={
                  '/projects/' +
                  result.projectId +
                  '/runs?' +
                  new URLSearchParams({
                    interpretationId: model.interpretationId,
                    revisionId: model.revisions.at(-1)?.revisionId ?? '',
                  }).toString()
                }
              >
                Проверить на дополнительных записях →
              </Link>
            </Banner>
          )}
          <p className="muted">
            Выбранные записи использованы для поиска. Для проверки назначения возьми дополнительный
            эксперимент с другими значениями.
          </p>
        </section>
      )}
      {!result.rows.length && (
        <Empty
          title="Примеры не найдены"
          description="Проверь готовность записей и направление. Пропуски и конфликты не заменяются предполагаемыми байтами."
        />
      )}
      {proposal && (
        <AutomaticObservation
          key={proposal.generation.candidateId}
          proposal={proposal}
          onClose={() => setProposal(null)}
        />
      )}
    </>
  );
}
