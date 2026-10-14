package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"time"
)

func (r *InterpretationRepository) SchemaByRevision(ctx context.Context, project, revision string) (string, error) {
	var schema string
	err := r.db.QueryRowContext(ctx, `SELECT r.schema_json FROM revisions r JOIN interpretations i ON i.id=r.interpretation_id WHERE r.id=? AND i.project_id=?`, revision, project).Scan(&schema)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return schema, err
}

type Run struct {
	RunID                string         `json:"runId"`
	ProjectID            string         `json:"projectId"`
	RevisionID           string         `json:"revisionId"`
	AssemblyID           string         `json:"assemblyId"`
	CaptureID            string         `json:"captureId,omitempty"`
	SettingsVersion      string         `json:"settingsVersion,omitempty"`
	CaptureSHA256        string         `json:"captureSha256,omitempty"`
	CaptureEngineVersion string         `json:"captureEngineVersion,omitempty"`
	SettingsJSON         string         `json:"settingsJson,omitempty"`
	InputManifestJSON    string         `json:"inputManifestJson,omitempty"`
	JobID                string         `json:"jobId,omitempty"`
	Status               string         `json:"status"`
	Summary              map[string]any `json:"summary"`
	CreatedAt            string         `json:"createdAt"`
}
type RunInput struct {
	RevisionID           string         `json:"revisionId"`
	AssemblyID           string         `json:"assemblyId"`
	CaptureID            string         `json:"captureId"`
	SettingsVersion      string         `json:"settingsVersion"`
	Filters              map[string]any `json:"filters"`
	CaptureSHA256        string         `json:"-"`
	CaptureEngineVersion string         `json:"-"`
	SettingsJSON         string         `json:"-"`
	InputManifestJSON    string         `json:"-"`
}

func (r *InterpretationRepository) CreateRun(ctx context.Context, project string, in RunInput, key string) (Run, bool, error) {
	if key != "" {
		v, e := r.FindRunByKey(ctx, project, key)
		if e == nil {
			return v, true, nil
		}
		if !errors.Is(e, ErrNotFound) {
			return Run{}, false, e
		}
	}
	run := Run{RunID: uuid.NewString(), ProjectID: project, RevisionID: in.RevisionID, AssemblyID: in.AssemblyID, CaptureID: in.CaptureID, SettingsVersion: in.SettingsVersion, CaptureSHA256: in.CaptureSHA256, CaptureEngineVersion: in.CaptureEngineVersion, SettingsJSON: in.SettingsJSON, InputManifestJSON: in.InputManifestJSON, JobID: "ana_" + uuid.NewString(), Status: "pending", Summary: map[string]any{}, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	var k any
	if key != "" {
		k = key
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Run{}, false, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO analysis_runs (id,revision_id,assembly_id,status,project_id,capture_id,settings_version,job_id,idempotency_key,capture_sha256,capture_engine_version,settings_json,input_manifest_json,request_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, run.RunID, run.RevisionID, run.AssemblyID, run.Status, project, run.CaptureID, run.SettingsVersion, run.JobID, k, run.CaptureSHA256, run.CaptureEngineVersion, run.SettingsJSON, run.InputManifestJSON, run.InputManifestJSON)
	if err != nil {
		if key != "" {
			v, e := r.FindRunByKey(ctx, project, key)
			if e == nil {
				return v, true, nil
			}
		}
		return Run{}, false, fmt.Errorf("create run: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO analysis_jobs(id,project_id,run_id) VALUES(?,?,?)`, run.JobID, project, run.RunID)
	if err != nil {
		return Run{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return Run{}, false, err
	}
	return run, false, nil
}
func (r *InterpretationRepository) FindRunByKey(ctx context.Context, project, key string) (Run, error) {
	var id string
	err := r.db.QueryRowContext(ctx, `SELECT id FROM analysis_runs WHERE project_id=? AND idempotency_key=?`, project, key).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return Run{}, ErrNotFound
	}
	if err != nil {
		return Run{}, err
	}
	return r.GetRun(ctx, project, id)
}
func (r *InterpretationRepository) GetRun(ctx context.Context, project, id string) (Run, error) {
	var run Run
	var summary string
	var created string
	err := r.db.QueryRowContext(ctx, `SELECT id,project_id,revision_id,assembly_id,capture_id,settings_version,job_id,status,summary_json,created_at,capture_sha256,capture_engine_version,settings_json,input_manifest_json FROM analysis_runs WHERE id=? AND project_id=?`, id, project).Scan(&run.RunID, &run.ProjectID, &run.RevisionID, &run.AssemblyID, &run.CaptureID, &run.SettingsVersion, &run.JobID, &run.Status, &summary, &created, &run.CaptureSHA256, &run.CaptureEngineVersion, &run.SettingsJSON, &run.InputManifestJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return Run{}, ErrNotFound
	}
	if err != nil {
		return Run{}, err
	}
	run.Summary = map[string]any{}
	_ = json.Unmarshal([]byte(summary), &run.Summary)
	t, e := parseSQLiteTime(created)
	if e != nil {
		return Run{}, e
	}
	run.CreatedAt = t.UTC().Format(time.RFC3339)
	return run, nil
}
func (r *InterpretationRepository) ListRuns(ctx context.Context, project, status string, limit, offset int) ([]Run, bool, error) {
	query := `SELECT id FROM analysis_runs WHERE project_id=?`
	args := []any{project}
	if status != "" {
		query += ` AND status=?`
		args = append(args, status)
	}
	query += ` ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`
	args = append(args, limit+1, offset)
	rows, e := r.db.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, false, e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			break
		}
		ids = append(ids, id)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return nil, false, e
	}
	more := len(ids) > limit
	if more {
		ids = ids[:limit]
	}
	out := []Run{}
	for _, id := range ids {
		v, e := r.GetRun(ctx, project, id)
		if e != nil {
			return nil, false, e
		}
		out = append(out, v)
	}
	return out, more, nil
}
func (r *InterpretationRepository) SetRunStatus(ctx context.Context, id, status string, summary string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE analysis_runs SET status=?,summary_json=?,completed_at=CASE WHEN ? IN ('completed','failed') THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?`, status, summary, status, id)
	return err
}
func (r *InterpretationRepository) SaveResult(ctx context.Context, id, result string) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO analysis_results(id,run_id,result_json) VALUES(?,?,?)`, uuid.NewString(), id, result)
	return err
}
func (r *InterpretationRepository) Results(ctx context.Context, project, id string) ([]string, error) {
	if _, err := r.GetRun(ctx, project, id); err != nil {
		return nil, err
	}
	rows, e := r.db.QueryContext(ctx, `SELECT result_json FROM analysis_results WHERE run_id=? ORDER BY created_at,id`, id)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var v string
		if e = rows.Scan(&v); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (r *InterpretationRepository) RecoverRuns(ctx context.Context) error { return r.RecoverJobs(ctx) }
