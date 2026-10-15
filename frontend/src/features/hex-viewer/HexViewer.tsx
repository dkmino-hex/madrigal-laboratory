import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ByteWindow, Location } from '../../shared/api/contracts/models';
import { boundedIndex, decimal, hexOffset } from '../../shared/model/precision';
import { byteAscii, byteHex, cellAt, copyKnown } from '../../shared/model/bytes';
import { Banner, Button } from '../../shared/ui/common';
import type { FieldAnnotation } from '../../shared/model/message-inspection';

function revealColumns(
  body: HTMLDivElement | null,
  header: HTMLDivElement | null,
  relative: bigint,
  length = 1n,
) {
  if (!body || body.clientWidth === 0) return;
  const column = boundedIndex(((relative % 16n) + 16n) % 16n, 15);
  const count = boundedIndex(
    length > 0n && length < BigInt(16 - column) ? length : BigInt(16 - column),
    16,
  );
  const left = 6 + 150 + column * 24;
  const right = left + (count * 24 <= body.clientWidth ? count * 24 : 24);
  if (left < body.scrollLeft) body.scrollLeft = left;
  else if (right > body.scrollLeft + body.clientWidth) body.scrollLeft = right - body.clientWidth;
  if (header) header.scrollLeft = body.scrollLeft;
}

