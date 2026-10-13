import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResultsTable } from './Results';
import { resultsFor, projectId } from '../../mocks/fixtures/corpus';
import { decimal } from '../../shared/model/precision';

it('переход к полю сохраняет его диапазон, run, revision и возврат, а не весь message', () => {
  const result = resultsFor(projectId)[0]!;
  result.fields[0]!.location = { ...result.location, start: decimal('1002'), length: decimal('1') };
  render(
    <MemoryRouter initialEntries={['/projects/demo-laboratory/runs/run-baseline?status=PASS']}>
      <ResultsTable results={[result]} runId="run-baseline" revisionId="revision-v1" />
    </MemoryRouter>,
  );
  const url = new URL(
    (screen.getByRole('link', { name: 'Открыть источник поля' }) as HTMLAnchorElement).href,
  );
  expect(url.searchParams.get('start')).toBe('1002');
  expect(url.searchParams.get('length')).toBe('1');
  expect(url.searchParams.get('runId')).toBe('run-baseline');
  expect(url.searchParams.get('revisionId')).toBe('revision-v1');
  expect(url.searchParams.get('returnTo')).toBe(
    '/projects/demo-laboratory/runs/run-baseline?status=PASS',
  );
});
