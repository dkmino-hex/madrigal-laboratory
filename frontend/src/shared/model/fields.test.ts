import { it, expect } from 'vitest';
import { pairFields } from './fields';
import { resultsFor, projectId } from '../../mocks/fixtures/corpus';
import { decimal } from './precision';

const fields = () => resultsFor(projectId).flatMap((result) => result.fields);

it('сравнивает каждое вхождение поля вместо последнего с первым', () => {
  const input = fields();
  const pairs = pairFields(input, input, '1000', '1000');
  expect(pairs).toHaveLength(input.length);
  expect(pairs.map((pair) => [pair.left?.value, pair.right?.value])).toEqual([
    ['21', '21'],
    ['42', '42'],
  ]);
});
it('сохраняет поля только справа и не сопоставляет другой тип или длину', () => {
  const first = fields()[0]!;
  const other = { ...first, type: 'uint16' };
  const pairs = pairFields([first], [other], '1000', '1000');
  expect(pairs).toHaveLength(2);
  expect(pairs[0]!.right).toBeUndefined();
  expect(pairs[1]!.right).toEqual(other);
});
it('сопоставляет независимые большие координаты без Number', () => {
  const first = fields()[0]!;
  const huge = { ...first, location: { ...first.location, start: decimal('9007199254740993') } };
  expect(pairFields([first], [huge], first.location.start, '9007199254740993')[0]!.right).toEqual(
    huge,
  );
});
