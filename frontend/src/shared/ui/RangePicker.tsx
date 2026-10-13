import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKey } from '../api/query';
import { MoreChoices, usePagedChoices } from '../api/paged-choices';
import type { Location } from '../api/contracts/draft';
import { decimal } from '../model/precision';
import { rangeInput } from '../model/validation';
import { Field, ErrorState, Pagination } from './common';
export function RangePicker({
  projectId,
  label,
  initial,
  maximumLength,
  onChange,
}: {
  projectId: string;
  label: string;
  initial?: Location | null;
  maximumLength?: number;
  onChange: (location: Location | null, settingsVersion?: string) => void;
}) {
  const [captureChoice, setCapture] = useState(initial?.captureId ?? '');
  const [sessionChoice, setSession] = useState(initial?.sessionId ?? '');
  const [assemblyChoice, setAssembly] = useState(initial?.assemblyId ?? '');
  const [sessionCursor, setSessionCursor] = useState('0');
  const [start, setStart] = useState(initial?.start ?? '1000');
  const [length, setLength] = useState(initial?.length ?? '4');
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  const captures = usePagedChoices(
    projectId,
    'captures',
    (cursor, signal) => api.captures({ projectId, cursor }, { signal }),
    {},
    true,
    captureChoice,
    (capture) => capture.status === 'READY',
  );
  const captureId =
    captureChoice ||
    captures.data?.items.find((capture) => capture.status === 'READY')?.captureId ||
    '';
  const selectedCapture = captures.data?.items.find((item) => item.captureId === captureId);
  const sessions = useQuery({
    queryKey: queryKey(projectId, 'sessions', { captureId, cursor: sessionCursor }),
    queryFn: ({ signal }) =>
      api.sessions({ projectId, captureId, cursor: sessionCursor }, { signal }),
    enabled: selectedCapture?.status === 'READY',
  });
  const sessionId = sessionChoice || sessions.data?.items[0]?.sessionId || '';
  const assemblies = usePagedChoices(
    projectId,
    'assemblies',
    (cursor, signal) => api.assemblies({ projectId, captureId, sessionId, cursor }, { signal }),
    { captureId, sessionId },
    !!sessionId,
    assemblyChoice,
    (assembly) => assembly.status === 'READY',
  );
  const assemblyId =
    assemblyChoice ||
    assemblies.data?.items.find((assembly) => assembly.status === 'READY')?.assemblyId ||
    '';
  const assembly = assemblies.data?.items.find(
    (assembly) => assembly.assemblyId === assemblyId && assembly.status === 'READY',
  );
  const range = rangeInput(start, length, assembly?.length);
  if (
    range.length !== undefined &&
    maximumLength !== undefined &&
    BigInt(range.length) > BigInt(maximumLength)
  ) {
    range.lengthError = 'Для этого разбора выберите не больше ' + maximumLength + ' байт.';
    range.valid = false;
  }
  const valid = selectedCapture?.status === 'READY' && assembly && range.valid;
  const serialized = valid
    ? JSON.stringify({
        projectId,
        captureId,
        sessionId,
        assemblyId,
        streamId: assembly.streamId,
        direction: assembly.direction,
        start: decimal(range.start!),
        length: decimal(range.length!),
      })
    : 'null';
  useEffect(() => {
    callback.current(
      JSON.parse(serialized) as Location | null,
      valid ? assembly.settingsVersion : undefined,
    );
  }, [serialized, valid, assembly?.settingsVersion]);
  return (
    <fieldset className="range-picker">
      <legend>{label}</legend>
      <div className="range-picker-controls">
        <Field label={label + ': запись'}>
          {(id) => (
            <select
              id={id}
              value={captureId}
              onChange={(event) => {
                setCapture(event.target.value);
                setSession('');
                setAssembly('');
                setSessionCursor('0');
              }}
            >
              {!captureId && (
                <option value="" disabled>
                  {captures.isPending ? 'Загрузка записей…' : 'Нет готовых записей'}
                </option>
              )}
              {captureId && !captures.data?.items.some((item) => item.captureId === captureId) && (
                <option value={captureId}>{captureId} · выбранная запись</option>
              )}
              {captures.data?.items.map((item) => (
                <option
                  key={item.captureId}
                  disabled={item.status !== 'READY'}
                  value={item.captureId}
                >
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={label + ': сессия'}>
          {(id) => (
            <select
              id={id}
              value={sessionId}
              onChange={(event) => {
                setSession(event.target.value);
                setAssembly('');
              }}
            >
              {sessionId && !sessions.data?.items.some((item) => item.sessionId === sessionId) && (
                <option value={sessionId}>{sessionId} · выбранная сессия</option>
              )}
              {sessions.data?.items.map((item) => (
                <option key={item.sessionId} value={item.sessionId}>
                  {item.sessionId} · поколение {item.generation}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={label + ': сборка и направление'}
          hint="Сборки в процессе подготовки и с ошибкой недоступны для исследования."
        >
          {(id) => (
            <select
              id={id}
              value={assemblyId}
              onChange={(event) => setAssembly(event.target.value)}
            >
              {assemblyId &&
                !assemblies.data?.items.some((item) => item.assemblyId === assemblyId) && (
                  <option value={assemblyId}>{assemblyId} · выбранная сборка</option>
                )}
              {assemblies.data?.items.map((item) => (
                <option
                  key={item.assemblyId}
                  value={item.assemblyId}
                  disabled={item.status !== 'READY'}
                >
                  {item.assemblyId} · {item.direction === 'A_TO_B' ? 'A→B' : 'B→A'} ·{' '}
                  {item.settingsVersion} ·{' '}
                  {item.status === 'READY'
                    ? 'Готова'
                    : item.status === 'BUILDING'
                      ? 'Ещё собирается'
                      : 'Ошибка сборки'}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="form-grid">
          <Field
            label={label + ': начало'}
            hint="Смещение в байтах, начиная с 0."
            error={range.startError}
          >
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={label + ': длина'}
            hint="Число байтов в диапазоне, больше 0."
            error={range.lengthError}
          >
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                value={length}
                onChange={(event) => setLength(event.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
      <MoreChoices label="записи" query={captures} />
      <MoreChoices label="версии сборки" query={assemblies} />
      {captureId &&
        captures.data &&
        !captures.resolving &&
        (!selectedCapture || selectedCapture.status !== 'READY') && (
          <ErrorState
            error={
              new Error(
                'Указанная запись недоступна или ещё не готова. Другая запись не подставляется.',
              )
            }
          />
        )}
      {sessions.data && (sessionCursor !== '0' || sessions.data.nextCursor !== null) && (
        <div role="group" aria-label={label + ': страницы сессий'}>
          <Pagination
            cursor={sessionCursor}
            nextCursor={sessions.data.nextCursor}
            onChange={(cursor) => {
              setSessionCursor(cursor);
              setSession(sessionId);
              setAssembly(assemblyId);
            }}
            total={sessions.data.total}
          />
        </div>
      )}
      {assemblies.data &&
        assemblyId &&
        !assembly &&
        !assemblies.resolving &&
        !assemblies.error &&
        !assemblies.paginationError && (
          <ErrorState
            error={new Error('Указанная сборка недоступна. Другая версия не подставляется.')}
          />
        )}
      {[captures.initialError, sessions.error, assemblies.initialError]
        .filter(Boolean)
        .map((error, index) => (
          <ErrorState key={index} error={error} />
        ))}
    </fieldset>
  );
}
