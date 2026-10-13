import { expect, it } from 'vitest';
import {
  fileError,
  integerInput,
  rangeInput,
  textError,
  timeOffsetInput,
  timeZoneError,
  timeZones,
  timeRangeInput,
} from './validation';

it.each(['', ' ', '-1', '1.5', '1e3', 'NaN', 'Infinity', '0x20', '12 34', '１２', '1\n2'])(
  'отклоняет неверную координату %j',
  (value) => {
    expect(integerInput(value).error).toMatch(/Введите целое/);
  },
);
it('нормализует пробелы и ведущие нули без потери точности', () => {
  expect(integerInput(' 0009007199254740993 ').value).toBe('9007199254740993');
  expect(integerInput('+00042', { signed: true }).value).toBe('42');
  expect(integerInput('-0', { signed: true }).value).toBe('0');
  expect(integerInput('9'.repeat(129)).error).toContain('слишком длинное');
});
it('различает формат, пустой диапазон, начало вне потока и превышение длины', () => {
  expect(rangeInput('1000', '0', '1004').lengthError).toContain('больше нуля');
  expect(rangeInput('1004', '1', '1004').startError).toContain('Начало');
  expect(rangeInput('1000', '5', '1004').lengthError).toContain('4 байт');
  expect(rangeInput('0001000', '04', '1004')).toMatchObject({
    start: '1000',
    length: '4',
    valid: true,
  });
  expect(rangeInput('9007199254740993', '4', '9007199254740997').valid).toBe(true);
  expect(rangeInput('1004', '0', '1004', true).valid).toBe(true);
});
it('проверяет обязательный текст, длину и управляющие символы', () => {
  expect(textError('  \n', 'название', 120)).toBe('Введите название.');
  expect(textError('\u200b\u200c\u200d', 'название', 120)).toBe('Введите название.');
  expect(textError('a'.repeat(121), 'название', 120)).toContain('120');
  expect(textError('Название\u0000', 'название', 120)).toContain('управляющие');
  expect(textError('', 'основание', 4000, false)).toBeUndefined();
  expect(textError('Основание\nСледующая строка', 'основание', 4000)).toBeUndefined();
  expect(textError('نام\u200cنامه', 'название', 120)).toBeUndefined();
});
it('проверяет часовые пояса и точную поправку времени', () => {
  expect(timeZoneError('')).toContain('Выберите');
  expect(timeZoneError('Somewhere/Unknown')).toContain('списка');
  expect(timeZoneError('Europe/Moscow')).toBeUndefined();
  expect(timeOffsetInput('-9007199254740993').value).toBe('-9007199254740993');
  expect(timeOffsetInput('1.5').error).toContain('Введите целое число');
  expect(timeOffsetInput('9'.repeat(30)).error).toContain('диапазон дат');
  expect(timeZones('US/Eastern')).toEqual(
    expect.arrayContaining(['UTC', 'Europe/Moscow', 'US/Eastern']),
  );
});
it('проверяет расширение и пустоту файла до передачи', () => {
  expect(fileError(new File(['a'], 'CAPTURE.PCAP'), ['.pcap', '.pcapng'])).toBeUndefined();
  expect(fileError(new File([], 'empty.csv'), ['.csv'])).toContain('пуст');
  expect(fileError(new File(['a'], 'bad.txt'), ['.csv'])).toContain('.csv');
});
it('указывает ошибочное поле времени и сравнивает наносекунды с разными поясами', () => {
  expect(timeRangeInput('', '').valid).toBe(true);
  expect(timeRangeInput('2026-02-30T00:00:00Z', '2026-10-11T12:00:00Z')).toMatchObject({
    fromError: expect.any(String),
    toError: undefined,
  });
  expect(timeRangeInput('2026-10-11T15:00:00.000000001+03:00', '2026-10-11T12:00:00Z').valid).toBe(
    false,
  );
  expect(timeRangeInput('2026-10-11T15:00:00+03:00', '2026-10-11T12:00:00Z').valid).toBe(true);
});
