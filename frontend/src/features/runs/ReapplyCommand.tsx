import type { Run } from '../../shared/api/contracts/models';
import { gatewayUrl } from '../../app/config';
import { CopyButton } from '../../shared/ui/common';

// Single quotes protect IDs and URLs in PowerShell, including embedded quotes.
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export function reapplyCommand(run: Run, gateway: string) {
  const captures = [...new Set(run.manifest.corpus.map((item) => item.captureId))];
  if (captures.length !== run.manifest.corpus.length) return null;
  return [
    'node scripts/apply-interpretation.mjs',
    '--gateway ' + quote(gateway),
    '--project ' + quote(run.projectId),
    '--revision ' + quote(run.manifest.revisionId),
    ...run.manifest.corpus.flatMap((item) => [
      '--capture ' + quote(item.captureId),
      '--assembly ' + quote(item.assemblyId),
    ]),
  ].join(' ');
}
export function ReapplyCommand({ run }: { run?: Run }) {
  const command = run ? reapplyCommand(run, gatewayUrl('/')) : null;
  return (
    <section className="panel">
      <h2>Повторное применение без GUI</h2>
      <p>
        Запусти команду в PowerShell из корня репозитория. Нужны Node.js 22.12+ и работающие
        сервисы.
      </p>
      {command ? (
        <>
          <pre className="command-preview">{command}</pre>
          <CopyButton value={command} label="Копировать команду PowerShell" />
          <p>
            Команда использует выбранную ревизию и те же версии сборок. Создаёт новый запуск со
            снимком текущего журнала; исходный результат сохраняется. В новой папке output появятся
            run.json и results.ndjson.
          </p>
        </>
      ) : (
        <p className="muted">
          Выбери завершённый запуск выше. Для корпуса с несколькими сборками одной записи используй
          сохранённый манифест и API запуска.
        </p>
      )}
      <p className="muted">
        Копирование не запускает команду. Тайм-аут CLI не отменяет серверное задание; его можно
        найти во вкладке «Проверка».
      </p>
    </section>
  );
}
