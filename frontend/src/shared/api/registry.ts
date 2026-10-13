import approvedMapping from './contracts/gateway-mapping.json';
export const operations = {
  projects: { owner: 'Workspace', mutation: false },
  project: { owner: 'Workspace', mutation: false },
  createProject: { owner: 'Workspace', mutation: true },
  captures: { owner: 'Capture', mutation: false },
  uploadCapture: { owner: 'Capture', mutation: true },
  importProject: { owner: 'Workspace', mutation: true },
  exportProject: { owner: 'Workspace', mutation: true },
  sessions: { owner: 'Capture', mutation: false },
  assemblies: { owner: 'Capture', mutation: false },
  bytes: { owner: 'Capture', mutation: false },
  sources: { owner: 'Capture', mutation: false },
  packet: { owner: 'Capture', mutation: false },
  search: { owner: 'Capture', mutation: false },
  settings: { owner: 'Workspace', mutation: false },
  saveSettings: { owner: 'Workspace', mutation: true },
  createAssembly: { owner: 'Capture', mutation: true },
  actions: { owner: 'Workspace', mutation: false },
  importActions: { owner: 'Workspace', mutation: true },
  evidence: { owner: 'Workspace', mutation: false },
  saveEvidence: { owner: 'Workspace', mutation: true },
  hypotheses: { owner: 'Workspace', mutation: false },
  saveHypothesis: { owner: 'Workspace', mutation: true },
  interpretations: { owner: 'Analysis', mutation: false },
  interpretation: { owner: 'Analysis', mutation: false },
  createInterpretation: { owner: 'Analysis', mutation: true },
  saveRevision: { owner: 'Analysis', mutation: true },
  preview: { owner: 'Analysis', mutation: true },
  runs: { owner: 'Analysis', mutation: false },
  run: { owner: 'Analysis', mutation: false },
  createRun: { owner: 'Analysis', mutation: true },
  results: { owner: 'Analysis', mutation: false },
  job: { owner: 'Gateway', mutation: false },
  cancelJob: { owner: 'Gateway', mutation: true },
  artifacts: { owner: 'Workspace', mutation: false },
  createReport: { owner: 'Workspace', mutation: true },
} as const;
export type Operation = keyof typeof operations;
export type Mapping = {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  operationId: string;
  contractVersion: string;
  idempotent: boolean;
};
// Только согласованный BASE-02 может заполнить эту карту. Draft-пути недоступны в api.
export const gatewayMapping: Partial<Record<Operation, Mapping>> = approvedMapping;
export function availability(operation: Operation) {
  return gatewayMapping[operation] ? 'MAPPED' : 'CONTRACT_PENDING';
}
export function draftMapping(operation: Operation): Mapping {
  return {
    method: operations[operation].mutation ? 'POST' : 'GET',
    path: '/__madrigal_mock/v1/' + operation,
    operationId: 'draft:' + operation,
    contractVersion: 'frontend-draft-v1',
    idempotent: operations[operation].mutation,
  };
}
