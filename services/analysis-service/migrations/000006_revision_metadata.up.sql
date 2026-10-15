ALTER TABLE revisions ADD COLUMN change_comment TEXT NOT NULL DEFAULT '';
ALTER TABLE revisions ADD COLUMN parent_revision_id TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_imports ADD COLUMN id_map_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE analysis_idempotency (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    request_sha256 TEXT NOT NULL,
    response_json TEXT NOT NULL,
    PRIMARY KEY (scope, key)
);
