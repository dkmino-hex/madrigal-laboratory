import { it, expect } from 'vitest';
import { candidateValue } from './research';

it('показывает знаковый масштаб и uint64 точно и оставляет короткий пример неизвестным', () => {
  expect(
    candidateValue([0xfd, 0xda], { offset: 0, length: 2, encoding: 'int16be', divisor: 100 }),
  ).toBe('-5.5');
  expect(
    candidateValue([255, 255, 255, 255, 255, 255, 255, 255], {
      offset: 0,
      length: 8,
      encoding: 'uint64be',
      divisor: 1,
    }),
  ).toBe('18446744073709551615');
  expect(
    candidateValue([1], { offset: 0, length: 2, encoding: 'uint16be', divisor: 1 }),
  ).toBeNull();
});
