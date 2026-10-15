import { useContext } from 'react';
import {
  appendJsonValue,
  editJsonValue,
  jsonToken,
  removeJsonValue,
} from '../../shared/model/json-text';
import { Button, Field } from '../../shared/ui/common';
import { JsonChoice, JsonControl, SchemaContext } from './SchemaControls';

export function FramingEditor({ parsed }: { parsed: Record<string, unknown> | null }) {
  const { draft, change } = useContext(SchemaContext);
  const framing = parsed?.framing as Record<string, unknown> | undefined;
  const mode = framing?.fixedLength ? 'fixed' : framing?.lengthType ? 'length' : 'whole';
  return (
    <details open className="schema-field">
      <summary>Границы сообщений</summary>
      <div className="schema-controls">
        <Field label="Как выделять сообщения">
          {(id) => (
            <select
              id={id}
              value={mode}
              onChange={(event) => {
                let next = draft;
                for (const key of [
                  'fixedLength',
                  'headerLength',
                  'lengthOffset',
                  'lengthType',
                  'lengthIncludesHeader',
                ])
                  next = removeJsonValue(next, ['framing', key]);
                if (event.target.value === 'fixed')
                  next = editJsonValue(next, ['framing', 'fixedLength'], 4);
                if (event.target.value === 'length') {
                  next = editJsonValue(next, ['framing', 'headerLength'], 4);
                  next = editJsonValue(next, ['framing', 'lengthOffset'], 2);
                  next = editJsonValue(next, ['framing', 'lengthType'], 'uint16be');
                }
                change(next);
              }}
            >
              <option value="whole">Весь непрерывный участок — одно сообщение</option>
              <option value="fixed">Фиксированный размер</option>
              <option value="length">Длина указана в заголовке</option>
            </select>
          )}
        </Field>
        <JsonControl
          path={['framing', 'magic']}
          label="Маркер начала HEX"
          optional
          hint="Например A5 или A6 5C. Пусто — маркер не используется."
        />
        {mode === 'fixed' && (
          <JsonControl
            path={['framing', 'fixedLength']}
            label="Размер сообщения, байт"
            kind="uint"
            minimum={1n}
            maximum={1048576n}
          />
        )}
        {mode === 'length' && (
          <>
            <JsonControl
              path={['framing', 'headerLength']}
              label="Размер заголовка, байт"
              kind="uint"
              minimum={1n}
              maximum={1048576n}
            />
            <JsonControl
              path={['framing', 'lengthOffset']}
              label="Позиция длины в заголовке"
              kind="uint"
              maximum={1048576n}
              hint="С 0. Поле длины должно целиком помещаться в заголовок."
            />
            <JsonChoice
              path={['framing', 'lengthType']}
              label="Как прочитать длину"
              options={['uint8', 'uint16be', 'uint16le', 'uint32be', 'uint32le'].map((value) => ({
                value,
                label: value,
              }))}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={framing?.lengthIncludesHeader === true}
                onChange={(event) =>
                  change(
                    editJsonValue(draft, ['framing', 'lengthIncludesHeader'], event.target.checked),
                  )
                }
              />
              Длина включает заголовок
            </label>
          </>
        )}
        <JsonChoice
          path={['direction']}
          label="Направление схемы"
          empty="Оба направления"
          options={[
            { value: 'A_TO_B', label: 'A → B' },
            { value: 'B_TO_A', label: 'B → A' },
          ]}
        />
        <JsonControl
          path={['messageLength']}
          label="Применять только к сообщениям длиной"
          kind="uint"
          optional
          maximum={1048576n}
          hint="Пусто — любой размер. Это фильтр применения полей и правил."
        />
        <h3>Признаки нужного типа сообщения</h3>
        <p className="muted">
          Поля и правила применяются только при совпадении всех признаков. Например код команды в
          байте 1.
        </p>
        {(Array.isArray(parsed?.match) ? parsed.match : []).map((_, index) => (
          <div className="schema-field" key={index}>
            <JsonControl
              path={['match', index, 'offset']}
              label={'Позиция признака ' + (index + 1)}
              kind="uint"
              maximum={1048576n}
            />
            <JsonControl
              path={['match', index, 'hex']}
              label={'HEX признака ' + (index + 1)}
              hint="Без пробелов, например A502."
            />
            <Button
              variant="ghost"
              onClick={() => change(removeJsonValue(draft, ['match', index]))}
            >
              Удалить признак {index + 1}
            </Button>
          </div>
        ))}
        <Button onClick={() => change(appendJsonValue(draft, ['match'], { offset: 0, hex: '00' }))}>
          Добавить признак сообщения
        </Button>
      </div>
    </details>
  );
}

