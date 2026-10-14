// Временные frontend DTO. Не являются согласованным OpenAPI BASE-02.
import { z } from 'zod';
import { decimalSchema as d, timestampSchema } from '../../model/precision';

const id = z.string().min(1).max(200);
export const checkStatus = z.enum(['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'UNKNOWN']);
export const projectSchema = z.object({
  projectId: id,
  name: z.string(),
  description: z.string(),
  status: z.enum(['READY', 'IMPORTING', 'ERROR']),
  updatedAt: timestampSchema,
  captures: z.number().int().nonnegative(),
  settingsVersion: id,
  jobId: id.optional(),
  diagnostic: z.string().optional(),
});
export const captureSchema = z.object({
  captureId: id,
  projectId: id,
  name: z.string(),
  size: d,
  packets: d,
  sha256: z.string(),
  status: z.enum(['READY', 'IMPORTING', 'ERROR']),
  importedAt: timestampSchema,
  synthetic: z.boolean(),
  diagnostic: z.string().optional(),
  jobId: id.optional(),
});
export const sessionSchema = z.object({
  sessionId: id,
  captureId: id,
  generation: z.number().int().positive(),
  sideA: z.string(),
  sideB: z.string(),
  role: z.enum(['KNOWN', 'UNKNOWN']),
  startTime: timestampSchema,
  endTime: timestampSchema,
  bytes: d,
  defects: z.array(z.string()),
  streamA: id,
  streamB: id,
});
export const assemblySchema = z.object({
  assemblyId: id,
  captureId: id,
  sessionId: id,
  streamId: id,
  direction: z.enum(['A_TO_B', 'B_TO_A']),
  settingsVersion: id,
  status: z.enum(['READY', 'BUILDING', 'ERROR']),
  length: d,
});
export const locationSchema = z.object({
  projectId: id,
  captureId: id,
  sessionId: id,
  streamId: id,
  direction: z.enum(['A_TO_B', 'B_TO_A']),
  assemblyId: id,
  start: d,
  length: d,
});
export const sourceSchema = z.object({
  captureId: id,
  packetNo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  frameOffset: d,
  length: d,
  streamStart: d,
  relation: z.enum(['primary', 'retransmission', 'conflict-alternative']),
  alternativeGroupId: id.optional(),
});
const byte = z.number().int().min(0).max(255);
export const segmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('known'), start: d, bytes: z.array(byte).max(4096) }),
  z.object({ kind: z.literal('gap'), start: d, length: d, reason: z.string() }),
  z.object({ kind: z.literal('truncation'), start: d, length: d, reason: z.string() }),
  z.object({
    kind: z.literal('conflict'),
    start: d,
    length: d,
    alternatives: z
      .array(z.object({ bytes: z.array(byte).max(4096), sources: z.array(sourceSchema) }))
      .min(2),
  }),
]);
export const windowSchema = z.object({
  location: locationSchema,
  streamLength: d,
  segments: z.array(segmentSchema).max(4096),
});
export const packetSchema = z.object({
  captureId: id,
  packetNo: z.number().int().positive(),
  timestamp: timestampSchema,
  capturedLength: d,
  originalLength: d,
  headers: z.array(z.string()),
  bytes: z.array(byte).max(1048576),
});
export const settingsSchema = z.object({
  settingsVersion: id,
  timeZone: z.string(),
  offsetNanoseconds: z.string().regex(/^-?\d+$/),
  checksum: z.enum(['warn', 'strict', 'ignore']),
  overlap: z.enum(['preserve-alternatives']),
});
export const actionSchema = z.object({
  actionId: id,
  projectId: id,
  name: z.string(),
  type: z.string(),
  parameters: z.string(),
  timestamp: timestampSchema,
  timeZone: z.string(),
  offsetNanoseconds: z.string().regex(/^-?\d+$/),
  sourceFile: z.string(),
  row: z.number().int().positive(),
  importId: id,
});
export const evidenceSchema = z.object({
  evidenceId: id,
  location: locationSchema,
  sources: z.array(sourceSchema),
  status: z.enum(['tentative', 'confirmed']),
  basis: z.string(),
  actionId: id.optional(),
  kind: z.enum(['support', 'counterexample']),
  revisionId: id.optional(),
  runId: id.optional(),
});
export const hypothesisSchema = z.object({
  hypothesisId: id,
  projectId: id,
  type: z.enum(['observation', 'hypothesis']),
  text: z.string(),
  basis: z.string(),
  status: z.enum(['open', 'supported', 'refuted']),
  evidence: z.array(evidenceSchema),
});
export const revisionSchema = z.object({
  revisionId: id,
  interpretationId: id,
  createdAt: timestampSchema,
  json: z.string(),
  label: z.string(),
  parentRevisionId: id.optional(),
});
export const interpretationSchema = z.object({
  interpretationId: id,
  projectId: id,
  name: z.string(),
  revisions: z.array(revisionSchema),
});
export const fieldSchema = z.object({
  fieldId: id,
  path: z.string(),
  type: z.string(),
  value: z.string().nullable(),
  location: locationSchema,
  sources: z.array(sourceSchema),
  status: checkStatus,
  reason: z.string(),
  rule: z.string(),
});
export const resultSchema = z.object({
  resultId: id,
  messageId: id,
  status: checkStatus,
  reason: z.string(),
  rule: z.string(),
  location: locationSchema,
  fields: z.array(fieldSchema),
  sources: z.array(sourceSchema),
});
export const previewSchema = z.object({
  revisionId: id,
  location: locationSchema,
  results: z.array(resultSchema),
  unknown: z.array(locationSchema),
  complete: z.boolean(),
  diagnostic: z.string().optional(),
});
export const manifestSchema = z.object({
  revisionId: id,
  settingsVersion: id,
  engineVersion: z.string(),
  filters: z.string(),
  synthetic: z.boolean(),
  corpus: z.array(z.object({ captureId: id, assemblyId: id, sha256: z.string() })),
});
export const summarySchema = z.object({
  messages: d,
  knownBytes: d,
  unknownBytes: d,
  captures: d,
  sessions: d,
  rules: z.record(checkStatus, d),
  complete: z.boolean(),
});
export const runSchema = z.object({
  runId: id,
  projectId: id,
  jobId: id,
  createdAt: timestampSchema,
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED', 'INTERRUPTED']),
  manifest: manifestSchema,
  summary: summarySchema,
  historical: z.boolean(),
});
export const jobSchema = z.object({
  jobId: id,
  projectId: id,
  owner: z.enum(['Capture', 'Analysis', 'Workspace']),
  status: z.enum([
    'QUEUED',
    'RUNNING',
    'CANCEL_REQUESTED',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
    'INTERRUPTED',
  ]),
  stage: z.string(),
  completed: d,
  total: d.nullable(),
  unit: z.string(),
  resourceId: id.optional(),
  diagnostic: z.string().optional(),
});
export const artifactSchema = z.object({
  artifactId: id,
  projectId: id,
  jobId: id,
  runId: id.optional(),
  snapshotId: id.optional(),
  kind: z.enum(['report', 'project']),
  status: z.enum(['PENDING', 'READY', 'FAILED', 'CANCELLED']),
  name: z.string(),
  contentType: z.string(),
  downloadUrl: z.string().optional(),
});
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
    total: d.optional(),
  });
export type Project = z.infer<typeof projectSchema>;
export type Capture = z.infer<typeof captureSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Assembly = z.infer<typeof assemblySchema>;
export type Location = z.infer<typeof locationSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type ByteWindow = z.infer<typeof windowSchema>;
export type Packet = z.infer<typeof packetSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Action = z.infer<typeof actionSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type Interpretation = z.infer<typeof interpretationSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type Result = z.infer<typeof resultSchema>;
export type FieldResult = z.infer<typeof fieldSchema>;
export type Preview = z.infer<typeof previewSchema>;
export type Run = z.infer<typeof runSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type Job = z.infer<typeof jobSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type CheckStatus = z.infer<typeof checkStatus>;
export type Page<T> = { items: T[]; nextCursor: string | null; total?: z.infer<typeof d> };
