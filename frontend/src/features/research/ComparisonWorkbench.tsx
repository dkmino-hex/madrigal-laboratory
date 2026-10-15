import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Interpretation } from '../../shared/api/contracts/models';
import type {
  AutomaticInput,
  Discovery,
  ResearchCandidate,
  ResearchRow,
} from '../../shared/api/contracts/research';
import { api } from '../../shared/api/client';
import { queryKey, useCommand } from '../../shared/api/query';
import { researchBytes, candidateValue } from '../../shared/model/research';
import {
  actionLabel,
  displayResearchValue,
  exampleStatus,
  exampleTime,
  fieldHex,
  observationPresentation,
  observationText,
  parameterInfo,
  readingDescription,
  type ObservationPresentation,
} from '../../shared/model/research-presentation';
import { sourceLink } from '../../shared/model/navigation';
import { AutomaticObservation } from '../observations/AutomaticObservation';
import { Banner, Button, Empty, ErrorState, Field, Pagination } from '../../shared/ui/common';
import { ExampleInspector } from './ExampleInspector';
import { ByteMatrix } from './ByteMatrix';
import { CandidateList, CompactByteMatrix } from './CandidateComparison';

function groupTitle(group: Discovery['groups'][number], rows: ResearchRow[], index: number) {
  const members = rows.filter((row) => row.groupId === group.id),
    counts = new Map<string, number>();
  for (const row of members) {
    const label = actionLabel(row.label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
  const label =
    sorted[0] && sorted[0][1] >= members.length / 2
      ? sorted[0][0] + (sorted.length > 1 ? ' и другие' : '')
      : 'Разные действия';
  return `${label} · ${members[0]?.location.direction.replaceAll('_TO_', ' → ') ?? 'направление неизвестно'} · ${group.rows} примеров · группа ${index + 1}`;
}
function candidateTitle(candidate: ResearchCandidate) {
  return candidate.kind === 'parameter'
    ? parameterInfo(candidate.parameter).title
    : candidate.kind === 'constant'
      ? 'Постоянный участок'
      : 'Изменяющийся участок';
}

export function ComparisonWorkbench({ result }: { result: Discovery }) {
  const [params, setParams] = useSearchParams();
  const first =
    result.candidates.find((candidate) => candidate.kind === 'parameter') ?? result.candidates[0];
  const group =
    result.groups.find((item) => item.id === params.get('group')) ??
    result.groups.find(
      (item) =>
        item.id ===
        result.candidates.find((candidate) => candidate.parameter === params.get('parameter'))
          ?.groupId,
    ) ??
    result.groups.find((item) => item.id === first?.groupId) ??
    result.groups[0];
  const groupId = group?.id ?? '';
  const rows = result.rows.filter((row) => row.groupId === groupId);
  const groupCandidates = result.candidates.filter((candidate) => candidate.groupId === groupId);
  const parameter = params.has('parameter')
    ? params.get('parameter')!
    : (groupCandidates.find((candidate) => candidate.kind === 'parameter')?.parameter ?? '');
  const candidates = groupCandidates.filter(
    (candidate) => !parameter || !candidate.parameter || candidate.parameter === parameter,
  );
  const picked =
    candidates.find((candidate) => candidate.id === params.get('candidate')) ??
    candidates[0] ??
    null;
  const [saved, setSaved] = useState<Record<string, Interpretation>>({});
  const [proposal, setProposal] = useState<{
    input: AutomaticInput;
    presentation: ObservationPresentation;
    candidate: ResearchCandidate;
  } | null>(null);
  const model = picked ? saved[picked.id] : undefined;
  function update(values: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values))
      if (value === null) next.delete(key);
      else next.set(key, value);
    setParams(next, { replace: true });
  }
  const schema = useCommand(
    'createInterpretation',
    (candidate: ResearchCandidate, options) =>
      api.createInterpretation(
        {
          projectId: result.projectId,
          name: ('Кандидат: ' + candidateTitle(candidate)).slice(0, 120),
          description: observationText(candidate),
          json: candidate.schemaJson,
        },
        options,
      ),
    [queryKey(result.projectId, 'interpretations')],
  );
  function createSchema(candidate: ResearchCandidate) {
    schema.mutate(candidate, {
      onSuccess: (interpretation) =>
        setSaved((previous) => ({ ...previous, [candidate.id]: interpretation })),
    });
  }
  function observe(candidate: ResearchCandidate) {
    update({ candidate: candidate.id });
    setProposal({
      candidate,
      presentation: observationPresentation(candidate, rows),
      input: {
        projectId: result.projectId,
        text: observationText(candidate),
        basis:
          candidate.basis +
          ` Приложено ${candidate.examples.length} источников из выборки ${candidate.total}. Технический параметр: ${candidate.parameter || 'не установлен'}. Чтение: ${candidate.encoding}${candidate.divisor === 1 ? '' : ' ÷ ' + candidate.divisor}.`,
        generation: {
          engineVersion: result.engineVersion,
          fingerprint: result.fingerprint,
          candidateId: candidate.id,
          kind: candidate.kind,
          parameter: candidate.parameter,
          matches: candidate.matches,
          total: candidate.total,
        },
        examples: candidate.examples,
      },
    });
  }
  const query = params.get('exampleSearch') ?? '',
    onlyCounterexamples = params.get('examples') === 'counterexamples';
  const filtered = rows.filter(
    (row) =>
      (!onlyCounterexamples || picked?.counterexamples.includes(row.id)) &&
      (!query ||
        [
          row.label,
          actionLabel(row.label),
          row.captureName,
          ...Object.values(row.values),
          ...Object.values(row.values).map((value) => value.replace('.', ',')),
        ].some((text) => text.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')))),
  );
  const rawPage = params.get('examplePage') ?? '0';
  const page =
    /^\d{1,4}$/.test(rawPage) && Number(rawPage) < filtered.length
      ? Math.floor(Number(rawPage) / 24) * 24
      : 0;
  const shown = filtered.slice(page, page + 24);
  const selectedRow =
    shown.find((row) => row.id === params.get('example')) ??
    shown.find((row) => picked?.support.includes(row.id)) ??
    shown[0];
  const selectedIndex = shown.findIndex((row) => row.id === selectedRow?.id);
  const byteView = params.get('compareView') !== 'values';
  const returnParams = new URLSearchParams(params);
  returnParams.set('group', groupId);
  returnParams.set('parameter', parameter);
  returnParams.set('captures', result.captures.map((capture) => capture.captureId).join(','));
  if (picked) returnParams.set('candidate', picked.id);
  if (selectedRow) returnParams.set('example', selectedRow.id);
  const returnTo = '/projects/' + result.projectId + '/compare?' + returnParams.toString();
  const schemaExample = rows.find((row) => picked?.support.includes(row.id)) ?? selectedRow;
  const parameters = [...new Set(result.groups.flatMap((item) => item.parameters))].sort((a, b) =>
    parameterInfo(a).title.localeCompare(parameterInfo(b).title, 'ru'),
  );

  return (
    <>
      <div className="research-filters">
        <Field
          label="Что ищем в сообщениях"
          hint="Это значения из журнала эксперимента. Назначение поля ещё предстоит проверить."
        >
          {(id) => (
            <select
              id={id}
              value={parameter}
              onChange={(event) => {
                const value = event.target.value,
                  best =
                    result.candidates.find(
                      (candidate) => candidate.parameter === value && candidate.groupId === groupId,
                    ) ?? result.candidates.find((candidate) => candidate.parameter === value);
                update({
                  parameter: value,
                  group: best?.groupId ?? groupId,
                  candidate: best?.id ?? null,
                  example: null,
                  examplePage: null,
                  examples: null,
                });
              }}
            >
              <option value="">Повторяющиеся и изменяющиеся участки</option>
              {parameters.map((path) => (
                <option key={path} value={path}>
                  {parameterInfo(path).title} ·{' '}
                  {path.startsWith('params.') ? 'действие' : 'результат'}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Какие примеры сравниваем">
          {(id) => (
            <select
              id={id}
              value={groupId}
              onChange={(event) =>
                update({
                  group: event.target.value,
                  parameter: null,
                  candidate: null,
                  example: null,
                  examplePage: null,
                  examples: null,
                })
              }
            >
              {result.groups.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {groupTitle(item, result.rows, index)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {picked && (
        <section className="panel research-finding" aria-label="Найденная закономерность">
          <div className="research-finding-title">
            <div>
              <span className="research-eyebrow">
                {picked.kind === 'parameter' ? 'Возможное поле по журналу' : 'Наблюдение о байтах'}
              </span>
              <h2>{candidateTitle(picked)}</h2>
              <p>{readingDescription(picked)}.</p>
            </div>
            <div className="research-match-count">
              <strong>
                {picked.matches} из {picked.total}
              </strong>
              <span>
                {picked.kind === 'parameter'
                  ? 'сопоставимых примеров совпали'
                  : 'примеров имеют этот признак'}
              </span>
            </div>
          </div>
          <div className="research-workflow" aria-label="Следующие шаги исследования">
            <span data-current="true">1 · Посмотри примеры ниже</span>
            <span>2 · Сохрани наблюдение</span>
            <span>3 · Проверь на другой записи</span>
          </div>
          <p>
            Программа нашла участок, который{' '}
            {picked.kind === 'parameter'
              ? 'можно так прочитать. Название взято из журнала; совпадение значений — основание для проверки назначения поля.'
              : 'ведёт себя одинаково в этой выборке. Его назначение пока неизвестно.'}
          </p>
          {picked.counterexamples.length > 0 && (
            <p className="research-notice">
              {picked.counterexamples.length} примеров противоречат этому чтению. Открой «Только
              отличающиеся» и сравни значения.
            </p>
          )}
          <div className="toolbar">
            <Button
              variant="primary"
              disabled={!picked.examples.length}
              onClick={() => observe(picked)}
            >
              Сохранить наблюдение
            </Button>
            {picked.schemaJson && (
              <Button disabled={schema.isPending || !!model} onClick={() => createSchema(picked)}>
                {schema.isPending
                  ? 'Создаём схему…'
                  : model
                    ? 'Схема создана'
                    : 'Создать схему для проверки'}
              </Button>
            )}
          </div>
          {schema.error && <ErrorState error={schema.error} />}
          {model && (
            <Banner tone="success">
              Схема создана.{' '}
              <Link
                to={
                  '/projects/' +
                  result.projectId +
                  '/interpretations/' +
                  model.interpretationId +
                  (schemaExample
                    ? '?' +
                      new URLSearchParams({ source: sourceLink(schemaExample.location) }).toString()
                    : '')
                }
              >
                Открыть спецификацию →
              </Link>{' '}
              <Link
                to={
                  '/projects/' +
                  result.projectId +
                  '/runs?' +
                  new URLSearchParams({
                    interpretationId: model.interpretationId,
                    revisionId: model.revisions.at(-1)?.revisionId ?? '',
                  }).toString()
                }
              >
                Проверить на другой записи →
              </Link>
            </Banner>
          )}
        </section>
      )}
      <div className="research-summary">
        <strong>
          {result.rows.length} найденных примеров · {result.groups.length} групп
        </strong>
        <span>
          {result.complete
            ? 'Поиск завершён в пределах интерактивной выборки'
            : 'Выборка ограничена — подробности ниже'}
        </span>
      </div>
      <div className="research-workbench research-linked-workbench">
        <section className="panel research-examples">
          <div className="panel-heading">
            <h2>Примеры: журнал и найденное значение</h2>
            <span>
              {filtered.length} из {rows.length}
            </span>
          </div>
          <p className="muted">
            Выбери строку — байты и объяснение появятся в панели «Выбранный пример». Стрелки ↑ ↓
            переключают примеры.
          </p>
          <div className="research-example-filters">
            <Field label="Найти пример">
              {(id) => (
                <input
                  id={id}
                  type="search"
                  value={query}
                  placeholder="Имя записи, действие или значение"
                  onChange={(event) =>
                    update({ exampleSearch: event.target.value, examplePage: null, example: null })
                  }
                />
              )}
            </Field>
            <Button
              aria-pressed={onlyCounterexamples}
              disabled={!onlyCounterexamples && !picked?.counterexamples.length}
              onClick={() =>
                update({
                  examples: onlyCounterexamples ? null : 'counterexamples',
                  example: null,
                  examplePage: null,
                })
              }
            >
              {onlyCounterexamples ? 'Показать все примеры' : 'Только отличающиеся'}
              {!onlyCounterexamples && picked ? ' · ' + picked.counterexamples.length : ''}
            </Button>
          </div>
          <div className="comparison-view-switch" role="group" aria-label="Вид примеров">
            <Button aria-pressed={byteView} onClick={() => update({ compareView: 'bytes' })}>
              Байты
            </Button>
            <Button aria-pressed={!byteView} onClick={() => update({ compareView: 'values' })}>
              Значения
            </Button>
          </div>
          {byteView && group ? (
            <CompactByteMatrix
              group={group}
              rows={shown}
              picked={picked}
              selectedRowId={selectedRow?.id}
              onSelect={(id) => update({ example: id })}
            />
          ) : (
            <div
              className="research-example-table"
              role="region"
              aria-label="Сопоставление значений"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>Действие и запись</th>
                    <th>В журнале</th>
                    <th>Из байтов</th>
                    <th>Байты поля</th>
                    <th>Сопоставление</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row, index) => {
                    const status = picked ? exampleStatus(row, picked) : 'Чтение не выбрано';
                    return (
                      <tr
                        key={row.id}
                        data-selected={row.id === selectedRow?.id}
                        data-example-status={
                          status === 'Совпало'
                            ? 'match'
                            : status === 'Отличается'
                              ? 'counterexample'
                              : 'unknown'
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="research-example-pick"
                            aria-pressed={row.id === selectedRow?.id}
                            data-example-index={index}
                            onClick={() => update({ example: row.id })}
                            onKeyDown={(event) => {
                              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                              event.preventDefault();
                              const next = Math.max(
                                0,
                                Math.min(
                                  shown.length - 1,
                                  index + (event.key === 'ArrowDown' ? 1 : -1),
                                ),
                              );
                              update({ example: shown[next]!.id });
                              event.currentTarget
                                .closest('tbody')
                                ?.querySelector<HTMLButtonElement>(
                                  `button[data-example-index="${next}"]`,
                                )
                                ?.focus();
                            }}
                          >
                            {actionLabel(row.label)}
                            <small>{row.captureName}</small>
                            <small>Захват: {exampleTime(row.timestamp)}</small>
                          </button>
                        </td>
                        <td>
                          {picked?.parameter
                            ? displayResearchValue(row.values[picked.parameter], picked.parameter)
                            : '—'}
                        </td>
                        <td>
                          <strong>
                            {picked?.kind === 'parameter'
                              ? displayResearchValue(
                                  candidateValue(researchBytes(row), picked),
                                  picked.parameter,
                                )
                              : '—'}
                          </strong>
                        </td>
                        <td>
                          <code>{picked ? (fieldHex(row, picked) ?? 'Недоступны') : '—'}</code>
                        </td>
                        <td>
                          <span
                            className="research-status"
                            data-status={
                              status === 'Совпало'
                                ? 'match'
                                : status === 'Отличается'
                                  ? 'counterexample'
                                  : 'unknown'
                            }
                          >
                            {status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!shown.length && (
            <Empty
              title="Нет примеров по этому фильтру"
              description="Очисти поиск или покажи все примеры группы."
            />
          )}
          <Pagination
            cursor={String(page)}
            nextCursor={page + 24 < filtered.length ? String(page + 24) : null}
            total={String(filtered.length)}
            onChange={(value) => update({ examplePage: value, example: null })}
          />
        </section>
        <div className="research-side-stack">
          <CandidateList
            candidates={candidates}
            picked={picked}
            rows={rows}
            onPick={(candidate) =>
              update({ candidate: candidate.id, example: null, examples: null, examplePage: null })
            }
            onCounterexample={(candidate, row) =>
              update({
                candidate: candidate.id,
                example: row.id,
                examples: 'counterexamples',
                exampleSearch: null,
                examplePage: null,
              })
            }
            onObserve={observe}
          />
          {selectedRow && picked ? (
            <ExampleInspector
              row={selectedRow}
              candidate={picked}
              returnTo={returnTo}
              onPrevious={
                selectedIndex > 0
                  ? () => update({ example: shown[selectedIndex - 1]!.id })
                  : undefined
              }
              onNext={
                selectedIndex + 1 < shown.length
                  ? () => update({ example: shown[selectedIndex + 1]!.id })
                  : undefined
              }
            />
          ) : (
            <Empty
              title="Выбери пример"
              description="Разбор и источник появятся после выбора примера и способа чтения."
            />
          )}
        </div>
      </div>
      {group && <ByteMatrix group={group} rows={shown} candidate={picked} returnTo={returnTo} />}
      <details className="panel research-explanations">
        <summary>Диагностика поиска и технические подробности</summary>
        {result.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
        <p>
          Привязка к журналу выполнена по имени файла и времени источника. Противоречивые значения в
          совпадающих окнах остаются неизвестными. A и B обозначают стороны соединения; роль клиента
          или устройства по одной букве не устанавливается.
        </p>
        {picked && (
          <>
            <p>
              Технический параметр: <code>{picked.parameter || 'не установлен'}</code>. Группа:{' '}
              <code>{groupId}</code>. Чтение:{' '}
              <code>
                {picked.encoding}
                {picked.divisor === 1 ? '' : ' ÷ ' + picked.divisor}
              </code>
              .
            </p>
            <p>{picked.statement}</p>
            <p>{picked.basis}</p>
          </>
        )}
      </details>
      {!result.rows.length && (
        <Empty
          title="Примеры не найдены"
          description="Проверь готовность записей и направление. Неизвестные байты не заменяются догадками."
        />
      )}
      {proposal && (
        <AutomaticObservation
          key={proposal.candidate.id}
          proposal={proposal.input}
          presentation={proposal.presentation}
          onClose={() => setProposal(null)}
          onCreateSchema={
            proposal.candidate.schemaJson
              ? () => {
                  createSchema(proposal.candidate);
                  setProposal(null);
                }
              : undefined
          }
        />
      )}
    </>
  );
}