export function RulesEditor({
  fields,
  checks,
}: {
  fields: Record<string, unknown>[];
  checks: Record<string, unknown>[];
}) {
  const { draft, change } = useContext(SchemaContext);
  return (
    <>
      <h2>Правила проверки</h2>
      <p>
        Проверяют прочитанные значения на всём выбранном корпусе. Совпадение правила само по себе не
        доказывает смысл поля.
      </p>
      {checks.map((check, index) => {
        const path = ['checks', index];
        const textValue = jsonToken(draft, [...path, 'value'])?.startsWith('"') ?? false;
        return (
          <details className="schema-field" key={index} open>
            <summary>
              Правило {index + 1} · {String(check.id ?? '')}
            </summary>
            <div className="schema-controls">
              <JsonControl path={[...path, 'id']} label={'Название правила ' + (index + 1)} />
              <JsonChoice
                path={[...path, 'field']}
                label={'Проверяемое поле ' + (index + 1)}
                options={fields.map((field) => ({
                  value: String(field.name ?? ''),
                  label: String(field.name ?? ''),
                }))}
              />
              <Field label={'Условие правила ' + (index + 1)}>
                {(id) => (
                  <select
                    id={id}
                    value={String(check.op ?? '')}
                    onChange={(event) => {
                      let next = editJsonValue(draft, [...path, 'op'], event.target.value);
                      if (
                        ['eq', 'length'].includes(event.target.value) &&
                        check.value === undefined
                      )
                        next = editJsonValue(next, [...path, 'value'], 0);
                      change(next);
                    }}
                  >
                    {!['eq', 'range', 'length', 'action'].includes(String(check.op)) && (
                      <option value={String(check.op ?? '')}>
                        {String(check.op ?? 'Выбери условие')} · из JSON
                      </option>
                    )}
                    <option value="eq">Равно значению</option>
                    <option value="range">В пределах диапазона</option>
                    <option value="length">Длина равна значению</option>
                    <option value="action">Совпадает с параметром журнала</option>
                  </select>
                )}
              </Field>
              {['eq', 'length'].includes(String(check.op)) && (
                <>
                  <Field label={'Вид ожидаемого значения ' + (index + 1)}>
                    {(id) => (
                      <select
                        id={id}
                        value={textValue ? 'text' : 'number'}
                        onChange={(event) =>
                          change(
                            editJsonValue(
                              draft,
                              [...path, 'value'],
                              event.target.value === 'text' ? '' : 0,
                            ),
                          )
                        }
                      >
                        <option value="number">Число</option>
                        <option value="text">Текст</option>
                      </select>
                    )}
                  </Field>
                  <JsonControl
                    path={[...path, 'value']}
                    label={'Ожидаемое значение ' + (index + 1)}
                    kind={textValue ? 'string' : 'json'}
                    hint="Числа сохраняются с исходной точностью. Для сложного JSON используй редактор слева."
                  />
                </>
              )}
              {check.op === 'range' && (
                <>
                  <JsonControl
                    path={[...path, 'min']}
                    label={'Минимум правила ' + (index + 1)}
                    kind="number"
                    optional
                  />
                  <JsonControl
                    path={[...path, 'max']}
                    label={'Максимум правила ' + (index + 1)}
                    kind="number"
                    optional
                  />
                </>
              )}
              {check.op === 'action' && (
                <>
                  <JsonControl
                    path={[...path, 'parameter']}
                    label={'Параметр журнала ' + (index + 1)}
                    hint="Путь из журнала, например params.threshold_c. Значения связываются по записи и времени."
                  />
                  <JsonControl
                    path={[...path, 'tolerance']}
                    label={'Допустимое отклонение ' + (index + 1)}
                    kind="number"
                    optional
                    hint="Пусто — точное совпадение; число от 0."
                  />
                </>
              )}
              <Button variant="ghost" onClick={() => change(removeJsonValue(draft, path))}>
                Удалить правило {index + 1}
              </Button>
            </div>
          </details>
        );
      })}
      <Button
        disabled={!fields.length}
        onClick={() => {
          let index = checks.length + 1;
          while (checks.some((check) => check.id === 'check_' + index)) index++;
          change(
            appendJsonValue(draft, ['checks'], {
              id: 'check_' + index,
              field: fields[0]!.name,
              op: 'eq',
              value: 0,
            }),
          );
        }}
      >
        Добавить правило
      </Button>
    </>
  );
}
