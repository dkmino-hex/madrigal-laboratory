import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge, ErrorState, Modal, Button, Field } from './common';
import { ApiError } from '../api/transport';
it.each(['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'UNKNOWN'])(
  'статус %s доступен как текст',
  (status) => {
    render(<Badge status={status} />);
    expect(screen.getByText(new RegExp(status))).toBeInTheDocument();
  },
);
it('постоянная ошибка содержит requestId и повтор чтения', async () => {
  const retry = vi.fn();
  render(
    <ErrorState
      error={new ApiError('NETWORK_ERROR', 'Проверьте Gateway', 'request-42')}
      retry={retry}
    />,
  );
  await userEvent.click(screen.getByText('Техническая диагностика'));
  expect(screen.getByText('request-42')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Повторить чтение' }));
  expect(retry).toHaveBeenCalledOnce();
});
it('диалог имеет имя, описание и возвращает фокус', async () => {
  const user = userEvent.setup();
  render(
    <Modal title="Новый проект" description="Описание" trigger={<Button>Открыть</Button>}>
      <Button>Создать</Button>
    </Modal>,
  );
  const trigger = screen.getByRole('button', { name: 'Открыть' });
  await user.click(trigger);
  expect(screen.getByRole('dialog', { name: 'Новый проект' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
it('ошибка формы программно связана с полем', () => {
  render(
    <Field label="Смещение" error="Нужно целое число">
      {(id) => <input id={id} />}
    </Field>,
  );
  expect(screen.getByLabelText('Смещение')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Смещение')).toHaveAccessibleDescription('Нужно целое число');
});
