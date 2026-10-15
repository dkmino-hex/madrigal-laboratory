import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/client';
import { queryKey, useCommand } from '../../shared/api/query';
import type { AutomaticInput } from '../../shared/api/contracts/research';
import { Button, Field, Modal, ErrorState, Banner } from '../../shared/ui/common';
import { sourceLink } from '../../shared/model/navigation';

export function AutomaticObservation({
  proposal,
  onClose,
}: {
  proposal: AutomaticInput;
  onClose: () => void;
}) {
  const [text, setText] = useState(proposal.text);
  const [basis, setBasis] = useState(proposal.basis);
  const [kind, setKind] = useState(proposal.kind ?? 'OBSERVATION');
  const save = useCommand(
    'saveAutomaticObservation',
    (input: AutomaticInput, options) => api.saveAutomaticObservation(input, options),
    [queryKey(proposal.projectId, 'hypotheses'), queryKey(proposal.projectId, 'evidence')],
  );
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      title="Наблюдение из данных"
      description="Формулировка и ссылки уже заполнены. Проверь текст и сохрани исследовательскую запись."
    >
      {save.data ? (
        <Banner tone="success">
          Запись сохранена с {proposal.examples.length} примерами.{' '}
          <Link to={'/projects/' + proposal.projectId + '/hypotheses'}>Открыть наблюдения →</Link>
        </Banner>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() && !save.isPending) save.mutate({ ...proposal, text, basis, kind });
          }}
        >
          <Field label="Тип исследовательской записи">
            {(id) => (
              <select
                id={id}
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
              >
                <option value="OBSERVATION">Наблюдение — что видно в данных</option>
                <option value="HYPOTHESIS">Гипотеза — предполагаемый смысл</option>
              </select>
            )}
          </Field>
          <Field label="Автоматическая формулировка" hint="Можно уточнить перед сохранением.">
            {(id) => (
              <textarea
                id={id}
                value={text}
                maxLength={4000}
                onChange={(event) => setText(event.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Основания автоматического наблюдения">
            {(id) => (
              <textarea
                id={id}
                value={basis}
                maxLength={8000}
                onChange={(event) => setBasis(event.target.value)}
              />
            )}
          </Field>
          <p>
            {proposal.generation.matches} из {proposal.generation.total} примеров · приложено{' '}
            {proposal.examples.length} источников.
          </p>
          <ul className="automatic-proof-list">
            {proposal.examples.map((example, index) => (
              <li key={index}>
                <Link to={sourceLink(example.location)}>
                  {example.kind === 'counterexample' ? 'Контрпример' : 'Пример'} {index + 1} · байты
                  [{example.location.start},{' '}
                  {BigInt(example.location.start) + BigInt(example.location.length)})
                </Link>
              </li>
            ))}
          </ul>
          <p className="muted">
            Запись сохранится как открытая. Смысловая гипотеза не получает подтверждение
            автоматически.
          </p>
          {save.error && <ErrorState error={save.error} />}
          <Button type="submit" variant="primary" disabled={!text.trim() || save.isPending}>
            {save.isPending
              ? 'Сохранение…'
              : kind === 'HYPOTHESIS'
                ? 'Сохранить гипотезу с источниками'
                : 'Сохранить наблюдение с источниками'}
          </Button>
        </form>
      )}
    </Modal>
  );
}
