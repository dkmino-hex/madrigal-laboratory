import { z } from 'zod';

export const decimalSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, 'Нужно целое неотрицательное число')
  .brand<'Decimal'>();
export type Decimal = z.infer<typeof decimalSchema>;
export const decimal = (value: string | bigint): Decimal => decimalSchema.parse(String(value));
export const add = (a: string, b: string) => decimal(BigInt(a) + BigInt(b));
export const subtract = (a: string, b: string) => decimal(BigInt(a) - BigInt(b));
export const compareDecimal = (a: string, b: string) =>
  BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
export const formatInteger = (value: string) =>
  decimal(value).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
export const hexOffset = (value: string) =>
  '0x' + BigInt(decimal(value)).toString(16).toUpperCase().padStart(8, '0');
export const rangeEnd = (start: string, length: string) => add(start, length);
export const boundedIndex = (value: bigint, maximum: number): number => {
  if (value < 0n || value > BigInt(maximum)) throw new RangeError('Индекс вне локального окна');
  return Number(value);
};
export const intersect = (
  a: { start: string; length: string },
  b: { start: string; length: string },
) => {
  const start = BigInt(a.start) > BigInt(b.start) ? BigInt(a.start) : BigInt(b.start);
  const aEnd = BigInt(a.start) + BigInt(a.length);
  const bEnd = BigInt(b.start) + BigInt(b.length);
  const end = aEnd < bEnd ? aEnd : bEnd;
  return end > start ? { start: decimal(start), length: decimal(end - start) } : null;
};
const timestampPattern = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/;
export const timestampSchema = z
  .string()
  .regex(timestampPattern)
  .refine((value) => {
    const match = timestampPattern.exec(value);
    if (!match || Number.isNaN(Date.parse(value))) return false;
    const calendar = match[1] + 'T' + match[2];
    const ms = Date.parse(calendar + 'Z');
    return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 19) === calendar;
  }, 'Некорректная дата');
export function formatTimestamp(value: string) {
  const match = timestampPattern.exec(timestampSchema.parse(value));
  return match
    ? match[1] +
        ' ' +
        match[2] +
        (match[3] ? '.' + match[3] : '') +
        ' ' +
        (match[4] === 'Z' ? 'UTC' : 'UTC' + match[4])
    : value;
}
export function shiftTimestamp(value: string, offsetNanoseconds: string): string {
  if (!/^-?\d+$/.test(offsetNanoseconds)) throw new Error('Некорректная поправка времени');
  const match = timestampPattern.exec(timestampSchema.parse(value));
  if (!match) throw new Error('Некорректное время');
  const ns = timestampNanoseconds(value) + BigInt(offsetNanoseconds);
  let seconds = ns / 1000000000n;
  let fraction = ns % 1000000000n;
  if (fraction < 0n) {
    seconds--;
    fraction += 1000000000n;
  }
  const date = new Date(Number(seconds * 1000n));
  if (Number.isNaN(date.getTime()))
    throw new Error('Скорректированное время вне календарного диапазона');
  const iso = date.toISOString();
  if (!/^\d{4}-/.test(iso))
    throw new Error('Скорректированное время вне календарного диапазона 0000–9999');
  return iso.slice(0, 19) + '.' + fraction.toString().padStart(9, '0') + 'Z';
}
export function formatShiftedTimestamp(value: string, offsetNanoseconds: string) {
  try {
    return formatTimestamp(shiftTimestamp(value, offsetNanoseconds));
  } catch {
    return 'Скорректированное время недоступно: проверьте дату и поправку.';
  }
}
export function timestampNanoseconds(value: string) {
  const match = timestampPattern.exec(timestampSchema.parse(value))!;
  return (
    BigInt(Date.parse(match[1] + 'T' + match[2] + match[4])) * 1000000n +
    BigInt((match[3] ?? '').padEnd(9, '0'))
  );
}
