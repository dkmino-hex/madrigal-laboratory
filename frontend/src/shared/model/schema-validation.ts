import { integerInput, textError } from './validation';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;

/** Validate known schema controls; the server remains authoritative for extensions. */
export function schemaProblems(value: unknown): Record<string, string> {
  const schema = object(value);
  if (!schema) return { schema: 'Схема должна быть объектом JSON, например { ... }.' };
  if (schema.format !== 'madrigal-demo-v1') return schema.format ? {} : nativeProblems(schema);
  const problems: Record<string, string> = {};
  const framing = object(schema.framing);
  const frame = integerInput(String(framing?.length ?? ''), { positive: true, maximum: 4096n });
  if (framing?.kind !== 'fixed')
    problems['framing.kind'] = 'Выберите фиксированный размер сообщения.';
  if (frame.error || typeof framing?.length !== 'number')
    problems['framing.length'] = frame.error ?? 'Размер сообщения должен быть целым числом в JSON.';
  if (!['little', 'big'].includes(String(schema.endian)))
    problems.endian = 'Выберите порядок байтов.';
  if (!['A_TO_B', 'B_TO_A'].includes(String(object(schema.scope)?.direction)))
    problems['scope.direction'] = 'Выберите направление A → B или B → A.';
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  if (!fields.length) problems.fields = 'Добавьте хотя бы одно поле.';
  const names = new Set<string>();
  const ids = new Set<string>();
  fields.forEach((value, index) => {
    const field = object(value);
    const prefix = 'fields.' + index + '.';
    for (const [key, seen, label] of [
      ['id', ids, 'идентификатор поля'],
      ['name', names, 'имя поля'],
    ] as const) {
      const text = typeof field?.[key] === 'string' ? (field[key] as string) : '';
      const problem = textError(text, label, 120);
      if (problem) problems[prefix + key] = problem;
      else if (seen.has(text.trim()))
        problems[prefix + key] = 'У каждого поля должны быть уникальные имя и идентификатор.';
      seen.add(text.trim());
    }
    if (field?.type !== 'uint32') problems[prefix + 'type'] = 'Для этой формы доступен тип uint32.';
    const offset = integerInput(String(field?.offset ?? ''));
    if (offset.error || typeof field?.offset !== 'string')
      problems[prefix + 'offset'] =
        offset.error ?? 'Смещение должно быть десятичной строкой в JSON.';
    else if (frame.value !== undefined && BigInt(offset.value!) + 4n > BigInt(frame.value))
      problems[prefix + 'offset'] =
        'Поле uint32 занимает 4 байта и должно целиком помещаться в сообщении.';
  });
  if (!Array.isArray(schema.rules))
    problems.rules = 'Правила должны быть массивом JSON; без правил укажите [].';
  if (Array.isArray(schema.rules))
    schema.rules.forEach((value, index) => {
      const rule = object(value);
      const prefix = 'rules.' + index + '.';
      if (typeof rule?.field !== 'string' || !names.has(rule.field))
        problems[prefix + 'field'] = 'Выберите имя существующего поля.';
      const maximum = integerInput(String(rule?.maximum ?? ''), { maximum: 4294967295n });
      if (maximum.error || typeof rule?.maximum !== 'string')
        problems[prefix + 'maximum'] =
          maximum.error ?? 'Максимум должен быть десятичной строкой в JSON.';
    });
  return problems;
}

