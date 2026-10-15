import { it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge, ErrorState, Modal, Button, Field, CopyButton, Pagination } from './common';
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
it('диалог без Radix.Trigger возвращает фокус на действие, которое его открыло', async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Записать находку</Button>
        {open && (
          <Modal open title="Наблюдение" description="Описание" onOpenChange={setOpen}>
            <input aria-label="Текст" />
          </Modal>
        )}
      </>
    );
  }
  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Записать находку' });
  await user.click(opener);
  expect(screen.getByRole('dialog', { name: 'Наблюдение' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(opener).toHaveFocus();
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
it('одна страница не показывает недоступные кнопки и технический cursor', () => {
  render(<Pagination cursor="0" nextCursor={null} total="2" onChange={vi.fn()} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByText('Всего записей: 2')).toBeInTheDocument();
  expect(screen.getByText('Все записи показаны')).toBeInTheDocument();
});
it('непрозрачный cursor передаётся точно, но не показывается пользователю', async () => {
  const change = vi.fn();
  render(<Pagination cursor="opaque-secret" nextCursor="opaque-next" onChange={change} />);
  expect(screen.queryByText(/opaque-/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));
  expect(change).toHaveBeenCalledWith('opaque-next');
});
it('во время обновления списка нельзя перейти по устаревшему cursor', () => {
  const change = vi.fn();
  render(<Pagination cursor="0" nextCursor="next" onChange={change} busy />);
  const next = screen.getByRole('button', { name: 'Следующая страница' });
  expect(next).toBeDisabled();
  fireEvent.click(next);
  expect(change).not.toHaveBeenCalled();
});
it('копирование поясняет содержимое, сообщает результат и не показывает старый успех для другого значения', async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const view = render(
    <CopyButton
      value="exact-source"
      label="Копировать источник"
      description="Ссылка на диапазон и сборку"
    />,
  );
  expect(screen.getByRole('button')).toHaveAttribute('title', 'Ссылка на диапазон и сборку');
  await user.click(screen.getByRole('button'));
  expect(write).toHaveBeenCalledWith('exact-source');
  expect(await screen.findByText('Скопировано')).toBeVisible();
  view.rerender(<CopyButton value="another-source" label="Копировать источник" />);
  expect(screen.queryByText('Скопировано')).not.toBeInTheDocument();
});
it('отсутствующий буфер обмена сообщает ошибку без исключения интерфейса', async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(<CopyButton value="source" />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Буфер обмена недоступен')).toBeVisible();
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});
