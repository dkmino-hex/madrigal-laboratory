import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SourceInspector } from './SourceInspector';
import { api } from '../../shared/api/client';
import { goldenLocation, goldenSources, fixturePacket } from '../../mocks/fixtures/corpus';
import { decimal } from '../../shared/model/precision';
import { sourceLink } from '../../shared/model/navigation';

it('переход обратно из байтов в журнал сохраняет выбранное действие и фильтры', () => {
  vi.spyOn(api, 'sources').mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const returnTo =
    '/projects/' +
    goldenLocation.projectId +
    '/actions?actionId=action-selected&q=period&cursor=50';
  render(
    <MemoryRouter initialEntries={[sourceLink(goldenLocation, { returnTo })]}>
      <QueryClientProvider client={client}>
        <SourceInspector location={goldenLocation} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: 'Связать с действием журнала' });
  const params = new URL(link.getAttribute('href')!, window.location.origin).searchParams;
  expect(params.get('actionId')).toBe('action-selected');
  expect(params.get('q')).toBe('period');
  expect(params.get('cursor')).toBe('50');
  expect(params.get('source')).toBe(sourceLink(goldenLocation));
  expect(
    new URL(params.get('returnTo')!, window.location.origin).searchParams.has('returnTo'),
  ).toBe(false);
  client.clear();
});

it('недоступная часть кадра обозначается ошибкой вместо пустого выделения', async () => {
  vi.spyOn(api, 'sources').mockResolvedValue([
    { ...goldenSources[0]!, frameOffset: decimal('999') },
  ]);
  vi.spyOn(api, 'packet').mockResolvedValue(fixturePacket('capture-baseline-fixture2', 7));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SourceInspector location={goldenLocation} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await userEvent.click(await screen.findByText('Кадр №7'));
  expect(
    await screen.findByText(/Исходный участок выходит за пределы захваченного кадра/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: /HEX кадра/ })).not.toBeInTheDocument();
  client.clear();
});