function nativeProblems(schema: JsonObject): Record<string, string> {
  const problems: Record<string, string> = {};
  const uint = (value: unknown, key: string, positive = false) => {
    if (
      value !== undefined &&
      (typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < (positive ? 1 : 0) ||
        value > 1048576)
    )
      problems[key] = 'Введите целое число от ' + (positive ? '1' : '0') + ' до 1048576.';
  };
  const hex = (value: unknown, key: string, spaces: boolean) => {
    if (
      value !== undefined &&
      (typeof value !== 'string' ||
        !/^(?:[0-9a-f]{2})+$/i.test(spaces ? value.replaceAll(' ', '') : value))
    )
      problems[key] = 'HEX должен содержать полные байты, например A502.';
  };
  const framing = object(schema.framing);
  uint(framing?.fixedLength, 'framing.fixedLength');
  uint(framing?.headerLength, 'framing.headerLength');
  uint(framing?.lengthOffset, 'framing.lengthOffset');
  hex(framing?.magic, 'framing.magic', true);
  if (framing?.lengthType) {
    const sizes: Record<string, number> = {
      uint8: 1,
      uint16le: 2,
      uint16be: 2,
      uint32le: 4,
      uint32be: 4,
    };
    const size = sizes[String(framing.lengthType)];
    if (!size) problems['framing.lengthType'] = 'Выберите поддерживаемый тип длины.';
    if (
      !Number(framing.headerLength) ||
      Number(framing.lengthOffset ?? 0) + (size ?? 0) > Number(framing.headerLength)
    )
      problems['framing.headerLength'] = 'Поле длины должно помещаться в непустой заголовок.';
  }
  if (
    schema.direction !== undefined &&
    !['', 'A_TO_B', 'B_TO_A'].includes(String(schema.direction))
  )
    problems.direction = 'Выберите направление A → B или B → A.';
  uint(schema.messageLength, 'messageLength');
  if (!Array.isArray(schema.fields))
    problems.fields = 'Поля должны быть массивом JSON; без полей укажите [].';
  const names = new Set<string>();
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  fields.forEach((value, index) => {
    const field = object(value),
      key = 'fields.' + index + '.';
    if (!field || typeof field.name !== 'string' || !field.name.trim() || names.has(field.name))
      problems[key + 'name'] = 'Введите непустое уникальное имя поля.';
    if (field?.lengthFrom && !names.has(String(field.lengthFrom)))
      problems[key + 'lengthFrom'] = 'Длина может ссылаться только на предыдущее поле.';
    uint(field?.offset, key + 'offset');
    uint(field?.length, key + 'length');
    if (typeof field?.type !== 'string' || !field.type)
      problems[key + 'type'] = 'Задайте тип поля.';
    if (field?.scale !== undefined && typeof field.scale !== 'number')
      problems[key + 'scale'] = 'Масштаб должен быть числом JSON.';
    if (typeof field?.name === 'string') names.add(field.name);
  });
  const ids = new Set<string>();
  if (schema.checks !== undefined && !Array.isArray(schema.checks))
    problems.checks = 'Правила должны быть массивом JSON.';
  (Array.isArray(schema.checks) ? schema.checks : []).forEach((value, index) => {
    const check = object(value),
      key = 'checks.' + index + '.';
    if (!check || typeof check.id !== 'string' || !check.id.trim() || ids.has(check.id))
      problems[key + 'id'] = 'Введите непустое уникальное имя правила.';
    if (!names.has(String(check?.field))) problems[key + 'field'] = 'Выберите существующее поле.';
    if (!['eq', 'range', 'length', 'action'].includes(String(check?.op)))
      problems[key + 'op'] = 'Выберите поддерживаемое условие.';
    if (['eq', 'length'].includes(String(check?.op)) && check?.value === undefined)
      problems[key + 'value'] = 'Задайте ожидаемое значение.';
    for (const name of ['min', 'max', 'tolerance'])
      if (check?.[name] !== undefined && typeof check[name] !== 'number')
        problems[key + name] = 'Введите число JSON.';
    if (typeof check?.tolerance === 'number' && check.tolerance < 0)
      problems[key + 'tolerance'] = 'Отклонение должно быть от 0.';
    if (check?.op === 'action' && (typeof check.parameter !== 'string' || !check.parameter.trim()))
      problems[key + 'parameter'] = 'Задайте путь параметра журнала.';
    if (typeof check?.id === 'string') ids.add(check.id);
  });
  (Array.isArray(schema.match) ? schema.match : []).forEach((value, index) => {
    const item = object(value);
    uint(item?.offset, 'match.' + index + '.offset');
    hex(item?.hex ?? '', 'match.' + index + '.hex', false);
  });
  return problems;
}
