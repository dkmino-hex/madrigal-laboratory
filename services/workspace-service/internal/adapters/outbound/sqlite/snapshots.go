package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

type Snapshot = domain.Snapshot

func collectSnapshotRows(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]map[string]any, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		targets := make([]any, len(columns))
		for i := range values {
			targets[i] = &values[i]
		}
		if err = rows.Scan(targets...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns))
		for i, key := range columns {
			if b, ok := values[i].([]byte); ok {
				item[key] = string(b)
			} else {
				item[key] = values[i]
			}
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s Store) CreateSnapshot(ctx context.Context, projectID string) (Snapshot, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: false})
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback()
	var status string
	if err = tx.QueryRowContext(ctx, "SELECT status FROM projects WHERE id=?1", projectID).Scan(&status); err != nil {
		return Snapshot{}, err
	}
	if status != "READY" {
		return Snapshot{}, ErrProjectNotReady
	}
	queries := []struct{ key, sql string }{
		{"project", "SELECT id,name,status,current_settings_version,created_at,updated_at FROM projects WHERE id=?1"},
		{"settings", "SELECT id,version,settings_json,created_at FROM project_settings WHERE project_id=?1 ORDER BY version"},
		{"journalImports", "SELECT id,original_name,sha256,timezone,time_offset_ns,status,total_rows,accepted_rows,diagnostics_json,created_at FROM journal_imports WHERE project_id=?1 ORDER BY id"},
		{"actions", "SELECT id,journal_import_id,source_action_id,source_line,capture_path,capture_id,session_label,start_unix_ns,end_unix_ns,name,parameters_json,observed_result_json,created_at FROM actions WHERE project_id=?1 ORDER BY id"},
		{"observations", "SELECT id,kind,text,status,action_id,created_at,updated_at FROM observations WHERE project_id=?1 ORDER BY id"},
		{"evidence", "SELECT id,observation_id,kind,capture_sha256,packet_no,frame_offset,byte_length,assembly_id,stream_id,stream_offset,selected,created_at FROM evidence WHERE project_id=?1 ORDER BY id"},
	}
	metadata := make(map[string]any, len(queries))
	counts := make(map[string]int, len(queries))
	for _, q := range queries {
		items, e := collectSnapshotRows(ctx, tx, q.sql, projectID)
		if e != nil {
			return Snapshot{}, fmt.Errorf("snapshot %s: %w", q.key, e)
		}
		metadata[q.key] = items
		counts[q.key] = len(items)
	}
	for _, v := range metadata["journalImports"].([]map[string]any) {
		if v["status"] != "READY" {
			return Snapshot{}, ErrInvalid
		}
	}
	body, err := json.Marshal(metadata)
	if err != nil {
		return Snapshot{}, err
	}
	hash := sha256.Sum256(body)
	manifest, err := json.Marshal(map[string]any{"version": 1, "service": "workspace", "projectId": projectID, "metadataSha256": hex.EncodeToString(hash[:]), "counts": counts})
	if err != nil {
		return Snapshot{}, err
	}
	id := identifier.New("snapshot")
	if _, err = tx.ExecContext(ctx, "INSERT INTO snapshots(id,project_id,manifest_json,metadata_json) VALUES(?1,?2,?3,?4)", id, projectID, string(manifest), string(body)); err != nil {
		return Snapshot{}, err
	}
	if err = tx.Commit(); err != nil {
		return Snapshot{}, err
	}
	return Snapshot{ID: id, ProjectID: projectID, Manifest: manifest, Metadata: body}, nil
}
