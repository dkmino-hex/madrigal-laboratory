CREATE TABLE projects (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('READY','IMPORTING','ERROR')),
    current_settings_version TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (id, current_settings_version)
        REFERENCES project_settings(project_id, id) DEFERRABLE INITIALLY DEFERRED,
    CHECK (status != 'READY' OR current_settings_version IS NOT NULL)
) STRICT;
CREATE INDEX idx_projects_created ON projects(created_at, id);

CREATE TABLE project_settings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    version INTEGER NOT NULL CHECK (version > 0),
    settings_json TEXT NOT NULL CHECK (json_valid(settings_json) AND json_type(settings_json) = 'object'),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (project_id, version),
    UNIQUE (project_id, id)
) STRICT;

CREATE TRIGGER project_settings_no_update BEFORE UPDATE ON project_settings
BEGIN SELECT RAISE(ABORT, 'settings versions are immutable'); END;
CREATE TRIGGER project_settings_no_delete BEFORE DELETE ON project_settings
BEGIN SELECT RAISE(ABORT, 'settings versions are immutable'); END;

CREATE TABLE jobs (
    id TEXT PRIMARY KEY CHECK (id GLOB 'ws_*'),
    project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL CHECK (length(kind) > 0),
    resource_id TEXT,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
    payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
    error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
    progress_completed INTEGER NOT NULL DEFAULT 0 CHECK (progress_completed >= 0),
    progress_total INTEGER CHECK (progress_total IS NULL OR progress_total >= progress_completed),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at TEXT,
    finished_at TEXT,
    UNIQUE (project_id, id),
    CHECK (status NOT IN ('SUCCEEDED','FAILED','CANCELLED') OR finished_at IS NOT NULL),
    CHECK (status != 'FAILED' OR error_json IS NOT NULL)
) STRICT;
CREATE INDEX idx_jobs_queue ON jobs(status, created_at);
CREATE INDEX idx_jobs_project ON jobs(project_id, created_at);

CREATE TABLE idempotency_keys (
    scope TEXT NOT NULL,
    key TEXT NOT NULL CHECK (length(key) > 0),
    request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
    response_status INTEGER NOT NULL CHECK (response_status BETWEEN 100 AND 599),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    resource_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT NOT NULL,
    PRIMARY KEY (scope, key)
) STRICT;
CREATE INDEX idx_idempotency_expiry ON idempotency_keys(expires_at);
