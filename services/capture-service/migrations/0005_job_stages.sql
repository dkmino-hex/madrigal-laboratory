ALTER TABLE jobs ADD COLUMN stage TEXT NOT NULL DEFAULT 'QUEUED' CHECK (length(stage)>0);
CREATE INDEX idx_jobs_resource ON jobs(project_id,resource_id,kind,created_at);
