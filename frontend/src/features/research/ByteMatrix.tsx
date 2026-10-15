import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  Discovery,
  ResearchCandidate,
  ResearchRow,
} from '../../shared/api/contracts/research';
import { researchBytes, candidateValue } from '../../shared/model/research';
import { candidateLocation, actionLabel } from '../../shared/model/research-presentation';
import { sourceLink } from '../../shared/model/navigation';
import { Button } from '../../shared/ui/common';

export function ByteMatrix({
  group,
  rows,
  candidate,
  returnTo,
}: {
  group: Discovery['groups'][number];
  rows: ResearchRow[];
  candidate: ResearchCandidate | null;
  returnTo: string;
}) {
  const matrix = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  function focusField() {
    const cell = matrix.current?.querySelector<HTMLTableCellElement>(
      'thead [data-candidate="true"]',
    );
    if (!cell || !matrix.current) return;
    matrix.current.scrollLeft = Math.max(0, cell.offsetLeft - 250);
  }
  return (
    <details
      className="panel research-byte-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Полная матрица байтов · для подробного анализа</summary>
      {open && (
        <>
          <div className="toolbar">
            <p className="muted">
              Столбцы — позиции от начала примера. Номера в десятичном виде; HEX-код позиции виден в
              подсказке.
            </p>
            <Button disabled={!candidate} onClick={focusField}>
              Показать столбцы выбранного поля
            </Button>
          </div>
          <div
            className="research-matrix"
            ref={matrix}
            tabIndex={0}
            role="region"
            aria-label="Полная матрица байтов"
          >
            <table>
              <thead>
                <tr>
                  <th>Пример и источник</th>
                  <th>Журнал</th>
                  <th>Прочитано</th>
                  {group.columns.map((column) => (
                    <th
                      key={column.offset}
                      title={`Позиция ${column.offset} / 0x${column.offset.toString(16).toUpperCase()}`}
                      data-heat={column.heat}
                      data-kind={column.kind}
                      data-candidate={
                        !!candidate &&
                        column.offset >= candidate.offset &&
                        column.offset < candidate.offset + candidate.length
                      }
                    >
                      {column.offset}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const bytes = researchBytes(row);
                  return (
                    <tr
                      key={row.id}
                      data-example-status={
                        candidate?.support.includes(row.id)
                          ? 'match'
                          : candidate?.counterexamples.includes(row.id)
                            ? 'counterexample'
                            : 'unknown'
                      }
                    >
                      <td>
                        <Link
                          to={sourceLink(
                            candidate ? candidateLocation(row, candidate) : row.location,
                            {
                              returnTo,
                            },
                          )}
                        >
                          {actionLabel(row.label)}
                        </Link>
                        <small>
                          {row.captureName} · сообщение в потоке с {row.location.start}
                        </small>
                      </td>
                      <td>
                        {candidate?.parameter
                          ? (row.values[candidate.parameter] ?? 'Неизвестно')
                          : '—'}
                      </td>
                      <td>{candidate ? (candidateValue(bytes, candidate) ?? '—') : '—'}</td>
                      {group.columns.map((column) => (
                        <td
                          key={column.offset}
                          data-heat={column.heat}
                          data-kind={column.kind}
                          data-candidate={
                            !!candidate &&
                            column.offset >= candidate.offset &&
                            column.offset < candidate.offset + candidate.length
                          }
                          title={`Позиция ${column.offset}: ${column.distinct} разных значений`}
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
        </>
      )}
    </details>
  );
}
