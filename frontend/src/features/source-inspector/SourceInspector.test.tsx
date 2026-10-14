import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SourceInspector } from './SourceInspector';
import { api } from '../../shared/api/client';
import { goldenLocation, goldenSources, fixturePacket } from '../../mocks/fixtures/corpus';
import { decimal } from '../../shared/model/precision';

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
