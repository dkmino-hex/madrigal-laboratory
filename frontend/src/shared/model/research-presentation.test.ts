import { expect, it } from 'vitest';
import type { ResearchCandidate, ResearchRow } from '../api/contracts/research';
import { decimal } from './precision';
import {
  decodingCalculation,
  displayResearchValue,
  exampleStatus,
  exampleTime,
  observationPresentation,
  parameterInfo,
} from './research-presentation';

const row: ResearchRow = {
  id: 'row',
  groupId: 'group',
  label: 'set-config',
  captureName: 'real.pcap',
  captureSha256: 'a'.repeat(64),
  location: {
    projectId: 'p',
    captureId: 'c',
    assemblyId: 'a',
    sessionId: 's',
    streamId: 'stream',
    direction: 'A_TO_B',
    start: decimal('100'),
    length: decimal('2'),
  },
  bytes: btoa(String.fromCharCode(255, 6)),
  timestamp: '2026-10-15T10:00:00.125Z',
  boundary: 'message',
  actionIds: ['action'],
  association: 'matched',
  values: { 'params.threshold_c': '-2.5' },
  sources: [],
};
const candidate: ResearchCandidate = {
  id: 'candidate',
  groupId: 'group',
  kind: 'parameter',
  parameter: 'params.threshold_c',
  name: 'threshold_c',
  offset: 0,
  length: 2,
  encoding: 'int16be',
  divisor: 100,
  matches: 1,
  total: 1,
  support: ['row'],
  counterexamples: [],
  inconclusive: [],
  statement: '',
  basis: '',
  examples: [
    {
      location: row.location,
      captureSha256: row.captureSha256,
      status: 'tentative',
      basis: '',
      kind: 'support',
      sources: [
        {
          captureId: 'c',
          packetNo: 42,
          frameOffset: decimal('54'),
          length: decimal('2'),
          streamStart: decimal('100'),
          relation: 'primary',
        },
      ],
    },
  ],
};

it('объясняет знаковое значение без потери точности и не приписывает неизвестным именам единицы', () => {
  expect(decodingCalculation(row, candidate)).toBe('-250 ÷ 100 = -2,5 °C');
  expect(displayResearchValue('18446744073709551615', 'params.custom')).toBe(
    '18446744073709551615',
  );
  expect(parameterInfo('params.custom').unit).toBe('');
  expect(parameterInfo('observed.measurements[0].device_time_ms').context).toBe('измерение №1');
  expect(exampleTime(row.timestamp)).toBe('10:00:00,125 UTC');
  expect(exampleStatus({ ...row, bytes: btoa(String.fromCharCode(255)) }, candidate)).toBe(
    'Участок вне примера',
  );
});
it('показывает байты только из полного физического контекста доказательства', () => {
  const wrong = {
    ...row,
    captureName: 'other.pcap',
    bytes: btoa(String.fromCharCode(0, 21)),
    location: { ...row.location, captureId: 'other' },
  };
  const preview = observationPresentation(candidate, [wrong, row]).samples[0]!;
  expect(preview.label).toContain('real.pcap');
  expect(preview.hex).toBe('FF 06');
  expect(preview.value).toBe('-2,5 °C');
  expect(preview.packetNumbers).toEqual([42]);
  const missing = observationPresentation(candidate, [wrong]).samples[0]!;
  expect(missing.hex).toBeNull();
  expect(missing.value).toBeNull();
});
