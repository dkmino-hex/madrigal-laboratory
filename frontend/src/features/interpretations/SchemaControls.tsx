import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  editJsonRaw,
  editJsonValue,
  jsonToken,
  removeJsonValue,
} from '../../shared/model/json-text';
import { Field } from '../../shared/ui/common';

type Path = (string | number)[];
export const SchemaContext = createContext<{
  draft: string;
  change: (value: string) => void;
  problem: (key: string, value?: string) => void;
}>({ draft: '{}', change: () => {}, problem: () => {} });
export function JsonControl({
  path,
  label,
  kind = 'string',
  optional = false,
  hint,
  maximum,
  minimum,
  nonzero,
}: {
  path: Path;
  label: string;
  kind?: 'string' | 'number' | 'uint' | 'json';
  optional?: boolean;
  hint?: string;
  maximum?: bigint;
  minimum?: bigint;
  nonzero?: boolean;
}) {
  const context = useContext(SchemaContext);
  const raw = jsonToken(context.draft, path);
  const original = raw === undefined ? '' : kind === 'string' ? String(JSON.parse(raw)) : raw;
  const [value, setValue] = useState(original);
  const [error, setError] = useState<string>();
  const report = useRef(context.problem);
  report.current = context.problem;
  const key = path.join('.');
  useEffect(() => {
    setValue(original);
    setError(undefined);
    report.current(key);
  }, [original, key]);
  useEffect(() => () => report.current(key), [key]);
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <input
          id={id}
          value={value}
          inputMode={kind === 'uint' ? 'numeric' : 'text'}
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            let problem: string | undefined;
            if (next === '' && optional) {
              context.change(removeJsonValue(context.draft, path));
            } else if (kind === 'string') {
              context.change(editJsonValue(context.draft, path, next));
            } else {
              try {
                JSON.parse(next);
                if (kind === 'uint' && !/^(0|[1-9]\d*)$/.test(next))
                  throw new Error('Введите целое число от 0.');
                if (kind === 'uint' && maximum !== undefined && BigInt(next) > maximum)
                  throw new Error('Максимум: ' + maximum + '.');
                if (kind === 'uint' && minimum !== undefined && BigInt(next) < minimum)
                  throw new Error('Минимум: ' + minimum + '.');
                if (kind === 'number' && !/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(next))
                  throw new Error('Введите число, например 21 или 0.01.');
                if (nonzero && /^-?0(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(next))
                  throw new Error('Масштаб не может быть нулём.');
                context.change(editJsonRaw(context.draft, path, next));
              } catch (error) {
                problem =
                  error instanceof SyntaxError
                    ? 'Введите корректное значение.'
                    : (error as Error).message;
              }
            }
            setError(problem);
            context.problem(key, problem);
          }}
        />
      )}
    </Field>
  );
}
export function JsonChoice({
  path,
  label,
  options,
  empty,
}: {
  path: Path;
  label: string;
  options: { value: string; label: string }[];
  empty?: string;
}) {
  const { draft, change } = useContext(SchemaContext);
  const raw = jsonToken(draft, path);
  const value = raw === undefined ? '' : String(JSON.parse(raw));
  return (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          value={value}
          onChange={(event) =>
            change(
              event.target.value === ''
                ? removeJsonValue(draft, path)
                : editJsonValue(draft, path, event.target.value),
            )
          }
        >
          {empty !== undefined && <option value="">{empty}</option>}
          {value && !options.some((item) => item.value === value) && (
            <option value={value}>{value} · из JSON</option>
          )}
          {options.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
