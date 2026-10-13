import { integerInput, textError } from './validation';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;

/** Validate the recognised basic format; preserve arbitrary extension JSON verbatim. */
export function schemaProblems(value: unknown): Record<string, string> {
  const schema = object(value);
  if (!schema) return { schema: 'Схема должна быть объектом JSON, например { ... }.' };
  if (schema.format !== 'madrigal-demo-v1') return {};
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
