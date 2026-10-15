import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompactByteMatrix } from './CandidateComparison';
import type {
  Discovery,
  ResearchCandidate,
  ResearchRow,
} from '../../shared/api/contracts/research';
import { goldenLocation } from '../../mocks/fixtures/corpus';
import { decimal } from '../../shared/model/precision';

it('показывает выбранный участок за первыми столбцами и группу без кандидатов', () => {
  const group: Discovery['groups'][number] = {
    id: 'g',
    title: 'g',
    rows: 1,
    parameters: [],
    columns: Array.from({ length: 96 }, (_, offset) => ({
      offset,
      present: 1,
      distinct: 1,
      kind: 'constant',
      heat: 0,
    })),
  };
  const row: ResearchRow = {
    id: 'row',
    groupId: 'g',
    label: 'Опыты',
    captureName: 'capture.pcap',
    captureSha256: '',
    location: { ...goldenLocation, length: decimal('96') },
    bytes: btoa(String.fromCharCode(...Array(96).fill(0))),
    timestamp: '',
    boundary: 'message',
    actionIds: [],
    association: '',
    values: {},
    sources: [],
  };
  const picked: ResearchCandidate = {
    id: 'candidate',
    groupId: 'g',
    kind: 'parameter',
    parameter: 'params.count',
    name: 'count',
    offset: 60,
    length: 2,
    encoding: 'uint16be',
    divisor: 1,
    matches: 1,
    total: 1,
    support: ['row'],
    counterexamples: [],
    inconclusive: [],
    statement: '',
    basis: '',
    examples: [],
  };
  const onSelect = vi.fn();
  const { rerender } = render(
    <CompactByteMatrix group={group} rows={[row]} picked={picked} onSelect={onSelect} />,
  );
  expect(screen.getByRole('columnheader', { name: '60' })).toHaveAttribute(
    'data-candidate',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: /Опыты/ }));
  expect(onSelect).toHaveBeenCalledWith('row');
  rerender(<CompactByteMatrix group={group} rows={[row]} picked={null} onSelect={onSelect} />);
  expect(screen.getByRole('columnheader', { name: '0' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Предыдущие столбцы байтов' })).toBeDisabled();
});