export function HexViewer({
  window,
  selection,
  onSelect,
  onWindow,
  annotations = [],
}: {
  window: ByteWindow;
  selection: Location;
  onSelect: (start: string, length: string, windowStart?: string) => void;
  onWindow: (start: string) => void;
  annotations?: FieldAnnotation[];
}) {
  const annotationAt = (offset: bigint) =>
    annotations.find(
      (item) => offset >= BigInt(item.start) && offset < BigInt(item.start) + BigInt(item.length),
    );
  const scroll = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const anchor = useRef(BigInt(selection.start));
  const caret = useRef(BigInt(selection.start));
  const [copyError, setCopyError] = useState('');
  const scrolled = useRef('');
  const internalSelection = useRef(selection.start + ':' + selection.length);
  const observedSelection = useRef(internalSelection.current);
  const observedAssembly = useRef(selection.assemblyId);
  const pendingSelections = useRef(new Set<string>());
  const virtual = useVirtualizer({
    count: Math.ceil(boundedIndex(BigInt(window.location.length), 4096) / 16),
    getScrollElement: () => scroll.current,
    estimateSize: () => 30,
    overscan: 5,
  });
  useEffect(() => {
    const release = () => {
      drag.current = false;
    };
    globalThis.window.addEventListener('pointerup', release);
    return () => {
      globalThis.window.removeEventListener('pointerup', release);
      // Повторный mount эффектов в StrictMode заново подключает virtualizer.
      scrolled.current = '';
    };
  }, []);
  useEffect(() => {
    const selectionKey = selection.start + ':' + selection.length;
    if (selection.assemblyId !== observedAssembly.current) {
      observedAssembly.current = selection.assemblyId;
      observedSelection.current = selectionKey;
      internalSelection.current = selectionKey;
      caret.current = BigInt(selection.start);
      anchor.current = caret.current;
      pendingSelections.current.clear();
      scrolled.current = '';
    } else if (selectionKey !== observedSelection.current) {
      observedSelection.current = selectionKey;
      if (pendingSelections.current.has(selectionKey)) {
        // Router может подтвердить предыдущий шаг после следующего keydown.
        // Такое подтверждение не должно откатывать локальный caret/anchor.
        if (selectionKey === internalSelection.current) pendingSelections.current.clear();
        else pendingSelections.current.delete(selectionKey);
      } else if (selectionKey !== internalSelection.current) {
        caret.current = BigInt(selection.start);
        anchor.current = caret.current;
        internalSelection.current = selectionKey;
        pendingSelections.current.clear();
        scrolled.current = '';
      }
    }
    const key = selection.assemblyId + ':' + window.location.start;
    const relative = caret.current - BigInt(window.location.start);
    if (scrolled.current !== key && relative >= 0n && relative < BigInt(window.location.length)) {
      scrolled.current = key;
      const index = boundedIndex(relative / 16n, 255);
      virtual.scrollToIndex(index, { align: 'center' });
      // При первом mount virtualizer ещё может не знать viewport. Высота строк
      // фиксирована; нативная прокрутка также инициирует измерение видимого окна.
      if (scroll.current)
        scroll.current.scrollTop = Math.max(0, index * 30 - scroll.current.clientHeight / 2 + 15);
      revealColumns(scroll.current, header.current, relative, BigInt(selection.length));
    }
  }, [
    selection.start,
    selection.length,
    selection.assemblyId,
    window.location.start,
    window.location.length,
    virtual,
  ]);
  function choose(offset: bigint, extend: boolean, windowStart?: string) {
    caret.current = offset;
    if (!extend) anchor.current = offset;
    const start = offset < anchor.current ? offset : anchor.current;
    const end = offset > anchor.current ? offset : anchor.current;
    internalSelection.current = String(start) + ':' + String(end - start + 1n);
    pendingSelections.current.add(internalSelection.current);
    revealColumns(scroll.current, header.current, offset - BigInt(window.location.start));
    onSelect(String(start), String(end - start + 1n), windowStart);
  }
  async function copy(mode: 'hex' | 'ascii') {
    let value: string;
    try {
      value = copyKnown(window, selection, mode);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : 'Копирование недоступно');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyError('Скопировано');
    } catch {
      setCopyError('Буфер обмена недоступен');
    }
  }
  const start = BigInt(selection.start);
  const end = start + BigInt(selection.length);
  return (
    <div className="hex-viewer">
      <div className="hex-tools">
        <span className="mono">16 байтов / строка</span>
        <div className="toolbar">
          <Button variant="ghost" onClick={() => copy('hex')}>
            Копировать HEX
          </Button>
          <Button variant="ghost" onClick={() => copy('ascii')}>
            Копировать ASCII
          </Button>
        </div>
      </div>
      {copyError && (
        <Banner tone={copyError === 'Скопировано' ? 'success' : 'warning'}>{copyError}</Banner>
      )}
      <div className="hex-header mono" ref={header}>
        <span>Смещение</span>
        <span className="hex-column-names">
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i}>{i.toString(16).toUpperCase().padStart(2, '0')}</span>
          ))}
        </span>
        <span>ASCII</span>
      </div>
      <div
        className="hex-body"
        ref={scroll}
        role="grid"
        aria-label="HEX и ASCII, клавиши стрелок перемещают выделение, Shift расширяет"
        aria-readonly="true"
        aria-rowcount={virtual.options.count}
        tabIndex={0}
        onScroll={(event) => {
          if (header.current) header.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        onKeyDown={(event) => {
          const steps: Record<string, bigint> = {
            ArrowRight: 1n,
            ArrowLeft: -1n,
            ArrowDown: 16n,
            ArrowUp: -16n,
            PageDown: 256n,
            PageUp: -256n,
          };
          if (event.key === 'Escape') {
            onSelect(selection.start, '0');
            event.preventDefault();
            return;
          }
          if (event.key === 'Home') {
            choose(BigInt(window.location.start), event.shiftKey);
            event.preventDefault();
            return;
          }
          if (event.key === 'End') {
            choose(
              BigInt(window.location.start) + BigInt(window.location.length) - 1n,
              event.shiftKey,
            );
            event.preventDefault();
            return;
          }
          const step = steps[event.key];
          if (step === undefined) return;
          event.preventDefault();
          let next = caret.current + step;
          if (next < 0n) next = 0n;
          if (next >= BigInt(window.streamLength)) next = BigInt(window.streamLength) - 1n;
          const relative = next - BigInt(window.location.start);
          const outside = relative < 0n || relative >= BigInt(window.location.length);
          choose(next, event.shiftKey, outside ? String((next / 4096n) * 4096n) : undefined);
          if (!outside) virtual.scrollToIndex(boundedIndex(relative / 16n, 255), { align: 'auto' });
        }}
      >
        <div style={{ height: virtual.getTotalSize(), position: 'relative', minWidth: 680 }}>
          {virtual.getVirtualItems().map((row) => {
            const rowStart = BigInt(window.location.start) + BigInt(row.index * 16);
            const count = Math.min(
              16,
              boundedIndex(
                BigInt(window.location.start) + BigInt(window.location.length) - rowStart,
                4096,
              ),
            );
            const cells = Array.from({ length: count }, (_, i) => {
              const offset = rowStart + BigInt(i);
              return { offset, cell: cellAt(window, String(offset)) };
            });
            return (
              <div
                className="hex-row mono"
                key={row.key}
                role="row"
                aria-rowindex={row.index + 1}
                style={{ position: 'absolute', top: row.start, height: row.size }}
              >
                <span className="hex-address" role="rowheader" title={String(rowStart)}>
                  {hexOffset(String(rowStart))}
                </span>
                <span className="hex-cells">
                  {cells.map(({ offset, cell }) => (
                    <button
                      type="button"
                      tabIndex={-1}
                      role="gridcell"
                      aria-selected={offset >= start && offset < end}
                      aria-label={'Байт ' + offset + ': ' + byteHex(cell)}
                      key={String(offset)}
                      data-offset={String(offset)}
                      data-candidate={
                        cell.kind === 'known' &&
                        !!annotationAt(offset) &&
                        annotationAt(offset)?.kind !== 'field'
                      }
                      data-field-color={
                        cell.kind === 'known' && annotationAt(offset)?.kind === 'field'
                          ? annotationAt(offset)?.color
                          : undefined
                      }
                      title={
                        cell.kind === 'known'
                          ? (annotationAt(offset)?.label ?? String(offset))
                          : cell.reason
                      }
                      className={
                        'hex-byte ' +
                        cell.kind +
                        (offset >= start && offset < end ? ' selected' : '')
                      }
                      onPointerDown={(event) => {
                        event.preventDefault();
                        scroll.current?.focus();
                        drag.current = true;
                        choose(offset, event.shiftKey);
                      }}
                      onPointerEnter={() => {
                        if (drag.current) choose(offset, true);
                      }}
                      onClick={(event) => {
                        if (event.detail === 0) choose(offset, event.shiftKey);
                      }}
                    >
                      {byteHex(cell)}
                    </button>
                  ))}
                </span>
                <span className="ascii-cells" aria-hidden="true">
                  {cells.map(({ offset, cell }) => (
                    <span
                      key={String(offset)}
                      data-field-color={
                        cell.kind === 'known' && annotationAt(offset)?.kind === 'field'
                          ? annotationAt(offset)?.color
                          : undefined
                      }
                      className={(offset >= start && offset < end ? 'selected ' : '') + cell.kind}
                    >
                      {byteAscii(cell)}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="hex-footer">
        <span>
          <span className="legend known" />
          Известно
        </span>
        <span>
          <span className="legend gap" />
          ?? Пропуск / усечение
        </span>
        <span>
          <span className="legend conflict" />
          ≠? Конфликт
        </span>
        <span className="muted">Полный HEX / ASCII — горизонтальная прокрутка</span>
      </div>
      <div className="toolbar hex-pagination">
        <Button
          disabled={window.location.start === '0'}
          onClick={() =>
            onWindow(
              decimal(
                BigInt(window.location.start) < 4096n ? 0n : BigInt(window.location.start) - 4096n,
              ),
            )
          }
        >
          Предыдущее окно
        </Button>
        <span className="mono">
          [{window.location.start}, {BigInt(window.location.start) + BigInt(window.location.length)}
          )
        </span>
        <Button
          disabled={
            BigInt(window.location.start) + BigInt(window.location.length) >=
            BigInt(window.streamLength)
          }
          onClick={() => onWindow(String(BigInt(window.location.start) + 4096n))}
        >
          Следующее окно
        </Button>
      </div>
    </div>
  );
}
