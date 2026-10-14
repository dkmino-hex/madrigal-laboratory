CREATE TABLE analysis_snapshots (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 archive BLOB NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE analysis_imports (
 project_id TEXT NOT NULL,
 import_id TEXT NOT NULL,
 archive_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(project_id, import_id)
);
