package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/google/uuid"
)

// domain.Snapshot contains only data owned by Analysis. It is a versioned logical export,
// not a copy of the SQLite database (which could include other projects).

func (r *InterpretationRepository) ExportSnapshot(ctx context.Context, project string) (domain.Snapshot, error) {
	s := domain.Snapshot{Version: 1, ProjectID: project, Interpretations: []domain.InterpretationRow{}, Revisions: []domain.RevisionRow{}, Runs: []domain.RunRow{}, Results: []domain.ResultRow{}}
	tx, e := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return s, e
	}
	defer tx.Rollback()
	rows, e := tx.QueryContext(ctx, `SELECT id,name,COALESCE(description,''),created_at FROM interpretations WHERE project_id=? ORDER BY id`, project)
	if e != nil {
		return s, e
	}
	for rows.Next() {
		var v domain.InterpretationRow
		if e = rows.Scan(&v.ID, &v.Name, &v.Description, &v.CreatedAt); e != nil {
			break
		}
		s.Interpretations = append(s.Interpretations, v)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return s, e
	}
	rows, e = tx.QueryContext(ctx, `SELECT r.id,r.interpretation_id,r.version,r.schema_json,r.created_at,r.change_comment,r.parent_revision_id FROM revisions r JOIN interpretations i ON i.id=r.interpretation_id WHERE i.project_id=? ORDER BY r.id`, project)
	if e != nil {
		return s, e
	}
	for rows.Next() {
		var v domain.RevisionRow
		if e = rows.Scan(&v.ID, &v.InterpretationID, &v.Version, &v.SchemaJSON, &v.CreatedAt, &v.ChangeComment, &v.ParentRevisionID); e != nil {
			break
		}
		s.Revisions = append(s.Revisions, v)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return s, e
	}
	rows, e = tx.QueryContext(ctx, `SELECT id,revision_id,assembly_id,capture_id,settings_version,status,summary_json,request_json,created_at,completed_at,capture_sha256,capture_engine_version,settings_json,input_manifest_json FROM analysis_runs WHERE project_id=? ORDER BY id`, project)
	if e != nil {
		return s, e
	}
	for rows.Next() {
		var v domain.RunRow
		var done sql.NullString
		if e = rows.Scan(&v.ID, &v.RevisionID, &v.AssemblyID, &v.CaptureID, &v.SettingsVersion, &v.Status, &v.SummaryJSON, &v.RequestJSON, &v.CreatedAt, &done, &v.CaptureSHA256, &v.CaptureEngineVersion, &v.SettingsJSON, &v.InputManifestJSON); e != nil {
			break
		}
		if done.Valid {
			v.CompletedAt = &done.String
		}
		s.Runs = append(s.Runs, v)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return s, e
	}
	rows, e = tx.QueryContext(ctx, `SELECT a.id,a.run_id,a.result_json,a.created_at FROM analysis_results a JOIN analysis_runs r ON r.id=a.run_id WHERE r.project_id=? ORDER BY a.id`, project)
	if e != nil {
		return s, e
	}
	for rows.Next() {
		var v domain.ResultRow
		if e = rows.Scan(&v.ID, &v.RunID, &v.ResultJSON, &v.CreatedAt); e != nil {
			break
		}
		s.Results = append(s.Results, v)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return s, e
	}
	return s, tx.Commit()
}

