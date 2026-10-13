import { describe, it, expect } from 'vitest';
import {
  add,
  subtract,
  decimal,
  compareDecimal,
  formatInteger,
  hexOffset,
  intersect,
  formatTimestamp,
  formatShiftedTimestamp,
  shiftTimestamp,
  boundedIndex,
  timestampNanoseconds,
  timestampSchema,
} from './precision';
describe('Точные координаты и время', () => {
  const values = ['9007199254740991', '9007199254740992', '9007199254740993'];
  it.each(values)('сохраняет %s в формате, арифметике и JSON', (value) => {
    expect(decimal(value)).toBe(value);
    expect(formatInteger(value).replace(/\u202f/g, '')).toBe(value);
    expect(subtract(add(value, '1'), '1')).toBe(value);
    expect(JSON.parse(JSON.stringify({ value })).value).toBe(value);
    expect(BigInt(hexOffset(value))).toBe(BigInt(value));
  });
  it('сортирует соседние значения выше 2^53 без слияния', () =>
    expect([...values].reverse().sort(compareDecimal)).toEqual(values));
  it.each(['-1', '1.1', '1e20', '00', 'NaN', ' 1'])(
    'отвергает неверную десятичную строку %s',
    (value) => expect(() => decimal(value)).toThrow(),
  );
  it('использует полуоткрытые границы и не включает соприкосновение', () => {
    expect(
      intersect({ start: values[0]!, length: '4' }, { start: values[1]!, length: '4' }),
    ).toEqual({ start: values[1], length: '3' });
    expect(intersect({ start: '10', length: '4' }, { start: '14', length: '2' })).toBeNull();
  });
  it('допускает number только для ограниченного локального индекса', () => {
    expect(boundedIndex(255n, 255)).toBe(255);
    expect(() => boundedIndex(256n, 255)).toThrow();
    expect(() => boundedIndex(9007199254740993n, 4096)).toThrow();
  });
  it('сохраняет различие в одну наносекунду и timezone', () => {
    const a = '2026-10-11T12:34:56.123456789Z';
    const b = '2026-10-11T12:34:56.123456790Z';
    expect(formatTimestamp(a)).not.toBe(formatTimestamp(b));
    expect(timestampNanoseconds(b) - timestampNanoseconds(a)).toBe(1n);
    expect(formatTimestamp('2026-10-11T15:34:56.123456789+03:00')).toContain('UTC+03:00');
  });
  it('корректирует время отдельно от исходного и сохраняет дробь', () =>
    expect(shiftTimestamp('2026-10-11T15:34:56.123456789+03:00', '-1')).toBe(
      '2026-10-11T12:34:56.123456788Z',
    ));
  it('корректно переносит отрицательную наносекунду через эпоху', () =>
    expect(shiftTimestamp('1970-01-01T00:00:00Z', '-1')).toBe('1969-12-31T23:59:59.999999999Z'));
  it.each(['2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-10-11T24:00:00Z'])(
    'не нормализует неверную дату %s',
    (date) => expect(timestampSchema.safeParse(date).success).toBe(false),
  );
  it('принимает календарно корректный високосный день', () =>
    expect(timestampSchema.safeParse('2024-02-29T15:34:56.123456789+03:00').success).toBe(true));
  it('не обрезает расширенный год и не роняет журнал при слишком большой поправке', () => {
    expect(() => shiftTimestamp('9999-12-31T23:59:59Z', '1000000000')).toThrow(
      /календарного диапазона/,
    );
    expect(formatShiftedTimestamp('2026-10-11T12:00:00Z', '9'.repeat(30))).toContain(
      'проверьте дату и поправку',
    );
    expect(formatShiftedTimestamp('2026-10-11T12:00:00.000000001Z', '-1')).toBe(
      '2026-10-11 12:00:00.000000000 UTC',
    );
  });
});
