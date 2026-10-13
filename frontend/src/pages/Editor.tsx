import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import CodeMirror from '@uiw/react-codemirror';
import { json as jsonLanguage } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { useTheme } from '../app/theme';
import { useProject } from '../app/Shell';
import { config } from '../app/config';
import { api } from '../shared/api/client';
import { queryKey, useCommand } from '../shared/api/query';
import type { Interpretation, Location, Revision } from '../shared/api/contracts/draft';
import { readLocation, sourceLink } from '../shared/model/navigation';
import { editJsonValue, formatJsonText } from '../shared/model/json-text';
import { UnsavedGuard } from '../shared/lib/use-unsaved';
import {
  Banner,
  Button,
  ErrorState,
  Field,
  PageHeading,
  QueryState,
  downloadText,
} from '../shared/ui/common';
import { RangePicker } from '../shared/ui/RangePicker';
import { ResultsTable } from '../features/interpretations/Results';
const defaultDraft =
  import.meta.env.DEV && config.mode === 'mock'
    ? '{\n  "format": "madrigal-demo-v1",\n  "framing": { "kind": "fixed", "length": 4 },\n  "endian": "little",\n  "scope": { "direction": "A_TO_B" },\n  "fields": [{ "id": "setpoint", "name": "value", "type": "uint32", "offset": "0" }],\n  "rules": [{ "id": "value-bound", "field": "value", "maximum": "30" }]\n}'
    : '{}';
