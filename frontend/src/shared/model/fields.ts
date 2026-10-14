import type { FieldResult } from '../api/contracts/draft';

export type FieldPair = { left?: FieldResult; right?: FieldResult; relativeStart: string };

/** Compare occurrences of a schema field relative to each selected example. */
export function pairFields(
  left: FieldResult[],
  right: FieldResult[],
  leftStart: string,
  rightStart: string,
): FieldPair[] {
  const key = (field: FieldResult, start: string) =>
    JSON.stringify([
      field.fieldId,
      field.type,
      field.location.length,
      String(BigInt(field.location.start) - BigInt(start)),
    ]);
  const remaining = new Map<string, FieldResult[]>();
  for (const field of right) {
    const id = key(field, rightStart);
    const occurrences = remaining.get(id) ?? [];
    occurrences.push(field);
    remaining.set(id, occurrences);
  }
  const pairs: FieldPair[] = left.map((field) => ({
    left: field,
    right: remaining.get(key(field, leftStart))?.shift(),
    relativeStart: String(BigInt(field.location.start) - BigInt(leftStart)),
  }));
  for (const occurrences of remaining.values())
    for (const field of occurrences)
      pairs.push({
        right: field,
        relativeStart: String(BigInt(field.location.start) - BigInt(rightStart)),
      });
  return pairs;
}
