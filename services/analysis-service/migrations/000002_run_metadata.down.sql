DROP INDEX IF EXISTS idx_analysis_runs_idempotency;
DROP INDEX IF EXISTS idx_analysis_runs_project;
ALTER TABLE analysis_runs DROP COLUMN summary_json;
ALTER TABLE analysis_runs DROP COLUMN idempotency_key;
ALTER TABLE analysis_runs DROP COLUMN job_id;
ALTER TABLE analysis_runs DROP COLUMN settings_version;
ALTER TABLE analysis_runs DROP COLUMN capture_id;
ALTER TABLE analysis_runs DROP COLUMN project_id;
