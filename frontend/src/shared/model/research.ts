import type { ResearchCandidate, ResearchRow } from '../api/contracts/research';

export function researchBytes(row: ResearchRow): number[] {
  return Array.from(atob(row.bytes), (char) => char.charCodeAt(0));
}
export function candidateValue(
  bytes: number[],
  candidate: Pick<ResearchCandidate, 'encoding' | 'offset' | 'length' | 'divisor'>,
): string | null {
  const { offset, length, encoding, divisor } = candidate;
  if (offset < 0 || offset + length > bytes.length || encoding === 'hex') return null;
  const view = new DataView(Uint8Array.from(bytes.slice(offset, offset + length)).buffer),
    little = encoding.endsWith('le');
  if (encoding.startsWith('float')) {
    const value = view.getFloat32(0, little) / divisor;
    return Number.isFinite(value) ? String(value) : null;
  }
  const signed = encoding.startsWith('int');
  let value: bigint;
  if (length === 1) value = BigInt(signed ? view.getInt8(0) : view.getUint8(0));
  else if (length === 2)
    value = BigInt(signed ? view.getInt16(0, little) : view.getUint16(0, little));
  else if (length === 4)
    value = BigInt(signed ? view.getInt32(0, little) : view.getUint32(0, little));
  else if (length === 8)
    value = signed ? view.getBigInt64(0, little) : view.getBigUint64(0, little);
  else return null;
  const negative = value < 0n;
  if (negative) value = -value;
  const denominator = BigInt(divisor),
    whole = value / denominator,
    remainder = value % denominator;
  const fraction = remainder
    ? '.' +
      String(remainder)
        .padStart(String(divisor).length - 1, '0')
        .replace(/0+$/, '')
    : '';
  return (negative ? '-' : '') + String(whole) + fraction;
}
