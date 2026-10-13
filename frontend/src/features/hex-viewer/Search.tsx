import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Location } from '../../shared/api/contracts/draft';
import { api } from '../../shared/api/client';
import { queryKey } from '../../shared/api/query';
import { validateSearch } from '../../shared/model/bytes';
import { Banner, Button, Field, QueryState } from '../../shared/ui/common';
export function SearchPanel({
  location,
  onSelect,
}: {
  location: Location;
  onSelect: (start: string, length: string) => void;
}) {
  const [mode, setMode] = useState<'HEX' | 'ASCII'>('HEX');
  const [pattern, setPattern] = useState('15 00 00 00');
  const [submitted, setSubmitted] = useState<{ mode: string; pattern: string; cursor: string }>();
  const error = validateSearch(mode, pattern);
  const query = useQuery({
    queryKey: queryKey(location.projectId, 'search', { ...location, ...submitted }),
    queryFn: ({ signal }) => api.search({ ...location, ...submitted }, { signal }),
    enabled: !!submitted,
  });
  return (
    <details className="search-panel">
      <summary>Поиск по всему потоку HEX / ASCII</summary>
      <div className="search-form">
        <Field label="Режим поиска">
          {(id) => (
            <select
              id={id}
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as 'HEX' | 'ASCII');
                setSubmitted(undefined);
              }}
            >
              <option>HEX</option>
              <option>ASCII</option>
            </select>
          )}
        </Field>
        <Field
          label="Образец"
          error={error ?? undefined}
          hint={
            mode === 'HEX'
              ? 'Пары шестнадцатеричных цифр, например 15 00 00 00; до 256 байтов.'
              : 'Печатные символы ASCII, до 256 символов.'
          }
        >
          {(id, info) => (
            <input
              id={id}
              aria-describedby={info}
              aria-invalid={!!error}
              value={pattern}
              spellCheck={false}
              onChange={(event) => {
                setPattern(event.target.value);
                setSubmitted(undefined);
              }}
            />
          )}
        </Field>
        <Button
          disabled={!!error || query.isFetching}
          onClick={() => setSubmitted({ mode, pattern, cursor: '0' })}
        >
          Найти в потоке
        </Button>
      </div>
      {submitted && (
        <QueryState
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        >
          {query.data && (
            <>
              <Banner>
                Просмотрено в этой странице поиска: {query.data.searchedBytes} байт.{' '}
                {query.data.complete
                  ? 'Поиск завершён.'
                  : 'Результат неполный; доступно продолжение.'}{' '}
                Совпадения не соединяются через пропуск или конфликт.
              </Banner>
              <div className="search-results">
                {query.data.items.map((item) => (
                  <Button
                    key={item.start}
                    variant="ghost"
                    onClick={() => onSelect(item.start, item.length)}
                  >
                    <code>{item.start}</code> · {item.length} байт
                  </Button>
                ))}
                {query.data.items.length === 0 && <p>Совпадений на этой странице поиска нет.</p>}
              </div>
              <Button
                disabled={!query.data.nextCursor || query.isFetching}
                onClick={() => setSubmitted({ ...submitted, cursor: query.data!.nextCursor! })}
              >
                Продолжить поиск
              </Button>
            </>
          )}
        </QueryState>
      )}
    </details>
  );
}
