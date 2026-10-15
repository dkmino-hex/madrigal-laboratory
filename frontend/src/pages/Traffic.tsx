import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useProject } from '../app/Shell';
import { config } from '../app/config';
import { api } from '../shared/api/client';
import { queryKey } from '../shared/api/query';
import { MoreChoices, usePagedChoices } from '../shared/api/paged-choices';
import type { Location } from '../shared/api/contracts/models';
import { decimal, decimalSchema, formatInteger, formatTimestamp } from '../shared/model/precision';
import { readLocation, safeReturnPath, sameContext } from '../shared/model/navigation';
import { readPreference, savePreference } from '../shared/lib/storage';
import { useBufferedParam } from '../shared/lib/use-buffered-param';
import { rangeInput } from '../shared/model/validation';
import {
  Banner,
  Button,
  Empty,
  ErrorState,
  Field,
  Modal,
  PageHeading,
  Pagination,
  QueryState,
} from '../shared/ui/common';
import { Resizer } from '../shared/ui/Resizer';
import { HexViewer } from '../features/hex-viewer/HexViewer';
import { SearchPanel } from '../features/hex-viewer/Search';
import { SourceInspector } from '../features/source-inspector/SourceInspector';

export default function Traffic() {
  const project = useProject();
  const projectId = project.projectId;
  const [params, setParams] = useSearchParams();
  const [pane, setPane] = useState('bytes');
  const [leftWidth, setLeftWidth] = useState(
    Math.min(350, Math.max(180, Number(readPreference('traffic:left') ?? 210))),
  );
  const [rightWidth, setRightWidth] = useState(
    Math.min(500, Math.max(260, Number(readPreference('traffic:right') ?? 300))),
  );
  const [pendingAssembly, setPendingAssembly] = useState<string>();
  const [inputErrors, setInputErrors] = useState<{ start?: string; length?: string }>({});
  let direct: Location | null = null;
  let linkError: Error | undefined;
  try {
    direct = readLocation(params, projectId);
  } catch (error) {
    linkError = error as Error;
  }
  const captures = usePagedChoices(
    projectId,
    'captures',
    (cursor, signal) => api.captures({ projectId, cursor }, { signal }),
    {},
    true,
    params.get('captureId') ?? '',
    (capture) => capture.status === 'READY',
  );
  const captureId =
    params.get('captureId') ??
    captures.data?.items.find((capture) => capture.status === 'READY')?.captureId ??
    '';
  const selectedCapture = captures.data?.items.find((item) => item.captureId === captureId);
  if (
    captureId &&
    captures.data &&
    !captures.resolving &&
    (!selectedCapture || selectedCapture.status !== 'READY')
  )
    linkError = new Error(
      'Указанная запись недоступна или ещё не готова. Другая запись не подставляется.',
    );
  const sessionCursor = params.get('sessionCursor') ?? '0';
  const q = params.get('q') ?? '';
  const search = useBufferedParam('q', 'sessionCursor');
  const defects = params.get('defects') ?? '';
  const sessions = useQuery({
    queryKey: queryKey(projectId, 'sessions', { captureId, cursor: sessionCursor, q, defects }),
    queryFn: ({ signal }) =>
      api.sessions({ projectId, captureId, cursor: sessionCursor, q, defects }, { signal }),
    enabled: selectedCapture?.status === 'READY' && !linkError,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] &&
      Reflect.get(previousQuery.queryKey[3] as object, 'captureId') === captureId &&
      Reflect.get(previousQuery.queryKey[3] as object, 'cursor') === sessionCursor
        ? previous
        : undefined,
  });
  const sessionId = params.get('sessionId') ?? sessions.data?.items[0]?.sessionId ?? '';
  const session = sessions.data?.items.find((item) => item.sessionId === sessionId);
  const direction = params.get('direction') === 'B_TO_A' ? 'B_TO_A' : 'A_TO_B';
  const assemblies = usePagedChoices(
    projectId,
    'assemblies',
    (cursor, signal) => api.assemblies({ projectId, captureId, sessionId, cursor }, { signal }),
    { captureId, sessionId },
    !!sessionId && !linkError,
    params.get('assemblyId') ?? '',
    (assembly) => assembly.direction === direction && assembly.status === 'READY',
  );
  const assemblyId =
    params.get('assemblyId') ??
    assemblies.data?.items.find(
      (assembly) => assembly.direction === direction && assembly.status === 'READY',
    )?.assemblyId ??
    '';
  const assembly = assemblies.data?.items.find(
    (item) => item.assemblyId === assemblyId && item.direction === direction,
  );
  const settings = useQuery({
    queryKey: queryKey(projectId, 'settings', { settingsVersion: assembly?.settingsVersion }),
    queryFn: ({ signal }) => api.settings(projectId, assembly!.settingsVersion, { signal }),
    enabled: !!assembly,
  });
  const selectedStart = params.get('start') ?? (config.mode === 'api' ? '0' : '1000');
  const selectedLength =
    params.get('length') ??
    (config.mode === 'api' && assembly
      ? String(BigInt(assembly.length) < 4n ? BigInt(assembly.length) : 4n)
      : '4');
  let selection: Location | null = direct;
  if (
    !direct &&
    assembly &&
    decimalSchema.safeParse(selectedStart).success &&
    decimalSchema.safeParse(selectedLength).success
  )
    selection = {
      projectId,
      captureId,
      sessionId,
      streamId: assembly.streamId,
      direction,
      assemblyId,
      start: decimal(selectedStart),
      length: decimal(selectedLength),
    };
  if (assembly && selection) {
    if (assembly.status !== 'READY')
      linkError = new Error('Сборка ещё не готова. Исследование доступно только после READY.');
    else if (
      selection.streamId !== assembly.streamId ||
      selection.captureId !== assembly.captureId ||
      selection.sessionId !== assembly.sessionId ||
      selection.direction !== assembly.direction
    )
      linkError = new Error('Прямая ссылка не соответствует потоку выбранной сборки.');
    else if (BigInt(selection.start) + BigInt(selection.length) > BigInt(assembly.length))
      linkError = new Error('Диапазон прямой ссылки выходит за пределы этой сборки.');
  }
  let windowStart = '0';
  let windowLength = '0';
  try {
    windowStart = decimal(
      params.get('window') ??
        String(
          (BigInt(selection?.start ?? '0') / BigInt(config.windowSize)) * BigInt(config.windowSize),
        ),
    );
    if (assembly) {
      const remaining = BigInt(assembly.length) - BigInt(windowStart);
      if (remaining < 0n) throw new Error('Окно находится за пределами потока');
      windowLength = decimal(
        remaining > BigInt(config.windowSize) ? BigInt(config.windowSize) : remaining,
      );
    }
  } catch (error) {
    linkError = error as Error;
  }
  const windowLocation = selection
    ? { ...selection, start: decimal(windowStart), length: decimal(windowLength) }
    : null;
  const bytes = useQuery({
    queryKey: queryKey(projectId, 'bytes', windowLocation ? { ...windowLocation } : {}),
    queryFn: ({ signal }) => api.bytes(windowLocation!, { signal }),
    enabled: !!windowLocation && !!assembly && !linkError,
    gcTime: 10000,
    placeholderData: (previous) =>
      previous && windowLocation && sameContext(previous.location, windowLocation)
        ? previous
        : undefined,
  });
  function updateSelection(start: string, length: string, moveWindow: boolean | string = false) {
    if (!selection) return;
    const range = rangeInput(start, length, assembly?.length, true);
    if (!assembly || !range.valid) {
      setInputErrors({ start: range.startError, length: range.lengthError });
      return;
    }
    const next = new URLSearchParams(params);
    Object.entries({ ...selection, start: range.start!, length: range.length! }).forEach(
      ([key, value]) => next.set(key, value),
    );
    if (moveWindow)
      next.set(
        'window',
        typeof moveWindow === 'string'
          ? moveWindow
          : String((BigInt(range.start!) / 4096n) * 4096n),
      );
    setInputErrors({});
    setParams(next, { replace: true });
  }
  function changeAssembly(id: string) {
    const nextAssembly = assemblies.data?.items.find((item) => item.assemblyId === id);
    if (!nextAssembly) return;
    const next = new URLSearchParams(params);
    Object.entries({
      projectId,
      captureId,
      sessionId,
      direction,
      streamId: nextAssembly.streamId,
      assemblyId: id,
      start: selectedStart,
      length: selectedLength,
    }).forEach(([key, value]) => next.set(key, value));
    for (const key of ['packetNo', 'runId', 'revisionId']) next.delete(key);
    setParams(next, { flushSync: true });
    setPendingAssembly(undefined);
  }
  const returnPath = safeReturnPath(params.get('returnTo'), projectId);
  const [hintsEnabled, setHintsEnabled] = useState(false);
  const hints = useQuery({
    queryKey: queryKey(projectId, 'discover', { captureId, assemblyId, direction }),
    queryFn: ({ signal }) =>
      api.discover({ projectId, captures: [{ captureId, assemblyId }], direction }, { signal }),
    enabled: config.mode === 'api' && hintsEnabled && !!assemblyId,
  });
  const annotations: { start: string; length: string; label: string }[] = [];
  if (hintsEnabled && hints.data)
    for (const candidate of hints.data.candidates
      .filter((item) => item.kind === 'parameter' || item.kind === 'variable')
      .slice(0, 12))
      for (const row of hints.data.rows) {
        if (annotations.length >= 64) break;
        if (
          row.groupId !== candidate.groupId ||
          row.location.streamId !== selection?.streamId ||
          candidate.offset + candidate.length > Number(row.location.length)
        )
          continue;
        const start = String(BigInt(row.location.start) + BigInt(candidate.offset)),
          length = String(candidate.length);
        if (!annotations.some((item) => item.start === start && item.length === length))
          annotations.push({
            start,
            length,
            label:
              'Кандидат: ' +
              (candidate.parameter || 'изменяющийся участок') +
              ' · ' +
              candidate.matches +
              '/' +
              candidate.total,
          });
        if (annotations.length >= 64) break;
      }
  return (
    <>
      <PageHeading
        title="Обмен и байты"
        subtitle="Направленный поток конкретной сборки. Источник каждого вывода доступен для проверки."
        actions={
          returnPath && (
            <Link className="button secondary" to={returnPath}>
              {new URL(returnPath, window.location.origin).pathname.endsWith('/actions')
                ? 'Вернуться к журналу'
                : 'Вернуться к результату'}
            </Link>
          )
        }
      />
      {linkError && <ErrorState error={linkError} />}
      {config.mode === 'api' && assemblyId && (
        <div className="research-hints">
          <Button disabled={hints.isFetching} onClick={() => setHintsEnabled((value) => !value)}>
            {hints.isFetching
              ? 'Поиск кандидатов…'
              : hintsEnabled
                ? 'Скрыть подсветку кандидатов'
                : 'Подсветить кандидаты в поля'}
          </Button>
          {hintsEnabled && (
            <>
              <span className="muted">
                Подсветка — предложение для наблюдения, а не установленное назначение поля.
              </span>
              {annotations.slice(0, 5).map((item) => (
                <Button
                  key={item.start + ':' + item.length}
                  onClick={() => updateSelection(item.start, item.length)}
                >
                  @{item.start} · {item.label}
                </Button>
              ))}
              {hints.data && !annotations.length && (
                <span>Для этого потока кандидатов в выборке нет.</span>
              )}
              {hints.error && <ErrorState error={hints.error} />}
            </>
          )}
        </div>
      )}
      {import.meta.env.DEV &&
        config.mode === 'mock' &&
        ['capture-baseline', 'capture-additional', 'capture-defects', 'capture-precision'].includes(
          captureId,
        ) && (
          <Banner tone="warning">
            Это прежний демонстрационный корпус. Его исходные кадры сохранены, но карта источников
            неполна. Для нового исследования выберите запись демо v2.
          </Banner>
        )}
      <div className="context-line">
        <span>{captureId || 'Запись не выбрана'}</span>
        <ChevronRight size={13} aria-hidden="true" />
        <span>{sessionId || 'Сессия не выбрана'}</span>
        <ChevronRight size={13} aria-hidden="true" />
        <span>{direction === 'A_TO_B' ? 'A→B' : 'B→A'}</span>
        <code>{assemblyId}</code>
        {assembly && (
          <span>
            Настройки <code>{assembly.settingsVersion}</code>
          </span>
        )}
      </div>
      <div className="mobile-pane-tabs" role="group" aria-label="Панели обмена">
        {[
          ['list', 'Записи и сессии'],
          ['bytes', 'HEX / ASCII'],
          ['source', 'Источники'],
        ].map(([value, label]) => (
          <Button key={value} aria-pressed={pane === value} onClick={() => setPane(value!)}>
            {label}
          </Button>
        ))}
      </div>
      <div
        className="traffic-workbench"
        data-pane={pane}
        style={{
          gridTemplateColumns: leftWidth + 'px 6px minmax(0, 1fr) 6px ' + rightWidth + 'px',
        }}
      >
        <aside className="traffic-list panel">
          <div className="panel-heading">
            <h2>Записи и сессии</h2>
          </div>
          <QueryState
            pending={captures.isPending}
            error={captures.initialError}
            retry={() => void captures.refetch()}
          >
            <Field label="Исходная запись">
              {(id) => (
                <select
                  id={id}
                  value={captureId}
                  onChange={(event) => {
                    const next = new URLSearchParams(params);
                    for (const key of [
                      'sessionId',
                      'sessionCursor',
                      'streamId',
                      'assemblyId',
                      'start',
                      'length',
                      'window',
                      'packetNo',
                      'runId',
                      'revisionId',
                      'returnTo',
                    ])
                      next.delete(key);
                    next.set('captureId', event.target.value);
                    setParams(next, { flushSync: true });
                  }}
                >
                  {!captureId && (
                    <option value="" disabled>
                      Нет готовых записей
                    </option>
                  )}
                  {captureId &&
                    !captures.data?.items.some((item) => item.captureId === captureId) && (
                      <option value={captureId}>{captureId} · выбранная запись</option>
                    )}
                  {captures.data?.items.map((capture) => (
                    <option
                      key={capture.captureId}
                      value={capture.captureId}
                      disabled={capture.status !== 'READY'}
                    >
                      {capture.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <MoreChoices label="записи" query={captures} />
          </QueryState>
          <Field
            label="Адрес или порт"
            hint="Поиск по адресам сторон, например 192.168.10.42 или 502."
          >
            {(id) => (
              <input
                id={id}
                type="search"
                placeholder="Например, 502…"
                value={search.value}
                onChange={(event) => search.setValue(event.target.value)}
              />
            )}
          </Field>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={defects === 'true'}
              onChange={(event) => {
                const next = new URLSearchParams(params);
                if (event.target.checked) next.set('defects', 'true');
                else next.delete('defects');
                next.delete('sessionCursor');
                setParams(next, { flushSync: true });
              }}
            />
            Только с дефектами
          </label>
          <small className="muted">
            Неполные сессии, пропуски, конфликты и усечение. Одинаковые ретрансляции сохраняются как
            источники.
          </small>
          <div className="query-updating" role="status">
            {search.pending || sessions.isFetching ? 'Поиск сессий…' : ''}
          </div>
          {captureId ? (
            <QueryState
              pending={sessions.isPending}
              error={sessions.error}
              retry={() => void sessions.refetch()}
            >
              {sessions.data?.items.map((item) => (
                <button
                  type="button"
                  className={'session-card ' + (item.sessionId === sessionId ? 'active' : '')}
                  key={item.sessionId}
                  disabled={sessions.isFetching || search.pending}
                  onClick={() => {
                    const next = new URLSearchParams();
                    for (const key of [
                      'q',
                      'defects',
                      'sessionCursor',
                      'captureCursor',
                      'direction',
                      'mode',
                      'scenario',
                    ]) {
                      const value = params.get(key);
                      if (value !== null) next.set(key, value);
                    }
                    next.set('captureId', captureId);
                    next.set('sessionId', item.sessionId);
                    setParams(next, { flushSync: true });
                  }}
                >
                  <strong>TCP · поколение {item.generation}</strong>
                  <span className="mono">{item.sideA}</span>
                  <span className="mono">{item.sideB}</span>
                  <span>{formatInteger(item.bytes)} байт</span>
                  <span className="timestamp">{formatTimestamp(item.startTime)}</span>
                  <span className="timestamp">{formatTimestamp(item.endTime)}</span>
                  <small>
                    {item.role === 'UNKNOWN'
                      ? 'Роли сторон неизвестны'
                      : 'A: наблюдаемый инициатор; B: устройство'}
                  </small>
                  {item.defects.map((defect) => (
                    <small className="defect-label" key={defect}>
                      {defect}
                    </small>
                  ))}
                </button>
              ))}
              {sessions.data && !sessions.data.items.length && (
                <Empty
                  title="Сессий нет"
                  description="Измените адрес или порт либо снимите фильтр дефектов."
                />
              )}
              {sessions.data && (
                <Pagination
                  cursor={sessionCursor}
                  nextCursor={sessions.data.nextCursor}
                  onChange={(value) => {
                    const next = new URLSearchParams(params);
                    next.set('sessionCursor', value);
                    setParams(next, { flushSync: true });
                  }}
                  total={sessions.data.total}
                  busy={sessions.isFetching || search.pending}
                />
              )}
            </QueryState>
          ) : (
            <Empty title="Нет записи" description="Добавьте запись в обзоре проекта." />
          )}
        </aside>
        <Resizer
          label="Ширина списка сессий"
          value={leftWidth}
          min={180}
          max={350}
          onChange={(value) => {
            setLeftWidth(value);
            savePreference('traffic:left', String(value));
          }}
        />
        <section className="traffic-bytes panel">
          <div className="panel-heading">
            <h2>HEX / ASCII</h2>
            <span className="muted">Точный диапазон</span>
          </div>
          <div className="stream-controls">
            <Field label="Направление">
              {(id) => (
                <select
                  id={id}
                  value={direction}
                  onChange={(event) =>
                    setParams({ captureId, sessionId, direction: event.target.value })
                  }
                >
                  <option value="A_TO_B">A → B</option>
                  <option value="B_TO_A">B → A</option>
                </select>
              )}
            </Field>
            <Field
              label="Сборка"
              hint="Сборки в процессе подготовки и с ошибкой недоступны для исследования."
            >
              {(id) => (
                <select
                  id={id}
                  value={assemblyId}
                  onChange={(event) =>
                    selectedLength !== '0'
                      ? setPendingAssembly(event.target.value)
                      : changeAssembly(event.target.value)
                  }
                >
                  {assemblies.data?.items
                    .filter((item) => item.direction === direction)
                    .map((item) => (
                      <option
                        key={item.assemblyId + ':' + item.streamId}
                        value={item.assemblyId}
                        disabled={item.status !== 'READY'}
                      >
                        {item.assemblyId} · {item.settingsVersion} ·{' '}
                        {item.status === 'BUILDING'
                          ? 'Ещё собирается'
                          : item.status === 'READY'
                            ? 'READY · Готова'
                            : 'Ошибка сборки'}
                      </option>
                    ))}
                </select>
              )}
            </Field>
          </div>
          {session?.role === 'UNKNOWN' && (
            <Banner tone="warning">
              Начало и роли соединения неизвестны. Названия клиент / сервер не установлены.
            </Banner>
          )}
          {session?.defects.some((item) => /checksum/i.test(item)) && (
            <Banner tone="warning">
              Checksum: политика {settings.data?.[0]?.checksum ?? 'не получена'} ·{' '}
              {assembly?.settingsVersion}. Возможный offloading не доказывает нарушение протокола.
              Альтернативы и дефекты сохраняются.
            </Banner>
          )}
          {assemblies.error && (
            <ErrorState error={assemblies.error} retry={() => void assemblies.refetch()} />
          )}
          <MoreChoices label="версии сборки" query={assemblies} />
          {assemblies.data &&
            assemblyId &&
            !assembly &&
            !assemblies.resolving &&
            !assemblies.error &&
            !assemblies.paginationError && (
              <ErrorState
                error={
                  new Error(
                    'Эта сборка не найдена. Историческая ссылка не перенаправляется на последнюю сборку.',
                  )
                }
              />
            )}
          {selection && assembly?.status === 'READY' && !linkError && (
            <>
              <form
                className="range-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  updateSelection(String(data.get('start')), String(data.get('length')), true);
                }}
              >
                <Field
                  label="Начало, байт"
                  error={inputErrors.start}
                  hint="Целое смещение от начала потока, начиная с 0."
                >
                  {(id) => (
                    <input
                      key={selection.start}
                      id={id}
                      name="start"
                      inputMode="numeric"
                      className="mono"
                      defaultValue={selection!.start}
                      onChange={() => setInputErrors((errors) => ({ ...errors, start: undefined }))}
                    />
                  )}
                </Field>
                <Field
                  label="Длина, байт"
                  error={inputErrors.length}
                  hint="Число байтов; 0 снимает выделение."
                >
                  {(id) => (
                    <input
                      key={selection.length}
                      id={id}
                      name="length"
                      inputMode="numeric"
                      className="mono"
                      defaultValue={selection!.length}
                      onChange={() =>
                        setInputErrors((errors) => ({ ...errors, length: undefined }))
                      }
                    />
                  )}
                </Field>
                <Button type="submit">Перейти к диапазону</Button>
              </form>
              <span className="sr-only" aria-live="polite">
                Выделено от {selection.start}, длина {selection.length} байт
              </span>
              <SearchPanel
                key={selection.assemblyId}
                location={selection}
                onSelect={(start, length) => updateSelection(start, length, true)}
              />
              {bytes.isPlaceholderData && (
                <Banner>
                  Загрузка нового окна… Пока показано предыдущее загруженное окно этой сборки.
                </Banner>
              )}
              <QueryState
                pending={bytes.isPending}
                error={bytes.error}
                retry={() => void bytes.refetch()}
              >
                {bytes.data &&
                  (bytes.data.segments.length ? (
                    <HexViewer
                      window={bytes.data}
                      annotations={annotations}
                      selection={selection}
                      onSelect={(start, length, windowStart) =>
                        updateSelection(start, length, windowStart ?? false)
                      }
                      onWindow={(start) => {
                        const next = new URLSearchParams(params);
                        Object.entries(selection!).forEach(([key, value]) => next.set(key, value));
                        next.set('window', start);
                        setParams(next, { replace: true });
                      }}
                    />
                  ) : (
                    <Empty
                      title="Поток пуст"
                      description="Ноль байтов не означает успешную проверку протокола."
                    />
                  ))}
              </QueryState>
              {bytes.data?.segments
                .filter((segment) => segment.kind === 'conflict')
                .map(
                  (segment) =>
                    segment.kind === 'conflict' && (
                      <details className="conflict-details" key={segment.start}>
                        <summary>
                          Конфликт [{segment.start},{' '}
                          {BigInt(segment.start) + BigInt(segment.length)}) · альтернативы не
                          выбраны
                        </summary>
                        {segment.alternatives.map((alternative, index) => (
                          <div key={index}>
                            <strong>Альтернатива {index + 1}</strong>
                            <code>
                              {alternative.bytes
                                .map((byte) => byte.toString(16).padStart(2, '0'))
                                .join(' ')}
                            </code>
                            <p>
                              Кадры{' '}
                              {alternative.sources.map((source) => source.packetNo).join(', ')}
                            </p>
                          </div>
                        ))}
                      </details>
                    ),
                )}
            </>
          )}
        </section>
        <Resizer
          label="Ширина инспектора источника"
          value={rightWidth}
          min={260}
          max={500}
          invert
          onChange={(value) => {
            setRightWidth(value);
            savePreference('traffic:right', String(value));
          }}
        />
        <aside className="traffic-source panel">
          {selection && assembly?.status === 'READY' && !linkError ? (
            <SourceInspector
              location={selection}
              runId={params.get('runId') ?? undefined}
              revisionId={params.get('revisionId') ?? undefined}
            />
          ) : (
            <Empty title="Источник" description="Выберите готовую сборку и диапазон." />
          )}
        </aside>
      </div>
      <Modal
        open={!!pendingAssembly}
        onOpenChange={(open) => {
          if (!open) setPendingAssembly(undefined);
        }}
        title="Сменить сборку?"
        description="Диапазон будет открыт в другой версии байтов. Сохранённые доказательства и исторические ссылки останутся в прежней сборке."
      >
        <div className="toolbar">
          <Button onClick={() => setPendingAssembly(undefined)}>Оставить текущую</Button>
          <Button
            variant="primary"
            onClick={() => pendingAssembly && changeAssembly(pendingAssembly)}
          >
            Открыть другую сборку
          </Button>
        </div>
      </Modal>
    </>
  );
}
