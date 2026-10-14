import { describe, it, expect } from 'vitest';
import {
  fixtureWindow,
  goldenLocation,
  goldenSources,
  fixturePacket,
} from '../../mocks/fixtures/corpus';
import { decimal } from './precision';
import { byteHex, byteAscii, cellAt, copyKnown, compareCells, validateSearch } from './bytes';
describe('Байты, дефекты и golden происхождение', () => {
  const window = fixtureWindow(
    { ...goldenLocation, start: decimal('0'), length: decimal('4096') },
    '65536',
  );
  it('реальный нулевой байт известен и не смешивается с отсутствием', () => {
    expect(cellAt(window, '1001')).toEqual({ kind: 'known', value: 0 });
    expect(byteHex(cellAt(window, '1001'))).toBe('00');
    expect(byteAscii(cellAt(window, '1001'))).toBe('·');
  });
  it.each([
    ['64', 'gap'],
    ['96', 'conflict'],
    ['120', 'truncation'],
  ])('различает дефект %s (%s)', (offset, kind) => {
    expect(cellAt(window, offset!).kind).toBe(kind);
    expect(byteHex(cellAt(window, offset!))).not.toBe('00');
  });
  it('соседи пропуска остаются известными', () => {
    expect(cellAt(window, '63').kind).toBe('known');
    expect(cellAt(window, '72').kind).toBe('known');
  });
  it('незагруженная координата отличается от пропуска', () =>
    expect(cellAt(window, '5000').kind).toBe('unloaded'));
  it('копирует ровно четыре известных байта', () =>
    expect(copyKnown(window, goldenLocation, 'hex')).toBe('15 00 00 00'));
  it.each(['64', '96', '120'])('отвергает точную копию неизвестного диапазона %s', (start) =>
    expect(() =>
      copyKnown(window, { ...goldenLocation, start: decimal(start), length: decimal('4') }, 'hex'),
    ).toThrow(),
  );
  it('не копирует частично загруженный диапазон', () =>
    expect(() =>
      copyKnown(window, { ...goldenLocation, start: decimal('4094'), length: decimal('6') }, 'hex'),
    ).toThrow());
  it('golden: кадры 7/8/9 совпадают побайтно, логическая длина 4, источники суммарно 6', () => {
    const logical = fixtureWindow(goldenLocation, '65536');
    for (const source of goldenSources) {
      const packet = fixturePacket(source.captureId, source.packetNo);
      for (let index = 0; index < Number(BigInt(source.length)); index++) {
        const cell = cellAt(logical, decimal(BigInt(source.streamStart) + BigInt(index)));
        expect(cell).toEqual({
          kind: 'known',
          value: packet.bytes[Number(BigInt(source.frameOffset)) + index],
        });
      }
    }
    expect(goldenLocation.length).toBe('4');
    expect(goldenSources.reduce((sum, item) => sum + BigInt(item.length), 0n)).toBe(6n);
  });
  it('частичное окно конфликта сохраняет правильные альтернативные байты', () => {
    const part = fixtureWindow(
      { ...goldenLocation, start: decimal('98'), length: decimal('2') },
      '65536',
    );
    expect(part.segments[0]).toMatchObject({
      kind: 'conflict',
      start: '98',
      length: '2',
      alternatives: [{ bytes: [0x12, 0x13] }, { bytes: [0x22, 0x23] }],
    });
  });
  it('различает неодинаковость, недостаток данных и хвост', () => {
    expect(compareCells({ kind: 'known', value: 0 }, { kind: 'known', value: 1 })).toBe(
      'different',
    );
    expect(compareCells({ kind: 'gap', reason: 'gap' }, { kind: 'known', value: 0 })).toBe(
      'unknown',
    );
    expect(compareCells({ kind: 'known', value: 0 }, null)).toBe('tail');
  });
  it.each([
    ['HEX', '1'],
    ['HEX', 'GG'],
    ['ASCII', 'текст'],
    ['ASCII', '\n'],
  ])('валидация %s образца %s', (mode, input) =>
    expect(validateSearch(mode as 'HEX' | 'ASCII', input!)).not.toBeNull(),
  );
  it('допускает известный HEX и печатный ASCII', () => {
    expect(validateSearch('HEX', '15 00')).toBeNull();
    expect(validateSearch('ASCII', 'SET 21')).toBeNull();
  });
});
