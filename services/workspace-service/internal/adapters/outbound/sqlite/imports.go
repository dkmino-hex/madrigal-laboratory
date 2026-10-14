package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func (s Store) retryProjectImport(ctx context.Context, importID, projectID string) (map[string]any, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	job, err := s.Jobs().EnqueueTx(ctx, tx, projectID, ProjectImportKind, &importID, map[string]string{"importId": importID})
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE project_imports SET job_id=?2,status='VALIDATING',updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1", importID, job.ID); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE projects SET status='IMPORTING' WHERE id=?1", projectID); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"importId": importID, "projectId": projectID, "jobId": job.ID, "status": "IMPORTING"}, nil
}

func (s Store) finishProjectImport(ctx context.Context, tx *sql.Tx, j jobs.Job, status string) error {
	if j.ResourceID == nil {
		return ErrInvalid
	}
	importStatus, projectStatus := "ERROR", "ERROR"
	if status == "SUCCEEDED" {
		importStatus, projectStatus = "READY", "READY"
	}
	if status == "CANCELLED" {
		importStatus = "CANCELLED"
	}
	if _, err := tx.ExecContext(ctx, "UPDATE project_imports SET status=?2,updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1", *j.ResourceID, importStatus); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "UPDATE projects SET status=?2,updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1", j.ProjectID, projectStatus)
	return err
}

func (s Store) ExistingProjectImport(ctx context.Context, importID, hash string) (map[string]any, bool, error) {
	var oldJob, oldProject, oldHash, status string
	err := s.DB.QueryRowContext(ctx, "SELECT job_id,project_id,archive_sha256,status FROM project_imports WHERE id=?1", importID).Scan(&oldJob, &oldProject, &oldHash, &status)
	if err == nil {
		if oldHash != hash {
			return nil, false, ErrConflict
		}
		if status != "ERROR" && status != "CANCELLED" {
			return map[string]any{"importId": importID, "projectId": oldProject, "jobId": oldJob, "status": status}, true, nil
		}
		result, err := s.retryProjectImport(ctx, importID, oldProject)
		return result, true, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, false, err
	}

	return nil, false, nil
}

func (s Store) RegisterProjectImport(ctx context.Context, importID, final, hash string, manifest domain.ProjectArchiveManifest, workspace map[string][]map[string]any) (map[string]any, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	projectID := identifier.New("prj")
	name, _ := workspace["project"][0]["name"].(string)
	if strings.TrimSpace(name) == "" {
		return nil, ErrInvalidArchive
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO projects(id,name,status) VALUES(?1,?2,'IMPORTING')", projectID, name); err != nil {
		return nil, err
	}
	settingsMap := map[string]string{}
	var current string
	oldCurrent, _ := workspace["project"][0]["current_settings_version"].(string)
	for _, setting := range workspace["settings"] {
		old, _ := setting["id"].(string)
		version, versionErr := domain.IntValue(setting["version"])
		body, _ := setting["settings_json"].(string)
		if versionErr != nil || old == "" || !json.Valid([]byte(body)) || settingsMap[old] != "" {
			return nil, ErrInvalidArchive
		}
		id := identifier.New("set")
		settingsMap[old] = id
		if old == oldCurrent {
			current = id
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO project_settings(id,project_id,version,settings_json) VALUES(?1,?2,?3,?4)", id, projectID, version, body); err != nil {
			return nil, err
		}
	}
	if current == "" {
		return nil, ErrInvalidArchive
	}
	if _, err = tx.ExecContext(ctx, "UPDATE projects SET current_settings_version=?2 WHERE id=?1", projectID, current); err != nil {
		return nil, err
	}
	job, err := s.Jobs().EnqueueTx(ctx, tx, projectID, ProjectImportKind, &importID, map[string]string{"importId": importID})
	if err != nil {
		return nil, err
	}
	contextJSON, _ := json.Marshal(importContext{Archive: manifest, SettingsMap: settingsMap})
	_, err = tx.ExecContext(ctx, "INSERT INTO project_imports(id,project_id,job_id,archive_path,archive_sha256,manifest_json,status) VALUES(?1,?2,?3,?4,?5,?6,'VALIDATING')", importID, projectID, job.ID, final, hash, string(contextJSON))
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"importId": importID, "projectId": projectID, "jobId": job.ID, "status": "IMPORTING"}, nil

}

