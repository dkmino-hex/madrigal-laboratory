import type { CheckStatus, Location, Preview } from '../api/contracts/models';
import type { Discovery, ResearchCandidate } from '../api/contracts/research';
import { sameContext } from './navigation';
import { candidateValue, researchBytes } from './research';
import {
  actionLabel,
  candidateLocation,
  displayResearchValue,
  parameterInfo,
} from './research-presentation';

export type InspectedField = {
  id: string;
  name: string;
  type: string;
  value: string | null;
  location: Location;
  note: string;
  hypothesis: boolean;
  status?: CheckStatus;
  parameter?: string;
};
export type InspectedMessage = {
  id: string;
  title: string;
  location: Location;
  fields: InspectedField[];
  note: string;
  status?: CheckStatus;
};
export type FieldAnnotation = {
  start: string;
  length: string;
  label: string;
  color?: number;
  kind?: 'field';
};

export function overlaps(a: Location, b: Location) {
  return (
    sameContext(a, b) &&
    BigInt(a.length) > 0n &&
    BigInt(b.length) > 0n &&
    BigInt(a.start) < BigInt(b.start) + BigInt(b.length) &&
    BigInt(b.start) < BigInt(a.start) + BigInt(a.length)
  );
}

export function schemaMessages(preview: Preview, name: string, json: string): InspectedMessage[] {
  // Only textual metadata is read here; decoded numeric values stay exact strings from Analysis.
  let schema: {
    fields?: { name?: string; description?: string }[];
    checks?: { field?: string; parameter?: string }[];
  } = {};
  try {
    const value = JSON.parse(json);
    if (value && typeof value === 'object') {
      schema = {
        fields: Array.isArray(value.fields)
          ? value.fields.filter((item: unknown) => item && typeof item === 'object')
          : [],
        checks: Array.isArray(value.checks)
          ? value.checks.filter((item: unknown) => item && typeof item === 'object')
          : [],
      };
    }
  } catch {
    /* Analysis provides schema diagnostics. */
  }
  return preview.results.map((message) => ({
    id: message.messageId,
    title: message.fields.length
      ? name
      : message.status === 'NOT_APPLICABLE'
        ? 'Сообщение вне области схемы'
        : 'Сообщение без прочитанных полей',
    location: message.location,
    note: message.reason,
    status: message.status,
    fields: message.fields.map((field) => {
      const rawParameter = schema.checks?.find((check) => check.field === field.path)?.parameter;
      const parameter = typeof rawParameter === 'string' ? rawParameter : undefined;
      const description = schema.fields?.find(
        (definition) => definition.name === field.path,
      )?.description;
      return {
        id: field.fieldId,
        name: parameter ? parameterInfo(parameter).title : field.path,
        type: field.type,
        value: field.value,
        location: field.location,
        note: typeof description === 'string' && description ? description : field.reason,
        hypothesis: false,
        status: field.status,
        parameter,
      };
    }),
  }));
}

export function discoveredMessages(discovery: Discovery, window: Location): InspectedMessage[] {
  return discovery.rows
    .filter((row) => overlaps(row.location, window))
    .map((row) => {
      const picked = new Map<string, ResearchCandidate>();
      for (const candidate of discovery.candidates) {
        if (
          candidate.groupId !== row.groupId ||
          candidate.kind !== 'parameter' ||
          candidate.offset + candidate.length > Number(row.location.length)
        )
          continue;
        const old = picked.get(candidate.parameter);
        if (
          !old ||
          candidate.matches / Math.max(1, candidate.total) > old.matches / Math.max(1, old.total)
        )
          picked.set(candidate.parameter, candidate);
      }
      return {
        id: row.id,
        title: actionLabel(row.label),
        location: row.location,
        note:
          row.boundary === 'tcp-fragment'
            ? 'TCP-фрагмент: граница прикладного сообщения ещё не установлена.'
            : 'Граница сообщения предложена автоматическим поиском.',
        fields: [...picked.values()].slice(0, 16).map((candidate) => ({
          id: candidate.id,
          name: parameterInfo(candidate.parameter).title,
          type: candidate.encoding + (candidate.divisor === 1 ? '' : ' ÷ ' + candidate.divisor),
          value: displayResearchValue(
            candidateValue(researchBytes(row), candidate),
            candidate.parameter,
          ),
          location: candidateLocation(row, candidate),
          note: `${candidate.matches} из ${candidate.total} примеров совпали с журналом; гипотеза требует проверки.`,
          hypothesis: true,
          parameter: candidate.parameter,
        })),
      };
    });
}

export function activeMessage(messages: InspectedMessage[], selection: Location) {
  return messages.find((message) => overlaps(message.location, selection)) ?? messages[0];
}
export function selectedField(message: InspectedMessage, selection: Location) {
  return (
    message.fields.find(
      (field) =>
        sameContext(field.location, selection) &&
        field.location.start === selection.start &&
        field.location.length === selection.length,
    ) ?? message.fields.find((field) => overlaps(field.location, selection))
  );
}
export function messageAnnotations(message?: InspectedMessage): FieldAnnotation[] {
  return (
    message?.fields.map((field, index) => ({
      start: field.location.start,
      length: field.location.length,
      label: `${field.name}: ${field.value ?? 'значение недоступно'}${field.hypothesis ? ' · гипотеза' : ''}`,
      kind: 'field',
      color: index % 6,
    })) ?? []
  );
}
