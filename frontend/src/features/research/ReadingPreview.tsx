export function ReadingPreview({
  hex,
  value,
  expected,
  reading,
  calculation,
}: {
  hex: string | null;
  value: string | null;
  expected: string | null;
  reading: string;
  calculation?: string | null;
}) {
  return (
    <div className="research-reading">
      <div className="research-reading-values">
        <div>
          <span>В записи трафика</span>
          <code>{hex ?? 'Байты недоступны'}</code>
        </div>
        <span className="research-reading-arrow" aria-hidden="true">
          →
        </span>
        <div>
          <span>После чтения поля</span>
          <strong>{value ?? 'Чтение недоступно'}</strong>
        </div>
      </div>
      <p>{reading}.</p>
      {calculation && (
        <p className="research-calculation">
          Расчёт: <strong>{calculation}</strong>
        </p>
      )}
      {expected !== null && (
        <p>
          В журнале для этого примера: <strong>{expected}</strong>.
        </p>
      )}
    </div>
  );
}
