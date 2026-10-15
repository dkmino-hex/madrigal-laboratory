import { Link } from 'react-router-dom';
import type { RuleCheck } from '../../shared/api/contracts/models';
import { sourceLink } from '../../shared/model/navigation';
import { Badge, Button } from '../../shared/ui/common';

export function ChecksTable({
  checks,
  runId,
  revisionId,
  onStream,
}: {
  checks: RuleCheck[];
  runId: string;
  revisionId: string;
  onStream: (stream: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Правило</th>
            <th>Результат</th>
            <th>Объяснение</th>
            <th>Байты и источник</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check, index) => (
            <tr key={check.checkId + ':' + index}>
              <td>
                <code>{check.rule}</code>
              </td>
              <td>
                <Badge status={check.status} />
              </td>
              <td>{check.reason || 'Объяснение не предоставлено'}</td>
              <td>
                {check.location ? (
                  <>
                    <Link
                      to={sourceLink(check.location, {
                        runId,
                        revisionId,
                        returnTo: window.location.pathname + window.location.search,
                      })}
                    >
                      Байты [{check.location.start},{' '}
                      {String(BigInt(check.location.start) + BigInt(check.location.length))}) ·{' '}
                      {check.sources.length} источников
                    </Link>
                    <small>
                      {check.location.captureId} ·{' '}
                      {check.location.direction === 'A_TO_B' ? 'A → B' : 'B → A'}
                    </small>
                    <Button variant="ghost" onClick={() => onStream(check.location!.streamId)}>
                      Только этот поток
                    </Button>
                  </>
                ) : (
                  <span className="muted">У правила нет диапазона байтов</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
