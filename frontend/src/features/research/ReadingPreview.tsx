export function ReadingPreview({ hex, value, expected, reading }: {
  hex: string | null;
  value: string | null;
  expected: string | null;
  reading: string;
}) {
  return <div className="research-reading">
    <div className="research-reading-values">
      <div><span>В записи трафика</span><code>{hex ?? 'Байты недоступны'}</code></div>
      <span className="research-reading-arrow" aria-hidden="true">→</span>
      <div><span>После чтения поля</span><strong>{value ?? 'Число не определено'}</strong></div>
    </div>
    <p>{reading}.</p>
    {expected !== null && <p>В журнале для этого примера: <strong>{expected}</strong>.</p>}
  </div>;
}
