import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileArchive, Plus } from 'lucide-react';
import { api } from '../shared/api/client';
import { queryKey, useCommand } from '../shared/api/query';
import { formatTimestamp } from '../shared/model/precision';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Modal,
  PageHeading,
  Pagination,
  QueryState,
} from '../shared/ui/common';
import { UploadWidget } from '../features/projects/Upload';
export default function Projects() {
  const [params, setParams] = useSearchParams();
  const cursor = params.get('cursor') ?? '0';
  const q = params.get('q') ?? '';
  const query = useQuery({
    queryKey: queryKey('all', 'projects', { cursor, q }),
    queryFn: ({ signal }) => api.projects({ cursor, q }, { signal }),
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const navigate = useNavigate();
  const create = useCommand('createProject', api.createProject, [queryKey('all', 'projects')]);
  return (
    <main id="main" className="projects-page">
      <div className="projects-intro">
        <span className="workspace-caption">Рабочие пространства</span>
        <PageHeading
          title="Проекты исследования"
          subtitle="От исходных байтов к проверяемой интерпретации."
          actions={
            <>
              <Modal
                title="Импортировать проект ZIP"
                description="Перенос исходных записей, версий и доказательств. Проверку архива выполняет Workspace."
                trigger={
                  <Button>
                    <FileArchive size={16} aria-hidden="true" />
                    Импортировать ZIP
                  </Button>
                }
              >
                <UploadWidget kind="project" />
              </Modal>
              <Modal
                title="Новый проект"
                description="Создайте отдельное пространство для записей и исследовательских гипотез."
                open={open}
                onOpenChange={setOpen}
                trigger={
                  <Button variant="primary">
                    <Plus size={16} aria-hidden="true" />
                    Создать проект
                  </Button>
                }
              >
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    create.mutate(
                      { name, description },
                      {
                        onSuccess: (project) => {
                          setOpen(false);
                          void navigate('/projects/' + project.projectId);
                        },
                      },
                    );
                  }}
                >
                  <Field label="Название проекта">
                    {(id) => (
                      <input
                        id={id}
                        name="project-name"
                        autoComplete="off"
                        required
                        maxLength={120}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Описание исследования">
                    {(id) => (
                      <textarea
                        id={id}
                        maxLength={2000}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    )}
                  </Field>
                  {create.error && <ErrorState error={create.error} />}
                  <Button type="submit" variant="primary" disabled={create.isPending}>
                    {create.isPending ? 'Создание…' : 'Создать проект'}
                  </Button>
                </form>
              </Modal>
            </>
          }
        />
      </div>
      <div className="section-toolbar">
        <Field label="Найти проект">
          {(id) => (
            <input
              id={id}
              type="search"
              value={q}
              placeholder="Название проекта…"
              onChange={(event) => {
                const next = new URLSearchParams(params);
                next.set('q', event.target.value);
                next.delete('cursor');
                setParams(next, { replace: true });
              }}
            />
          )}
        </Field>
        <span className="muted">Локальные записи · неизменяемые версии</span>
      </div>
      <QueryState pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
        {query.data?.items.length ? (
          <div className="project-grid">
            {query.data.items.map((project) => (
              <article className="project-card" key={project.projectId}>
                <div className="row between">
                  <span className="project-symbol" aria-hidden="true">
                    ⌘
                  </span>
                  <Badge status={project.status} />
                </div>
                <h2>
                  <Link to={'/projects/' + project.projectId}>
                    {project.name}
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </Link>
                </h2>
                <p>{project.description || 'Описание ещё не добавлено'}</p>
                <div className="project-card-footer">
                  <span>{project.captures} записи</span>
                  <span className="mono">{project.settingsVersion}</span>
                </div>
                <small className="muted">{formatTimestamp(project.updatedAt)}</small>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="Проекты не найдены"
            description="Измените поиск или создайте новый проект."
          />
        )}
        {query.data && (
          <Pagination
            cursor={cursor}
            nextCursor={query.data.nextCursor}
            total={query.data.total}
            onChange={(value) => {
              const next = new URLSearchParams(params);
              next.set('cursor', value);
              setParams(next);
            }}
          />
        )}
      </QueryState>
      <div className="research-note">
        <strong>Байты → наблюдение → гипотеза → проверка</strong>
        <p>
          Результат разбора не доказывает смысл поля. Сохраняйте основания и контрпримеры вместе с
          исходными данными.
        </p>
      </div>
    </main>
  );
}
