ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE actions ADD COLUMN type TEXT NOT NULL DEFAULT '';
ALTER TABLE observations ADD COLUMN basis TEXT NOT NULL DEFAULT '';
CREATE TABLE source_links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    action_id TEXT,
    data_json TEXT NOT NULL CHECK (json_valid(data_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(project_id,id),
    FOREIGN KEY(project_id,action_id) REFERENCES actions(project_id,id)
) STRICT;
CREATE INDEX idx_source_links_project ON source_links(project_id,id);
CREATE TABLE observation_source_links (
    project_id TEXT NOT NULL,
    observation_id TEXT NOT NULL,
    link_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('support','counterexample')),
    PRIMARY KEY(observation_id,link_id),
    FOREIGN KEY(project_id,observation_id) REFERENCES observations(project_id,id),
    FOREIGN KEY(project_id,link_id) REFERENCES source_links(project_id,id)
) STRICT;
