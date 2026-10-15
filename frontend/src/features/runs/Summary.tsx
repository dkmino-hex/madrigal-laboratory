import type { Run } from '../../shared/api/contracts/models';
import { Badge, Banner } from '../../shared/ui/common';
import { summaryConclusion } from '../../shared/model/runs';
import { formatInteger } from '../../shared/model/precision';
export function RunSummary({ run }: { run: Run }) {
  return (
    <section className="run-summary">
      <Banner tone={!run.summary.complete || run.status !== 'COMPLETED' ? 'warning' : 'info'}>
        {summaryConclusion(run.summary, run.status)}
      </Banner>
      <dl className="coverage-grid">
        <div>
          <dt>Сообщения</dt>
          <dd>{formatInteger(run.summary.messages)}</dd>
        </div>
        <div>
          <dt>Известные байты</dt>
          <dd>{formatInteger(run.summary.knownBytes)}</dd>
        </div>
        <div>
          <dt>Неизвестные байты</dt>
          <dd>{formatInteger(run.summary.unknownBytes)}</dd>
        </div>
        <div>
          <dt>Записи</dt>
          <dd>{formatInteger(run.summary.captures)}</dd>
        </div>
        <div>
          <dt>Сессии</dt>
          <dd>{formatInteger(run.summary.sessions)}</dd>
        </div>
      </dl>
      <div className="table-scroll">
        <table>
          <caption>Проверки правил — отдельная единица учёта</caption>
          <thead>
            <tr>
              <th>Статус проверки</th>
              <th>Количество правил</th>
              {run.summary.messageStatuses && <th>Количество сообщений</th>}
            </tr>
          </thead>
          <tbody>
            {Object.entries(run.summary.rules).map(([status, count]) => (
              <tr key={status}>
                <td>
                  <Badge status={status} />
                </td>
                <td className="mono">{formatInteger(count)}</td>
                {run.summary.messageStatuses && (
                  <td className="mono">
                    {formatInteger(
                      run.summary.messageStatuses[
                        status as keyof typeof run.summary.messageStatuses
                      ],
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Правила и сообщения считаются отдельно. Неприменимое сообщение может не содержать ни одной
        проверки. PASS сообщения означает успешный структурный разбор; смысл поля оценивается по
        правилам и дополнительным опытам.
      </p>
    </section>
  );
}
export function RunManifest({ run }: { run: Run }) {
  return (
    <div className="run-manifest">
      <div className="panel-heading">
        <h2>Закреплённые входы</h2>
        {run.manifest.synthetic && <span className="mode-label mock">Синтетический manifest</span>}
      </div>
      <dl className="metadata">
        {run.manifest.actionSnapshotCount !== undefined && (
          <div>
            <dt>Закреплённый журнал</dt>
            <dd>
              {formatInteger(run.manifest.actionSnapshotCount)} действий ·{' '}
              {run.manifest.actionsComplete ? 'снимок полный' : 'снимок ограничен'}. Изменения
              текущего журнала не меняют эту проверку.
            </dd>
          </div>
        )}
        <div>
          <dt>Ревизия</dt>
          <dd>
            <code>{run.manifest.revisionId}</code>
          </dd>
        </div>
        <div>
          <dt>Настройки</dt>
          <dd>
            <code>{run.manifest.settingsVersion}</code>
          </dd>
        </div>
        <div>
          <dt>Движок</dt>
          <dd>
            <code>{run.manifest.engineVersion}</code>
          </dd>
        </div>
        <div>
          <dt>Область / фильтры</dt>
          <dd>{run.manifest.filters}</dd>
        </div>
      </dl>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Запись</th>
              <th>Сборка</th>
              <th>Хеш из manifest</th>
            </tr>
          </thead>
          <tbody>
            {run.manifest.corpus.map((capture) => (
              <tr key={capture.captureId + capture.assemblyId}>
                <td>
                  <code>{capture.captureId}</code>
                </td>
                <td>
                  <code>{capture.assemblyId}</code>
                </td>
                <td className="hash">
                  <code>{capture.sha256}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Входы получены от серверной операции и остаются неизменяемыми. Создание новой ревизии не
        меняет этот запуск.
      </p>
    </div>
  );
}
