// GENERATED from Gateway OpenAPI. Do not edit.
export interface paths {
  '/api/v1/projects': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['projects'];
    put?: never;
    post: operations['createProject'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['project'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/captures': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['captures'];
    put?: never;
    /** @description Duplicate capture content is detected by SHA256 in the project. Idempotency-Key is not used. */
    post: operations['uploadCapture'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/import': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Retries use the same multipart importId. Reusing importId for another archive returns 409. */
    post: operations['importProject'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/exports': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['exportProject'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/sessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['sessions'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/captures/{captureId}/assemblies': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['assemblies'];
    put?: never;
    post: operations['createAssembly'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/streams/{streamId}/bytes': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['bytes'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/streams/{streamId}/sources': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['sources'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/captures/{captureId}/packets/{packetNo}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['packet'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/streams/{streamId}/search': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['search'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/settings': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['settings'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: operations['saveSettings'];
    trace?: never;
  };
  '/api/v1/projects/{projectId}/actions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['actions'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/action-log': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['importActions'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/evidence': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['evidence'];
    put?: never;
    post: operations['saveEvidence'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/observations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['hypotheses'];
    put?: never;
    post: operations['saveHypothesis'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/observations/{hypothesisId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: operations['deleteHypothesis'];
    options?: never;
    head?: never;
    patch: operations['patchHypothesis'];
    trace?: never;
  };
  '/api/v1/projects/{projectId}/interpretations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['interpretations'];
    put?: never;
    post: operations['createInterpretation'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/interpretations/{interpretationId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['interpretation'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/interpretations/{interpretationId}/revisions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['revisions'];
    put?: never;
    post: operations['saveRevision'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/previews': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['preview'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/runs': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['runs'];
    put?: never;
    post: operations['createRun'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/runs/{runId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['run'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/runs/{runId}/results': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['results'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/jobs/{jobId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['job'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/jobs/{jobId}/cancel': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['cancelJob'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/artifacts': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['artifacts'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/reports': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['createReport'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/sessions/{sessionId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['session'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/evidence/{evidenceId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: operations['patchEvidence'];
    trace?: never;
  };
  '/api/v1/projects/{projectId}/action-log/{importId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['actionImportStatus'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/artifacts/{artifactId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['downloadArtifact'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/analysis/health': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['analysisHealth'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/interpretations/{interpretationId}/revisions/{revisionId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getRevision'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/discoveries': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['discover'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/projects/{projectId}/observations/automatic': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['saveAutomaticObservation'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    Project: {
      projectId: string;
      name: string;
      description: string;
      /** @enum {string} */
      status: 'READY' | 'IMPORTING' | 'ERROR';
      settingsVersion: string | null;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
    };
    Settings: {
      settingsVersion: string;
      projectId: string;
      version: number;
      settings: {
        [key: string]: unknown;
      };
      /** Format: date-time */
      createdAt: string;
    };
    Capture: {
      captureId: string;
      sha256: string;
      originalName: string;
      sizeBytes: number;
      format: string;
      status: string;
      packetCount: number;
      diagnostics: string[];
      /** Format: date-time */
      createdAt: string;
    };
    Assembly: {
      assemblyId: string;
      settingsVersion: string;
      settings: {
        [key: string]: unknown;
      };
      engineVersion: string;
      status: string;
      diagnostics: unknown[];
      /** Format: date-time */
      createdAt: string;
      finishedAt: string;
    };
    Endpoint: {
      ip: string;
      port: number;
    };
    Session: {
      sessionId: string;
      assemblyId: string;
      captureId: string;
      generation: number;
      endpointA: components['schemas']['Endpoint'];
      endpointB: components['schemas']['Endpoint'];
      firstPacketNo: number;
      lastPacketNo: number;
      diagnostics: string[];
    };
    Stream: {
      streamId: string;
      /** @enum {string} */
      direction: 'A_TO_B' | 'B_TO_A';
      logicalLength: number;
      knownBytes: number;
      knownStart: boolean;
      diagnostics: string[];
    };
    Source: {
      packetNo: number;
      frameStart: number;
      frameEnd: number;
      streamStart: number;
      streamEnd: number;
      alternativeId?: string;
      /**
       * Format: date-time
       * @description Packet observation time, when available; not device time.
       */
      timestamp?: string;
    };
    Interval: {
      startOffset: number;
      endOffset: number;
      /** @enum {string} */
      kind: 'DATA' | 'GAP' | 'CONFLICT';
      data?: string;
      alternatives?: string[];
    };
    Packet: {
      captureId: string;
      packetNo: number;
      /** Format: date-time */
      timestamp: string;
      timestampSeconds: number;
      timestampNanoseconds: number;
      capturedLength: number;
      originalLength: number;
      frame: string;
      sourceIp: string;
      destinationIp: string;
      sourcePort: number;
      destinationPort: number;
      checksumStatus: string;
      diagnostics: string[];
    };
    Job: {
      jobId: string;
      projectId: string;
      /** @enum {string} */
      owner: 'Workspace' | 'Capture' | 'Analysis';
      kind?: string;
      resourceId?: string;
      /** @enum {string} */
      status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
      stage: string;
      completed: string;
      total?: string;
      cancelRequested: boolean;
      error?: {
        code: string;
        message: string;
      };
    };
    JournalImport: {
      importId: string;
      jobId: string;
      status: string;
      sha256: string;
      totalRows: number;
      acceptedRows: number;
      diagnostics: {
        line: number;
        message: string;
      }[];
    };
    Action: {
      actionId: string;
      projectId: string;
      importId: string;
      sourceActionId: string;
      sourceLine: number;
      capturePath: string;
      session: string;
      /** Format: date-time */
      start: string;
      /** Format: date-time */
      end: string;
      name: string;
      type: string;
      parameters: unknown;
      parametersJson: string;
      observedResult: unknown;
      sourceFile: string;
      timezone: string;
      timeOffsetNs: string;
    };
    Location: {
      projectId: string;
      captureId: string;
      assemblyId: string;
      sessionId: string;
      streamId: string;
      /** @enum {string} */
      direction: 'A_TO_B' | 'B_TO_A';
      start: string;
      length: string;
    };
    FrameSource: {
      captureId: string;
      packetNo: number;
      frameOffset: string;
      length: string;
      streamStart: string;
      /** @enum {string} */
      relation: 'primary' | 'retransmission' | 'conflict-alternative';
      alternativeGroupId?: string;
    };
    SourceLink: {
      evidenceId: string;
      location: components['schemas']['Location'];
      sources: components['schemas']['FrameSource'][];
      captureSha256: string;
      /** @enum {string} */
      status: 'tentative' | 'confirmed';
      basis: string;
      actionId?: string;
      /** @enum {string} */
      kind: 'support' | 'counterexample';
      revisionId?: string;
      runId?: string;
    };
    LinkReference: {
      evidenceId: string;
      /** @enum {string} */
      kind: 'support' | 'counterexample';
    };
    Observation: {
      observationId: string;
      /** @enum {string} */
      kind: 'OBSERVATION' | 'HYPOTHESIS';
      text: string;
      /** @enum {string} */
      status: 'DRAFT' | 'SUPPORTED' | 'REFUTED' | 'INCONCLUSIVE';
      actionId: string;
      basis: string;
      evidence: {
        [key: string]: unknown;
      }[];
      sourceLinks: components['schemas']['SourceLink'][];
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      generation?: components['schemas']['Generation'];
    };
    Interpretation: {
      interpretationId: string;
      projectId: string;
      name: string;
      description: string;
      currentRevisionId: string;
      /** Format: date-time */
      createdAt: string;
    };
    Revision: {
      revisionId: string;
      interpretationId: string;
      version: number;
      revision: {
        [key: string]: unknown;
      };
      schemaJson: string;
      /** Format: date-time */
      createdAt: string;
      changeComment: string;
      parentRevisionId?: string;
    };
    Span: {
      assemblyId: string;
      streamId: string;
      startOffset: string;
      endOffset: string;
      packetRefs?: components['schemas']['Source'][];
    };
    Field: {
      name: string;
      type?: string;
      value?: unknown;
      valueText?: string;
      sourceSpan: components['schemas']['Span'];
    };
    Check: {
      ruleId: string;
      /** @enum {string} */
      status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'NOT_APPLICABLE' | 'UNKNOWN';
      message?: string;
      sourceSpan?: components['schemas']['Span'];
    };
    Message: {
      sourceSpan: components['schemas']['Span'];
      status: string;
      fields: components['schemas']['Field'][];
      checks: components['schemas']['Check'][];
    };
    AnalysisResult: {
      messages: components['schemas']['Message'][];
      fields: components['schemas']['Field'][];
      checks: components['schemas']['Check'][];
      unknownRegions: components['schemas']['Span'][];
      errors: {
        code: string;
        message: string;
        sourceSpan?: components['schemas']['Span'];
      }[];
    };
    CorpusEntry: {
      captureId: string;
      assemblyId: string;
      sha256?: string;
    };
    Run: {
      runId: string;
      projectId: string;
      revisionId: string;
      assemblyId: string;
      captureId: string;
      settingsVersion: string;
      captureSha256: string;
      captureEngineVersion: string;
      settingsJson: string;
      inputManifestJson: string;
      jobId: string;
      status: string;
      summary: {
        [key: string]: unknown;
      };
      /** Format: date-time */
      createdAt: string;
      job?: components['schemas']['Job'];
      /** @description True when a newer revision of the same interpretation exists. The pinned result is unchanged. */
      historical?: boolean;
    };
    Artifact: {
      artifactId: string;
      projectId: string;
      jobId: string;
      runId: string;
      snapshotId: string;
      /** @enum {string} */
      kind: 'REPORT_MARKDOWN' | 'PROJECT_ZIP';
      /** @enum {string} */
      status: 'BUILDING' | 'READY' | 'ERROR' | 'CANCELLED';
      name: string;
      contentType: string;
      downloadUrl: string;
    };
    Accepted: {
      jobId: string;
      status?: string;
    };
    Error:
      | {
          code: string;
          message: string;
        }
      | {
          error: unknown;
        };
    SessionDetail: components['schemas']['Session'] & {
      roleStatus: string;
      /** Format: date-time */
      firstSeen: string;
      /** Format: date-time */
      lastSeen: string;
      streams: components['schemas']['Stream'][];
    };
    Generation: {
      engineVersion: string;
      fingerprint: string;
      candidateId: string;
      /** @enum {string} */
      kind: 'parameter' | 'constant' | 'variable' | 'selection';
      parameter?: string;
      matches: number;
      total: number;
    };
    ProposedSourceLink: {
      location: components['schemas']['Location'];
      sources: components['schemas']['FrameSource'][];
      captureSha256: string;
      /** @enum {string} */
      status: 'tentative' | 'confirmed';
      basis: string;
      actionId?: string;
      /** @enum {string} */
      kind: 'support' | 'counterexample';
      revisionId?: string;
      runId?: string;
    };
    CaptureSelection: {
      captureId: string;
      assemblyId?: string;
    };
    ResearchColumn: {
      offset: number;
      present: number;
      distinct: number;
      /** @enum {string} */
      kind: 'constant' | 'variable' | 'partial';
      heat: number;
    };
    ResearchGroup: {
      id: string;
      title: string;
      rows: number;
      parameters: string[];
      columns: components['schemas']['ResearchColumn'][];
    };
    ResearchRow: {
      id: string;
      groupId: string;
      label: string;
      captureName: string;
      captureSha256: string;
      location: components['schemas']['Location'];
      bytes: string;
      /** Format: date-time */
      timestamp: string;
      /** @enum {string} */
      boundary: 'schema' | 'inferred-length-prefix' | 'tcp-fragment';
      actionIds: string[];
      /** @enum {string} */
      association: 'unlinked' | 'time-window' | 'overlapping-windows';
      values: {
        [key: string]: string;
      };
      sources: components['schemas']['FrameSource'][];
    };
    ResearchCandidate: {
      id: string;
      groupId: string;
      /** @enum {string} */
      kind: 'parameter' | 'constant' | 'variable';
      parameter: string;
      name: string;
      offset: number;
      length: number;
      encoding: string;
      /** @enum {integer} */
      divisor: 1 | 10 | 100 | 1000;
      matches: number;
      total: number;
      support: string[];
      counterexamples: string[];
      inconclusive: string[];
      statement: string;
      basis: string;
      schemaJson?: string;
      examples: components['schemas']['ProposedSourceLink'][];
    };
    Discovery: {
      projectId: string;
      engineVersion: string;
      fingerprint: string;
      complete: boolean;
      captures: components['schemas']['CaptureSelection'][];
      rows: components['schemas']['ResearchRow'][];
      groups: components['schemas']['ResearchGroup'][];
      candidates: components['schemas']['ResearchCandidate'][];
      warnings: string[];
    };
    DiscoveryInput: {
      captures?: components['schemas']['CaptureSelection'][];
      /** @enum {string} */
      direction?: '' | 'A_TO_B' | 'B_TO_A';
      revisionId?: string;
    };
    AutomaticObservationInput: {
      /** @enum {string} */
      kind?: 'OBSERVATION' | 'HYPOTHESIS';
      text: string;
      basis: string;
      generation: components['schemas']['Generation'];
      examples: components['schemas']['ProposedSourceLink'][];
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  projects: {
    parameters: {
      query?: {
        q?: string;
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['Project'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  createProject: {
    parameters: {
      query?: never;
      header: {
        /** @description Stable key for retries of the same logical request. Reusing it with another body returns 409. */
        'Idempotency-Key': string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          name: string;
          description?: string;
          settings?: {
            [key: string]: unknown;
          };
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Project'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  project: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Project'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  captures: {
    parameters: {
      query?: {
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['Capture'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  uploadCapture: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'multipart/form-data': {
          /** Format: binary */
          file: string;
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Accepted'] & {
            captureId: string;
            sha256: string;
            duplicate: boolean;
            job: components['schemas']['Job'];
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  importProject: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'multipart/form-data': {
          /** Format: binary */
          file: string;
          importId: string;
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Accepted'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  exportProject: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': Record<string, never>;
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Accepted'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  sessions: {
    parameters: {
      query?: {
        captureId?: string;
        assemblyId?: string;
        streamId?: string;
        ip?: string;
        port?: string;
        from?: string;
        to?: string;
        q?: string;
        defects?: string;
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['Session'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  assemblies: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
        captureId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['Assembly'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  createAssembly: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
        captureId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          settingsVersion: string;
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Accepted'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  bytes: {
    parameters: {
      query: {
        assemblyId: string;
        offset?: string;
        length?: string;
      };
      header?: never;
      path: {
        projectId: string;
        streamId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            assemblyId: string;
            streamId: string;
            intervals: components['schemas']['Interval'][];
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  sources: {
    parameters: {
      query: {
        assemblyId: string;
        offset?: string;
        length?: string;
      };
      header?: never;
      path: {
        projectId: string;
        streamId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            assemblyId: string;
            streamId: string;
            sources: components['schemas']['Source'][];
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  packet: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
        captureId: string;
        packetNo: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Packet'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  search: {
    parameters: {
      query?: {
        assemblyId?: string;
        mode?: string;
        pattern?: string;
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        projectId: string;
        streamId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: {
              startOffset: number;
              endOffset: number;
            }[];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  settings: {
    parameters: {
      query?: {
        settingsVersion?: string;
      };
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['Settings'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  saveSettings: {
    parameters: {
      query?: never;
      header: {
        /** @description Stable key for retries of the same logical request. Reusing it with another body returns 409. */
        'Idempotency-Key': string;
      };
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          settings: {
            [key: string]: unknown;
          };
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Settings'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  actions: {
    parameters: {
      query?: {
        q?: string;
        type?: string;
        from?: string;
        to?: string;
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['Action'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  importActions: {
    parameters: {
      query?: never;
      header?: {
        /** @description Stable key for retries of the same logical request. Reusing it with another body returns 409. */
        'Idempotency-Key'?: string;
      };
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'multipart/form-data': {
          /** Format: binary */
          file: string;
          timezone?: string;
          timeOffsetNs?: string;
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['JournalImport'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  evidence: {
    parameters: {
      query?: {
        actionId?: string;
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['SourceLink'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  saveEvidence: {
    parameters: {
      query?: never;
      header?: {
        /** @description Stable key for retries of the same logical request. Reusing it with another body returns 409. */
        'Idempotency-Key'?: string;
      };
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          evidenceId?: string;
          location: components['schemas']['Location'];
          sources: components['schemas']['FrameSource'][];
          captureSha256: string;
          /** @enum {string} */
          status: 'tentative' | 'confirmed';
          basis: string;
          actionId?: string;
          /** @enum {string} */
          kind: 'support' | 'counterexample';
          revisionId?: string;
          runId?: string;
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SourceLink'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  hypotheses: {
    parameters: {
      query?: {
        kind?: string;
        status?: string;
        source?: string;
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['Observation'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  saveHypothesis: {
    parameters: {
      query?: never;
      header?: {
        /** @description Stable key for retries of the same logical request. Reusing it with another body returns 409. */
        'Idempotency-Key'?: string;
      };
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          kind: string;
          text: string;
          basis?: string;
          status?: string;
          sourceLinks?: components['schemas']['LinkReference'][];
          evidence?: {
            [key: string]: unknown;
          }[];
          actionId?: string;
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Observation'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  deleteHypothesis: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
        hypothesisId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            projectId: string;
            hypothesisId: string;
            deleted: boolean;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  patchHypothesis: {
    parameters: {
      query?: never;
      header?: {
        /** @description Stable key for retries of the same logical request. Reusing it with another body returns 409. */
        'Idempotency-Key'?: string;
      };
      path: {
        projectId: string;
        hypothesisId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          text?: string;
          basis?: string;
          status?: string;
          sourceLinks?: components['schemas']['LinkReference'][];
          selectedEvidenceIds?: string[];
          /** @enum {string} */
          kind?: 'OBSERVATION' | 'HYPOTHESIS';
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Observation'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  interpretations: {
    parameters: {
      query?: {
        q?: string;
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['Interpretation'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  createInterpretation: {
    parameters: {
      query?: never;
      header?: {
        /** @description Stable key for retries of the same logical request. Reusing it with another body returns 409. */
        'Idempotency-Key'?: string;
      };
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          name: string;
          description?: string;
          revision?: {
            [key: string]: unknown;
          };
          schemaJson?: string;
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Interpretation'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  interpretation: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
        interpretationId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Interpretation'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  revisions: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
        interpretationId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['Revision'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  saveRevision: {
    parameters: {
      query?: never;
      header?: {
        /** @description Stable key for retries of the same logical request. Reusing it with another body returns 409. */
        'Idempotency-Key'?: string;
      };
      path: {
        projectId: string;
        interpretationId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          revision?: {
            [key: string]: unknown;
          };
          schemaJson?: string;
          changeComment?: string;
          parentRevisionId?: string;
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Revision'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  preview: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          revisionId: string;
          assemblyId: string;
          streamId: string;
          offset: string;
          length: string;
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AnalysisResult'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  runs: {
    parameters: {
      query?: {
        status?: string;
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['Run'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  createRun: {
    parameters: {
      query?: never;
      header?: {
        /** @description Stable key for retries of the same logical request. Reusing it with another body returns 409. */
        'Idempotency-Key'?: string;
      };
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          revisionId: string;
          assemblyId?: string;
          captureId?: string;
          settingsVersion?: string;
          corpus?: components['schemas']['CorpusEntry'][];
          filters?: {
            [key: string]: unknown;
          };
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Accepted'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  run: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
        runId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Run'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  results: {
    parameters: {
      query?: {
        view?: string;
        status?: string;
        ruleId?: string;
        source?: string;
        q?: string;
        cursor?: string;
        limit?: number;
        captureId?: string;
      };
      header?: never;
      path: {
        projectId: string;
        runId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            | {
                items: components['schemas']['Message'][];
                nextCursor?: string;
              }
            | {
                items: components['schemas']['Check'][];
                nextCursor: string;
                total: string;
              }
            | {
                items: components['schemas']['Field'][];
                fields: components['schemas']['Field'][];
                checks: components['schemas']['Check'][];
                counterexamples: components['schemas']['Check'][];
                nextCursor: string;
              };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  job: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        jobId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Job'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  cancelJob: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        jobId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': Record<string, never>;
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Job'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  artifacts: {
    parameters: {
      query?: {
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            items: components['schemas']['Artifact'][];
            nextCursor?: string;
          };
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  createReport: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          runId: string;
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Accepted'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  session: {
    parameters: {
      query: {
        assemblyId: string;
      };
      header?: never;
      path: {
        projectId: string;
        sessionId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionDetail'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  patchEvidence: {
    parameters: {
      query?: never;
      header?: {
        /** @description Stable key for retries of the same logical request. Reusing it with another body returns 409. */
        'Idempotency-Key'?: string;
      };
      path: {
        projectId: string;
        evidenceId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          evidenceId?: string;
          location: components['schemas']['Location'];
          sources: components['schemas']['FrameSource'][];
          captureSha256: string;
          /** @enum {string} */
          status: 'tentative' | 'confirmed';
          basis: string;
          actionId?: string;
          /** @enum {string} */
          kind: 'support' | 'counterexample';
          revisionId?: string;
          runId?: string;
        };
      };
    };
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SourceLink'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  actionImportStatus: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
        importId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Success. Native service DTO; UI models are adapted in frontend/src/shared/api/live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['JournalImport'];
        };
      };
      /** @description Error */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  downloadArtifact: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        artifactId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description SHA256-verified Markdown report or project ZIP. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/zip': string;
          'text/markdown': string;
        };
      };
      /** @description Artifact is not ready */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  analysisHealth: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Analysis liveness */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/plain': string;
        };
      };
    };
  };
  getRevision: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
        interpretationId: string;
        revisionId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Stored immutable revision */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Revision'];
        };
      };
      /** @description Revision does not belong to the project */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  discover: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['DiscoveryInput'];
      };
    };
    responses: {
      /** @description Success */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Discovery'];
        };
      };
      /** @description Invalid input */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Source service unavailable */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  saveAutomaticObservation: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': string;
      };
      path: {
        projectId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['AutomaticObservationInput'];
      };
    };
    responses: {
      /** @description Success */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Observation'];
        };
      };
      /** @description Invalid input */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Source service unavailable */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
}
