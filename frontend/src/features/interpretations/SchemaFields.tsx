import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { appendJsonValue, editJsonValue, removeJsonValue } from '../../shared/model/json-text';
import { Banner, Button, Field } from '../../shared/ui/common';
import { JsonChoice, JsonControl, SchemaContext } from './SchemaControls';
import { FramingEditor, RulesEditor } from './SchemaStructure';

export const schemaObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const fieldTypes = [
  ['uint8', 'Целое без знака · 1 байт'],
  ['int8', 'Целое со знаком · 1 байт'],
  ...[16, 32, 64].flatMap((bits) =>
    ['uint', 'int'].flatMap((prefix) =>
      ['le', 'be'].map((order) => [
        prefix + bits + order,
        `${prefix === 'int' ? 'Со знаком' : 'Без знака'} · ${bits / 8} байт · ${order === 'le' ? 'младший первым' : 'старший первым'}`,
      ]),
    ),
  ),
  ['float32le', 'Дробное IEEE 754 · 4 байта · младший первым'],
  ['float32be', 'Дробное IEEE 754 · 4 байта · старший первым'],
  ['ascii', 'Текст ASCII'],
  ['utf8', 'Текст UTF-8'],
  ['hex', 'Байты HEX'],
  ['bytes', 'Байты'],
  ['base64', 'Байты Base64'],
].map(([value, label]) => ({ value: value!, label: label! }));

export function SchemaFields({
  draft,
  parsed,
  projectId,
  onChange,
  onInvalid,
}: {
  draft: string;
  parsed: Record<string, unknown> | null;
  projectId: string;
  onChange: (draft: string) => void;
  onInvalid?: (invalid: boolean) => void;
}) {
  const fields = (Array.isArray(parsed?.fields) ? parsed.fields : []).map(schemaObject);
  const checks = (Array.isArray(parsed?.checks) ? parsed.checks : []).map(schemaObject);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const problem = useCallback(
    (key: string, value?: string) =>
      setProblems((previous) => {
        if (previous[key] === value) return previous;
        const next = { ...previous };
        if (value) next[key] = value;
        else delete next[key];
        return next;
      }),
    [],
  );
  const invalid = Object.keys(problems).length > 0;
  useEffect(() => {
    onInvalid?.(invalid);
    return () => onInvalid?.(false);
  }, [invalid, onInvalid]);
  const pendingRenames = useRef(new Map<number, string>());
  function rename(index: number, name: string) {
    const current = fields[index]?.name;
    const previous = current === '' ? pendingRenames.current.get(index) : current;
    let next = editJsonValue(draft, ['fields', index, 'name'], name);
    if (name === '' && typeof previous === 'string' && previous !== '')
      pendingRenames.current.set(index, previous);
    else if (typeof previous === 'string' && previous !== '') {
      pendingRenames.current.delete(index);
      fields.forEach((field, otherIndex) => {
        if (field.lengthFrom === previous)
          next = editJsonValue(next, ['fields', otherIndex, 'lengthFrom'], name);
      });
      checks.forEach((check, index) => {
        if (check.field === previous) next = editJsonValue(next, ['checks', index, 'field'], name);
      });
    }
    onChange(next);
  }
  return (
    <SchemaContext.Provider value={{ draft, change: onChange, problem }}>
      <div className="schema-fields">
        <FramingEditor parsed={parsed} />
        <h2>Поля сообщения</h2>
        <p>
          Опиши, как читать байты внутри одного сообщения. Масштаб умножает прочитанное число:
          например 2150 × 0.01 = 21.5.
        </p>
        {fields.map((field, index) => {
          const path = ['fields', index];
          const name = String(field.name ?? '');
          const referenced =
            fields.some((other) => other.lengthFrom === name) ||
            checks.some((check) => check.field === name);
          return (
            <details className="schema-field" key={index} open>
              <summary>
                Поле {index + 1} · {name || 'Без имени'}
              </summary>
              <div className="schema-controls">
                <Field
                  label={'Название поля ' + (index + 1)}
                  hint="Рабочее имя в схеме. Правила и длины связанных полей переименуются вместе с ним."
                >
                  {(id) => (
                    <input
                      id={id}
                      value={name}
                      onChange={(event) => rename(index, event.target.value)}
                    />
                  )}
                </Field>
                <JsonChoice
                  path={[...path, 'type']}
                  label={'Тип поля ' + (index + 1)}
                  options={fieldTypes}
                />
                <JsonControl
                  path={[...path, 'description']}
                  label={'Пояснение поля ' + (index + 1)}
                  optional
                  hint="Показывается рядом со значением в просмотре сообщений."
                />
                <JsonControl
                  path={[...path, 'offset']}
                  label={'Позиция поля ' + (index + 1)}
                  kind="uint"
                  optional
                  maximum={1048576n}
                  hint="От начала сообщения, с 0. Пусто — сразу после предыдущего поля."
                />
                <JsonControl
                  path={[...path, 'length']}
                  label={'Длина поля ' + (index + 1)}
                  kind="uint"
                  optional
                  maximum={1048576n}
                  hint="Для текста и байтов. Числовой тип уже задаёт свой размер."
                />
                <JsonChoice
                  path={[...path, 'lengthFrom']}
                  label={'Длина из другого поля ' + (index + 1)}
                  empty="Задана выше / остаток сообщения"
                  options={fields.slice(0, index).map((item) => ({
                    value: String(item.name ?? ''),
                    label: String(item.name ?? ''),
                  }))}
                />
                <JsonControl
                  path={[...path, 'scale']}
                  label={'Масштаб поля ' + (index + 1)}
                  kind="number"
                  nonzero
                  optional
                  hint="Только для чисел. Пусто — без пересчёта; 0.01 означает деление на 100."
                />
                <Button
                  variant="ghost"
                  disabled={referenced}
                  onClick={() => {
                    pendingRenames.current.clear();
                    onChange(removeJsonValue(draft, path));
                  }}
                >
                  Удалить поле {index + 1}
                </Button>
                {referenced && (
                  <p className="muted">
                    Сначала удали использующие это поле правила или ссылки на его длину.
                  </p>
                )}
              </div>
            </details>
          );
        })}
        <Button
          onClick={() => {
            let index = fields.length + 1;
            while (fields.some((field) => field.name === 'field_' + index)) index++;
            onChange(appendJsonValue(draft, ['fields'], { name: 'field_' + index, type: 'uint8' }));
          }}
        >
          Добавить поле
        </Button>
        <RulesEditor fields={fields} checks={checks} />
        {invalid && (
          <Banner tone="error">
            Исправь значения в форме перед сохранением или предварительным разбором.
          </Banner>
        )}
        <Link to={'/projects/' + projectId + '/guide#fields'}>
          Пример поля и объяснение типов →
        </Link>
      </div>
    </SchemaContext.Provider>
  );
}
