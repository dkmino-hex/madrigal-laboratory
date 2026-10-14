CREATE TABLE analysis_jobs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL DEFAULT 'ANALYSIS_RUN', status TEXT NOT NULL DEFAULT 'QUEUED',
 stage TEXT NOT NULL DEFAULT 'QUEUED', completed TEXT NOT NULL DEFAULT '0',
 total TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 started_at TEXT, finished_at TEXT,
 FOREIGN KEY(run_id) REFERENCES analysis_runs(id)
);
CREATE INDEX idx_analysis_jobs_status ON analysis_jobs(status);
ALTER TABLE analysis_runs ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}';
