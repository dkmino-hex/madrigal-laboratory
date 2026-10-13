import { it, expect } from 'vitest';
import { baselineRun } from '../../mocks/fixtures/corpus';
import { decimal } from './precision';
import { compatibleRunInputs, summaryConclusion } from './runs';
it('завершение job не превращает FAIL в PASS', () => {
  const run = baselineRun('p');
  expect(summaryConclusion(run.summary, run.status)).toContain('нарушения');
});
it('ноль сообщений не означает успех', () => {
  const run = baselineRun('p');
  run.summary.messages = decimal('0');
  expect(summaryConclusion(run.summary, 'COMPLETED')).toContain('не подтверждена');
});
it('ноль применимых правил не означает успех', () => {
  const run = baselineRun('p');
  run.summary.rules = {
    PASS: decimal('0'),
    FAIL: decimal('0'),
    UNKNOWN: decimal('0'),
    INCONCLUSIVE: decimal('0'),
    NOT_APPLICABLE: decimal('5'),
  };
  expect(summaryConclusion(run.summary, 'COMPLETED')).toContain('успех не установлен');
});
it.each(['CANCELLED', 'INTERRUPTED', 'FAILED', 'RUNNING'] as const)(
  'технический статус %s остаётся незавершённым',
  (status) =>
    expect(summaryConclusion(baselineRun('p').summary, status)).toContain('незавершённый'),
);
it('сравнивает входы независимо от ревизии, но с учётом корпуса и фильтров', () => {
  const a = baselineRun('p');
  const b = structuredClone(a);
  b.manifest.revisionId = 'new';
  expect(compatibleRunInputs(a, b)).toBe(true);
  b.manifest.filters = 'other';
  expect(compatibleRunInputs(a, b)).toBe(false);
  b.manifest.filters = a.manifest.filters;
  b.manifest.corpus[0]!.assemblyId = 'new-assembly';
  expect(compatibleRunInputs(a, b)).toBe(false);
});
