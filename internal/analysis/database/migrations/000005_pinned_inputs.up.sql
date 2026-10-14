ALTER TABLE analysis_runs ADD COLUMN capture_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_runs ADD COLUMN capture_engine_version TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_runs ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE analysis_runs ADD COLUMN input_manifest_json TEXT NOT NULL DEFAULT '{}';
