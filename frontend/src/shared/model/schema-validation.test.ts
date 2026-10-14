import { expect, it } from 'vitest';
import { schemaProblems } from './schema-validation';
import { schemaText } from '../../mocks/fixtures/corpus';

it('проверяет согласованную схему и не ограничивает неизвестные расширения', () => {
  expect(schemaProblems(JSON.parse(schemaText))).toEqual({});
  expect(schemaProblems({ format: 'other', extension: { count: '9007199254740993' } })).toEqual({});
});
it.each([null, [], 12, 'schema'])('не принимает не объект %j', (value) => {
  expect(schemaProblems(value).schema).toContain('объектом JSON');
});
it.each(['', 0, 1.5, 4097, '1e3'])('проверяет размер сообщения %j', (length) => {
  const schema = JSON.parse(schemaText);
  schema.framing.length = length;
  expect(schemaProblems(schema)['framing.length']).toBeTruthy();
});
it('обнаруживает выход поля за сообщение, пустое имя и несуществующее поле правила', () => {
  const schema = JSON.parse(schemaText);
  schema.fields[0].offset = '1';
  schema.fields[0].name = '   ';
  schema.rules[0].field = 'missing';
  expect(schemaProblems(schema)).toMatchObject({
    'fields.0.offset': expect.stringContaining('4 байта'),
    'fields.0.name': expect.stringContaining('Введите имя'),
    'rules.0.field': expect.stringContaining('существующего'),
  });
});
it('проверяет дубликаты полей и границу uint32', () => {
  const schema = JSON.parse(schemaText);
  schema.fields.push({ ...schema.fields[0] });
  schema.rules[0].maximum = '4294967296';
  expect(schemaProblems(schema)['fields.1.id']).toContain('уникальные');
  expect(schemaProblems(schema)['rules.0.maximum']).toContain('4294967295');
});
