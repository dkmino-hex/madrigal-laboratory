import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router-dom';
import { expect, it } from 'vitest';
import { useBufferedParam } from './use-buffered-param';
import { UnsavedGuard } from './use-unsaved';

function Search({ dirty = false }: { dirty?: boolean }) {
  const input = useBufferedParam('q', 'cursor', 80);
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <UnsavedGuard dirty={dirty} searchKeys={['selected']} />
      <input
        aria-label="Поиск"
        value={input.value}
        onChange={(event) => input.setValue(event.target.value)}
      />
      <output data-testid="pending">{String(input.pending)}</output>
      <output data-testid="url">{location.search}</output>
      <button onClick={() => void navigate(-1)}>Назад</button>
      <button onClick={() => void navigate('/settings')}>Перейти в настройки</button>
    </>
  );
}
function Destination() {
  const location = useLocation();
  return (
    <>
      <h1>Настройки</h1>
      <output data-testid="url">{location.search}</output>
    </>
  );
}
function mount(entries: string[], dirty = false) {
  render(
    <RouterProvider
      router={createMemoryRouter(
        [
          { path: '/projects', element: <Search dirty={dirty} /> },
          { path: '/settings', element: <Destination /> },
        ],
        {
          initialEntries: entries,
        },
      )}
    />,
  );
}
it('быстрый набор применяет последний запрос, сохраняя остальные фильтры и сбрасывая страницу', async () => {
  mount(['/projects?type=observation&cursor=20']);
  const search = screen.getByLabelText('Поиск');
  for (const value of ['a', 'ab', 'abc']) fireEvent.change(search, { target: { value } });
  expect(screen.getByTestId('url').textContent).not.toContain('q=');
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('q=abc'));
  expect(screen.getByTestId('url')).toHaveTextContent('type=observation');
  expect(screen.getByTestId('url').textContent).not.toContain('cursor');
  expect(screen.getByTestId('pending')).toHaveTextContent('false');
});
it('пробелы считаются пустым поиском и не оставляют интерфейс в состоянии ожидания', () => {
  mount(['/projects?cursor=20']);
  fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: '   ' } });
  expect(screen.getByTestId('pending')).toHaveTextContent('false');
  expect(screen.getByTestId('url')).toHaveTextContent('?cursor=20');
});
it('возврат к предыдущему URL отменяет ещё не применённый поиск', async () => {
  mount(['/projects?q=older', '/projects?q=latest']);
  fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'pending' } });
  fireEvent.click(screen.getByText('Назад'));
  await waitFor(() => expect(screen.getByLabelText('Поиск')).toHaveValue('older'));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
  expect(screen.getByTestId('url')).toHaveTextContent('?q=older');
  expect(screen.getByTestId('pending')).toHaveTextContent('false');
});
it('отложенный поиск не закрывает защиту черновика и продолжается после решения остаться', async () => {
  mount(['/projects'], true);
  fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'pending' } });
  fireEvent.click(screen.getByText('Перейти в настройки'));
  await screen.findByRole('dialog', { name: 'Есть несохранённые изменения' });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByTestId('url').textContent).toBe('');
  fireEvent.click(screen.getByText('Остаться'));
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('q=pending'));
});
it('подтверждённый уход удаляет таймер старого экрана и освобождает блокировку', async () => {
  mount(['/projects'], true);
  fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'pending' } });
  fireEvent.click(screen.getByText('Перейти в настройки'));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByText('Уйти без сохранения'));
  await screen.findByRole('heading', { name: 'Настройки' });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));
  expect(screen.getByTestId('url').textContent).toBe('');
});
