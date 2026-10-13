import type { Run } from '../../shared/api/contracts/draft';
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
            </tr>
          </thead>
          <tbody>
            {Object.entries(run.summary.rules).map(([status, count]) => (
              <tr key={status}>
                <td>
                  <Badge status={status} />
                </td>
                <td className="mono">{formatInteger(count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