// ImportSnapshot rejects unresolved external references instead of producing
// misleading links to the source project. Callers may supply explicit maps.
func (r *InterpretationRepository) ImportSnapshot(ctx context.Context, dest string, s domain.Snapshot, captures, assemblies, streams, settings map[string]string, importID, digest string, sessions ...map[string]string) error {
	if dest == "" || s.Version != 1 || s.ProjectID == "" {
		return errors.New("invalid snapshot version or project")
	}
	if len(s.Interpretations) > 100000 || len(s.Revisions) > 100000 || len(s.Runs) > 100000 || len(s.Results) > 1000000 {
		return errors.New("snapshot exceeds row limits")
	}
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var count int
	if e = tx.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM interpretations WHERE project_id=?) + (SELECT COUNT(*) FROM analysis_runs WHERE project_id=?)`, dest, dest).Scan(&count); e != nil {
		return e
	}
	if count != 0 {
		return errors.New("destination Analysis project already contains data")
	}
	owned := map[string]map[string]string{
		"interpretationId": {}, "revisionId": {}, "runId": {}, "resultId": {},
		"projectId": {s.ProjectID: dest},
	}
	if len(sessions) != 0 {
		owned["sessionId"] = sessions[0]
	}
	if len(sessions) > 1 {
		owned["alternativeId"] = sessions[1]
	}
	allocate := func(kind, id string) error {
		if id == "" || owned[kind][id] != "" {
			return errors.New("empty or duplicate snapshot ID")
		}
		owned[kind][id] = uuid.NewString()
		return nil
	}
	for _, row := range s.Interpretations {
		if e = allocate("interpretationId", row.ID); e != nil {
			return e
		}
	}
	for _, row := range s.Revisions {
		if e = allocate("revisionId", row.ID); e != nil {
			return e
		}
	}
	for _, row := range s.Runs {
		if e = allocate("runId", row.ID); e != nil {
			return e
		}
	}
	for _, row := range s.Results {
		if e = allocate("resultId", row.ID); e != nil {
			return e
		}
	}
	for _, v := range s.Interpretations {
		if v.ID == "" {
			return errors.New("empty interpretation id")
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO interpretations(id,project_id,name,description,created_at) VALUES(?,?,?,?,?)`, owned["interpretationId"][v.ID], dest, v.Name, v.Description, v.CreatedAt); e != nil {
			return e
		}
	}
	for _, v := range s.Revisions {
		if !json.Valid([]byte(v.SchemaJSON)) {
			return errors.New("invalid revision JSON")
		}
		if owned["interpretationId"][v.InterpretationID] == "" {
			return errors.New("revision references missing interpretation")
		}
		parent := owned["revisionId"][v.ParentRevisionID]
		if v.ParentRevisionID != "" && parent == "" {
			return errors.New("revision references missing parent")
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO revisions(id,interpretation_id,version,schema_json,created_at,change_comment,parent_revision_id) VALUES(?,?,?,?,?,?,?)`, owned["revisionId"][v.ID], owned["interpretationId"][v.InterpretationID], v.Version, v.SchemaJSON, v.CreatedAt, v.ChangeComment, parent); e != nil {
			return e
		}
	}
	for _, v := range s.Runs {
		assembly := v.AssemblyID
		capture := v.CaptureID
		setting := v.SettingsVersion
		if assembly != "" {
			mapped, ok := assemblies[assembly]
			if !ok || mapped == "" {
				return fmt.Errorf("missing assembly ID mapping: %s", assembly)
			}
			assembly = mapped
		}
		if capture != "" {
			mapped, ok := captures[capture]
			if !ok || mapped == "" {
				return fmt.Errorf("missing capture ID mapping: %s", capture)
			}
			capture = mapped
		}
		if setting != "" {
			mapped, ok := settings[setting]
			if !ok || mapped == "" {
				return fmt.Errorf("missing settings version mapping: %s", setting)
			}
			setting = mapped
		}
		// Replace known stream identifiers in structured JSON, never by text replacement.
		request, e := remapJSON(v.RequestJSON, captures, assemblies, streams, settings, owned)
		if e != nil {
			return e
		}
		summary, e := remapJSON(v.SummaryJSON, captures, assemblies, streams, settings, owned)
		if e != nil {
			return e
		}
		manifest, e := remapJSON(v.InputManifestJSON, captures, assemblies, streams, settings, owned)
		if e != nil {
			return e
		}
		status := v.Status
		if status == "pending" || status == "running" {
			status = "failed"
		}
		if owned["revisionId"][v.RevisionID] == "" {
			return errors.New("run references missing revision")
		}
		jobID := "ana_" + uuid.NewString()
		if _, e = tx.ExecContext(ctx, `INSERT INTO analysis_runs(id,revision_id,assembly_id,status,created_at,completed_at,project_id,capture_id,settings_version,job_id,summary_json,request_json,capture_sha256,capture_engine_version,settings_json,input_manifest_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, owned["runId"][v.ID], owned["revisionId"][v.RevisionID], assembly, status, v.CreatedAt, v.CompletedAt, dest, capture, setting, jobID, summary, request, v.CaptureSHA256, v.CaptureEngineVersion, v.SettingsJSON, manifest); e != nil {
			return e
		}
		jobStatus, stage, code := "SUCCEEDED", "RESTORED", ""
		if status != "completed" {
			jobStatus, stage, code = "FAILED", "RESTORED", "ARCHIVED_FAILURE"
			var state struct {
				Reason string `json:"reason"`
				Error  string `json:"error"`
			}
			if err := json.Unmarshal([]byte(summary), &state); err != nil {
				return err
			}
			if state.Reason == "cancelled" || state.Error == "job cancelled" || state.Error == "context canceled" {
				jobStatus, code = "CANCELLED", ""
			}
			if v.Status == "pending" || v.Status == "running" || state.Reason == "PROCESS_INTERRUPTED" {
				stage, code = "INTERRUPTED", "ARCHIVED_INTERRUPTED"
			}
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO analysis_jobs(id,project_id,run_id,status,stage,completed,total,error_code,finished_at) VALUES(?,?,?,?,?,'1','1',NULLIF(?,''),CURRENT_TIMESTAMP)`, jobID, dest, owned["runId"][v.ID], jobStatus, stage, code); e != nil {
			return e
		}
	}
	for _, v := range s.Results {
		payload, e := remapJSON(v.ResultJSON, captures, assemblies, streams, settings, owned)
		if e != nil {
			return e
		}
		if owned["runId"][v.RunID] == "" {
			return errors.New("result references missing run")
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO analysis_results(id,run_id,result_json,created_at) VALUES(?,?,?,?)`, owned["resultId"][v.ID], owned["runId"][v.RunID], payload, v.CreatedAt); e != nil {
			return e
		}
	}
	if importID != "" {
		idMaps, err := json.Marshal(owned)
		if err != nil {
			return err
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO analysis_imports(project_id,import_id,archive_sha256,id_map_json) VALUES(?,?,?,?)`, dest, importID, digest, string(idMaps)); e != nil {
			return e
		}
	}
	return tx.Commit()
}

func (r *InterpretationRepository) ImportMappings(ctx context.Context, project, importID string) (map[string]map[string]string, error) {
	var raw string
	if err := r.db.QueryRowContext(ctx, `SELECT id_map_json FROM analysis_imports WHERE project_id=? AND import_id=?`, project, importID).Scan(&raw); err != nil {
		return nil, err
	}
	var maps map[string]map[string]string
	err := json.Unmarshal([]byte(raw), &maps)
	return maps, err
}
func remapJSON(raw string, captures, assemblies, streams, settings map[string]string, extras ...map[string]map[string]string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "{}", nil
	}
	var v any
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	if e := decoder.Decode(&v); e != nil {
		return "", e
	}
	maps := map[string]map[string]string{"captureId": captures, "assemblyId": assemblies, "streamId": streams, "settingsVersion": settings}
	for _, extra := range extras {
		for key, mapping := range extra {
			maps[key] = mapping
		}
	}
	var invalid error
	var walk func(any)
	walk = func(x any) {
		switch t := x.(type) {
		case map[string]any:
			for k, val := range t {
				if k == "sessionIds" {
					if ids, ok := val.([]any); ok {
						for i, raw := range ids {
							id, ok := raw.(string)
							mapped := maps["sessionId"][id]
							if !ok || mapped == "" {
								invalid = fmt.Errorf("missing sessionId mapping")
								return
							}
							ids[i] = mapped
						}
					}
				}
				if m, ok := maps[k]; ok {
					if old, yes := val.(string); yes && old != "" {
						newID, found := m[old]
						if !found || newID == "" {
							invalid = fmt.Errorf("missing %s mapping: %s", k, old)
							return
						}
						t[k] = newID
					}
				}
				if _, mapped := maps["sessionId"]; k == "sessionId" && !mapped {
					if old, yes := val.(string); yes && old != "" {
						invalid = fmt.Errorf("sessionId mapping not supported by Workspace: %s", old)
						return
					}
				}
				walk(t[k])
				if invalid != nil {
					return
				}
			}
		case []any:
			for _, child := range t {
				walk(child)
				if invalid != nil {
					return
				}
			}
		}
	}
	walk(v)
	if invalid != nil {
		return "", invalid
	}
	b, e := json.Marshal(v)
	return string(b), e
}

func (r *InterpretationRepository) SaveSnapshot(ctx context.Context, id, project string, data []byte) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO analysis_snapshots(id,project_id,archive) VALUES(?,?,?)`, id, project, data)
	return err
}
func (r *InterpretationRepository) LoadSnapshot(ctx context.Context, id string) ([]byte, error) {
	var b []byte
	err := r.db.QueryRowContext(ctx, `SELECT archive FROM analysis_snapshots WHERE id=?`, id).Scan(&b)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return b, err
}
func (r *InterpretationRepository) ImportSeen(ctx context.Context, project, importID, digest string) (bool, error) {
	var previous string
	e := r.db.QueryRowContext(ctx, `SELECT archive_sha256 FROM analysis_imports WHERE project_id=? AND import_id=?`, project, importID).Scan(&previous)
	if errors.Is(e, sql.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if previous != digest {
		return false, errors.New("importId reused with different archive")
	}
	return true, nil
}
