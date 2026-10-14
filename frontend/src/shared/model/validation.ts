import { timestampNanoseconds, timestampSchema } from './precision';

export type IntegerInput = { value?: string; error?: string };

/** User input is normalised before it reaches canonical decimal API coordinates. */
export function integerInput(
  input: string,
  options: { signed?: boolean; positive?: boolean; maximum?: bigint } = {},
): IntegerInput {
  const text = input.trim();
  const instruction = options.signed
    ? 'Введите целое число, например 0, 1000 или -1000.'
    : 'Введите целое неотрицательное число, например 0 или 1000.';
  if (!text || !(options.signed ? /^[+-]?\d+$/ : /^\d+$/).test(text)) return { error: instruction };
  if (text.length > 128) return { error: 'Число слишком длинное: максимум 128 символов.' };
  const value = BigInt(text);
  if (options.positive && value <= 0n) return { error: 'Введите целое число больше нуля.' };
  if (options.maximum !== undefined && (value > options.maximum || value < -options.maximum))
    return { error: 'Допустимое значение: не больше ' + options.maximum + '.' };
  return { value: String(value) };
}

export function rangeInput(
  start: string,
  length: string,
  streamLength?: string,
  allowEmpty = false,
) {
  const a = integerInput(start);
  const b = integerInput(length, { positive: !allowEmpty });
  let startError = a.error;
  let lengthError = b.error;
  if (a.value !== undefined && b.value !== undefined && streamLength !== undefined) {
    const total = BigInt(streamLength);
    if (BigInt(a.value) > total || (!allowEmpty && BigInt(a.value) === total))
      startError = 'Начало должно быть меньше длины сборки (' + streamLength + ' байт).';
    else if (BigInt(a.value) + BigInt(b.value) > total)
      lengthError = 'От выбранного начала доступно ' + (total - BigInt(a.value)) + ' байт.';
  }
  return {
    start: a.value,
    length: b.value,
    startError,
    lengthError,
    valid: !startError && !lengthError,
  };
}

export function textError(value: string, label: string, maximum: number, required = true) {
  if (required && !value.replace(/[\p{Default_Ignorable_Code_Point}\s]/gu, ''))
    return 'Введите ' + label + '.';
  if (value.length > maximum) return 'Допустимо не больше ' + maximum + ' символов.';
  // Tabs and line breaks remain valid in descriptions and research notes.
  if (
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    return 'Удалите непечатные управляющие символы.';
  return undefined;
}

export function timeZoneError(value: string) {
  if (!value.trim()) return 'Выберите часовой пояс.';
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: value });
    return undefined;
  } catch {
    return 'Выберите известный часовой пояс из списка.';
  }
}

export function timeOffsetInput(value: string): IntegerInput {
  const parsed = integerInput(value, { signed: true });
  if (parsed.value !== undefined && BigInt(parsed.value.replace('-', '')) > 8640000000000000000000n)
    return { error: 'Поправка времени выходит за поддерживаемый диапазон дат.' };
  return parsed;
}

export function fileError(file: File | undefined, extensions: string[]) {
  if (!file) return undefined;
  if (!extensions.some((extension) => file.name.toLowerCase().endsWith(extension)))
    return 'Выберите файл ' + extensions.join(' или ') + '.';
  if (file.size === 0) return 'Файл пуст. Выберите файл с данными.';
  return undefined;
}

export function timeZones(current = 'UTC') {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [
    ...new Set([
      'UTC',
      'Europe/Moscow',
      'Europe/London',
      'America/New_York',
      'Asia/Tokyo',
      ...supported,
      ...(!timeZoneError(current) ? [current] : []),
    ]),
  ].sort();
}

export function timeRangeInput(from: string, to: string) {
  const instruction =
    'Введите дату и время с часовым поясом, например 2026-10-11T12:00:00Z. Дробная часть — до 9 цифр.';
  let fromError = from && !timestampSchema.safeParse(from).success ? instruction : undefined;
  let toError = to && !timestampSchema.safeParse(to).success ? instruction : undefined;
  if (
    !fromError &&
    !toError &&
    from &&
    to &&
    timestampNanoseconds(from) > timestampNanoseconds(to)
  ) {
    fromError = 'Начало временного диапазона должно быть не позже конца.';
    toError = 'Конец временного диапазона должен быть не раньше начала.';
  }
  return { fromError, toError, valid: !fromError && !toError };
}

export function choiceError(value: string, allowed: readonly string[], label: string) {
  return allowed.includes(value) ? undefined : 'Выберите ' + label + ' из доступных вариантов.';
}
