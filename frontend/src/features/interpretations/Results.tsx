import { Link, useLocation } from 'react-router-dom';
import type { Result } from '../../shared/api/contracts/models';
import { sourceLink } from '../../shared/model/navigation';
import { Badge } from '../../shared/ui/common';
export function ResultsTable({
  results,
  revisionId,
  runId,
}: {
  results: Result[];
  revisionId?: string;
  runId?: string;
}) {
  const current = useLocation();
  return (
    <div className="table-scroll">
      <table className="results-table">
        <thead>
          <tr>
            <th>Проверка</th>
            <th>Поле / сообщение</th>
            <th>Причина и правило</th>
            <th>Источник</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.resultId}>
              <td>
                <Badge status={result.status} />
              </td>
              <td>
                <strong>{result.messageId}</strong>
                {result.fields.map((field) => (
                  <div className="result-field" key={field.fieldId}>
                    <code>{field.path}</code>
                    <span>
                      {field.type} ={' '}
                      <strong className="mono">
                        {field.value === null ? 'Неизвестно' : field.value}
                      </strong>
                    </span>
                    <small>{field.reason}</small>
                    <Link
                      to={sourceLink(field.location, {
                        revisionId,
                        runId,
                        returnTo: current.pathname + current.search,
                      })}
                    >
                      Открыть источник поля
                    </Link>
                  </div>
                ))}
              </td>
              <td>
                {result.reason}
                <small className="mono">{result.rule}</small>
              </td>
              <td>
                <Link
                  className="button ghost"
                  to={sourceLink(result.location, {
                    revisionId,
                    runId,
                    returnTo: current.pathname + current.search,
                  })}
                >
                  Открыть исходные пакеты
                </Link>
                <small className="mono">
                  [{result.location.start},{' '}
                  {BigInt(result.location.start) + BigInt(result.location.length)})
                </small>
                <small>{result.sources.length} исходных участков</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
