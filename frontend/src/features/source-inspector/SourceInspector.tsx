import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Location, Source } from '../../shared/api/contracts/models';
import { api } from '../../shared/api/client';
import { ApiError } from '../../shared/api/transport';
import { queryKey } from '../../shared/api/query';
import { decimal, formatTimestamp } from '../../shared/model/precision';
import { safeReturnPath, sourceLink } from '../../shared/model/navigation';
import { CopyButton, Empty, Pagination, QueryState } from '../../shared/ui/common';
import { config } from '../../app/config';
import { ObserveSelection } from '../observations/ObserveSelection';
function PacketHex({ bytes, source }: { bytes: number[]; source: Source }) {
  const scroll = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(8);
  const row = Math.floor(Number(source.frameOffset) / columns);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () => setColumns(element.clientWidth >= 420 ? 16 : 8);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const rows = Math.ceil(bytes.length / columns);
  const virtual = useVirtualizer({
    count: rows,
    getScrollElement: () => scroll.current,
    estimateSize: () => 24,
    overscan: 3,
  });
  useEffect(() => {
    virtual.scrollToIndex(Math.max(0, row - 2), { align: 'start' });
  }, [row, virtual]);
  return (
    <div
      className="packet-hex-viewport mono"
      style={{ height: Math.min(220, rows * 24) }}
      ref={scroll}
      role="region"
      tabIndex={0}
      aria-label={'HEX кадра ' + source.packetNo + ', выделение от начала кадра'}
    >
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => (
          <div
            className="packet-hex"
            key={item.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: item.size,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              transform: `translateY(${item.start}px)`,
            }}
          >
            {bytes
              .slice(item.index * columns, item.index * columns + columns)
              .map((byte, column) => {
                const index = item.index * columns + column;
                return (
                  <span
                    key={index}
                    data-frame-offset={index}
                    data-selected={
                      BigInt(index) >= BigInt(source.frameOffset) &&
                      BigInt(index) < BigInt(source.frameOffset) + BigInt(source.length)
                    }
                    title={'Смещение кадра ' + index}
                  >
                    {byte.toString(16).padStart(2, '0').toUpperCase()}
                  </span>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
function SourceList({ sources, projectId }: { sources: Source[]; projectId: string }) {
  const [page, setPage] = useState(0);
  return (
    <>
      {sources.slice(page, page + 20).map((source, index) => (
        <PacketSlice
          key={source.packetNo + ':' + source.frameOffset + ':' + (page + index)}
          source={source}
          projectId={projectId}
        />
      ))}
      {sources.length > 20 && (
        <div role="group" aria-label="Страницы исходных участков">
          <Pagination
            cursor={String(page)}
            nextCursor={page + 20 < sources.length ? String(page + 20) : null}
            total={String(sources.length)}
            onChange={(value) => setPage(Number(value))}
          />
        </div>
      )}
    </>
  );
}
function PacketSlice({ source, projectId }: { source: Source; projectId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: queryKey(projectId, 'packet', {
      captureId: source.captureId,
      packetNo: source.packetNo,
    }),
    queryFn: ({ signal }) =>
      api.packet({ projectId, captureId: source.captureId, packetNo: source.packetNo }, { signal }),
    enabled: open,
  });
  const boundsError =
    query.data &&
    BigInt(source.frameOffset) + BigInt(source.length) > BigInt(query.data.capturedLength)
      ? new ApiError(
          'INCOMPATIBLE_RESPONSE',
          'Исходный участок выходит за пределы захваченного кадра. Другой источник не подставляется.',
        )
      : null;
  return (
    <details className="source-packet" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <strong>Кадр №{source.packetNo}</strong>
        <small>
          {source.relation === 'primary'
            ? 'Основной источник'
            : source.relation === 'retransmission'
              ? 'Одинаковая ретрансляция'
              : 'Альтернатива конфликта'}
        </small>
        <code>
          [{source.frameOffset}, {decimal(BigInt(source.frameOffset) + BigInt(source.length))}) ·{' '}
          {source.length} байт
        </code>
      </summary>
      {open && (
        <QueryState
          pending={query.isPending}
          error={query.error ?? boundsError}
          retry={() => void query.refetch()}
        >
          {query.data && (
            <div className="packet-content">
              <code>{query.data.captureId}</code>
              <p className="mono timestamp">{formatTimestamp(query.data.timestamp)}</p>
              <p>
                Захвачено {query.data.capturedLength}, исходная длина {query.data.originalLength}{' '}
                байт
              </p>
              <p>Время наблюдения в точке захвата</p>
              {query.data.headers.map((header) => (
                <small key={header}>{header}</small>
              ))}
              <PacketHex bytes={query.data.bytes} source={source} />
            </div>
          )}
        </QueryState>
      )}
    </details>
  );
}
export function SourceInspector({
  location,
  runId,
  revisionId,
}: {
  location: Location;
  runId?: string;
  revisionId?: string;
}) {
  const current = useLocation();
  const query = useQuery({
    queryKey: queryKey(location.projectId, 'sources', { ...location }),
    queryFn: ({ signal }) => api.sources(location, { signal }),
    enabled: BigInt(location.length) > 0n,
  });
  const link = sourceLink(location, { runId, revisionId });
  const actionPath = '/projects/' + encodeURIComponent(location.projectId) + '/actions';
  const returnPath = safeReturnPath(
    new URLSearchParams(current.search).get('returnTo'),
    location.projectId,
  );
  const returnUrl = returnPath ? new URL(returnPath, window.location.origin) : null;
  const actionParams =
    returnUrl?.pathname === actionPath
      ? new URLSearchParams(returnUrl.search)
      : new URLSearchParams();
  const trafficParams = new URLSearchParams(current.search);
  trafficParams.delete('returnTo');
  actionParams.set('source', link);
  actionParams.set(
    'returnTo',
    current.pathname + (trafficParams.size ? '?' + trafficParams.toString() : ''),
  );
  return (
    <div className="source-inspector">
      <div className="panel-heading">
        <h2>Происхождение</h2>
        <CopyButton
          value={window.location.origin + link}
          label="Копировать прямую ссылку на источник"
          description="Копировать ссылку на выбранный диапазон байтов, его сборку и исходные пакеты"
        />
      </div>
      <div className="selection-info">
        <small className="muted">Логические байты потока</small>
        <strong className="mono">
          [{location.start}, {decimal(BigInt(location.start) + BigInt(location.length))})
        </strong>
        <span>
          {location.length} байт · {location.direction === 'A_TO_B' ? 'A→B' : 'B→A'}
        </span>
        <code>{location.assemblyId}</code>
        {runId && (
          <small>
            Запуск <code>{runId}</code>
          </small>
        )}
        {revisionId && (
          <small>
            Ревизия <code>{revisionId}</code>
          </small>
        )}
      </div>
      {location.length === '0' ? (
        <Empty
          title="Выделите диапазон"
          description="Источники загружаются только для выбранных байтов."
        />
      ) : (
        <QueryState
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        >
          {query.data?.length ? (
            <>
              <p className="muted">
                {query.data.length} исходных участка. Ретрансляции не увеличивают логическую длину.
              </p>
              <SourceList key={link} sources={query.data} projectId={location.projectId} />
            </>
          ) : (
            <Empty
              title="Источник не предоставлен"
              description="Это пропуск или техническая недоступность происхождения. Другая сборка не подставляется."
            />
          )}
        </QueryState>
      )}
      <Link className="button ghost" to={actionPath + '?' + actionParams.toString()}>
        Связать с действием журнала
      </Link>
      {config.mode === 'api' && query.data && (
        <ObserveSelection
          location={location}
          sources={query.data}
          revisionId={revisionId}
          runId={runId}
        />
      )}
      <Link
        className="button ghost"
        to={
          '/projects/' +
          location.projectId +
          '/compare?' +
          new URLSearchParams({ left: link }).toString()
        }
      >
        Сравнить с другим примером
      </Link>
      <Link
        className="button ghost"
        to={
          '/projects/' +
          location.projectId +
          '/interpretations?' +
          new URLSearchParams({ source: link }).toString()
        }
      >
        Открыть интерпретации для диапазона
      </Link>
    </div>
  );
}
