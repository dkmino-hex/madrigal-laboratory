package jobs

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gofrs/flock"

	"github.com/dkmino-hex/madrigal-laboratory/platform/database"
	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
)

var ErrCancelled = errors.New("job cancellation requested")
var ErrState = errors.New("job is not running")

type JobError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Job struct {
	ID              string          `json:"jobId"`
	ProjectID       string          `json:"projectId"`
	Kind            string          `json:"kind"`
	ResourceID      *string         `json:"resourceId,omitempty"`
	Status          string          `json:"status"`
	Stage           string          `json:"stage"`
	Payload         json.RawMessage `json:"-"`
	Error           *JobError       `json:"error,omitempty"`
	Completed       int64           `json:"completed,string"`
	Total           *int64          `json:"total,string,omitempty"`
	CancelRequested bool            `json:"cancelRequested"`
	Attempts        int64           `json:"attempts,string"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
	StartedAt       *time.Time      `json:"startedAt,omitempty"`
	FinishedAt      *time.Time      `json:"finishedAt,omitempty"`
}

type FinishHook func(context.Context, *sql.Tx, Job, string, *JobError) error
type Store struct {
	DB       *sql.DB
	Prefix   string
	OnFinish FinishHook
}

const columns = "id,project_id,kind,resource_id,status,stage,payload_json,error_json,progress_completed,progress_total,cancel_requested,attempts,created_at,updated_at,started_at,finished_at"

type scanner interface{ Scan(...any) error }

func scan(row scanner) (Job, error) {
	var j Job
	var rawError, rawPayload []byte
	var created, updated, started, finished database.Timestamp
	err := row.Scan(&j.ID, &j.ProjectID, &j.Kind, &j.ResourceID, &j.Status, &j.Stage, &rawPayload, &rawError, &j.Completed, &j.Total, &j.CancelRequested, &j.Attempts, &created, &updated, &started, &finished)
	j.Payload = rawPayload
	if err == nil && len(rawError) > 0 {
		err = json.Unmarshal(rawError, &j.Error)
	}
	j.CreatedAt, j.UpdatedAt, j.StartedAt, j.FinishedAt = created.Time, updated.Time, started.Pointer(), finished.Pointer()
	return j, err
}

func (s Store) EnqueueTx(ctx context.Context, tx *sql.Tx, projectID, kind string, resourceID *string, payload any) (Job, error) {
	if s.Prefix != "cap" && s.Prefix != "ws" {
		return Job{}, errors.New("unsupported job owner")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return Job{}, err
	}
	return scan(tx.QueryRowContext(ctx, "INSERT INTO jobs(id,project_id,kind,resource_id,payload_json) VALUES(?1,?2,?3,?4,?5) RETURNING "+columns, identifier.New(s.Prefix), projectID, kind, resourceID, string(data)))
}

func (s Store) Get(ctx context.Context, id string) (Job, error) {
	return scan(s.DB.QueryRowContext(ctx, "SELECT "+columns+" FROM jobs WHERE id=?1", id))
}

func (s Store) Claim(ctx context.Context, kinds []string) (Job, error) {
	if len(kinds) == 0 {
		return Job{}, sql.ErrNoRows
	}
	kindsJSON, err := json.Marshal(kinds)
	if err != nil {
		return Job{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Job{}, err
	}
	defer tx.Rollback()
	var id string
	err = tx.QueryRowContext(ctx, "SELECT id FROM jobs WHERE status='QUEUED' AND cancel_requested=FALSE AND kind IN (SELECT value FROM json_each(?1)) ORDER BY created_at,id LIMIT 1", string(kindsJSON)).Scan(&id)
	if err != nil {
		return Job{}, err
	}
	j, err := scan(tx.QueryRowContext(ctx, "UPDATE jobs SET status='RUNNING',stage='STARTING',attempts=attempts+1,started_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1 RETURNING "+columns, id))
	if err != nil {
		return Job{}, err
	}
	return j, tx.Commit()
}

func (s Store) Progress(ctx context.Context, id, stage string, completed int64, total *int64) error {
	if stage == "" || completed < 0 || total != nil && *total < completed {
		return errors.New("invalid progress")
	}
	result, err := s.DB.ExecContext(ctx, "UPDATE jobs SET stage=?2,progress_completed=?3,progress_total=?4,updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1 AND status='RUNNING' AND cancel_requested=FALSE AND (stage<>?2 OR progress_completed<=?3)", id, stage, completed, total)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil || n == 1 {
		return err
	}
	j, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if j.CancelRequested {
		return ErrCancelled
	}
	return ErrState
}

func terminal(status string) bool {
	return status == "SUCCEEDED" || status == "FAILED" || status == "CANCELLED"
}

func (s Store) finishTx(ctx context.Context, tx *sql.Tx, j Job, status string, jobError *JobError) error {
	if s.OnFinish != nil {
		if err := s.OnFinish(ctx, tx, j, status, jobError); err != nil {
			return err
		}
	}
	var raw any
	if jobError != nil {
		data, err := json.Marshal(jobError)
		if err != nil {
			return err
		}
		raw = string(data)
	}
	_, err := tx.ExecContext(ctx, "UPDATE jobs SET status=?2,stage=?2,error_json=?3,finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1", j.ID, status, raw)
	return err
}

func (s Store) Finish(ctx context.Context, id, status string, jobError *JobError) error {
	if !terminal(status) || status == "FAILED" && jobError == nil {
		return errors.New("invalid terminal state")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	j, err := scan(tx.QueryRowContext(ctx, "SELECT "+columns+" FROM jobs WHERE id=?1", id))
	if err != nil {
		return err
	}
	if terminal(j.Status) {
		return tx.Commit()
	}
	if j.Status != "RUNNING" {
		return ErrState
	}
	if j.CancelRequested {
		status = "CANCELLED"
		jobError = nil
	}
	if err = s.finishTx(ctx, tx, j, status, jobError); err != nil {
		return err
	}
	return tx.Commit()
}

func (s Store) Cancel(ctx context.Context, id string) (Job, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Job{}, err
	}
	defer tx.Rollback()
	j, err := scan(tx.QueryRowContext(ctx, "SELECT "+columns+" FROM jobs WHERE id=?1", id))
	if err != nil {
		return Job{}, err
	}
	if !terminal(j.Status) {
		if _, err = tx.ExecContext(ctx, "UPDATE jobs SET cancel_requested=TRUE,updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1", id); err != nil {
			return Job{}, err
		}
		if j.Status == "QUEUED" {
			if err = s.finishTx(ctx, tx, j, "CANCELLED", nil); err != nil {
				return Job{}, err
			}
		}
	}
	j, err = scan(tx.QueryRowContext(ctx, "SELECT "+columns+" FROM jobs WHERE id=?1", id))
	if err != nil {
		return Job{}, err
	}
	return j, tx.Commit()
}

func (s Store) Recover(ctx context.Context) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, "SELECT "+columns+" FROM jobs WHERE status='RUNNING' ORDER BY id")
	if err != nil {
		return err
	}
	var interrupted []Job
	for rows.Next() {
		j, err := scan(rows)
		if err != nil {
			rows.Close()
			return err
		}
		interrupted = append(interrupted, j)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, j := range interrupted {
		status := "FAILED"
		failure := &JobError{Code: "PROCESS_INTERRUPTED", Message: "worker stopped before completion; inspect diagnostics before retrying"}
		if j.CancelRequested {
			status = "CANCELLED"
			failure = nil
		}
		if err = s.finishTx(ctx, tx, j, status, failure); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type Handler func(context.Context, Job, func(string, int64, *int64) error) error
type Worker struct {
	Store    Store
	Handlers map[string]Handler
}

func (w Worker) Run(ctx context.Context) error {
	path, err := database.Path(ctx, w.Store.DB)
	if err != nil {
		return err
	}
	lock := flock.New(path+".worker.lock", flock.SetPermissions(0600))
	locked, err := lock.TryLock()
	if err != nil {
		return err
	}
	if !locked {
		return errors.New("another worker is active")
	}
	defer lock.Close()
	if err = w.Store.Recover(ctx); err != nil {
		return err
	}
	kinds := make([]string, 0, len(w.Handlers))
	for kind := range w.Handlers {
		kinds = append(kinds, kind)
	}
	for {
		if err = ctx.Err(); err != nil {
			return err
		}
		j, err := w.Store.Claim(ctx, kinds)
		if errors.Is(err, sql.ErrNoRows) {
			timer := time.NewTimer(250 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
				continue
			}
		}
		if err != nil {
			return err
		}
		work, stop := context.WithCancel(ctx)
		done := make(chan struct{})
		go func() {
			defer close(done)
			ticker := time.NewTicker(100 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-work.Done():
					return
				case <-ticker.C:
					state, err := w.Store.Get(work, j.ID)
					if err != nil || state.CancelRequested {
						stop()
						return
					}
				}
			}
		}()
		err = invoke(w.Handlers[j.Kind], work, j, func(stage string, n int64, total *int64) error { return w.Store.Progress(work, j.ID, stage, n, total) })
		stop()
		<-done
		if ctx.Err() != nil {
			return ctx.Err()
		}
		status := "SUCCEEDED"
		var failure *JobError
		if err != nil {
			status = "FAILED"
			message := err.Error()
			if len(message) > 300 {
				message = message[:300]
			}
			failure = &JobError{Code: "EXECUTION_FAILED", Message: message}
		}
		if err = w.Store.Finish(ctx, j.ID, status, failure); err != nil {
			return err
		}
	}
}

func invoke(handler Handler, ctx context.Context, j Job, progress func(string, int64, *int64) error) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("handler panic: %v", recovered)
		}
	}()
	return handler(ctx, j, progress)
}
