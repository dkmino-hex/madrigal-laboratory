import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobCard } from './Jobs';
import { api } from '../../shared/api/client';
import type { Job } from '../../shared/api/contracts/models';
import { decimal } from '../../shared/model/precision';

afterEach(() => vi.restoreAllMocks());
function show(job: Partial<Job> = {}) {
  vi.spyOn(api, 'job').mockResolvedValue({
    projectId: 'project',
    jobId: 'job',
    owner: 'Analysis',
    status: 'RUNNING',
    stage: 'Обработка',
    completed: decimal('0'),
    total: decimal('0'),
    unit: 'сообщений',
    ...job,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JobCard projectId="project" jobId="job" />
    </QueryClientProvider>,
  );
}
it.each(['Capture', 'Analysis', 'Workspace'] as const)(
  'известный ноль у %s отличается от неизвестного общего количества',
  async (owner) => {
    show({ owner });
    expect(await screen.findByText('0 / 0 сообщений')).toBeVisible();
    expect(screen.queryByText('Общее количество неизвестно')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  },
);
it('null total во время работы показывает неопределённый прогресс', async () => {
  show({ total: null });
  expect(await screen.findByText('Общее количество неизвестно')).toBeVisible();
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
});
it('завершённое задание с неизвестным total не продолжает показывать обработку', async () => {
  show({ total: null, status: 'COMPLETED' });
  expect(await screen.findByText(/COMPLETED/)).toBeVisible();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
it('большой total вычисляется точно и ограниченно преобразуется только процент', async () => {
  show({ total: decimal('9007199254740993'), completed: decimal('9007199254740992') });
  expect(await screen.findByText('9007199254740992 / 9007199254740993 сообщений')).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '9999');
});
