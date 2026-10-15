import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { queryKey } from '../../shared/api/query';
import { decimal, formatTimestamp } from '../../shared/model/precision';
import { sourceLink } from '../../shared/model/navigation';
import { Badge, Button, ErrorState, QueryState } from '../../shared/ui/common';

export function AssemblyHistory({
  projectId,
  captureId,
  assemblyId,
  direction,
}: {
  projectId: string;
  captureId: string;
  assemblyId: string;
  direction: 'A_TO_B' | 'B_TO_A';
}) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState('');
  const [error, setError] = useState<unknown>();
  const navigate = useNavigate();
  const history = useQuery({
    queryKey: queryKey(projectId, 'assemblies', { captureId, view: 'history' }),
    queryFn: ({ signal }) => api.assemblyHistory({ projectId, captureId }, { signal }),
    enabled: open && !!captureId,
  });
  async function show(id: string) {
    setOpening(id);
    setError(undefined);
    try {
      const sessions = await api.sessions({ projectId, captureId, assemblyId: id, limit: 1 });
      const sessionId = sessions.items[0]?.sessionId;
      if (!sessionId) throw new Error('В этой сборке нет сессий.');
      const streams = await api.assemblies({ projectId, captureId, sessionId, assemblyId: id });
      const stream = streams.items.find((item) => item.direction === direction) ?? streams.items[0];
      if (!stream || stream.assemblyId !== id)
        throw new Error('Поток выбранной версии недоступен.');
      navigate(
        sourceLink({
          projectId,
          ...stream,
          start: decimal('0'),
          length: decimal(BigInt(stream.length) < 4n ? stream.length : '4'),
        }),
      );
    } catch (error) {
      setError(error);
    } finally {
      setOpening('');
    }
  }
  return (
    <details
      className="panel assembly-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>История сборок записи</summary>
      <p>
        Каждая строка — отдельная версия восстановленных потоков. Открытие сохраняет её настройки и
        исходные координаты.
      </p>
      {open && (
        <QueryState
          pending={history.isPending}
          error={history.error}
          retry={() => void history.refetch()}
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Создана / завершена</th>
                  <th>Версия и состояние</th>
                  <th>Настройки и движок</th>
                  <th>Диагностика</th>
                  <th>Открыть</th>
                </tr>
              </thead>
              <tbody>
                {history.data?.items.map((item) => (
                  <tr key={item.assemblyId}>
                    <td>
                      {formatTimestamp(item.createdAt)}
                      <small>
                        {item.finishedAt ? formatTimestamp(item.finishedAt) : 'Не завершена'}
                      </small>
                    </td>
                    <td>
                      <code>{item.assemblyId}</code>
                      <Badge status={item.status} />
                      {item.assemblyId === assemblyId && <small>Открыта сейчас</small>}
                    </td>
                    <td>
                      <code>{item.settingsVersion}</code>
                      <small>Движок: {item.engineVersion}</small>
                      <details>
                        <summary>Параметры сборки</summary>
                        <pre>{item.settings}</pre>
                      </details>
                    </td>
                    <td>
                      {item.diagnostics.length ? item.diagnostics.join('; ') : 'Замечаний нет'}
                    </td>
                    <td>
                      <Button
                        disabled={item.status !== 'READY' || !!opening}
                        onClick={() => void show(item.assemblyId)}
                      >
                        {opening === item.assemblyId ? 'Открытие…' : 'Открыть эту сборку'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      )}
      {error !== undefined && <ErrorState error={error} />}
    </details>
  );
}
