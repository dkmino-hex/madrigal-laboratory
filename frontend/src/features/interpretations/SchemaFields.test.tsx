import { useState } from 'react';
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SchemaFields } from './SchemaFields';

it('переименование поля обновляет правила и длину зависимого поля, сохраняя точный JSON остальных значений', async () => {
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
  const name = screen.getByLabelText('Название поля 1');
  const user = userEvent.setup();
  await user.clear(name);
  await user.type(name, 'length');
  expect(JSON.parse(latest).fields[1].lengthFrom).toBe('length');
  expect(JSON.parse(latest).checks[0].field).toBe('length');
  expect(JSON.parse(latest).fields[2].lengthFrom).toBe('');
  expect(latest).toContain('"value":18446744073709551615');
  expect(latest).toContain('"extension":{"value":18446744073709551614,"scaled":1e+20}');
  expect(screen.getByLabelText('Название поля 2')).toHaveValue('payload');
});
