import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/client';
import { queryKey, useCommand } from '../../shared/api/query';
import type { AutomaticInput } from '../../shared/api/contracts/research';
import {
  proofFallback,
  type ObservationPresentation,
} from '../../shared/model/research-presentation';
import { Button, Field, Modal, ErrorState, Banner } from '../../shared/ui/common';
import { sourceLink } from '../../shared/model/navigation';
import { ReadingPreview } from '../research/ReadingPreview';

export function AutomaticObservation({
  proposal,
  presentation,
  onClose,
  onCreateSchema,
}: {
  proposal: AutomaticInput;
  presentation?: ObservationPresentation;
  onClose: () => void;
  onCreateSchema?: () => void;
}) {
  const [text, setText] = useState(proposal.text),
    [basis, setBasis] = useState(proposal.basis);
  const [kind, setKind] = useState(proposal.kind ?? 'OBSERVATION');
  const save = useCommand(
    'saveAutomaticObservation',
    (input: AutomaticInput, options) => api.saveAutomaticObservation(input, options),
    [queryKey(proposal.projectId, 'hypotheses'), queryKey(proposal.projectId, 'evidence')],
  );
  const first = presentation?.samples[0];
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      title="Наблюдение из данных"
      description="Сохраним, что обнаружено в примерах. Байты и исходные пакеты прикрепятся автоматически."
    >
      {save.data ? (
        <>
          <Banner tone="success">
            Запись сохранена с {proposal.examples.length} примерами.{' '}
            <Link to={'/projects/' + proposal.projectId + '/hypotheses'}>Открыть наблюдения →</Link>
          </Banner>
          <p>Следующий шаг — проверить это объяснение на другой записи с новыми значениями.</p>
          {onCreateSchema && (
            <Button variant="primary" onClick={onCreateSchema}>
              Создать схему для проверки
            </Button>
          )}
        </>
      ) : (
        <form
          className="automatic-observation-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() && !save.isPending) save.mutate({ ...proposal, text, basis, kind });
          }}
        >
          {presentation && (
            <section className="observation-preview">
              <h3>{presentation.title}</h3>
              <p>
                {proposal.generation.matches} из {proposal.generation.total} сопоставимых примеров{' '}
                {proposal.generation.kind === 'parameter' ? 'совпали' : 'имеют этот признак'}.
              </p>
              {first && (
                <>
                  <p className="muted">
                    Один из приложенных примеров: {first.label} · {first.time}
                  </p>
                  <ReadingPreview
                    hex={first.hex}
                    value={first.value}
                    expected={first.expected}
                    reading={presentation.reading}
                    calculation={first.calculation}
                  />
                </>
              )}
            </section>
          )}
          <Field label="Что удалось заметить" hint="Можно уточнить формулировку перед сохранением.">
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
          <details className="observation-options">
            <summary>Тип записи и технические основания</summary>
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
              Запись останется открытой. Успешное совпадение чисел само по себе не доказывает
              назначение поля.
            </p>
          </details>
          <details className="observation-sources">
            <summary>
              Источники, которые сохранятся вместе с записью · {proposal.examples.length}
            </summary>
            <ul className="automatic-proof-list">
              {proposal.examples.map((example, index) => {
                const sample = presentation?.samples[index];
                return (
                  <li key={index}>
                    <Link to={sourceLink(example.location)}>
                      {sample
                        ? `${example.kind === 'counterexample' ? 'Контрпример · ' : ''}${sample.label}`
                        : proofFallback(example, index)}
                    </Link>
                    <small>
                      {sample?.time}
                      {sample?.value ? ' · ' + sample.value : ''} · {example.location.length} байт ·
                      пакеты{' '}
                      {[...new Set(example.sources.map((source) => source.packetNo))].join(', ')}
                    </small>
                  </li>
                );
              })}
            </ul>
          </details>
          <p className="muted">
            Сейчас сохраняется{' '}
            {kind === 'OBSERVATION'
              ? 'наблюдение о выбранных данных'
              : 'гипотеза о назначении данных'}
            . Проверка на новой записи выполняется следующим шагом.
          </p>
          {save.error && <ErrorState error={save.error} />}
          <div className="observation-save">
            <Button type="submit" variant="primary" disabled={!text.trim() || save.isPending}>
              {save.isPending
                ? 'Сохранение…'
                : kind === 'HYPOTHESIS'
                  ? 'Сохранить гипотезу с источниками'
                  : 'Сохранить наблюдение с источниками'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
