import { it, expect } from 'vitest';
import { editJsonValue, formatJsonText } from './json-text';

const exact =
  '{ "endian": "little", "extension": 9007199254740993, "fraction": 0.123456789012345678901, "huge": 1e400 }';

it('правка известного свойства не меняет числа неизвестных расширений', () => {
  expect(editJsonValue(exact, ['endian'], 'big')).toBe(exact.replace('"little"', '"big"'));
});
it('правка вложенного свойства не пересериализует его соседей', () => {
  const text = '{"framing":{"kind":"fixed","length":4,"extra":9007199254740993}}';
  expect(editJsonValue(text, ['framing', 'length'], 8)).toBe(
    text.replace('"length":4', '"length":8'),
  );
});
it('правка элемента массива сохраняет остальные числа и поля', () => {
  const text = '{"fields":[{"name":"x","unknown":9007199254740993},{"name":"y"}]}';
  expect(editJsonValue(text, ['fields', 0, 'name'], 'renamed')).toBe(
    text.replace('"x"', '"renamed"'),
  );
});
it('добавление отсутствующего scope сохраняет существующее представление', () => {
  const result = editJsonValue(exact, ['scope', 'direction'], 'A_TO_B');
  expect(result).toContain('9007199254740993');
  expect(JSON.parse(result).scope.direction).toBe('A_TO_B');
});
it('экранированные и дублирующиеся имена следуют последнему JSON-свойству', () => {
  const text = '{"endian":"first","\\u0065ndian":"little","unknown":9007199254740993}';
  const result = editJsonValue(text, ['endian'], 'big');
  expect(result).toBe(text.replace('"little"', '"big"'));
  expect(JSON.parse(result).endian).toBe('big');
});
it('форматирование сохраняет все числовые лексемы, включая Infinity при native parse', () => {
  const result = formatJsonText(exact);
  for (const number of ['9007199254740993', '0.123456789012345678901', '1e400'])
    expect(result).toContain(number);
  expect(result).not.toContain('null');
});
it('форматирование не меняет строки, escapes и пустые контейнеры', () => {
  const escape = String.fromCharCode(92);
  const value = '"' + escape + 'u0041, [ ], ' + escape + '""';
  const text = '{"x":' + value + ', "empty": [], "object": {}}';
  const result = formatJsonText(text);
  expect(result).toContain(value);
  expect(JSON.parse(result)).toEqual(JSON.parse(text));
});
it('некорректный JSON отклоняется до изменения текста', () => {
  expect(() => editJsonValue('{', ['endian'], 'big')).toThrow();
  expect(() => formatJsonText('{')).toThrow();
});
