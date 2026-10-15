import { z } from 'zod';
import { evidenceSchema, generationSchema, locationSchema, sourceSchema } from './models';

export const proposalEvidenceSchema = evidenceSchema
  .omit({ evidenceId: true })
  .extend({ captureSha256: z.string() });
export const researchCandidateSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  kind: z.enum(['parameter', 'constant', 'variable']),
  parameter: z.string(),
  name: z.string(),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  encoding: z.string(),
  divisor: z.number().int().positive(),
  matches: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  support: z.array(z.string()),
  counterexamples: z.array(z.string()),
  inconclusive: z.array(z.string()),
  statement: z.string(),
  basis: z.string(),
  schemaJson: z.string().optional(),
  examples: z.array(proposalEvidenceSchema).max(24),
});
export const researchRowSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  label: z.string(),
  captureName: z.string(),
  captureSha256: z.string(),
  location: locationSchema,
  bytes: z.string(),
  timestamp: z.string(),
  boundary: z.string(),
  actionIds: z.array(z.string()),
  association: z.string(),
  values: z.record(z.string(), z.string()),
  sources: z.array(sourceSchema),
});
export const discoverySchema = z.object({
  projectId: z.string(),
  engineVersion: z.string(),
  fingerprint: z.string(),
  complete: z.boolean(),
  captures: z.array(z.object({ captureId: z.string(), assemblyId: z.string() })),
  rows: z.array(researchRowSchema).max(128),
  groups: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      rows: z.number().int().nonnegative(),
      parameters: z.array(z.string()),
      columns: z.array(
        z.object({
          offset: z.number().int(),
          present: z.number().int(),
          distinct: z.number().int(),
          kind: z.enum(['constant', 'variable', 'partial']),
          heat: z.number().int().min(0).max(5),
        }),
      ),
    }),
  ),
  candidates: z.array(researchCandidateSchema).max(80),
  warnings: z.array(z.string()),
});
export type Discovery = z.infer<typeof discoverySchema>;
export type ResearchCandidate = z.infer<typeof researchCandidateSchema>;
export type ResearchRow = z.infer<typeof researchRowSchema>;
export type DiscoveryInput = {
  projectId: string;
  captures?: { captureId: string; assemblyId?: string }[];
  direction?: string;
  revisionId?: string;
};
export type AutomaticInput = {
  projectId: string;
  kind?: 'OBSERVATION' | 'HYPOTHESIS';
  text: string;
  basis: string;
  generation: z.infer<typeof generationSchema>;
  examples: (Omit<z.infer<typeof proposalEvidenceSchema>, 'captureSha256'> & {
    captureSha256?: string;
  })[];
};