func (s Store) RestoreWorkspaceRows(ctx context.Context, projectID string, data map[string][]map[string]any, capture domain.CaptureImportResult, journalPaths map[string]string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var restored bool
	if err = tx.QueryRowContext(ctx, "SELECT workspace_restored FROM project_imports WHERE project_id=?1", projectID).Scan(&restored); err != nil {
		return err
	}
	if restored {
		return tx.Commit()
	}
	journalIDs, actionIDs, observationIDs := map[string]string{}, map[string]string{}, map[string]string{}
	for _, row := range data["journalImports"] {
		old, _ := domain.TextValue(row, "id")
		sha, _ := domain.TextValue(row, "sha256")
		id := identifier.New("journal")
		journalIDs[old] = id
		offset, e := domain.IntValue(row["time_offset_ns"])
		if e != nil {
			return e
		}
		total, e := domain.IntValue(row["total_rows"])
		if e != nil {
			return e
		}
		accepted, e := domain.IntValue(row["accepted_rows"])
		if e != nil {
			return e
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO journal_imports(id,project_id,original_name,source_path,sha256,timezone,time_offset_ns,status,total_rows,accepted_rows,diagnostics_json) VALUES(?1,?2,?3,?4,?5,?6,?7,'READY',?8,?9,?10)`, id, projectID, row["original_name"], journalPaths[sha], sha, row["timezone"], offset, total, accepted, row["diagnostics_json"])
		if err != nil {
			return err
		}
	}
	for _, row := range data["actions"] {
		old, _ := domain.TextValue(row, "id")
		id := identifier.New("act")
		actionIDs[old] = id
		journal, _ := domain.TextValue(row, "journal_import_id")
		line, e := domain.IntValue(row["source_line"])
		if e != nil {
			return e
		}
		start, e := domain.IntValue(row["start_unix_ns"])
		if e != nil {
			return e
		}
		end, e := domain.IntValue(row["end_unix_ns"])
		if e != nil {
			return e
		}
		var captureID any
		if oldCapture, ok := row["capture_id"].(string); ok && oldCapture != "" {
			mapped := capture.CaptureIDs[oldCapture]
			if mapped == "" {
				return ErrInvalidArchive
			}
			captureID = mapped
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO actions(id,project_id,journal_import_id,source_action_id,source_line,capture_path,capture_id,session_label,start_unix_ns,end_unix_ns,name,parameters_json,observed_result_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`, id, projectID, journalIDs[journal], row["source_action_id"], line, row["capture_path"], captureID, row["session_label"], start, end, row["name"], row["parameters_json"], row["observed_result_json"])
		if err != nil {
			return err
		}
	}
	for _, row := range data["observations"] {
		old, _ := domain.TextValue(row, "id")
		id := identifier.New("obs")
		observationIDs[old] = id
		var action any
		if oldAction, ok := row["action_id"].(string); ok && oldAction != "" {
			action = actionIDs[oldAction]
			if action == "" {
				return ErrInvalidArchive
			}
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO observations(id,project_id,kind,text,status,action_id) VALUES(?1,?2,?3,?4,?5,?6)", id, projectID, row["kind"], row["text"], row["status"], action)
		if err != nil {
			return err
		}
	}
	for _, row := range data["evidence"] {
		oldObs, _ := domain.TextValue(row, "observation_id")
		packet, e := domain.IntValue(row["packet_no"])
		if e != nil {
			return e
		}
		frame, e := domain.IntValue(row["frame_offset"])
		if e != nil {
			return e
		}
		length, e := domain.IntValue(row["byte_length"])
		if e != nil {
			return e
		}
		selected, e := domain.IntValue(row["selected"])
		if e != nil {
			return e
		}
		var aid, sid, off any
		if old, ok := row["assembly_id"].(string); ok && old != "" {
			aid = capture.AssemblyIDs[old]
			if aid == "" {
				return ErrInvalidArchive
			}
			oldStream, _ := domain.TextValue(row, "stream_id")
			sid = capture.StreamIDs[oldStream]
			if sid == "" {
				return ErrInvalidArchive
			}
			off, e = domain.IntValue(row["stream_offset"])
			if e != nil {
				return e
			}
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO evidence(id,project_id,observation_id,kind,capture_sha256,packet_no,frame_offset,byte_length,assembly_id,stream_id,stream_offset,selected) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`, identifier.New("ev"), projectID, observationIDs[oldObs], row["kind"], row["capture_sha256"], packet, frame, length, aid, sid, off, selected)
		if err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE project_imports SET workspace_restored=1 WHERE project_id=?1", projectID); err != nil {
		return err
	}
	return tx.Commit()

}

func (s Store) ImportState(ctx context.Context, id, projectID string) (domain.ImportState, error) {
	var v domain.ImportState
	err := s.DB.QueryRowContext(ctx, "SELECT archive_path,archive_sha256,manifest_json,workspace_restored FROM project_imports WHERE id=?1 AND project_id=?2", id, projectID).Scan(&v.ArchivePath, &v.Hash, &v.ContextJSON, &v.WorkspaceRestored)
	return v, err
}

func (s Store) SetImportState(ctx context.Context, id, status string, children map[string]string) error {
	if children == nil {
		_, err := s.DB.ExecContext(ctx, "UPDATE project_imports SET status=?2 WHERE id=?1", id, status)
		return err
	}
	raw, _ := json.Marshal(children)
	if status == "" {
		_, err := s.DB.ExecContext(ctx, "UPDATE project_imports SET child_jobs_json=?2 WHERE id=?1", id, string(raw))
		return err
	}
	_, err := s.DB.ExecContext(ctx, "UPDATE project_imports SET child_jobs_json=?2,status=?3 WHERE id=?1", id, string(raw), status)
	return err
}
