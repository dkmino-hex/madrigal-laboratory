import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import type { Location, Source } from '../../shared/api/contracts/models';
import type { AutomaticInput } from '../../shared/api/contracts/research';
import { copyKnown } from '../../shared/model/bytes';
import { Button, ErrorState } from '../../shared/ui/common';
import { AutomaticObservation } from './AutomaticObservation';

export function ObserveSelection({
  location,
  sources,
  revisionId,
  runId,
}: {
  location: Location;
  sources: Source[];
  revisionId?: string;
  runId?: string;
}) {
  const [proposal, setProposal] = useState<AutomaticInput | null>(null);
  const prepare = useMutation({
    mutationFn: async () => {
      const window = await api.bytes(location);
      const hex = copyKnown(window, location, 'hex');
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify({ location, hex })),
      );
      const fingerprint = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
      return {
        projectId: location.projectId,
        text: `В диапазоне [${location.start}, ${BigInt(location.start) + BigInt(location.length)}) известны ${location.length} байт: ${hex}.`,
        basis: 'Снимок выделенных байтов. Назначение участка пока не установлено.',
        generation: {
          engineVersion: 'selection-0.1',
          fingerprint,
          candidateId: fingerprint,
          kind: 'selection' as const,
          matches: 1,
          total: 1,
        },
        examples: [
          {
            location,
            sources,
            status: 'tentative' as const,
            basis: 'Автоматически зафиксированное выделение',
            kind: 'support' as const,
            revisionId,
            runId,
          },
        ],
      };
    },
    onSuccess: setProposal,
  });
  return (
    <>
      <Button
        disabled={BigInt(location.length) > 256n || !sources.length || prepare.isPending}
        title="Автоматическое наблюдение по 1–256 известным байтам"
        onClick={() => prepare.mutate()}
      >
        {prepare.isPending ? 'Чтение байтов…' : 'Создать наблюдение из выделения'}
      </Button>
      {prepare.error && <ErrorState error={prepare.error} />}{' '}
      {proposal && <AutomaticObservation proposal={proposal} onClose={() => setProposal(null)} />}
    </>
  );
}
