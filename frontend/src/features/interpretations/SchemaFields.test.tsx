import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SchemaFields } from './SchemaFields';
import userEvent from '@testing-library/user-event';

function Builder() {
  const [draft, setDraft] = useState(
    '{"framing":{"fixedLength":16},"fields":[{"name":"size","type":"uint64be"},{"name":"data","type":"hex","lengthFrom":"size"}],"checks":[{"id":"exact","field":"size","op":"eq","value":18446744073709551615}],"extension":0.123456789012345678901}',
  );
  const [invalid, setInvalid] = useState(false);
  return (
    <MemoryRouter>
      <SchemaFields
        draft={draft}
        parsed={JSON.parse(draft)}
        projectId="p"
        onChange={setDraft}
        onInvalid={setInvalid}
      />
      <output data-testid="draft">{draft}</output>
      <button disabled={invalid}>Сохранение тест</button>
    </MemoryRouter>
  );
}
it('форма переименовывает связанные правила и длины без округления uint64', () => {
  render(<Builder />);
  fireEvent.change(screen.getByLabelText('Название поля 1'), { target: { value: 'count' } });
  const text = screen.getByTestId('draft').textContent!;
  expect(text).toContain('18446744073709551615');
  expect(text).toContain('0.123456789012345678901');
  expect(JSON.parse(text)).toMatchObject({
    fields: [{ name: 'count' }, { lengthFrom: 'count' }],
    checks: [{ field: 'count' }],
  });
  expect(screen.getByRole('button', { name: 'Удалить поле 1' })).toBeDisabled();
  expect(screen.getByLabelText('Ожидаемое значение 1')).toHaveValue('18446744073709551615');
});
it('незаконченный ввод блокирует сохранение, исправление и добавление сохраняют точные числа', () => {
  render(<Builder />);
  const scale = screen.getByLabelText('Масштаб поля 1');
  fireEvent.change(scale, { target: { value: '0.' } });
  expect(screen.getByRole('button', { name: 'Сохранение тест' })).toBeDisabled();
  fireEvent.change(scale, { target: { value: '0.123456789012345678901' } });
  expect(screen.getByRole('button', { name: 'Сохранение тест' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Добавить поле' }));
  expect(JSON.parse(screen.getByTestId('draft').textContent!).fields).toHaveLength(3);
  expect(screen.getByTestId('draft').textContent).toContain('18446744073709551615');
});
it('очистка имени перед набором сохраняет ссылки на исходное поле и не связывает пустой lengthFrom', async () => {
  let latest =
    '{"framing":{"fixedLength":12},"fields":[{"name":"size","type":"uint8"},{"name":"payload","type":"bytes","lengthFrom":"size"},{"name":"extra","type":"bytes","length":1,"lengthFrom":""}],"checks":[{"id":"limit","field":"size","op":"eq","value":18446744073709551615}],"extension":{"value":18446744073709551614,"scaled":1e+20}}';
  function Editor() {
    const [draft, setDraft] = useState(latest);
    return (
      <SchemaFields
        draft={draft}
        parsed={JSON.parse(draft)}
        projectId="research"
        onChange={(next) => {
          latest = next;
          setDraft(next);
        }}
      />
    );
  }
  render(
    <MemoryRouter>
      <Editor />
    </MemoryRouter>,
  );
  const name = screen.getByLabelText('Название поля 1'),
    user = userEvent.setup();
  await user.clear(name);
  await user.type(name, 'length');
  expect(JSON.parse(latest).fields[1].lengthFrom).toBe('length');
  expect(JSON.parse(latest).checks[0].field).toBe('length');
  expect(JSON.parse(latest).fields[2].lengthFrom).toBe('');
  expect(latest).toContain('"value":18446744073709551615');
  expect(latest).toContain('"extension":{"value":18446744073709551614,"scaled":1e+20}');
  expect(screen.getByLabelText('Название поля 2')).toHaveValue('payload');
});
