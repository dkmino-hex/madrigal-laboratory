import type { Run, Summary } from '../api/contracts/draft';
export function summaryConclusion(summary: Summary, status: Run['status']) {
  if (status !== 'COMPLETED' || !summary.complete) return 'Частичный или незавершённый результат';
  if (summary.messages === '0') return 'Нет сообщений: проверка протокола не подтверждена';
  const applicable =
    BigInt(summary.rules.PASS) +
    BigInt(summary.rules.FAIL) +
    BigInt(summary.rules.INCONCLUSIVE) +
    BigInt(summary.rules.UNKNOWN);
  if (applicable === 0n) return 'Нет применимых проверок: успех не установлен';
  if (BigInt(summary.rules.FAIL) > 0n) return 'Есть нарушения и контрпримеры';
  if (
    BigInt(summary.unknownBytes) > 0n ||
    BigInt(summary.rules.INCONCLUSIVE) > 0n ||
    BigInt(summary.rules.UNKNOWN) > 0n
  )
    return 'Есть неизвестные или неоднозначные данные';
  return 'Применимые правила выполнены в указанной области; смысл полей не доказан';
}
export function compatibleRunInputs(left: Run, right: Run) {
  const normalize = (run: Run) =>
    JSON.stringify({
      settingsVersion: run.manifest.settingsVersion,
      engineVersion: run.manifest.engineVersion,
      filters: run.manifest.filters,
      corpus: [...run.manifest.corpus].sort((a, b) =>
        (a.captureId + a.assemblyId).localeCompare(b.captureId + b.assemblyId),
      ),
    });
  return normalize(left) === normalize(right);
}
