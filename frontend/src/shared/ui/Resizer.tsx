import { useEffect, useRef } from 'react';
export function Resizer({
  label,
  value,
  min,
  max,
  onChange,
  invert = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  invert?: boolean;
}) {
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  const change = (value: number) => onChange(Math.min(max, Math.max(min, value)));
  return (
    <div
      className="resizer"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          change(value + (event.key === 'ArrowLeft' ? -16 : 16));
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        const start = event.clientX;
        const move = (e: PointerEvent) => change(value + (e.clientX - start) * (invert ? -1 : 1));
        const end = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          document.body.classList.remove('resizing');
        };
        cleanup.current = end;
        document.body.classList.add('resizing');
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end, { once: true });
      }}
    />
  );
}
