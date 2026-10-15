import type { AutomaticInput, ResearchCandidate, ResearchRow } from '../api/contracts/research';
import { candidateValue, researchBytes } from './research';
import { decimal } from './precision';

const names: Record<string, [string, string]> = {
  device_time_ms: ['Время устройства', 'мс'],
  temperature_c: ['Температура', '°C'],
  threshold_c: ['Температурный порог', '°C'],
  period_ms: ['Период измерений', 'мс'],
  interval_ms: ['Интервал', 'мс'],
  count: ['Количество', ''],
};
const actions: Record<string, string> = {
  'read-values': 'Чтение измерений', 'read-config': 'Чтение настроек',
  'set-config': 'Изменение настроек', 'probe-invalid-period': 'Проверка неверного периода',
  'probe-invalid-utf8': 'Проверка неверной текстовой метки',
};

// These are display aliases for names already present in the journal, never inferred field semantics.
export function parameterInfo(path: string) {
  const leaf = path.split('.').at(-1) ?? path;
  const [label, unit] = names[leaf] ?? [leaf.replaceAll('_', ' ') || 'Участок байтов', ''];
  const measurement = /measurements\[(\d+)\]/.exec(path);
  return {
    label, unit,
    context: measurement ? `измерение №${Number(measurement[1]) + 1}` : path.startsWith('params.') ? 'параметр действия' : 'значение журнала',
    title: label + (unit ? ', ' + unit : '') + (measurement ? ` · измерение №${Number(measurement[1]) + 1}` : ''),
  };
}
export const actionLabel = (value: string) => actions[value] ?? value;
export function displayResearchValue(value: string | null | undefined, parameter: string) {
  if (value == null) return 'Нет однозначного значения';
  return value.replace('.', ',') + (parameterInfo(parameter).unit ? ' ' + parameterInfo(parameter).unit : '');
}
export function readingDescription(candidate: ResearchCandidate) {
  if (candidate.kind !== 'parameter') return candidate.kind === 'constant' ? 'Одинаковые байты во всех этих примерах' : 'Байты меняются между примерами';
  const type = candidate.encoding.startsWith('float') ? 'Дробное число' : candidate.encoding.startsWith('int') ? 'Целое со знаком' : 'Целое без знака';
  const endian = candidate.length > 1 ? candidate.encoding.endsWith('le') ? ', младший байт первым' : ', старший байт первым' : '';
  return `${type}, ${candidate.length} ${candidate.length === 1 ? 'байт' : candidate.length < 5 ? 'байта' : 'байтов'}${endian}${candidate.divisor === 1 ? '' : ', разделить на ' + candidate.divisor}`;
}
export function fieldHex(row: ResearchRow, candidate: ResearchCandidate) {
  const bytes = researchBytes(row);
  if (candidate.offset + candidate.length > bytes.length) return null;
  return bytes.slice(candidate.offset, candidate.offset + candidate.length).map(value => value.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
export function candidateLocation(row: ResearchRow, candidate: ResearchCandidate) {
  if (candidate.offset + candidate.length > Number(row.location.length)) return row.location;
  return {...row.location, start:decimal(BigInt(row.location.start)+BigInt(candidate.offset)), length:decimal(String(candidate.length))};
}
export function exampleTime(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Время неизвестно' : date.toLocaleTimeString('ru-RU', { timeZone: 'UTC', hour12: false }) + ' UTC';
}
export function exampleStatus(row: ResearchRow, candidate: ResearchCandidate) {
  if (candidate.support.includes(row.id)) return candidate.kind === 'parameter' ? 'Совпало' : 'Участок известен';
  if (candidate.counterexamples.includes(row.id)) return 'Отличается';
  return fieldHex(row, candidate) === null ? 'Байты недоступны' : 'Не с чем сравнить';
}

export type ObservationPresentation = {
  title: string;
  reading: string;
  samples: { label: string; hex: string | null; expected: string | null; value: string | null; time: string; packetNumbers: number[] }[];
};

export function observationPresentation(candidate: ResearchCandidate, rows: ResearchRow[]): ObservationPresentation {
  return {
    title: candidate.kind === 'parameter' ? parameterInfo(candidate.parameter).title : candidate.kind === 'constant' ? 'Постоянный участок' : 'Изменяющийся участок',
    reading: readingDescription(candidate),
    samples: candidate.examples.map(example => {
      const row = rows.find(item => item.location.streamId === example.location.streamId && item.location.assemblyId === example.location.assemblyId && BigInt(item.location.start) + BigInt(candidate.offset) === BigInt(example.location.start));
      return {
        label: row ? `${row.captureName} · ${actionLabel(row.label)}` : `Источник · ${example.location.direction.replaceAll('_TO_', ' → ')}`,
        hex: row ? fieldHex(row, candidate) : null,
        expected: row?.values[candidate.parameter] == null ? null : displayResearchValue(row.values[candidate.parameter], candidate.parameter),
        value: row && candidate.kind === 'parameter' ? displayResearchValue(candidateValue(researchBytes(row), candidate), candidate.parameter) : null,
        time: row ? exampleTime(row.timestamp) : '',
        packetNumbers: [...new Set(example.sources.map(source => source.packetNo))],
      };
    }),
  };
}
export function observationText(candidate: ResearchCandidate) {
  if (candidate.kind !== 'parameter') return candidate.statement;
  return `«${parameterInfo(candidate.parameter).title}»: значение из байтов ${candidate.offset}–${candidate.offset + candidate.length - 1} совпало с журналом в ${candidate.matches} из ${candidate.total} сопоставимых примеров. Это возможное объяснение участка; его ещё нужно проверить на другой записи.`;
}
export function proofFallback(example: AutomaticInput['examples'][number], index: number) {
  const packets = [...new Set(example.sources.map(source => source.packetNo))];
  return `${example.kind === 'counterexample' ? 'Контрпример' : 'Пример'} ${index + 1} · пакет${packets.length > 1 ? 'ы' : ''} ${packets.join(', ')} · ${example.location.length} байт`;
}