const extensions = [
  jsonLanguage(),
  EditorView.contentAttributes.of({ 'aria-label': 'JSON схемы' }),
];
function syntaxError(text: string) {
  try {
    JSON.parse(text);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : 'Некорректный JSON';
  }
}
function initialSource(params: URLSearchParams, projectId: string) {
  const source = params.get('source');
  if (!source) return { location: null, error: null };
  try {
    const location = readLocation(new URL(source, window.location.origin).searchParams, projectId);
    if (!location) throw new Error('Ссылка на источник содержит неполный контекст сборки.');
    return { location, error: null };
  } catch (error) {
    return { location: null, error: error as Error };
  }
}
export default function Editor() {
  const projectId = useProject().projectId;
  const interpretationId = useParams().interpretationId!;
  const [params] = useSearchParams();
  const query = useQuery({
    queryKey: queryKey(projectId, 'interpretation', { interpretationId }),
    queryFn: ({ signal }) => api.interpretation(projectId, interpretationId, { signal }),
  });
  const [pinned, setPinned] = useState<{ interpretationId: string; revisionId: string }>();
  useEffect(() => {
    const last = query.data?.revisions.at(-1);
    if (last && pinned?.interpretationId !== interpretationId)
      setPinned({ interpretationId, revisionId: last.revisionId });
  }, [query.data, pinned?.interpretationId, interpretationId]);
  const selected =
    params.get('revisionId') ??
    (pinned?.interpretationId === interpretationId
      ? pinned.revisionId
      : query.data?.revisions.at(-1)?.revisionId);
  const revision = query.data?.revisions.find((item) => item.revisionId === selected);
  return (
    <QueryState pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {params.get('revisionId') && !revision && query.data ? (
        <ErrorState
          error={new Error('Историческая ревизия недоступна. Новая версия не подставляется.')}
        />
      ) : (
        query.data && (
          <EditorWorkspace
            key={interpretationId + ':' + (params.get('source') ?? '')}
            interpretation={query.data}
            revision={revision}
          />
        )
      )}
    </QueryState>
  );
}
function EditorWorkspace({
  interpretation,
  revision,
}: {
  interpretation: Interpretation;
  revision?: Revision;
}) {
  const theme = useTheme();
  const projectId = interpretation.projectId;
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(revision?.json ?? defaultDraft);
  const [savedText, setSavedText] = useState(revision?.json ?? '');
  const [savedRevision, setSavedRevision] = useState(revision);
  const sourceContext = initialSource(params, projectId);
  const [location, setLocation] = useState<Location | null>(sourceContext.location);
  const [desiredRevision, setDesiredRevision] = useState('');
  const [previewAfterSave, setPreviewAfterSave] = useState(false);
  const [previewNotice, setPreviewNotice] = useState('');
  const previewGeneration = useRef(0);
  const previousProp = useRef(revision?.revisionId);
  const error = syntaxError(draft);
  const dirty = draft !== savedText;
  const save = useCommand(
    'saveRevision',
    (input: { json: string; parentRevisionId?: string }, options) =>
      api.saveRevision(
        {
          projectId,
          interpretationId: interpretation.interpretationId,
          ...input,
          label: 'Уточнение исследователя',
        },
        options,
      ),
    [
      queryKey(projectId, 'interpretation', { interpretationId: interpretation.interpretationId }),
      queryKey(projectId, 'interpretations'),
    ],
  );
  const preview = useCommand(
    'preview',
    (input: { revisionId: string; location: Location }, options) =>
      api.preview(
        { projectId, interpretationId: interpretation.interpretationId, ...input },
        options,
      ),
  );
  useEffect(() => {
    if (previousProp.current === revision?.revisionId) return;
    previousProp.current = revision?.revisionId;
    if (revision?.revisionId !== savedRevision?.revisionId) {
      setDraft(revision?.json ?? defaultDraft);
      setSavedText(revision?.json ?? '');
      setSavedRevision(revision);
      preview.reset();
    }
  }, [revision, savedRevision?.revisionId, preview]);
  useEffect(() => {
    if (
      !dirty &&
      desiredRevision &&
      (!previewAfterSave || preview.data?.revisionId === desiredRevision)
    ) {
      const next = new URLSearchParams(params);
      next.set('revisionId', desiredRevision);
      setDesiredRevision('');
      setParams(next, { replace: true });
    }
  }, [dirty, desiredRevision, params, setParams, previewAfterSave, preview.data?.revisionId]);
  const canPreview =
    location &&
    BigInt(location.length) > 0n &&
    BigInt(location.length) <= BigInt(config.previewLimit);
  let parsed: Record<string, unknown> | null = null;
  if (!error) {
    const value: unknown = JSON.parse(draft);
    if (value && !Array.isArray(value) && typeof value === 'object')
      parsed = value as Record<string, unknown>;
  }
  function updateBasic(key: string, value: unknown) {
    if (parsed) setDraft(editJsonValue(draft, [key], value));
  }
  const field =
    Array.isArray(parsed?.fields) && parsed.fields[0] && typeof parsed.fields[0] === 'object'
      ? (parsed.fields[0] as Record<string, unknown>)
      : null;
  const rule =
    Array.isArray(parsed?.rules) && parsed.rules[0] && typeof parsed.rules[0] === 'object'
      ? (parsed.rules[0] as Record<string, unknown>)
      : null;
  const basic = parsed?.format === 'madrigal-demo-v1';
  const fixed =
    basic &&
    parsed?.framing &&
    typeof parsed.framing === 'object' &&
    'kind' in parsed.framing &&
    parsed.framing.kind === 'fixed';
  function updateFirst(key: 'fields' | 'rules', change: Record<string, unknown>) {
    const list = parsed?.[key];
    if (Array.isArray(list))
      setDraft(
        Object.entries(change).reduce(
          (text, [name, value]) => editJsonValue(text, [key, 0, name], value),
          draft,
        ),
      );
  }
  function saveNow(withPreview: boolean) {
    if (save.isPending || error) return;
    const generation = previewGeneration.current;
    setPreviewNotice('');
    setPreviewAfterSave(withPreview);
    save.mutate(
      { json: draft, parentRevisionId: savedRevision?.revisionId },
      {
        onSuccess: (result) => {
          setSavedText(result.json);
          setSavedRevision(result);
          setDesiredRevision(result.revisionId);
          if (withPreview && location && generation === previewGeneration.current)
            preview.mutate({ revisionId: result.revisionId, location });
          else if (withPreview) {
            setPreviewAfterSave(false);
            setPreviewNotice(
              'Новая ревизия сохранена. Диапазон изменён, повторите предварительный разбор.',
            );
          }
        },
      },
    );
  }
  return (
    <>
      <UnsavedGuard dirty={dirty} />
      <PageHeading
        title={interpretation.name}
        subtitle="JSON и форма используют один черновик. Сохранённая ревизия остаётся неизменной."
        actions={
          <Button
            variant="primary"
            disabled={save.isPending || !!error || !dirty}
            onClick={() => saveNow(false)}
          >
            {save.isPending ? 'Сохранение…' : 'Сохранить новую ревизию'}
          </Button>
        }
      />
      <div className="context-line">
        <code>{interpretation.interpretationId}</code>
        <span>
          Сохранено: <code>{savedRevision?.revisionId ?? 'пока нет'}</code>
        </span>
        <BadgeDraft dirty={dirty} />
        <Button
          variant="ghost"
          disabled={!savedRevision}
          onClick={() =>
            savedRevision && downloadText(savedRevision.json, savedRevision.revisionId + '.json')
          }
        >
          Скачать точный JSON ревизии
        </Button>
      </div>
      <div className="editor-layout">
        <section className="panel editor-panel">
          <div className="panel-heading">
            <h2>JSON интерпретации</h2>
            <Button
              variant="ghost"
              disabled={!!error}
              onClick={() => setDraft(formatJsonText(draft))}
            >
              Форматировать JSON
            </Button>
          </div>
          <label className="sr-only" id="schema-editor-label">
            JSON схемы
          </label>
          <div role="group" aria-labelledby="schema-editor-label">
            <CodeMirror
              value={draft}
              height="420px"
              extensions={extensions}
              onChange={setDraft}
              theme={theme}
              basicSetup={{ lineNumbers: true, foldGutter: true }}
              indentWithTab={false}
              aria-label="JSON схемы"
            />
          </div>
          {error && <Banner tone="error">Синтаксическая ошибка JSON: {error}</Banner>}
          {save.error && <ErrorState error={save.error} />}
        </section>
        <aside className="panel editor-basics">
          <div className="panel-heading">
            <h2>Основные настройки</h2>
          </div>
          <Banner>
            Формы относятся к временному frontend-формату. Поддержка AN-03 ожидает согласования.
          </Banner>
          <Field label="Порядок байтов">
            {(id) => (
              <select
                id={id}
                disabled={!basic}
                value={typeof parsed?.endian === 'string' ? parsed.endian : ''}
                onChange={(event) => updateBasic('endian', event.target.value)}
              >
                <option value="little">Little endian</option>
                <option value="big">Big endian</option>
              </select>
            )}
          </Field>
          <Field label="Размер сообщения, байт">
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                max={4096}
                disabled={!fixed}
                value={
                  parsed?.framing &&
                  typeof parsed.framing === 'object' &&
                  'length' in parsed.framing
                    ? String(parsed.framing.length)
                    : ''
                }
                onChange={(event) =>
                  setDraft(editJsonValue(draft, ['framing', 'length'], event.target.valueAsNumber))
                }
              />
            )}
          </Field>
          <Field label="Область действия">
            {(id) => (
              <select
                id={id}
                disabled={!parsed}
                value={
                  parsed?.scope && typeof parsed.scope === 'object' && 'direction' in parsed.scope
                    ? String(parsed.scope.direction)
                    : ''
                }
                onChange={(event) =>
                  setDraft(editJsonValue(draft, ['scope', 'direction'], event.target.value))
                }
              >
                <option value="A_TO_B">A → B</option>
                <option value="B_TO_A">B → A</option>
              </select>
            )}
          </Field>
          <Field label="Имя первого поля">
            {(id) => (
              <input
                id={id}
                disabled={!basic || !field}
                value={String(field?.name ?? '')}
                onChange={(event) => updateFirst('fields', { name: event.target.value })}
              />
            )}
          </Field>
          <Field label="Тип поля">
            {(id) => <input id={id} readOnly value={String(field?.type ?? 'Не предоставлен')} />}
          </Field>
          <Field label="Смещение поля в сообщении">
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                disabled={!basic || field?.type !== 'uint32'}
                value={String(field?.offset ?? '')}
                onChange={(event) => updateFirst('fields', { offset: event.target.value })}
              />
            )}
          </Field>
          <Field label="Максимум первого правила">
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                disabled={!basic || !rule}
                value={String(rule?.maximum ?? '')}
                onChange={(event) => updateFirst('rules', { maximum: event.target.value })}
              />
            )}
          </Field>
          <h3>История ревизий</h3>
          <div className="revision-list">
            {interpretation.revisions.map((item) => (
              <Link
                key={item.revisionId}
                className={item.revisionId === savedRevision?.revisionId ? 'active' : ''}
                to={
                  '?revisionId=' +
                  item.revisionId +
                  (params.get('source')
                    ? '&' + new URLSearchParams({ source: params.get('source')! }).toString()
                    : '')
                }
              >
                <code>{item.revisionId}</code>
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
          <p className="muted">
            Открытие старой версии создаёт отдельный черновик при редактировании. Новые правила не
            меняют старые runs.
          </p>
        </aside>
      </div>
      <section className="panel preview-panel">
        <div className="panel-heading">
          <h2>Предварительный разбор</h2>
          <span className="muted">Лимит {config.previewLimit} байт</span>
        </div>
        <Banner>
          Предварительный разбор выбранного диапазона — не проверка всего корпуса. Используется
          сохранённый revisionId.
        </Banner>
        {sourceContext.error ? (
          <ErrorState error={sourceContext.error} />
        ) : (
          <RangePicker
            projectId={projectId}
            label="Диапазон preview"
            initial={location}
            onChange={(value) => {
              previewGeneration.current++;
              setLocation(value);
              preview.reset();
            }}
          />
        )}
        <div className="toolbar">
          <Button
            variant="primary"
            disabled={!canPreview || !!error || preview.isPending || save.isPending}
            onClick={() =>
              dirty || !savedRevision
                ? saveNow(true)
                : location && preview.mutate({ revisionId: savedRevision.revisionId, location })
            }
          >
            {preview.isPending
              ? 'Разбор…'
              : dirty || !savedRevision
                ? 'Сохранить новую ревизию и выполнить preview'
                : 'Выполнить preview'}
          </Button>
          <Link
            className="button secondary"
            to={
              '/projects/' +
              projectId +
              '/runs?' +
              new URLSearchParams({
                interpretationId: interpretation.interpretationId,
                revisionId: savedRevision?.revisionId ?? '',
              }).toString()
            }
          >
            Проверить корпус
          </Link>
        </div>
        {!canPreview && (
          <p className="muted">Выберите диапазон от 1 до {config.previewLimit} байт.</p>
        )}
        {previewNotice && !preview.data && !preview.isPending && <Banner>{previewNotice}</Banner>}
        {preview.error && <ErrorState error={preview.error} />}
        {preview.data && (
          <>
            <p>
              Ревизия <code>{preview.data.revisionId}</code>
              {previewAfterSave ? ' · новая сохранённая версия' : ''}
            </p>
            {preview.data.diagnostic && <Banner>{preview.data.diagnostic}</Banner>}
            <ResultsTable results={preview.data.results} revisionId={preview.data.revisionId} />
            {preview.data.unknown.map((item) => (
              <Banner tone="warning" key={item.start}>
                Неизвестная область [{item.start}, {BigInt(item.start) + BigInt(item.length)}){' '}
                <Link
                  to={sourceLink(item, {
                    revisionId: preview.data?.revisionId,
                    returnTo: window.location.pathname + window.location.search,
                  })}
                >
                  Открыть источник неизвестной области
                </Link>
              </Banner>
            ))}
          </>
        )}
      </section>
    </>
  );
}
function BadgeDraft({ dirty }: { dirty: boolean }) {
  return (
    <span className={'draft-badge ' + (dirty ? 'dirty' : '')}>
      {dirty ? 'Несохранённый черновик' : 'Сохранённый JSON'}
    </span>
  );
}
