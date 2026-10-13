import { useEffect } from 'react';
import { useBlocker, useBeforeUnload } from 'react-router-dom';
import { Button, Modal } from '../ui/common';
export function UnsavedGuard({ dirty, searchKeys }: { dirty: boolean; searchKeys?: string[] }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!dirty) return false;
    if (currentLocation.pathname !== nextLocation.pathname || searchKeys === undefined) return true;
    const current = new URLSearchParams(currentLocation.search);
    const next = new URLSearchParams(nextLocation.search);
    return searchKeys.some((key) => current.get(key) !== next.get(key));
  });
  useBeforeUnload((event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  useEffect(
    () => () => {
      /* Router и useBeforeUnload освобождают слушатели */
    },
    [],
  );
  return (
    <Modal
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset();
      }}
      title="Есть несохранённые изменения"
      description="Уход удалит локальный черновик. Сохраните изменения или подтвердите их потерю."
    >
      <div className="toolbar">
        <Button variant="primary" onClick={() => blocker.state === 'blocked' && blocker.reset()}>
          Остаться
        </Button>
        <Button variant="danger" onClick={() => blocker.state === 'blocked' && blocker.proceed()}>
          Уйти без сохранения
        </Button>
      </div>
    </Modal>
  );
}
