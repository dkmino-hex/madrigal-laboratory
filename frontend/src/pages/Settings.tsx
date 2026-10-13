import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProject } from '../app/Shell';
import { api } from '../shared/api/client';
import { queryKey, useCommand } from '../shared/api/query';
import type { Location, Settings as SettingsModel } from '../shared/api/contracts/draft';
import {
  Banner,
  Button,
  ErrorState,
  Field,
  Modal,
  PageHeading,
  QueryState,
} from '../shared/ui/common';
import { RangePicker } from '../shared/ui/RangePicker';
import { trackJob, JobCard } from '../features/jobs/Jobs';
import { UnsavedGuard } from '../shared/lib/use-unsaved';
export default function Settings() {
  const project = useProject();
  const projectId = project.projectId;
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: queryKey(projectId, 'settings'),
    queryFn: ({ signal }) => api.settings(projectId, undefined, { signal }),
  });
  const version = params.get('settingsVersion') ?? project.settingsVersion;
  const selected = query.data?.find((item) => item.settingsVersion === version);
  const [timeZone, setTimeZone] = useState('UTC');
  const [offset, setOffset] = useState('0');
  const [checksum, setChecksum] = useState<SettingsModel['checksum']>('warn');
  const [baseline, setBaseline] = useState(
    JSON.stringify({ timeZone: 'UTC', offset: '0', checksum: 'warn' }),
  );
  const dirty = JSON.stringify({ timeZone, offset, checksum }) !== baseline;
  const [clone, setClone] = useState<SettingsModel | null>(null);
  function copyVersion(item: SettingsModel) {
    setTimeZone(item.timeZone);
    setOffset(item.offsetNanoseconds);
    setChecksum(item.checksum);
    save.reset();
    setClone(null);
  }
  const [location, setLocation] = useState<Location | null>(null);
  const save = useCommand(
    'saveSettings',
    (input: Omit<SettingsModel, 'settingsVersion'>, options) =>
      api.saveSettings(projectId, input, options),
    [queryKey(projectId, 'settings'), queryKey(projectId, 'project')],
  );
  const assembly = useCommand('createAssembly', (input: Record<string, unknown>, options) =>
    api.createAssembly(input, options),
  );
  const offsetValid = /^-?\d+$/.test(offset);
  let zoneValid = true;
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone });
  } catch {
    zoneValid = false;
  }
  return (
    <>
      <UnsavedGuard dirty={dirty} searchKeys={[]} />
      <PageHeading
        title="Настройки проекта"
        subtitle="Новая версия настроек не изменяет старые сборки, доказательства и запуски."
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Сохранённые версии</h2>
        </div>
        <QueryState
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        >
          <Field label="settingsVersion">
            {(id) => (
              <select
                id={id}
                value={version}
                onChange={(event) => setParams({ settingsVersion: event.target.value })}
              >
                {query.data?.map((item) => (
                  <option key={item.settingsVersion}>{item.settingsVersion}</option>
                ))}
              </select>
            )}
          </Field>
          {selected ? (
            <>
              <dl className="metadata">
                <div>
                  <dt>Часовой пояс</dt>
                  <dd>{selected.timeZone}</dd>
                </div>
                <div>
                  <dt>Поправка времени</dt>
                  <dd className="mono">{selected.offsetNanoseconds} нс</dd>
                </div>
                <div>
                  <dt>Checksum</dt>
                  <dd>{selected.checksum}</dd>
                </div>
                <div>
                  <dt>Перекрытия</dt>
                  <dd>{selected.overlap}</dd>
                </div>
              </dl>
              <Button
                disabled={save.isPending}
                onClick={() => {
                  if (dirty) setClone(selected);
                  else copyVersion(selected);
                }}
              >
                Создать черновик от этой версии
              </Button>
            </>
          ) : (
            <ErrorState
              error={
                new Error(
                  'Указанная версия настроек недоступна. Последняя версия не подставляется.',
                )
              }
            />
          )}
        </QueryState>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Новая версия настроек</h2>
        </div>
        <Banner>
          Checksum offloading может объяснять предупреждение захвата. Оно не является доказанным
          FAIL протокола. Политика сохраняется в контексте исследования.
        </Banner>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!offsetValid || !zoneValid || save.isPending) return;
            save.mutate(
              {
                timeZone,
                offsetNanoseconds: String(BigInt(offset)),
                checksum,
                overlap: 'preserve-alternatives',
              },
              {
                onSuccess: (result) => {
                  setTimeZone(result.timeZone);
                  setOffset(result.offsetNanoseconds);
                  setChecksum(result.checksum);
                  setBaseline(
                    JSON.stringify({
                      timeZone: result.timeZone,
                      offset: result.offsetNanoseconds,
                      checksum: result.checksum,
                    }),
                  );
                  const next = new URLSearchParams(params);
                  next.set('settingsVersion', result.settingsVersion);
                  setParams(next, { replace: true });
                },
              },
            );
          }}
        >
          <div className="form-grid">
            <Field
              label="Часовой пояс"
              error={!zoneValid ? 'Неизвестный часовой пояс IANA' : undefined}
            >
              {(id) => (
                <input
                  id={id}
                  value={timeZone}
                  disabled={save.isPending}
                  onChange={(event) => setTimeZone(event.target.value)}
                />
              )}
            </Field>
            <Field
              label="Поправка времени, наносекунды"
              error={!offsetValid ? 'Точное целое число' : undefined}
            >
              {(id) => (
                <input
                  id={id}
                  value={offset}
                  disabled={save.isPending}
                  onChange={(event) => setOffset(event.target.value)}
                  inputMode="numeric"
                />
              )}
            </Field>
            <Field label="Политика checksum">
              {(id) => (
                <select
                  id={id}
                  value={checksum}
                  disabled={save.isPending}
                  onChange={(event) => setChecksum(event.target.value as SettingsModel['checksum'])}
                >
                  <option value="warn">Предупреждать</option>
                  <option value="strict">Строгая проверка</option>
                  <option value="ignore">Не учитывать</option>
                </select>
              )}
            </Field>
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={!offsetValid || !zoneValid || save.isPending}
          >
            Сохранить новую версию настроек
          </Button>
        </form>
        {save.error && <ErrorState error={save.error} />}{' '}
        {save.data && (
          <Banner tone="success">
            Создана версия {save.data.settingsVersion}. Исторические сборки сохранены.
          </Banner>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Пересборка потока</h2>
        </div>
        <p className="muted">
          Изменение настроек само по себе не создаёт новую сборку. Эту операцию выполняет Capture.
        </p>
        <RangePicker label="Основание новой сборки" projectId={projectId} onChange={setLocation} />
        <Button
          disabled={!location || !selected || assembly.isPending || save.isPending || dirty}
          onClick={() =>
            location &&
            assembly.mutate(
              { ...location, settingsVersion: version },
              { onSuccess: (result) => trackJob(projectId, result.job.jobId) },
            )
          }
        >
          Запросить новую сборку
        </Button>
        {assembly.error && <ErrorState error={assembly.error} />}{' '}
        {assembly.data && <JobCard projectId={projectId} jobId={assembly.data.job.jobId} />}
      </section>
      <Modal
        title="Заменить несохранённый черновик?"
        description="Настройки выбранной версии заменят локальные изменения формы."
        open={!!clone}
        onOpenChange={(open) => {
          if (!open) setClone(null);
        }}
      >
        <div className="toolbar">
          <Button onClick={() => setClone(null)}>Продолжить редактирование</Button>
          <Button variant="danger" onClick={() => clone && copyVersion(clone)}>
            Заменить черновик
          </Button>
        </div>
      </Modal>
    </>
  );
}
