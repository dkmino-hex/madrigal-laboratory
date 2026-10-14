DROP INDEX IF EXISTS idx_analysis_jobs_status;
DROP TABLE IF EXISTS analysis_jobs;
ALTER TABLE analysis_runs DROP COLUMN request_json;
