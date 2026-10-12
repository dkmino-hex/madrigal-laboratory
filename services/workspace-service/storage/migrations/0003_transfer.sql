CREATE TABLE project_imports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    job_id TEXT,
    archive_path TEXT NOT NULL,
    archive_sha256 TEXT NOT NULL CHECK (length(archive_sha256) = 64 AND archive_sha256 NOT GLOB '*[^0-9a-f]*'),
    manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
    status TEXT NOT NULL DEFAULT 'VALIDATING' CHECK (status IN ('VALIDATING','RESTORING','VERIFYING','READY','ERROR','CANCELLED')),
    diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (project_id, job_id) REFERENCES jobs(project_id, id)
) STRICT;
CREATE INDEX idx_project_imports_project ON project_imports(project_id, status);

CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
    metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (project_id, id)
) STRICT;
CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON snapshots
BEGIN SELECT RAISE(ABORT, 'workspace snapshots are immutable'); END;
CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON snapshots
BEGIN SELECT RAISE(ABORT, 'workspace snapshots are immutable'); END;

CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    job_id TEXT,
    snapshot_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('PROJECT_ZIP','REPORT_MARKDOWN')),
    status TEXT NOT NULL DEFAULT 'BUILDING' CHECK (status IN ('BUILDING','READY','ERROR','CANCELLED')),
    run_id TEXT,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    relative_path TEXT,
    sha256 TEXT CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
    size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (project_id, job_id) REFERENCES jobs(project_id, id),
    FOREIGN KEY (project_id, snapshot_id) REFERENCES snapshots(project_id, id),
    CHECK (status != 'READY' OR (relative_path IS NOT NULL AND sha256 IS NOT NULL AND size_bytes IS NOT NULL AND snapshot_id IS NOT NULL)),
    CHECK (kind != 'REPORT_MARKDOWN' OR status != 'READY' OR run_id IS NOT NULL)
) STRICT;
CREATE INDEX idx_artifacts_project ON artifacts(project_id, status, created_at);
CREATE TRIGGER artifacts_ready_no_update BEFORE UPDATE ON artifacts WHEN OLD.status = 'READY'
BEGIN SELECT RAISE(ABORT, 'ready artifacts are immutable'); END;
CREATE TRIGGER artifacts_ready_no_delete BEFORE DELETE ON artifacts WHEN OLD.status = 'READY'
BEGIN SELECT RAISE(ABORT, 'ready artifacts are immutable'); END;
