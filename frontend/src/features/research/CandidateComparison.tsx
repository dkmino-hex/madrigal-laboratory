import { useEffect, useRef, useState } from 'react';
import type {
  Discovery,
  ResearchCandidate,
  ResearchRow,
} from '../../shared/api/contracts/research';
import { researchBytes, candidateValue } from '../../shared/model/research';
import {
  actionLabel,
  parameterInfo,
  readingDescription,
} from '../../shared/model/research-presentation';
import { Button, Empty } from '../../shared/ui/common';

export function CandidateList({
  candidates,
  picked,
  rows,
  onPick,
  onCounterexample,
  onObserve,
}: {
  candidates: ResearchCandidate[];
  picked: ResearchCandidate | null;
  rows: ResearchRow[];
  onPick: (candidate: ResearchCandidate) => void;
  onCounterexample: (candidate: ResearchCandidate, row: ResearchRow) => void;
  onObserve: (candidate: ResearchCandidate) => void;
}) {
  return (
    <section className="panel candidate-list" aria-label="Кандидаты в поля">
      <div className="panel-heading">
        <h2>Кандидаты в поля</h2>
        <span>{candidates.length}</span>
      </div>
      <p className="muted">
        Выбери вариант — его байты подсветятся во всех примерах. Совпадение ещё требует проверки.
      </p>
      <div className="candidate-list-scroll">
        {candidates.map((candidate) => (
          <article
            key={candidate.id}
            className="research-candidate"
            data-active={picked?.id === candidate.id}
          >
            <button
              type="button"
              className="research-candidate-pick"
              aria-pressed={picked?.id === candidate.id}
              onClick={() => onPick(candidate)}
            >
              <strong>
                {candidate.kind === 'parameter'
                  ? parameterInfo(candidate.parameter).title
                  : candidate.kind === 'constant'
                    ? 'Постоянный участок'
                    : 'Изменяющийся участок'}
              </strong>
              <span>
                Байты {candidate.offset}–{candidate.offset + candidate.length - 1} ·{' '}
                <code>
                  {candidate.encoding}
                  {candidate.divisor === 1 ? '' : ' ÷ ' + candidate.divisor}
                </code>
              </span>
              <span>{readingDescription(candidate)}</span>
              <span className="candidate-score">
                <b>
                  {candidate.matches}/{candidate.total}
                </b>{' '}
                {candidate.kind === 'parameter' ? 'совпали с журналом' : 'примеров'} · гипотеза
              </span>
            </button>
            {candidate.counterexamples.length > 0 && (
              <div className="candidate-counterexamples">
                <span>Контрпримеры: {candidate.counterexamples.length}</span>
                {candidate.counterexamples.slice(0, 2).map((id) => {
                  const row = rows.find((item) => item.id === id);
                  return row ? (
                    <button key={id} type="button" onClick={() => onCounterexample(candidate, row)}>
                      {actionLabel(row.label)} →
                    </button>
                  ) : null;
                })}
              </div>
            )}
            {candidate.inconclusive.length > 0 && (
              <small className="muted">
                Без однозначного сравнения: {candidate.inconclusive.length}
              </small>
            )}
            <Button disabled={!candidate.examples.length} onClick={() => onObserve(candidate)}>
              Сохранить этот вариант
            </Button>
          </article>
        ))}
        {!candidates.length && (
          <Empty
            title="Пока нет кандидатов"
            description="Нужны как минимум два разных совпавших значения. Попробуй другую группу или запись."
          />
        )}
      </div>
    </section>
  );
}

