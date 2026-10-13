CREATE TABLE interpretations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_interpretations_project_id

ON interpretations(project_id);

CREATE TABLE revisions (
    id TEXT PRIMARY KEY,
    interpretation_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    schema_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (interpretation_id)
        REFERENCES interpretations(id)
        ON DELETE CASCADE,

    UNIQUE (interpretation_id, version)
);

CREATE TABLE analysis_runs (
    id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL,
    assembly_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,

    FOREIGN KEY (revision_id)
        REFERENCES revisions(id),

    CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE TABLE analysis_results (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (run_id)
        REFERENCES analysis_runs(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_revisions_interpretation_id
    ON revisions(interpretation_id);

CREATE INDEX idx_analysis_runs_revision_id
    ON analysis_runs(revision_id);

CREATE INDEX idx_analysis_runs_assembly_id
    ON analysis_runs(assembly_id);

CREATE INDEX idx_analysis_results_run_id
    ON analysis_results(run_id);