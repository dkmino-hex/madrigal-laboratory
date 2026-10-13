import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useProject } from '../app/Shell';
import { api } from '../shared/api/client';
import { queryKey, useCommand } from '../shared/api/query';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  Modal,
  PageHeading,
  Pagination,
  QueryState,
} from '../shared/ui/common';
export default function Interpretations() {
  const projectId = useProject().projectId;
  const [params, setParams] = useSearchParams();
  const cursor = params.get('cursor') ?? '0';
  const query = useQuery({
    queryKey: queryKey(projectId, 'interpretations', { cursor }),
    queryFn: ({ signal }) => api.interpretations({ projectId, cursor }, { signal }),
  });
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const create = useCommand(
    'createInterpretation',
    (input: { name: string }, options) =>
      api.createInterpretation({ projectId, ...input }, options),
    [queryKey(projectId, 'interpretations')],
  );
  return (
    <>
      <PageHeading
        title="Интерпретации"
        subtitle="Рабочие модели структуры. Сохранение создаёт новую неизменяемую ревизию."
        actions={
          <Modal
            title="Новая интерпретация"
            description="Имя модели не устанавливает смысл наблюдаемых полей."
            open={open}
            onOpenChange={setOpen}
            trigger={
              <Button variant="primary">
                <Plus size={15} aria-hidden="true" />
                Создать интерпретацию
              </Button>
            }
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate({ name }, { onSuccess: () => setOpen(false) });
              }}
            >
              <Field label="Название интерпретации">
                {(id) => (
                  <input
                    id={id}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={120}
                  />
                )}
              </Field>
              {create.error && <ErrorState error={create.error} />}
              <Button variant="primary" type="submit" disabled={create.isPending}>
                Создать интерпретацию
              </Button>
            </form>
          </Modal>
        }
      />
      <QueryState pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
        {query.data?.items.length ? (
          <section className="panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Интерпретация</th>
                    <th>Ревизии</th>
                    <th>Последняя сохранённая</th>
                    <th>Редактор</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((item) => (
                    <tr key={item.interpretationId}>
                      <td>
                        <strong>{item.name}</strong>
                        <small className="mono">{item.interpretationId}</small>
                      </td>
                      <td>{item.revisions.length}</td>
                      <td className="mono">
                        {item.revisions.at(-1)?.revisionId ?? 'Нет сохранённых ревизий'}
                      </td>
                      <td>
                        <Link
                          className="button secondary"
                          to={
                            '/projects/' +
                            projectId +
                            '/interpretations/' +
                            item.interpretationId +
                            (params.get('source')
                              ? '?' +
                                new URLSearchParams({ source: params.get('source')! }).toString()
                              : '')
                          }
                        >
                          Открыть редактор
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <Empty
            title="Нет интерпретаций"
            description="Создайте модель и сохраните первую ревизию."
          />
        )}
        {query.data && (
          <Pagination
            cursor={cursor}
            total={query.data.total}
            nextCursor={query.data.nextCursor}
            onChange={(value) => {
              const next = new URLSearchParams(params);
              next.set('cursor', value);
              setParams(next);
            }}
          />
        )}
      </QueryState>
    </>
  );
}
