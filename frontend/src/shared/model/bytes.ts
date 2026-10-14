import type { ByteWindow, Location, Segment } from '../api/contracts/draft';
import { boundedIndex, decimal, intersect } from './precision';

export type Cell =
  | { kind: 'known'; value: number }
  | { kind: 'gap' | 'truncation' | 'conflict' | 'unloaded'; reason: string };
export const segmentLength = (segment: Segment) =>
  segment.kind === 'known' ? BigInt(segment.bytes.length) : BigInt(segment.length);
export function cellAt(window: ByteWindow, offset: string): Cell {
  const position = BigInt(offset);
  for (const segment of window.segments) {
    const relative = position - BigInt(segment.start);
    if (relative < 0n || relative >= segmentLength(segment)) continue;
    if (segment.kind === 'known')
      return { kind: 'known', value: segment.bytes[boundedIndex(relative, 4095)]! };
    if (segment.kind === 'conflict')
      return { kind: 'conflict', reason: 'Конфликт: альтернативы не выбраны' };
    return { kind: segment.kind, reason: segment.reason };
  }
  return { kind: 'unloaded', reason: 'Данные ещё не загружены' };
}
export const byteHex = (cell: Cell) =>
  cell.kind === 'known'
    ? cell.value.toString(16).padStart(2, '0').toUpperCase()
    : cell.kind === 'conflict'
      ? '≠?'
      : cell.kind === 'unloaded'
        ? '··'
        : '??';
export const byteAscii = (cell: Cell) =>
  cell.kind === 'known'
    ? cell.value >= 32 && cell.value <= 126
      ? String.fromCharCode(cell.value)
      : '·'
    : '?';
export function copyKnown(window: ByteWindow, selection: Location, mode: 'hex' | 'ascii') {
  const overlap = intersect(window.location, selection);
  if (
    !overlap ||
    overlap.start !== selection.start ||
    overlap.length !== selection.length ||
    BigInt(selection.length) > 4096n
  ) {
    throw new Error(
      'Копирование ограничено загруженным окном: максимум 4096 байтов. Перейдите к началу выделения.',
    );
  }
  const cells = Array.from({ length: boundedIndex(BigInt(selection.length), 4096) }, (_, index) =>
    cellAt(window, decimal(BigInt(selection.start) + BigInt(index))),
  );
  if (cells.some((cell) => cell.kind !== 'known'))
    throw new Error(
      'Выделение содержит неизвестные, конфликтные или незагруженные байты. Точная копия недоступна.',
    );
  return cells.map(mode === 'hex' ? byteHex : byteAscii).join(mode === 'hex' ? ' ' : '');
}
export function compareCells(
  left: Cell,
  right: Cell | null,
): 'equal' | 'different' | 'unknown' | 'tail' {
  if (right === null) return 'tail';
  if (left.kind !== 'known' || right.kind !== 'known') return 'unknown';
  return left.value === right.value ? 'equal' : 'different';
}
export function validateSearch(mode: 'HEX' | 'ASCII', input: string) {
  if (!input.trim()) return 'Введите образец';
  if (mode === 'HEX') {
    const compact = input.replace(/\s/g, '');
    if (!/^[0-9a-fA-F]+$/.test(compact)) return 'HEX содержит недопустимые символы';
    if (compact.length % 2) return 'HEX должен содержать чётное число полубайтов';
    if (compact.length > 512) return 'Максимум 256 байтов';
  } else if (!/^[\x20-\x7e]+$/.test(input) || input.length > 256) {
    return 'Доступен печатный ASCII (32–126), максимум 256 символов';
  }
  return null;
}
