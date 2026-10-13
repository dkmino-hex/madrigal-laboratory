import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HexViewer } from './HexViewer';
import { goldenLocation, fixtureWindow } from '../../mocks/fixtures/corpus';
import { decimal } from '../../shared/model/precision';
it('клавиатура сохраняет абсолютное выделение через границу окна', async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const windowChange = vi.fn();
  const selection = { ...goldenLocation, start: decimal('4095'), length: decimal('1') };
  render(
    <HexViewer
      window={fixtureWindow(
        { ...goldenLocation, start: decimal('0'), length: decimal('4096') },
        '65536',
      )}
      selection={selection}
      onSelect={select}
      onWindow={windowChange}
    />,
  );
  screen.getByRole('grid').focus();
  await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
  expect(select).toHaveBeenCalledWith('4095', '2', '4096');
  expect(windowChange).not.toHaveBeenCalled();
});
it('копирование пропуска объясняет невозможность точной копии', async () => {
  const user = userEvent.setup();
  const selection = { ...goldenLocation, start: decimal('64'), length: decimal('4') };
  render(
    <HexViewer
      window={fixtureWindow(
        { ...goldenLocation, start: decimal('0'), length: decimal('256') },
        '65536',
      )}
      selection={selection}
      onSelect={vi.fn()}
      onWindow={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Копировать HEX' }));
  expect(screen.getByText(/Точная копия недоступна/)).toBeInTheDocument();
});
it('запаздывающее подтверждение URL не откатывает быстрые клавиши Shift', async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const props = {
    window: fixtureWindow(
      { ...goldenLocation, start: decimal('0'), length: decimal('4096') },
      '65536',
    ),
    selection: { ...goldenLocation, length: decimal('1') },
    onSelect: select,
    onWindow: vi.fn(),
  };
  const { rerender } = render(<HexViewer {...props} />);
  screen.getByRole('grid').focus();
  await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}');
  expect(select).toHaveBeenLastCalledWith('1000', '3', undefined);
  rerender(<HexViewer {...props} selection={{ ...goldenLocation, length: decimal('2') }} />);
  await user.keyboard('{ArrowRight}{/Shift}');
  expect(select).toHaveBeenLastCalledWith('1000', '4', undefined);
  // Та же координата в другой неизменяемой сборке — новый контекст.
  rerender(
    <HexViewer
      {...props}
      selection={{ ...goldenLocation, assemblyId: 'another-assembly', length: decimal('3') }}
    />,
  );
  await user.keyboard('{ArrowRight}');
  expect(select).toHaveBeenLastCalledWith('1001', '1', undefined);
});
