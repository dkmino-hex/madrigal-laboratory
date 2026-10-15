package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/google/uuid"
)

func (r *InterpretationRepository) SchemaByRevision(ctx context.Context, project, revision string) (string, error) {
	var schema string
	err := r.db.QueryRowContext(ctx, `SELECT r.schema_json FROM revisions r JOIN interpretations i ON i.id=r.interpretation_id WHERE r.id=? AND i.project_id=?`, revision, project).Scan(&schema)
	if errors.Is(err, sql.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	return schema, err
}

func (r *InterpretationRepository) CreateRun(ctx context.Context, project string, in domain.RunInput, key string) (domain.Run, bool, error) {
	if key != "" {
		v, e := r.FindRunByKey(ctx, project, key)
		if e == nil {
			return v, true, nil
		}
		if !errors.Is(e, domain.ErrNotFound) {
			return domain.Run{}, false, e
		}
	}
	run := domain.Run{RunID: uuid.NewString(), ProjectID: project, RevisionID: in.RevisionID, AssemblyID: in.AssemblyID, CaptureID: in.CaptureID, SettingsVersion: in.SettingsVersion, CaptureSHA256: in.CaptureSHA256, CaptureEngineVersion: in.CaptureEngineVersion, SettingsJSON: in.SettingsJSON, InputManifestJSON: in.InputManifestJSON, JobID: "ana_" + uuid.NewString(), Status: "pending", Summary: map[string]any{}, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	var k any
	if key != "" {
		k = key
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Run{}, false, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO analysis_runs (id,revision_id,assembly_id,status,project_id,capture_id,settings_version,job_id,idempotency_key,capture_sha256,capture_engine_version,settings_json,input_manifest_json,request_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, run.RunID, run.RevisionID, run.AssemblyID, run.Status, project, run.CaptureID, run.SettingsVersion, run.JobID, k, run.CaptureSHA256, run.CaptureEngineVersion, run.SettingsJSON, run.InputManifestJSON, run.InputManifestJSON)
	if err != nil {
		if key != "" {
			_ = tx.Rollback()
			v, e := r.FindRunByKey(ctx, project, key)
			if e == nil {
				return v, true, nil
			}
		}
		return domain.Run{}, false, fmt.Errorf("create run: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO analysis_jobs(id,project_id,run_id) VALUES(?,?,?)`, run.JobID, project, run.RunID)
	if err != nil {
		return domain.Run{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return domain.Run{}, false, err
	}
	return run, false, nil
}
func (r *InterpretationRepository) FindRunByKey(ctx context.Context, project, key string) (domain.Run, error) {
	var id string
	err := r.db.QueryRowContext(ctx, `SELECT id FROM analysis_runs WHERE project_id=? AND idempotency_key=?`, project, key).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Run{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Run{}, err
	}
	return r.GetRun(ctx, project, id)
}
func (r *InterpretationRepository) GetRun(ctx context.Context, project, id string) (domain.Run, error) {
	var run domain.Run
	var summary string
	var created string
	err := r.db.QueryRowContext(ctx, `SELECT id,project_id,revision_id,assembly_id,capture_id,settings_version,job_id,status,summary_json,created_at,capture_sha256,capture_engine_version,settings_json,input_manifest_json,EXISTS(SELECT 1 FROM revisions pinned JOIN revisions newer ON newer.interpretation_id=pinned.interpretation_id WHERE pinned.id=analysis_runs.revision_id AND newer.version>pinned.version) FROM analysis_runs WHERE id=? AND project_id=?`, id, project).Scan(&run.RunID, &run.ProjectID, &run.RevisionID, &run.AssemblyID, &run.CaptureID, &run.SettingsVersion, &run.JobID, &run.Status, &summary, &created, &run.CaptureSHA256, &run.CaptureEngineVersion, &run.SettingsJSON, &run.InputManifestJSON, &run.Historical)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Run{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Run{}, err
	}
	run.Summary = map[string]any{}
	_ = json.Unmarshal([]byte(summary), &run.Summary)
	t, e := parseSQLiteTime(created)
	if e != nil {
		return domain.Run{}, e
	}
	run.CreatedAt = t.UTC().Format(time.RFC3339)
	if run.JobID != "" {
		job, err := r.GetJob(ctx, run.JobID)
		if err != nil {
			return domain.Run{}, err
		}
		run.Job = &job
	}
	return run, nil
}
func (r *InterpretationRepository) ListRuns(ctx context.Context, project, status string, limit, offset int) ([]domain.Run, bool, error) {
	query := `SELECT id FROM analysis_runs WHERE project_id=?`
	args := []any{project}
	if status == "cancelled" {
		query += ` AND EXISTS(SELECT 1 FROM analysis_jobs j WHERE j.run_id=analysis_runs.id AND j.status='CANCELLED')`
	} else if status == "interrupted" {
		query += ` AND EXISTS(SELECT 1 FROM analysis_jobs j WHERE j.run_id=analysis_runs.id AND j.stage='INTERRUPTED' AND j.status='FAILED')`
	} else if status == "failed" {
		query += ` AND status='failed' AND NOT EXISTS(SELECT 1 FROM analysis_jobs j WHERE j.run_id=analysis_runs.id AND (j.status='CANCELLED' OR j.stage='INTERRUPTED'))`
	} else if status != "" {
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
	out := []domain.Run{}
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
	out := []string{}
	err := r.VisitResults(ctx, project, id, func(payload string) error { out = append(out, payload); return nil })
	return out, err
}

func (r *InterpretationRepository) VisitResults(ctx context.Context, project, id string, visit func(string) error) error {
	if _, err := r.GetRun(ctx, project, id); err != nil {
		return err
	}
	rows, e := r.db.QueryContext(ctx, `SELECT result_json FROM analysis_results WHERE run_id=? ORDER BY created_at,id`, id)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var v string
		if e = rows.Scan(&v); e != nil {
			return e
		}
		if e = visit(v); e != nil {
			return e
		}
	}
	return rows.Err()
}
func (r *InterpretationRepository) RecoverRuns(ctx context.Context) error { return r.RecoverJobs(ctx) }
