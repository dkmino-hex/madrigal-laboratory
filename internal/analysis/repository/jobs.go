package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type Job struct {
	JobID           string    `json:"jobId"`
	ProjectID       string    `json:"projectId"`
	Kind            string    `json:"kind"`
	ResourceID      string    `json:"resourceId"`
	Status          string    `json:"status"`
	Stage           string    `json:"stage"`
	Completed       string    `json:"completed"`
	Total           *string   `json:"total,omitempty"`
	CancelRequested bool      `json:"cancelRequested"`
	Attempts        string    `json:"attempts"`
	CreatedAt       string    `json:"createdAt"`
	UpdatedAt       string    `json:"updatedAt"`
	StartedAt       *string   `json:"startedAt,omitempty"`
	FinishedAt      *string   `json:"finishedAt,omitempty"`
	Error           *JobError `json:"error,omitempty"`
}
type JobError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (r *InterpretationRepository) GetJob(ctx context.Context, id string) (Job, error) {
	var j Job
	var cancel, attempts int
	var created, updated string
	var started, finished, total, errCode, errMessage sql.NullString
	e := r.db.QueryRowContext(ctx, `SELECT id,project_id,run_id,kind,status,stage,completed,total,cancel_requested,attempts,created_at,updated_at,started_at,finished_at,error_code,error_message FROM analysis_jobs WHERE id=?`, id).Scan(&j.JobID, &j.ProjectID, &j.ResourceID, &j.Kind, &j.Status, &j.Stage, &j.Completed, &total, &cancel, &attempts, &created, &updated, &started, &finished, &errCode, &errMessage)
	if errors.Is(e, sql.ErrNoRows) {
		return j, ErrNotFound
	}
	if e != nil {
		return j, e
	}
	j.CancelRequested = cancel != 0
	j.Attempts = fmt.Sprint(attempts)
	if total.Valid {
		j.Total = &total.String
	}
	if started.Valid {
		j.StartedAt = &started.String
	}
	if finished.Valid {
		j.FinishedAt = &finished.String
	}
	if errCode.Valid {
		j.Error = &JobError{Code: errCode.String, Message: errMessage.String}
	}
	if t, e := parseSQLiteTime(created); e == nil {
		j.CreatedAt = t.UTC().Format(time.RFC3339)
	} else {
		return j, e
	}
	if t, e := parseSQLiteTime(updated); e == nil {
		j.UpdatedAt = t.UTC().Format(time.RFC3339)
	} else {
		return j, e
	}
	return j, nil
}
func (r *InterpretationRepository) CancelJob(ctx context.Context, id string) (Job, error) {
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return Job{}, e
	}
	defer tx.Rollback()
	var status, runID string
	e = tx.QueryRowContext(ctx, `SELECT status,run_id FROM analysis_jobs WHERE id=?`, id).Scan(&status, &runID)
	if errors.Is(e, sql.ErrNoRows) {
		return Job{}, ErrNotFound
	}
	if e != nil {
		return Job{}, e
	}
	if status == "QUEUED" {
		_, e = tx.ExecContext(ctx, `UPDATE analysis_jobs SET status='CANCELLED',stage='CANCELLED',cancel_requested=1,finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`, id)
		if e == nil {
			_, e = tx.ExecContext(ctx, `UPDATE analysis_runs SET status='failed',summary_json='{"reason":"cancelled"}',completed_at=CURRENT_TIMESTAMP WHERE id=?`, runID)
		}
	} else if status == "RUNNING" {
		_, e = tx.ExecContext(ctx, `UPDATE analysis_jobs SET cancel_requested=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`, id)
	}
	if e != nil {
		return Job{}, e
	}
	if e = tx.Commit(); e != nil {
		return Job{}, e
	}
	return r.GetJob(ctx, id)
}
func (r *InterpretationRepository) StartJob(ctx context.Context, id string) (bool, error) {
	res, e := r.db.ExecContext(ctx, `UPDATE analysis_jobs SET status='RUNNING',stage='ANALYZING',attempts=attempts+1,started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='QUEUED' AND cancel_requested=0`, id)
	if e != nil {
		return false, e
	}
	n, e := res.RowsAffected()
	return n == 1, e
}
func (r *InterpretationRepository) ProgressJob(ctx context.Context, id string, done, total int) error {
	_, e := r.db.ExecContext(ctx, `UPDATE analysis_jobs SET completed=?,total=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, fmt.Sprint(done), fmt.Sprint(total), id)
	return e
}
func (r *InterpretationRepository) FinishJob(ctx context.Context, id, status, code, message string) error {
	_, e := r.db.ExecContext(ctx, `UPDATE analysis_jobs SET status=?,stage=?,error_code=NULLIF(?,''),error_message=NULLIF(?,''),finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`, status, status, code, message, id)
	return e
}
func (r *InterpretationRepository) JobCancelRequested(ctx context.Context, id string) (bool, error) {
	var requested int
	var status string
	e := r.db.QueryRowContext(ctx, `SELECT cancel_requested,status FROM analysis_jobs WHERE id=?`, id).Scan(&requested, &status)
	return requested != 0 || status == "CANCELLED", e
}
func (r *InterpretationRepository) RecoverJobs(ctx context.Context) error {
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	_, e = tx.ExecContext(ctx, `UPDATE analysis_jobs SET status=CASE WHEN cancel_requested=1 THEN 'CANCELLED' ELSE 'FAILED' END,stage='INTERRUPTED',error_code=CASE WHEN cancel_requested=1 THEN NULL ELSE 'PROCESS_INTERRUPTED' END,error_message=CASE WHEN cancel_requested=1 THEN NULL ELSE 'worker interrupted by restart' END,finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE status='RUNNING'`)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, `UPDATE analysis_runs SET status='failed',summary_json='{"reason":"PROCESS_INTERRUPTED"}',completed_at=CURRENT_TIMESTAMP WHERE id IN (SELECT run_id FROM analysis_jobs WHERE stage='INTERRUPTED')`)
	if e != nil {
		return e
	}
	return tx.Commit()
}
func (r *InterpretationRepository) QueuedRuns(ctx context.Context) ([]Run, error) {
	rows, e := r.db.QueryContext(ctx, `SELECT run_id FROM analysis_jobs WHERE status='QUEUED' ORDER BY created_at`)
	if e != nil {
		return nil, e
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
		return nil, e
	}
	out := []Run{}
	for _, id := range ids {
		var project string
		e = r.db.QueryRowContext(ctx, `SELECT project_id FROM analysis_runs WHERE id=?`, id).Scan(&project)
		if e != nil {
			return nil, e
		}
		run, e := r.GetRun(ctx, project, id)
		if e != nil {
			return nil, e
		}
		out = append(out, run)
	}
	return out, nil
}
