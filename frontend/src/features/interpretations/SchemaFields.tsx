import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { editJsonValue } from '../../shared/model/json-text';
import { Field } from '../../shared/ui/common';

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const typeLabels: Record<string, string> = {
  int8: 'знаковое число, 1 байт',
  int16le: 'знаковое число, 2 байта, младший первым',
  int16be: 'знаковое число, 2 байта, старший первым',
  int32le: 'знаковое число, 4 байта, младший первым',
  int32be: 'знаковое число, 4 байта, старший первым',
  int64le: 'знаковое число, 8 байт, младший первым',
  int64be: 'знаковое число, 8 байт, старший первым',
  uint8: 'целое число, 1 байт',
  u8: 'целое число, 1 байт',
  uint16le: 'целое число, 2 байта, младший первым',
  uint16be: 'целое число, 2 байта, старший первым',
  uint32le: 'целое число, 4 байта, младший первым',
  uint32be: 'целое число, 4 байта, старший первым',
  uint64le: 'целое число, 8 байт, младший первым',
  uint64be: 'целое число, 8 байт, старший первым',
  float32le: 'дробное число, 4 байта, младший первым',
  float32be: 'дробное число, 4 байта, старший первым',
  ascii: 'текст ASCII',
  utf8: 'текст UTF-8',
  hex: 'байты в шестнадцатеричной записи',
  bytes: 'исходные байты',
};

export function SchemaFields({
  draft,
  parsed,
  projectId,
  onChange,
}: {
  draft: string;
  parsed: Record<string, unknown> | null;
  projectId: string;
  onChange: (draft: string) => void;
}) {
  const fields: unknown[] = Array.isArray(parsed?.fields) ? parsed.fields : [];
  const framing = object(parsed?.framing);
  const pendingRenames = useRef(new Map<number, string>());
  function rename(index: number, name: string) {
    const current = object(fields[index])?.name;
    const previous = current === '' ? pendingRenames.current.get(index) : current;
    let next = editJsonValue(draft, ['fields', index, 'name'], name);
    if (name === '' && typeof previous === 'string' && previous !== '') {
      pendingRenames.current.set(index, previous);
    } else if (typeof previous === 'string' && previous !== '') {
      pendingRenames.current.delete(index);
      fields.forEach((field, otherIndex) => {
        if (object(field)?.lengthFrom === previous)
          next = editJsonValue(next, ['fields', otherIndex, 'lengthFrom'], name);
      });
      if (Array.isArray(parsed?.checks))
        parsed.checks.forEach((check, checkIndex) => {
          if (object(check)?.field === previous)
            next = editJsonValue(next, ['checks', checkIndex, 'field'], name);
        });
    }
    onChange(next);
  }
  return (
    <div className="schema-fields">
      <h2>Поля сообщения</h2>
      <p>
        Ниже показаны поля, заданные в JSON слева. Имя можно изменить здесь. Положение, тип,
        добавление полей и правила пока редактируются в JSON.
      </p>
      {framing?.fixedLength ? (
        <p>
          Заданный размер сообщения: <strong>{String(framing.fixedLength)} байт</strong>.
        </p>
      ) : null}
      {fields.map((value, index) => {
        const field = object(value);
        if (!field) return null;
        const name = typeof field.name === 'string' ? field.name : '';
        const duplicate = fields.some(
          (other, otherIndex) => otherIndex !== index && object(other)?.name === name,
        );
        return (
          <div className="schema-field" key={index}>
            <Field
              label={'Название поля ' + (index + 1)}
              hint="Это рабочее имя в схеме. Его смысл нужно подтвердить примерами."
              error={
                !name.trim()
                  ? 'Задай непустое имя поля.'
                  : duplicate
                    ? 'Имя уже используется другим полем.'
                    : undefined
              }
            >
              {(id) => (
                <input
                  id={id}
                  value={name}
                  maxLength={120}
                  onChange={(event) => rename(index, event.target.value)}
                />
              )}
            </Field>
            <p>
              <code>{String(field.type ?? 'Тип не задан')}</code>
              {typeLabels[String(field.type)] ? ' — ' + typeLabels[String(field.type)] : ''}
            </p>
            <p className="muted">
              {field.scale !== undefined
                ? 'Масштаб: прочитанное число × ' + String(field.scale) + '. '
                : ''}
              {field.offset === undefined
                ? index === 0
                  ? 'Начинается с первого байта сообщения.'
                  : 'Начинается сразу после предыдущего поля.'
                : 'Начинается с позиции ' + String(field.offset) + ' внутри сообщения; отсчёт с 0.'}
              {field.length ? ' Длина: ' + String(field.length) + ' байт.' : ''}
              {field.lengthFrom ? ' Длина берётся из поля ' + String(field.lengthFrom) + '.' : ''}
            </p>
          </div>
        );
      })}
      {!fields.length && <p>Поля ещё не заданы. Добавь массив fields в JSON схемы.</p>}
      <Link to={'/projects/' + projectId + '/guide#fields'}>Пример поля и объяснение типов →</Link>
    </div>
  );
}
