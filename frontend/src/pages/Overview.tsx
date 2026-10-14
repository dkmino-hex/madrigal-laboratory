import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Upload } from 'lucide-react';
import { useProject } from '../app/Shell';
import { api } from '../shared/api/client';
import { queryKey } from '../shared/api/query';
import {
  Badge,
  Banner,
  Button,
  Empty,
  Modal,
  PageHeading,
  Pagination,
  QueryState,
} from '../shared/ui/common';
import { formatInteger, formatTimestamp } from '../shared/model/precision';
import { UploadWidget } from '../features/projects/Upload';
import { JobsCenter } from '../features/jobs/Jobs';
export default function Overview() {
  const project = useProject();
  const [params, setParams] = useSearchParams();
  const cursor = params.get('cursor') ?? '0';
  const query = useQuery({
    queryKey: queryKey(project.projectId, 'captures', { cursor }),
    queryFn: ({ signal }) => api.captures({ projectId: project.projectId, cursor }, { signal }),
    enabled: project.status === 'READY',
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.status === 'IMPORTING') ? 1000 : false,
  });
  return (
    <>
      <PageHeading
        title={project.name}
        subtitle={project.description}
        actions={
          project.status === 'READY' && (
            <Modal
              title="Добавить запись"
              description="PCAP или PCAPNG. После передачи Capture создаёт отдельное задание обработки."
              trigger={
                <Button variant="primary">
                  <Upload size={15} aria-hidden="true" />
                  Добавить PCAP / PCAPNG
                </Button>
              }
            >
              <UploadWidget kind="capture" projectId={project.projectId} />
            </Modal>
          )
        }
      />
      <div className="context-line">
        <Badge status={project.status} />
        <code>{project.projectId}</code>
        <span>
          Настройки <code>{project.settingsVersion}</code>
        </span>
      </div>
      {project.status !== 'READY' ? (
        <>
          <Banner tone="warning">
            {project.diagnostic ??
              'Импорт ещё не завершён. Исследовательские операции доступны после READY.'}
          </Banner>
          <JobsCenter projectId={project.projectId} />
        </>
      ) : (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>Исходные записи</h2>
              <span className="muted">Источник остаётся неизменным</span>
            </div>
            <QueryState
              pending={query.isPending}
              error={query.error}
              retry={() => void query.refetch()}
            >
              {query.data?.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Запись</th>
                        <th>Состояние</th>
                        <th>Объём, байт</th>
                        <th>Пакеты</th>
                        <th>Импорт</th>
                        <th>Открыть</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.items.map((capture) => (
                        <tr key={capture.captureId}>
                          <td>
                            <strong>{capture.name}</strong>
                            <small className="mono">{capture.captureId}</small>
                            {capture.synthetic && (
                              <small className="muted">Синтетическая fixture</small>
                            )}
                          </td>
                          <td>
                            <Badge status={capture.status} />
                            {capture.diagnostic && <small>{capture.diagnostic}</small>}
                          </td>
                          <td className="mono">{formatInteger(capture.size)}</td>
                          <td className="mono">{formatInteger(capture.packets)}</td>
                          <td className="mono timestamp">{formatTimestamp(capture.importedAt)}</td>
                          <td>
                            {capture.status === 'READY' ? (
                              <Link
                                className="button ghost"
                                to={
                                  '/projects/' +
                                  project.projectId +
                                  '/traffic?captureId=' +
                                  encodeURIComponent(capture.captureId)
                                }
                              >
                                Исследовать
                                <ArrowUpRight size={14} aria-hidden="true" />
                              </Link>
                            ) : (
                              'Обработка'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="Исходных записей пока нет"
                  description="Добавьте PCAP или PCAPNG, чтобы открыть сессии и байты."
                />
              )}
              {query.data && (
                <Pagination
                  cursor={cursor}
                  nextCursor={query.data.nextCursor}
                  total={query.data.total}
                  onChange={(value) => setParams({ cursor: value })}
                />
              )}
            </QueryState>
          </section>
          <div className="overview-links">
            <Link to={'/projects/' + project.projectId + '/traffic'}>
              <h3>Исследовать обмен</h3>
              <p>Сессии, сборки, HEX и исходные пакеты.</p>
            </Link>
            <Link to={'/projects/' + project.projectId + '/interpretations'}>
              <h3>Уточнить интерпретацию</h3>
              <p>Сохранённые ревизии и предварительный разбор.</p>
            </Link>
            <Link to={'/projects/' + project.projectId + '/runs'}>
              <h3>Проверить корпус</h3>
              <p>Закреплённые входы, охват и контрпримеры.</p>
            </Link>
          </div>
          <JobsCenter projectId={project.projectId} />
        </>
      )}
    </>
  );
}
