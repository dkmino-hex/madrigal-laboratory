import type {
  Assembly,
  ByteWindow,
  Capture,
  Location,
  Packet,
  Result,
  Run,
  Session,
  Source,
} from '../../shared/api/contracts/draft';
import { decimal, boundedIndex } from '../../shared/model/precision';
export const projectId = 'demo-laboratory';
export const fixedTime = '2026-10-11T12:34:56.123456789Z';
export const schemaText = JSON.stringify(
  {
    format: 'madrigal-demo-v1',
    framing: { kind: 'fixed', length: 4 },
    endian: 'little',
    scope: { direction: 'A_TO_B' },
    fields: [{ id: 'setpoint', name: 'value', type: 'uint32', offset: '0' }],
    rules: [{ id: 'value-bound', field: 'value', maximum: '30' }],
    extensions: { note: 'Это синтетическая схема frontend, не формат AN-03' },
  },
  null,
  2,
);
export const goldenLocation: Location = {
  projectId,
  captureId: 'capture-baseline-fixture2',
  sessionId: 'session-baseline-fixture2-1',
  streamId: 'stream-baseline-fixture2-a',
  direction: 'A_TO_B',
  assemblyId: 'assembly-baseline-fixture2-v1',
  start: decimal('1000'),
  length: decimal('4'),
};
export const goldenSources: Source[] = [
  {
    captureId: 'capture-baseline-fixture2',
    packetNo: 7,
    frameOffset: decimal('54'),
    length: decimal('2'),
    streamStart: decimal('1000'),
    relation: 'primary',
  },
  {
    captureId: 'capture-baseline-fixture2',
    packetNo: 8,
    frameOffset: decimal('66'),
    length: decimal('2'),
    streamStart: decimal('1002'),
    relation: 'primary',
  },
  {
    captureId: 'capture-baseline-fixture2',
    packetNo: 9,
    frameOffset: decimal('54'),
    length: decimal('2'),
    streamStart: decimal('1000'),
    relation: 'retransmission',
  },
];
export function fixtureByte(offset: bigint, captureId = 'capture-baseline-fixture2') {
  const local = offset % 65536n;
  if (local >= 1000n && local < 1004n)
    return [captureId.includes('additional') ? 0x2a : 0x15, 0, 0, 0][
      boundedIndex(local - 1000n, 3)
    ]!;
  if (local >= 1004n && local < 1008n) return [0x2a, 0, 0, 0][boundedIndex(local - 1004n, 3)]!;
  return boundedIndex((offset * 17n + 3n) % 256n, 255);
}
export function fixtureWindow(location: Location, streamLength: string): ByteWindow {
  if (BigInt(location.length) > 4096n) throw new Error('Окно превышает 4096 байтов');
  const end = BigInt(location.start) + BigInt(location.length);
  const actualEnd = end < BigInt(streamLength) ? end : BigInt(streamLength);
  const segments: ByteWindow['segments'] = [];
  const defects =
    !location.streamId.includes('precision') &&
    !location.captureId.includes('large-frame') &&
    !location.captureId.includes('many-sources');
  let known: { kind: 'known'; start: ReturnType<typeof decimal>; bytes: number[] } | undefined;
  for (let offset = BigInt(location.start); offset < actualEnd; offset++) {
    const gap = defects && offset >= 64n && offset < 72n;
    const conflict = defects && offset >= 96n && offset < 100n;
    const truncated = defects && offset >= 120n && offset < 128n;
    if (gap || conflict || truncated) {
      known = undefined;
      if (
        offset === 64n ||
        offset === 96n ||
        offset === 120n ||
        offset === BigInt(location.start)
      ) {
        const boundary = gap ? 72n : conflict ? 100n : 128n;
        const length = decimal((boundary < actualEnd ? boundary : actualEnd) - offset);
        if (conflict) {
          segments.push({
            kind: 'conflict',
            start: decimal(offset),
            length,
            alternatives: [
              {
                bytes: [0x10, 0x11, 0x12, 0x13].slice(
                  boundedIndex(offset - 96n, 3),
                  boundedIndex(offset - 96n + BigInt(length), 4),
                ),
                sources: [
                  {
                    ...goldenSources[0]!,
                    captureId: location.captureId,
                    packetNo: 10,
                    frameOffset: decimal(54n + offset - 96n),
                    streamStart: decimal(offset),
                    length,
                    relation: 'conflict-alternative',
                    alternativeGroupId: 'overlap-1',
                  },
                ],
              },
              {
                bytes: [0x20, 0x21, 0x22, 0x23].slice(
                  boundedIndex(offset - 96n, 3),
                  boundedIndex(offset - 96n + BigInt(length), 4),
                ),
                sources: [
                  {
                    ...goldenSources[0]!,
                    captureId: location.captureId,
                    packetNo: 11,
                    frameOffset: decimal(54n + offset - 96n),
                    streamStart: decimal(offset),
                    length,
                    relation: 'conflict-alternative',
                    alternativeGroupId: 'overlap-1',
                  },
                ],
              },
            ],
          });
        } else
          segments.push({
            kind: gap ? 'gap' : 'truncation',
            start: decimal(offset),
            length,
            reason: gap ? 'Пакеты не наблюдались в точке захвата' : 'Захваченный кадр усечён',
          });
      }
    } else {
      if (!known) {
        known = { kind: 'known', start: decimal(offset), bytes: [] };
        segments.push(known);
      }
      known.bytes.push(fixtureByte(offset, location.captureId));
    }
  }
  if (location.direction !== 'A_TO_B' || !location.sessionId.endsWith('-1')) {
    for (const segment of segments)
      if (segment.kind === 'conflict')
        for (const alternative of segment.alternatives) alternative.sources = [];
  }
  return { location, streamLength: decimal(streamLength), segments };
}
export function fixturePacket(captureId: string, packetNo: number): Packet {
  const large = captureId.includes('large-frame');
  const many = captureId.includes('many-sources');
  const bytes = Array.from({ length: large ? 65536 : 128 }, (_, index) => (index * 7) % 256);
  if (large)
    bytes.splice(
      60000,
      8,
      ...Array.from({ length: 8 }, (_, index) => fixtureByte(1000n + BigInt(index), captureId)),
    );
  if (many) bytes.splice(54, 4, 0x15, 0, 0, 0);
  // Заданные координаты golden-test; не вычисляем размер заголовков.
  if (packetNo === 7 || packetNo === 9)
    bytes.splice(54, 2, captureId.includes('additional') ? 0x2a : 0x15, 0);
  if (packetNo === 8) {
    bytes.splice(66, 2, 0, 0);
    bytes.splice(captureId.includes('-fixture2') ? 68 : 70, 4, 0x2a, 0, 0, 0);
  }
  if (packetNo === 10 && !many) bytes.splice(54, 4, 0x10, 0x11, 0x12, 0x13);
  if (packetNo === 11 && !many) bytes.splice(54, 4, 0x20, 0x21, 0x22, 0x23);
  if (packetNo === 1 && !large && !many)
    bytes.splice(54, 8, ...Array.from({ length: 8 }, (_, i) => fixtureByte(BigInt(i), captureId)));
  return {
    captureId,
    packetNo,
    timestamp:
      '2026-10-11T12:34:56.' +
      String(123456780 + (packetNo === 7 ? 9 : packetNo === 8 ? 7 : packetNo)).padStart(9, '0') +
      'Z',
    capturedLength: decimal(String(bytes.length)),
    originalLength: decimal(large ? '65536' : packetNo === 6 && !many ? '160' : '128'),
    headers: [
      'Синтетический Ethernet',
      'IPv4 · 192.168.10.2 → 192.168.10.42',
      'TCP · исходный кадр, координаты от начала',
    ],
    bytes,
  };
}
export function demoPcap(): Uint8Array {
  const output = new Uint8Array(24 + 11 * 144);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0xa1b2c3d4, true);
  view.setUint16(4, 2, true);
  view.setUint16(6, 4, true);
  view.setUint32(16, 65535, true);
  view.setUint32(20, 1, true);
  for (let i = 0; i < 11; i++) {
    const offset = 24 + i * 144;
    view.setUint32(offset, 1791722096, true);
    view.setUint32(offset + 4, 123456 + i, true);
    view.setUint32(offset + 8, 128, true);
    view.setUint32(offset + 12, 128, true);
    output.set(fixturePacket('capture-baseline-fixture2', i + 1).bytes, offset + 16);
  }
  return output;
}
export function demoPcapng(): Uint8Array {
  const pcap = demoPcap();
  const output = new Uint8Array(48 + 11 * 160);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x0a0d0d0a, true);
  view.setUint32(4, 28, true);
  view.setUint32(8, 0x1a2b3c4d, true);
  view.setUint16(12, 1, true);
  view.setBigInt64(16, -1n, true);
  view.setUint32(24, 28, true);
  view.setUint32(28, 1, true);
  view.setUint32(32, 20, true);
  view.setUint16(36, 1, true);
  view.setUint32(40, 65535, true);
  view.setUint32(44, 20, true);
  for (let i = 0; i < 11; i++) {
    const offset = 48 + i * 160;
    view.setUint32(offset, 6, true);
    view.setUint32(offset + 4, 160, true);
    view.setUint32(offset + 20, 128, true);
    view.setUint32(offset + 24, 128, true);
    output.set(pcap.slice(24 + i * 144 + 16, 24 + i * 144 + 144), offset + 28);
    view.setUint32(offset + 156, 160, true);
  }
  return output;
}
export function capturesFor(project: string): Capture[] {
  return ['baseline', 'additional', 'defects', 'precision', 'large-frame', 'many-sources'].map(
    (name, index) => ({
      projectId: project,
      captureId: 'capture-' + name + '-fixture2',
      name:
        [
          'Основной обмен.pcap',
          'Другое значение.pcapng',
          'Дефекты захвата.pcap',
          'Точные координаты.pcapng',
          'Большой исходный кадр.pcap',
          'Много источников.pcap',
        ][index]! + ' · демо v2',
      size: decimal(
        name === 'large-frame'
          ? '65576'
          : name === 'many-sources'
            ? '18024'
            : index % 2 === 0
              ? '1608'
              : '1808',
      ),
      packets: decimal(name === 'large-frame' ? '1' : name === 'many-sources' ? '125' : '11'),
      sha256: 'synthetic-fixture-' + name + '-fixture2',
      status: 'READY',
      importedAt: fixedTime,
      synthetic: true,
    }),
  );
}
export function sessionsFor(capture: string): Session[] {
  const name = capture.replace('capture-', '');
  return [1, 2].map((generation) => ({
    sessionId: 'session-' + name + '-' + generation,
    captureId: capture,
    generation,
    sideA: '192.168.10.2:51824',
    sideB: '192.168.10.42:502',
    role: generation === 2 ? 'UNKNOWN' : 'KNOWN',
    startTime: fixedTime,
    endTime: '2026-10-11T12:35:02.987654321Z',
    bytes: decimal(name.startsWith('precision') ? '9007199254806528' : '65536'),
    defects: name.startsWith('defects')
      ? ['Пропуск', 'Усечение', 'Конфликт', 'Checksum: возможен offloading']
      : generation === 2
        ? ['Начало соединения неизвестно', 'Роли неизвестны']
        : ['Ретрансляция сохранена как источник'],
    streamA: 'stream-' + name + (generation === 1 ? '-a' : '-a2'),
    streamB: 'stream-' + name + (generation === 1 ? '-b' : '-b2'),
  }));
}
export function assembliesFor(capture: string, session: string): Assembly[] {
  const name = capture.replace('capture-', '');
  const sessionGeneration = session.split('-').at(-1) ?? '1';
  const generation = sessionGeneration === '1' ? '' : sessionGeneration;
  return ['A_TO_B', 'B_TO_A'].flatMap((direction) =>
    [
      'v1',
      'v2',
      'pending',
      ...Array.from({ length: 24 }, (_, index) => 'retained-' + (index + 2)),
    ].map((version) => ({
      assemblyId:
        'assembly-' + name + (direction === 'B_TO_A' ? '-b' : '') + generation + '-' + version,
      captureId: capture,
      sessionId: session,
      streamId: 'stream-' + name + (direction === 'A_TO_B' ? '-a' : '-b') + generation,
      direction: direction as Assembly['direction'],
      settingsVersion:
        version === 'v1' || version.startsWith('retained') ? 'settings-v1' : 'settings-v2',
      status: version === 'pending' ? 'BUILDING' : 'READY',
      length: decimal(name.startsWith('precision') ? '9007199254806528' : '65536'),
    })),
  );
}
export function resultsFor(
  project: string,
  revisionId = 'revision-v1',
  captureId = 'capture-baseline-fixture2',
  maximum = '30',
  context: Partial<Location> = {},
): Result[] {
  const name = captureId.replace('capture-', '');
  const location = {
    ...goldenLocation,
    projectId: project,
    captureId,
    sessionId: 'session-' + name + '-1',
    streamId: 'stream-' + name + '-a',
    assemblyId: 'assembly-' + name + '-v1',
    ...context,
  };
  const sources = goldenSources.map((source) => ({ ...source, captureId }));
  const conflictLocation = { ...location, start: decimal('96'), length: decimal('4') };
  const conflictSources = fixtureWindow(conflictLocation, '65536').segments.flatMap((segment) =>
    segment.kind === 'conflict'
      ? segment.alternatives.flatMap((alternative) => alternative.sources)
      : [],
  );
  return (['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'UNKNOWN'] as const).map(
    (status, index) => {
      const value = index === 0 && !captureId.includes('additional') ? '21' : '42';
      const resolved = index < 2 ? (BigInt(value) <= BigInt(maximum) ? 'PASS' : 'FAIL') : status;
      const fieldLocation = index === 1 ? { ...location, start: decimal('1004') } : location;
      const fieldSources =
        index === 1
          ? [
              {
                ...goldenSources[1]!,
                captureId,
                packetNo: 8,
                frameOffset: decimal(captureId.includes('-fixture2') ? '68' : '70'),
                length: decimal('4'),
                streamStart: decimal('1004'),
              },
            ]
          : sources;
      return {
        resultId: 'result-' + revisionId + '-' + index,
        messageId: 'message-' + index,
        status: resolved,
        reason:
          index < 2
            ? 'Значение ' +
              value +
              (resolved === 'PASS' ? ' удовлетворяет максимуму ' : ' превышает максимум ') +
              maximum
            : [
                '',
                '',
                'Конфликт перекрытия: однозначное значение недоступно',
                'Правило ответа неприменимо к выбранной команде',
                'Байты отсутствуют из-за пропуска',
              ][index]!,
        rule: index <= 1 ? 'value-bound' : ['', '', 'overlap', 'direction', 'availability'][index]!,
        location:
          index === 2
            ? conflictLocation
            : index === 4
              ? { ...location, start: decimal('64'), length: decimal('8') }
              : index === 3
                ? { ...location, start: decimal('108'), length: decimal('4') }
                : fieldLocation,
        sources: index === 2 ? conflictSources : index < 2 ? fieldSources : [],
        fields:
          index < 2
            ? [
                {
                  fieldId: 'setpoint',
                  path: 'message.value',
                  type: 'uint32',
                  value,
                  location: fieldLocation,
                  sources: fieldSources,
                  status: resolved,
                  reason: 'Извлечение значения не доказывает смысл поля',
                  rule: 'value-bound',
                },
              ]
            : [],
      };
    },
  );
}
export function baselineRun(
  project: string,
  runId = 'run-baseline',
  revisionId = 'revision-v1',
  captureId = 'capture-baseline-fixture2',
): Run {
  const results = resultsFor(project, revisionId, captureId);
  return {
    runId,
    projectId: project,
    jobId: 'ana_' + runId,
    createdAt: fixedTime,
    status: 'COMPLETED',
    historical: true,
    manifest: {
      revisionId,
      settingsVersion: 'settings-v1',
      engineVersion: captureId.includes('-fixture2')
        ? 'frontend-fixture-v2'
        : 'frontend-fixture-v1',
      filters: 'Все сообщения выбранной сборки',
      synthetic: true,
      corpus: [
        {
          captureId,
          assemblyId: 'assembly-' + captureId.replace('capture-', '') + '-v1',
          sha256: 'synthetic-fixture-' + captureId.replace('capture-', ''),
        },
      ],
    },
    summary: {
      messages: decimal('5'),
      knownBytes: decimal('12'),
      unknownBytes: decimal('12'),
      captures: decimal('1'),
      sessions: decimal('1'),
      complete: true,
      rules: Object.fromEntries(
        ['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'UNKNOWN'].map((status) => [
          status,
          decimal(String(results.filter((item) => item.status === status).length)),
        ]),
      ) as Run['summary']['rules'],
    },
  };
}
export const scenarioNames = [
  'baseline',
  'additional-example',
  'split-field',
  'multiple-messages',
  'reordered-and-retransmitted',
  'gap-and-truncation',
  'conflicting-overlap',
  'missing-syn-and-reused-tuple',
  'checksum-policy',
  'precision',
  'csv-partial',
  'invalid-schema',
  'all-check-statuses',
  'zero-messages',
  'partial-and-cancelled',
  'historical',
  'duplicate-and-idempotency',
  'api-failures',
  'transfer-failure',
  'large-paginated',
] as const;
