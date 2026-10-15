import { expect, it } from 'vitest';
import { goldenLocation } from '../../mocks/fixtures/corpus';
import type { Preview } from '../api/contracts/models';
import type { Discovery, ResearchCandidate, ResearchRow } from '../api/contracts/research';
import { decimal } from './precision';
import {
  activeMessage,
  discoveredMessages,
  messageAnnotations,
  overlaps,
  schemaMessages,
  selectedField,
} from './message-inspection';

const location = { ...goldenLocation, start: decimal('100'), length: decimal('12') };
const fieldLocation = { ...location, start: decimal('104'), length: decimal('8') };
const preview: Preview = {
  revisionId: 'revision',
  location,
  unknown: [],
  complete: true,
  results: [
    {
      resultId: 'message',
      messageId: 'message',
      status: 'PASS',
      reason: 'Проверка пройдена',
      rule: '',
      location,
      sources: [],
      fields: [
        {
          fieldId: 'value',
          path: 'value',
          type: 'uint64be',
          value: '18446744073709551615',
          location: fieldLocation,
          sources: [],
          status: 'PASS',
          reason: 'Правило значения',
          rule: 'check',
        },
      ],
    },
  ],
};

it('связывает поле и байты в пределах той же записи, сборки и направления', () => {
  const messages = schemaMessages(preview, 'Телеметрия', '{"fields":[]}');
  expect(activeMessage(messages, fieldLocation)?.id).toBe('message');
  expect(selectedField(messages[0]!, fieldLocation)?.id).toBe('value');
  expect(messageAnnotations(messages[0])).toEqual([
    { start: '104', length: '8', label: 'value: 18446744073709551615', kind: 'field', color: 0 },
  ]);
  expect(overlaps(location, { ...fieldLocation, assemblyId: 'other' })).toBe(false);
  expect(overlaps(location, { ...fieldLocation, direction: 'B_TO_A' })).toBe(false);
  expect(overlaps(location, { ...fieldLocation, captureId: 'other' })).toBe(false);
  expect(overlaps(location, { ...location, start: decimal('112') })).toBe(false);
  expect(selectedField(messages[0]!, { ...fieldLocation, length: decimal('0') })).toBeUndefined();
});

it('сохраняет uint64 и текст схемы, не придумывая назначение поля', () => {
  const messages = schemaMessages(
    preview,
    'Телеметрия',
    '{"fields":[{"name":"value","description":"Счётчик устройства"}],"checks":[{"field":"value","parameter":"params.custom"}]}',
  );
  expect(messages[0]!.fields[0]).toMatchObject({
    name: 'custom',
    value: '18446744073709551615',
    note: 'Счётчик устройства',
    hypothesis: false,
  });
  for (const json of [
    'null',
    '{}',
    '{"fields":true,"checks":1}',
    '{"fields":[{"name":"value","description":{}}]}',
  ])
    expect(schemaMessages(preview, 'Схема', json)[0]!.fields[0]!.note).toBe('Правило значения');
});

it('автопоиск показывает только подходящий поток и помещающиеся в сообщение кандидаты', () => {
  const row: ResearchRow = {
    id: 'r',
    groupId: 'g',
    label: 'set-config',
    captureName: 'capture.pcap',
    captureSha256: '',
    location: { ...location, length: decimal('2') },
    bytes: btoa(String.fromCharCode(255, 6)),
    timestamp: '',
    boundary: 'tcp-fragment',
    actionIds: [],
    association: 'matched',
    values: {},
    sources: [],
  };
  const candidate: ResearchCandidate = {
    id: 'c',
    groupId: 'g',
    kind: 'parameter',
    parameter: 'params.threshold_c',
    name: 'threshold',
    offset: 0,
    length: 2,
    encoding: 'int16be',
    divisor: 100,
    matches: 2,
    total: 3,
    support: [],
    counterexamples: [],
    inconclusive: [],
    statement: '',
    basis: '',
    examples: [],
  };
  const discovery: Discovery = {
    projectId: location.projectId,
    engineVersion: '',
    fingerprint: '',
    complete: false,
    captures: [],
    groups: [],
    warnings: [],
    rows: [row, { ...row, id: 'foreign', location: { ...row.location, streamId: 'foreign' } }],
    candidates: [
      candidate,
      { ...candidate, id: 'better', matches: 3 },
      { ...candidate, id: 'outside', parameter: 'params.count', offset: 10 },
    ],
  };
  const messages = discoveredMessages(discovery, location);
  expect(messages).toHaveLength(1);
  expect(messages[0]!.note).toContain('TCP-фрагмент');
  expect(messages[0]!.fields).toHaveLength(1);
  expect(messages[0]!.fields[0]).toMatchObject({
    id: 'better',
    value: '-2,5 °C',
    hypothesis: true,
  });
  expect(messageAnnotations(messages[0])[0]!.label).toContain('гипотеза');
});
