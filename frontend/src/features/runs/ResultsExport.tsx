import { useState } from 'react';
import { api } from '../../shared/api/client';
import type { Page, Result, RuleCheck } from '../../shared/api/contracts/models';
import { Button, ErrorState, downloadText } from '../../shared/ui/common';

export function ResultsExport({
  params,
  checks,
  enabled,
}: {
  params: Record<string, unknown>;
  checks: boolean;
  enabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [count, setCount] = useState(0);
  async function download() {
    setBusy(true);
    setError(undefined);
    setCount(0);
    try {
      const lines: string[] = [],
        seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: Page<Result | RuleCheck> = await (checks ? api.checks : api.results)({
          ...params,
          cursor: cursor ?? undefined,
          limit: 100,
        });
        lines.push(...page.items.map((item) => JSON.stringify(item)));
        setCount(lines.length);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new Error('Сервер повторил страницу. Экспорт остановлен.');
        if (cursor) seen.add(cursor);
      } while (cursor);
      downloadText(
        lines.join('\n') + (lines.length ? '\n' : ''),
        String(params.runId) + (checks ? '-checks' : '-messages') + '.ndjson',
        'application/x-ndjson',
      );
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button disabled={!enabled || busy} onClick={() => void download()}>
        {busy ? `Подготовка: ${count} строк…` : 'Скачать результаты NDJSON'}
      </Button>
      {error !== undefined && <ErrorState error={error} />}
    </>
  );
}
