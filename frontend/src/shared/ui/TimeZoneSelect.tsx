import { useMemo } from 'react';
import { timeZones, timeZoneError } from '../model/validation';
import { Field } from './common';

export function TimeZoneSelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const choices = useMemo(() => timeZones(value), [value]);
  return (
    <Field
      label={label}
      error={timeZoneError(value)}
      hint="Часовой пояс IANA. UTC — всемирное время; Europe/Moscow — московское."
    >
      {(id) => (
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {!choices.includes(value) && (
            <option value={value} disabled>
              {value || 'Выберите часовой пояс'}
            </option>
          )}
          {choices.map((zone) => (
            <option key={zone} value={zone}>
              {zone === 'UTC' ? 'UTC · Всемирное время' : zone}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
