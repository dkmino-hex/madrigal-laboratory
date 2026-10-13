import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProject } from '../app/Shell';
import { api } from '../shared/api/client';
import { queryKey } from '../shared/api/query';
import { MoreChoices, usePagedChoices } from '../shared/api/paged-choices';
import type { Location } from '../shared/api/contracts/draft';
import { boundedIndex, decimal } from '../shared/model/precision';
import { byteHex, cellAt, compareCells } from '../shared/model/bytes';
import { pairFields } from '../shared/model/fields';
import { readLocation, sourceLink } from '../shared/model/navigation';
import { Banner, Button, Field, PageHeading, QueryState, ErrorState } from '../shared/ui/common';
import { RangePicker } from '../shared/ui/RangePicker';
export default function Compare() {
  const projectId = useProject().projectId;
  const [params, setParams] = useSearchParams();
  const paramsRef = useRef(params);
  paramsRef.current = params;
  let initial: Location | null = null;
  let initialRight: Location | null = null;
  let sourceError: Error | undefined;
  try {
    if (params.get('left'))
      initial = readLocation(
        new URL(params.get('left')!, window.location.origin).searchParams,
        projectId,
      );
    if (params.get('right'))
      initialRight = readLocation(
        new URL(params.get('right')!, window.location.origin).searchParams,
        projectId,
      );
    if ((params.get('left') && !initial) || (params.get('right') && !initialRight))
      throw new Error(
        'Ссылка сравнения содержит неполный контекст сборки. Другой диапазон не подставляется.',
      );
  } catch (error) {
    sourceError = error as Error;
  }
  const [left, setLeft] = useState<Location | null>(initial);
  const [right, setRight] = useState<Location | null>(initialRight);
  const [relative, setRelative] = useState(0n);
  function choose(side: 'left' | 'right', value: Location | null) {
    if (sourceError) return;
    (side === 'left' ? setLeft : setRight)(value);
    setRelative(0n);
    setParsedInput(null);
    const next = new URLSearchParams(paramsRef.current);
    if (value) next.set(side, sourceLink(value));
    paramsRef.current = next;
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }
  const [sync, setSync] = useState(true);
  const leftScroll = useRef<HTMLDivElement>(null);
  const rightScroll = useRef<HTMLDivElement>(null);
  function windowFor(location: Location | null) {
    if (!location) return null;
    const remaining = BigInt(location.length) - relative;
    if (remaining <= 0n) return null;
    return {
      ...location,
      start: decimal(BigInt(location.start) + relative),
      length: decimal(remaining > 256n ? 256n : remaining),
    };
  }
  const leftWindow = windowFor(left);
  const rightWindow = windowFor(right);
  const leftData = useQuery({
    queryKey: queryKey(projectId, 'bytes', leftWindow ? { ...leftWindow } : {}),
    queryFn: ({ signal }) => api.bytes(leftWindow!, { signal }),
    enabled: !!leftWindow,
  });
  const rightData = useQuery({
    queryKey: queryKey(projectId, 'bytes', rightWindow ? { ...rightWindow } : {}),
    queryFn: ({ signal }) => api.bytes(rightWindow!, { signal }),
    enabled: !!rightWindow,
  });
  const interpretations = usePagedChoices(projectId, 'interpretations', (cursor, signal) =>
    api.interpretations({ projectId, cursor }, { signal }),
  );
  const leftRevision = params.get('leftRevision') ?? '';
  const rightRevision = params.get('rightRevision') ?? '';
  function chooseRevision(side: 'leftRevision' | 'rightRevision', value: string) {
    const next = new URLSearchParams(paramsRef.current);
    next.set(side, value);
    paramsRef.current = next;
    setParams(next, { replace: true });
    setParsedInput(null);
  }
  const leftModelId =
    params.get('leftInterpretation') ?? interpretations.data?.items[0]?.interpretationId ?? '';
  const rightModelId =
    params.get('rightInterpretation') ?? interpretations.data?.items[0]?.interpretationId ?? '';
  const modelLeft = useQuery({
    queryKey: queryKey(projectId, 'interpretation', { interpretationId: leftModelId }),
    queryFn: ({ signal }) => api.interpretation(projectId, leftModelId, { signal }),
    enabled: !!leftModelId,
  });
  const modelRight = useQuery({
    queryKey: queryKey(projectId, 'interpretation', { interpretationId: rightModelId }),
    queryFn: ({ signal }) => api.interpretation(projectId, rightModelId, { signal }),
    enabled: !!rightModelId,
  });
  const modelChoices = [
    ...new Map(
      [
        ...(interpretations.data?.items ?? []),
        ...(modelLeft.data ? [modelLeft.data] : []),
        ...(modelRight.data ? [modelRight.data] : []),
      ].map((item) => [item.interpretationId, item]),
    ).values(),
  ];
  const revisionsA = modelLeft.data?.revisions ?? [];
  const revisionsB = modelRight.data?.revisions ?? [];
  const revA = leftRevision || revisionsA[0]?.revisionId || '';
  const revB = rightRevision || revisionsB.at(-1)?.revisionId || '';
  const validModels =
    revisionsA.some((revision) => revision.revisionId === revA) &&
    revisionsB.some((revision) => revision.revisionId === revB);
  function chooseModel(side: 'left' | 'right', value: string) {
    const next = new URLSearchParams(paramsRef.current);
    next.set(side + 'Interpretation', value);
    next.delete(side + 'Revision');
    paramsRef.current = next;
    setParams(next, { replace: true });
    setParsedInput(null);
  }
  const [parsedInput, setParsedInput] = useState<{
    left: Location;
    right: Location;
    revA: string;
    revB: string;
    leftModelId: string;
    rightModelId: string;
  } | null>(null);
  const parsedLeft = useQuery({
    queryKey: queryKey(projectId, 'preview', {
      interpretationId: parsedInput?.leftModelId,
      revisionId: parsedInput?.revA,
      location: parsedInput?.left,
    }),
    queryFn: ({ signal }) =>
      api.preview(
        {
          projectId,
          interpretationId: parsedInput!.leftModelId,
          revisionId: parsedInput!.revA,
          location: parsedInput!.left,
        },
        { signal },
      ),
    enabled: !!parsedInput,
  });
  const parsedRight = useQuery({
    queryKey: queryKey(projectId, 'preview', {
      interpretationId: parsedInput?.rightModelId,
      revisionId: parsedInput?.revB,
      location: parsedInput?.right,
    }),
    queryFn: ({ signal }) =>
      api.preview(
        {
          projectId,
          interpretationId: parsedInput!.rightModelId,
          revisionId: parsedInput!.revB,
          location: parsedInput!.right,
        },
        { signal },
      ),
    enabled: !!parsedInput,
  });
  const count = Math.max(
    leftWindow ? boundedIndex(BigInt(leftWindow.length), 256) : 0,
    rightWindow ? boundedIndex(BigInt(rightWindow.length), 256) : 0,
  );
  const comparisons = Array.from({ length: count }, (_, index) => {
    const l =
      leftData.data && index < Number(BigInt(leftWindow?.length ?? '0'))
        ? cellAt(leftData.data, decimal(BigInt(leftWindow!.start) + BigInt(index)))
        : null;
    const r =
      rightData.data && index < Number(BigInt(rightWindow?.length ?? '0'))
        ? cellAt(rightData.data, decimal(BigInt(rightWindow!.start) + BigInt(index)))
        : null;
    return { index, left: l, right: r, status: l ? compareCells(l, r) : r ? 'tail' : 'unknown' };
  });
  const fieldsA = parsedLeft.data?.results.flatMap((result) => result.fields) ?? [];
  const fieldsB = parsedRight.data?.results.flatMap((result) => result.fields) ?? [];
  const fieldPairs = pairFields(
    fieldsA,
    fieldsB,
    parsedInput?.left.start ?? '0',
    parsedInput?.right.start ?? '0',
  );
  if (sourceError)
    return (
      <>
        <ErrorState error={sourceError} />
        <Link className="button secondary" to={'/projects/' + projectId + '/compare'}>
          Открыть сравнение без неверной ссылки
        </Link>
      </>
    );
  return (
    <>
      <PageHeading
        title="Сравнение двух примеров"
        subtitle="Сравнение относительно выбранных начал. Одинаковые смещения в разных потоках не означают одинаковый источник."
      />
      <div className="comparison-grid">
        <RangePicker
          projectId={projectId}
          label="Левый пример"
          initial={initial}
          onChange={(value) => choose('left', value)}
        />
        <RangePicker
          projectId={projectId}
          label="Правый пример"
          initial={initialRight}
          onChange={(value) => choose('right', value)}
        />
      </div>
      <div className="context-line">
        {left && (
          <Link className="button ghost" to={sourceLink(left)}>
            Открыть левый источник
          </Link>
        )}
        {right && (
          <Link className="button ghost" to={sourceLink(right)}>
            Открыть правый источник
          </Link>
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={sync}
            onChange={(event) => setSync(event.target.checked)}
          />
          Синхронная прокрутка
        </label>
      </div>
      <Banner>
        Страница сравнения ограничена 256 байтами. Неизвестный / конфликтный участок означает
        недостаток данных; хвост более длинного диапазона показан отдельно.
      </Banner>
      <QueryState
        pending={(!!leftWindow && leftData.isPending) || (!!rightWindow && rightData.isPending)}
        error={leftData.error ?? rightData.error}
        retry={() => {
          void leftData.refetch();
          void rightData.refetch();
        }}
      >
        <div className="comparison-grid">
          {(['left', 'right'] as const).map((side) => (
            <section className="panel" key={side}>
              <h2>{side === 'left' ? 'Левый диапазон' : 'Правый диапазон'}</h2>
              <div
                className="compare-bytes mono"
                role="region"
                tabIndex={0}
                aria-label={side === 'left' ? 'Байты левого диапазона' : 'Байты правого диапазона'}
                ref={side === 'left' ? leftScroll : rightScroll}
                onScroll={(event) => {
                  if (sync) {
                    const target = side === 'left' ? rightScroll.current : leftScroll.current;
                    if (target && target.scrollTop !== event.currentTarget.scrollTop)
                      target.scrollTop = event.currentTarget.scrollTop;
                  }
                }}
              >
                {comparisons.map((row) => (
                  <div className={'compare-byte-row ' + row.status} key={row.index}>
                    <span>+{relative + BigInt(row.index)}</span>
                    <code>{row[side] ? byteHex(row[side]!) : '—'}</code>
                    <span>
                      {row.status === 'equal'
                        ? 'Совпадает'
                        : row.status === 'different'
                          ? 'Различается'
                          : row.status === 'tail'
                            ? 'Хвост диапазона'
                            : 'Недостаточно данных'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="toolbar">
          <Button
            disabled={relative === 0n}
            onClick={() => setRelative(relative < 256n ? 0n : relative - 256n)}
          >
            Предыдущая страница сравнения
          </Button>
          <span className="mono">Относительное начало {String(relative)}</span>
          <Button
            disabled={
              relative + 256n >= BigInt(left?.length ?? '0') &&
              relative + 256n >= BigInt(right?.length ?? '0')
            }
            onClick={() => setRelative(relative + 256n)}
          >
            Следующая страница сравнения
          </Button>
        </div>
      </QueryState>
      <section className="panel">
        <div className="panel-heading">
          <h2>Значения полей после разбора</h2>
        </div>
        <div className="form-grid">
          {(['left', 'right'] as const).map((side) => (
            <Field
              key={side}
              label={'Интерпретация ' + (side === 'left' ? 'левого' : 'правого') + ' примера'}
            >
              {(id) => (
                <select
                  id={id}
                  value={side === 'left' ? leftModelId : rightModelId}
                  onChange={(event) => chooseModel(side, event.target.value)}
                >
                  <option value="">Выберите модель</option>
                  {modelChoices.map((item) => (
                    <option key={item.interpretationId} value={item.interpretationId}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ))}
          <Field label="Ревизия левого примера">
            {(id) => (
              <select
                id={id}
                value={revA}
                onChange={(event) => chooseRevision('leftRevision', event.target.value)}
              >
                {leftRevision && !revisionsA.some((rev) => rev.revisionId === leftRevision) && (
                  <option value={leftRevision}>{leftRevision} · недоступна</option>
                )}
                {revisionsA.map((rev) => (
                  <option key={rev.revisionId}>{rev.revisionId}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Ревизия правого примера">
            {(id) => (
              <select
                id={id}
                value={revB}
                onChange={(event) => chooseRevision('rightRevision', event.target.value)}
              >
                {rightRevision && !revisionsB.some((rev) => rev.revisionId === rightRevision) && (
                  <option value={rightRevision}>{rightRevision} · недоступна</option>
                )}
                {revisionsB.map((rev) => (
                  <option key={rev.revisionId}>{rev.revisionId}</option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <MoreChoices label="интерпретации" query={interpretations} />
        {[interpretations.initialError, modelLeft.error, modelRight.error]
          .filter(Boolean)
          .map((error, index) => (
            <ErrorState key={index} error={error} />
          ))}
        {((leftRevision &&
          modelLeft.data &&
          !revisionsA.some((rev) => rev.revisionId === leftRevision)) ||
          (rightRevision &&
            modelRight.data &&
            !revisionsB.some((rev) => rev.revisionId === rightRevision))) && (
          <ErrorState
            error={
              new Error(
                'Указанная ревизия не принадлежит выбранной модели. Выберите сохранённую ревизию.',
              )
            }
          />
        )}
        <Button
          disabled={
            !left ||
            !right ||
            BigInt(left.length) > 4096n ||
            BigInt(right.length) > 4096n ||
            !validModels
          }
          onClick={() => {
            if (!left || !right || !validModels) return;
            const next = new URLSearchParams(paramsRef.current);
            next.set('leftInterpretation', leftModelId);
            next.set('rightInterpretation', rightModelId);
            next.set('leftRevision', revA);
            next.set('rightRevision', revB);
            paramsRef.current = next;
            setParams(next, { replace: true });
            setParsedInput({ left, right, revA, revB, leftModelId, rightModelId });
          }}
        >
          Получить поля сохранённых ревизий
        </Button>
        {parsedInput && (
          <QueryState
            pending={parsedLeft.isPending || parsedRight.isPending}
            error={parsedLeft.error ?? parsedRight.error}
          >
            {parsedInput.revA !== parsedInput.revB && (
              <Banner tone="warning">
                Ревизии различаются. Соответствие полей должно быть проверено; одинаковый путь сам
                по себе не доказывает идентичность.
              </Banner>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ID поля / тип</th>
                    <th>Левое значение</th>
                    <th>Правое значение</th>
                    <th>Источники</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldPairs.map((pair, index) => {
                    const field = pair.left ?? pair.right!;
                    return (
                      <tr key={index}>
                        <td>
                          <code>{field.fieldId}</code>
                          <small>
                            {field.type} · относительное начало {pair.relativeStart}
                          </small>
                        </td>
                        <td className="mono">
                          {pair.left ? (pair.left.value ?? 'Неизвестно') : 'Несопоставимо'}
                        </td>
                        <td className="mono">
                          {pair.right ? (pair.right.value ?? 'Неизвестно') : 'Несопоставимо'}
                        </td>
                        <td>
                          {pair.left && (
                            <Link to={sourceLink(pair.left.location)}>Левый источник</Link>
                          )}
                          {pair.right && (
                            <Link to={sourceLink(pair.right.location)}>Правый источник</Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </QueryState>
        )}
      </section>
    </>
  );
}
