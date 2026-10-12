CREATE TABLE journal_imports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    job_id TEXT,
    original_name TEXT NOT NULL,
    source_path TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    time_offset_ns INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'IMPORTING' CHECK (status IN ('IMPORTING','READY','ERROR','CANCELLED')),
    total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
    accepted_rows INTEGER NOT NULL DEFAULT 0 CHECK (accepted_rows BETWEEN 0 AND total_rows),
    diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (project_id, id),
    FOREIGN KEY (project_id, job_id) REFERENCES jobs(project_id, id)
) STRICT;

CREATE TABLE actions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    journal_import_id TEXT NOT NULL,
    source_action_id TEXT NOT NULL,
    source_line INTEGER NOT NULL CHECK (source_line > 0),
    capture_path TEXT NOT NULL,
    capture_id TEXT,
    session_label TEXT,
    start_unix_ns INTEGER NOT NULL,
    end_unix_ns INTEGER NOT NULL CHECK (end_unix_ns >= start_unix_ns),
    name TEXT NOT NULL,
    parameters_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(parameters_json)),
    observed_result_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(observed_result_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (journal_import_id, source_action_id),
    UNIQUE (project_id, id),
    FOREIGN KEY (project_id, journal_import_id) REFERENCES journal_imports(project_id, id)
) STRICT;
CREATE INDEX idx_actions_project_time ON actions(project_id, start_unix_ns, id);
CREATE INDEX idx_actions_project_name_time ON actions(project_id, name, start_unix_ns);

CREATE TABLE observations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL CHECK (kind IN ('OBSERVATION','HYPOTHESIS')),
    text TEXT NOT NULL CHECK (length(trim(text)) > 0),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUPPORTED','REFUTED','INCONCLUSIVE')),
    action_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (project_id, id),
    FOREIGN KEY (project_id, action_id) REFERENCES actions(project_id, id)
) STRICT;
CREATE INDEX idx_observations_project ON observations(project_id, kind, status, created_at);

-- Sources are external Capture references; they survive changes of interpretation.
CREATE TABLE evidence (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    observation_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('SUPPORT','COUNTEREXAMPLE','CONTEXT')),
    capture_sha256 TEXT NOT NULL CHECK (length(capture_sha256) = 64 AND capture_sha256 NOT GLOB '*[^0-9a-f]*'),
    packet_no INTEGER NOT NULL CHECK (packet_no >= 1),
    frame_offset INTEGER NOT NULL CHECK (frame_offset >= 0),
    byte_length INTEGER NOT NULL CHECK (byte_length > 0),
    assembly_id TEXT,
    stream_id TEXT,
    stream_offset INTEGER CHECK (stream_offset IS NULL OR stream_offset >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (project_id, observation_id) REFERENCES observations(project_id, id),
    CHECK (
        (assembly_id IS NULL AND stream_id IS NULL AND stream_offset IS NULL)
        OR (assembly_id IS NOT NULL AND stream_id IS NOT NULL AND stream_offset IS NOT NULL)
    )
) STRICT;
CREATE INDEX idx_evidence_observation ON evidence(observation_id);
