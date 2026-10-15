package storage

import (
	"context"
	"encoding/json"

	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func (s Store) Settings(ctx context.Context, projectID, version string) ([]SettingsVersion, error) {
	if _, err := s.Get(ctx, projectID); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id,project_id,version,settings_json,created_at FROM project_settings WHERE project_id=? AND (?='' OR id=?) ORDER BY version`, projectID, version, version)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []SettingsVersion{}
	for rows.Next() {
		item, err := scanSettings(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s Store) Artifacts(ctx context.Context, projectID, cursor string, limit int) (map[string]any, error) {
	if limit < 1 || limit > 100 {
		return nil, ErrInvalid
	}
	if _, err := s.Get(ctx, projectID); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id,job_id,coalesce(run_id,''),snapshot_id,kind,status,filename,content_type FROM artifacts WHERE project_id=? AND id>? ORDER BY id LIMIT ?`, projectID, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, job, run, snapshot, kind, status, name, content string
		if err = rows.Scan(&id, &job, &run, &snapshot, &kind, &status, &name, &content); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"artifactId": id, "projectId": projectID, "jobId": job, "runId": run, "snapshotId": snapshot, "kind": kind, "status": status, "name": name, "contentType": content, "downloadUrl": "/api/v1/artifacts/" + id})
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	next := ""
	if len(items) > limit {
		items = items[:limit]
		next = items[len(items)-1]["artifactId"].(string)
	}
	return map[string]any{"items": items, "nextCursor": next}, nil
}
func (s Store) JournalImport(ctx context.Context, projectID, id string) (domain.JournalImport, error) {
	var item domain.JournalImport
	var raw string
	err := s.DB.QueryRowContext(ctx, `SELECT id,coalesce(job_id,''),status,sha256,total_rows,accepted_rows,diagnostics_json FROM journal_imports WHERE project_id=? AND id=?`, projectID, id).Scan(&item.ID, &item.JobID, &item.Status, &item.SHA256, &item.TotalRows, &item.AcceptedRows, &raw)
	item.Diagnostics = json.RawMessage(raw)
	return item, err
}
