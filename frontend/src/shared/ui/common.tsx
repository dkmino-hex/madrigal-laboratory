import {
  useId,
  useState,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, Copy, X, FolderOpen, RefreshCw } from 'lucide-react';
import { ApiError } from '../api/transport';

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return <button type="button" className={'button ' + variant + ' ' + className} {...props} />;
}
export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  const kind = ['PASS', 'READY', 'COMPLETED', 'confirmed', 'supported'].includes(status)
    ? 'good'
    : ['FAIL', 'FAILED', 'ERROR', 'refuted'].includes(status)
      ? 'bad'
      : [
            'INCONCLUSIVE',
            'UNKNOWN',
            'IMPORTING',
            'RUNNING',
            'QUEUED',
            'BUILDING',
            'CANCEL_REQUESTED',
          ].includes(status)
        ? 'warning'
        : 'neutral';
  const labels: Record<string, string> = {
    PASS: 'Пройдено',
    FAIL: 'Нарушение',
    INCONCLUSIVE: 'Неоднозначно',
    NOT_APPLICABLE: 'Неприменимо',
    UNKNOWN: 'Неизвестно',
    READY: 'Готово',
    IMPORTING: 'Импорт',
    ERROR: 'Ошибка',
    COMPLETED: 'Завершено',
    RUNNING: 'Выполняется',
    QUEUED: 'В очереди',
    CANCEL_REQUESTED: 'Отмена запрошена',
    CANCELLED: 'Отменено',
    FAILED: 'Ошибка',
    INTERRUPTED: 'Прервано',
    HISTORICAL: 'Исторический запуск',
    BUILDING: 'Сборка',
    PENDING: 'Ожидание',
    tentative: 'Предположительно',
    confirmed: 'Подтверждено исследователем',
    open: 'Открыта',
    supported: 'Поддерживается примерами',
    refuted: 'Опровергнута',
  };
  return (
    <span className={'badge ' + kind}>
      <span className="status-dot" aria-hidden="true" />
      <span>
        {status}
        {children ?? (labels[status] ? ' · ' + labels[status] : '')}
      </span>
    </span>
  );
}
export function Banner({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'error' | 'success';
}) {
  return (
    <div className={'banner ' + tone} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const code = error instanceof ApiError ? error.code : 'UI_ERROR';
  const message = error instanceof Error ? error.message : 'Не удалось загрузить данные';
  return (
    <div className="error-state" role="alert">
      <AlertCircle aria-hidden="true" size={22} />
      <div>
        <h3>{code === 'CONTRACT_PENDING' ? 'Ожидается контракт Gateway' : 'Данные недоступны'}</h3>
        <p>{message}</p>
        <code>{code}</code>
        {error instanceof ApiError && (
          <details>
            <summary>Техническая диагностика</summary>
            <p>
              requestId: <code>{error.requestId ?? 'не получен'}</code>
            </p>
            {error.details !== undefined && <pre>{JSON.stringify(error.details, null, 2)}</pre>}
          </details>
        )}
        {retry && (
          <Button onClick={retry}>
            <RefreshCw size={14} aria-hidden="true" />
            Повторить чтение
          </Button>
        )}
      </div>
    </div>
  );
}
export function Loading({ text = 'Загрузка данных…' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <div className="skeleton" />
      <p>{text}</p>
      <div className="skeleton short" />
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <FolderOpen size={30} aria-hidden="true" />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function QueryState({
  pending,
  error,
  retry,
  children,
}: {
  pending: boolean;
  error: unknown;
  retry?: () => void;
  children: ReactNode;
}) {
  if (pending) return <Loading />;
  if (error) return <ErrorState error={error} retry={retry} />;
  return <>{children}</>;
}
export function Modal({
  title,
  description,
  trigger,
  children,
  open,
  onOpenChange,
}: {
  title: string;
  description: string;
  trigger?: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Закрыть диалог">
                <X size={18} aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="muted">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const info = hint || error ? id + '-info' : undefined;
  const child = children(id, info);
  const control = isValidElement(child)
    ? cloneElement(
        child as ReactElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>,
        { 'aria-describedby': info, 'aria-invalid': error ? true : undefined },
      )
    : child;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control}
      {info && (
        <small id={info} className={error ? 'field-error' : 'muted'}>
          {error ?? hint}
        </small>
      )}
    </div>
  );
}
export function CopyButton({
  value,
  label = 'Копировать',
  disabled,
}: {
  value: string;
  label?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState('');
  return (
    <span className="copy-control">
      <Button
        aria-label={label}
        title={label}
        variant="ghost"
        disabled={disabled}
        onClick={() =>
          void navigator.clipboard.writeText(value).then(
            () => setState('Скопировано'),
            () => setState('Буфер обмена недоступен'),
          )
        }
      >
        <Copy size={14} aria-hidden="true" />
      </Button>
      <span className="sr-only" aria-live="polite">
        {state}
      </span>
    </span>
  );
}
export function PageHeading({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="toolbar">{actions}</div>}
    </header>
  );
}
export function Pagination({
  cursor,
  nextCursor,
  onChange,
  total,
}: {
  cursor: string;
  nextCursor: string | null;
  onChange: (cursor: string) => void;
  total?: string;
}) {
  return (
    <div className="pagination">
      <small className="muted">
        {total !== undefined ? 'Всего записей: ' + total : 'Общее количество не предоставлено'}
      </small>
      <div className="toolbar">
        <Button disabled={cursor === '0'} onClick={() => onChange('0')}>
          В начало
        </Button>
        <span className="mono">cursor {cursor}</span>
        <Button disabled={nextCursor === null} onClick={() => nextCursor && onChange(nextCursor)}>
          Следующая страница
        </Button>
      </div>
    </div>
  );
}
export function downloadText(text: string, name: string, contentType = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: contentType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
