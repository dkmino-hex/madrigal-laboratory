ALTER TABLE project_imports ADD COLUMN child_jobs_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(child_jobs_json));
ALTER TABLE project_imports ADD COLUMN workspace_restored INTEGER NOT NULL DEFAULT 0 CHECK (workspace_restored IN (0,1));
