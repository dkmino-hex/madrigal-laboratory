CREATE TABLE assembly_views (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
    status TEXT NOT NULL DEFAULT 'BUILDING' CHECK (status IN ('BUILDING','READY','ERROR')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE TRIGGER assembly_views_inputs_no_update BEFORE UPDATE OF id, project_id, manifest_json ON assembly_views
BEGIN SELECT RAISE(ABORT, 'assembly view inputs are immutable'); END;
CREATE TRIGGER assembly_views_terminal_no_update BEFORE UPDATE ON assembly_views WHEN OLD.status != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'finished assembly views are immutable'); END;
CREATE TRIGGER assembly_views_terminal_no_delete BEFORE DELETE ON assembly_views WHEN OLD.status != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'finished assembly views are immutable'); END;

CREATE TABLE assembly_view_items (
    view_id TEXT NOT NULL REFERENCES assembly_views(id),
    assembly_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
    end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
    PRIMARY KEY (view_id, assembly_id, stream_id, start_offset, end_offset),
    FOREIGN KEY (assembly_id, stream_id) REFERENCES streams(assembly_id, id)
) STRICT;
CREATE TRIGGER assembly_view_items_check_insert BEFORE INSERT ON assembly_view_items
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM assembly_views v
        JOIN assemblies a ON a.project_id = v.project_id AND a.id = NEW.assembly_id
        JOIN streams s ON s.id = NEW.stream_id AND s.assembly_id = a.id
        WHERE v.id = NEW.view_id AND v.status = 'BUILDING' AND a.status = 'READY'
        AND NEW.end_offset <= s.logical_length
    ) THEN RAISE(ABORT, 'view requires ready assemblies in the same project and valid ranges') END;
END;
CREATE TRIGGER assembly_view_items_no_update BEFORE UPDATE ON assembly_view_items
BEGIN SELECT RAISE(ABORT, 'assembly view items are immutable'); END;
CREATE TRIGGER assembly_view_items_building_delete BEFORE DELETE ON assembly_view_items
WHEN (SELECT status FROM assembly_views WHERE id=OLD.view_id) != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'finished assembly view items are immutable'); END;

CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
    metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON snapshots
BEGIN SELECT RAISE(ABORT, 'capture snapshots are immutable'); END;
CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON snapshots
BEGIN SELECT RAISE(ABORT, 'capture snapshots are immutable'); END;

CREATE TABLE imports (
    project_id TEXT NOT NULL,
    import_id TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
    status TEXT NOT NULL DEFAULT 'RESTORING' CHECK (status IN ('RESTORING','VERIFYING','READY','ERROR','CANCELLED')),
    diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (project_id, import_id)
) STRICT;
