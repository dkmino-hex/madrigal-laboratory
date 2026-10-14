-- Additional run metadata required by Analysis API and snapshots.
ALTER TABLE analysis_runs ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_runs ADD COLUMN capture_id TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_runs ADD COLUMN settings_version TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_runs ADD COLUMN job_id TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_runs ADD COLUMN idempotency_key TEXT;
ALTER TABLE analysis_runs ADD COLUMN summary_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX idx_analysis_runs_project ON analysis_runs(project_id);
CREATE UNIQUE INDEX idx_analysis_runs_idempotency ON analysis_runs(project_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
