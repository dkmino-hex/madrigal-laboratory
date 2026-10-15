DROP TABLE analysis_idempotency;
ALTER TABLE analysis_imports DROP COLUMN id_map_json;
ALTER TABLE revisions DROP COLUMN parent_revision_id;
ALTER TABLE revisions DROP COLUMN change_comment;