export function CompactByteMatrix({
  group,
  rows,
  picked,
  selectedRowId,
  onSelect,
}: {
  group: Discovery['groups'][number];
  rows: ResearchRow[];
  picked: ResearchCandidate | null;
  selectedRowId?: string;
  onSelect: (id: string) => void;
}) {
  const [manual, setManual] = useState<{ candidate: string; start: number }>();
  const matrix = useRef<HTMLDivElement>(null);
  const maximum = Math.max(0, (group.columns.at(-1)?.offset ?? 0) - 31);
  const start =
    manual && manual.candidate === (picked?.id ?? '')
      ? manual.start
      : Math.min(maximum, Math.max(0, (picked?.offset ?? 0) - 8));
  const columns = group.columns.filter(
    (column) => column.offset >= start && column.offset < start + 32,
  );
  function move(offset: number) {
    setManual({ candidate: picked?.id ?? '', start: Math.min(maximum, Math.max(0, offset)) });
  }
  useEffect(() => {
    const body = matrix.current;
    const cell = body?.querySelector<HTMLElement>('thead [data-candidate="true"]');
    if (!body || !cell) return;
    const headers = body.querySelectorAll<HTMLElement>('thead th');
    const stickyWidth = Array.from(headers)
      .slice(0, 3)
      .reduce((sum, header) => sum + header.offsetWidth, 0);
    const left =
      cell.getBoundingClientRect().left - body.getBoundingClientRect().left + body.scrollLeft;
    body.scrollLeft = Math.max(
      0,
      left - stickyWidth - Math.max(0, (body.clientWidth - stickyWidth - 60) / 2),
    );
  }, [picked?.id, start]);
  return (
    <div className="compact-comparison">
      <div className="compact-matrix-toolbar">
        <span className="muted">
          Позиции {columns[0]?.offset ?? 0}–{columns.at(-1)?.offset ?? 0} от начала сообщения ·
          десятичные
        </span>
        <div className="toolbar">
          <Button
            disabled={start === 0}
            onClick={() => move(start - 16)}
            aria-label="Предыдущие столбцы байтов"
          >
            ←
          </Button>
          <Button
            disabled={start >= maximum}
            onClick={() => move(start + 16)}
            aria-label="Следующие столбцы байтов"
          >
            →
          </Button>
        </div>
      </div>
      <div
        className="research-matrix compact-byte-matrix"
        ref={matrix}
        role="region"
        aria-label="Сравнение байтов примеров"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th>Пример</th>
              <th>Журнал</th>
              <th>Из байтов</th>
              {columns.map((column) => (
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
                  {column.offset}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const bytes = researchBytes(row);
              const status = picked?.counterexamples.includes(row.id)
                ? 'counterexample'
                : picked?.support.includes(row.id)
                  ? 'match'
                  : 'unknown';
              return (
                <tr
                  key={row.id}
                  data-selected={row.id === selectedRowId}
                  data-example-status={status}
                >
                  <td>
                    <button
                      type="button"
                      className="research-example-pick"
                      aria-label={`${actionLabel(row.label)} · ${row.captureName} · сообщение с позиции ${row.location.start}`}
                      aria-pressed={row.id === selectedRowId}
                      onClick={() => onSelect(row.id)}
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                        event.preventDefault();
                        const next = Math.max(
                          0,
                          Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                        );
                        onSelect(rows[next]!.id);
                        event.currentTarget
                          .closest('tbody')
                          ?.rows[next]?.querySelector('button')
                          ?.focus();
                      }}
                    >
                      {actionLabel(row.label)}
                      <small>{row.captureName}</small>
                    </button>
                  </td>
                  <td>{picked?.parameter ? (row.values[picked.parameter] ?? '—') : '—'}</td>
                  <td>
                    {picked?.kind === 'parameter' ? (candidateValue(bytes, picked) ?? '—') : '—'}
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column.offset}
                      data-heat={column.heat}
                      data-kind={column.kind}
                      data-candidate={
                        !!picked &&
                        column.offset >= picked.offset &&
                        column.offset < picked.offset + picked.length
                      }
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => onSelect(row.id)}
                        title={`Позиция ${column.offset}: ${column.distinct} разных значений · выбрать пример`}
                      >
                        {bytes[column.offset]?.toString(16).padStart(2, '0').toUpperCase() ?? '—'}
                      </button>
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
        <span data-kind="variable">Меняется</span>
        <span data-kind="partial">Есть не везде</span>
        <span data-kind="candidate">Кандидат</span>
      </div>
    </div>
  );
}
