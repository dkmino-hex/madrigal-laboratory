package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/platform/database"
	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

type Store struct{ DB *sql.DB }
type Capture = domain.Capture

const ImportKind = "CAPTURE_IMPORT"
const AssembleKind = "CAPTURE_ASSEMBLE"
const columns = "id,project_id,sha256,original_name,relative_path,size_bytes,format,status,created_at"

type scanner interface{ Scan(...any) error }

func (s Store) PingContext(ctx context.Context) error { return s.DB.PingContext(ctx) }

func scan(row scanner) (Capture, error) {
	var c Capture
	var created database.Timestamp
	err := row.Scan(&c.ID, &c.ProjectID, &c.SHA256, &c.OriginalName, &c.RelativePath, &c.Size, &c.Format, &c.Status, &created)
	c.CreatedAt = created.Time
	return c, err
}

func (s Store) Jobs() jobs.Store { return jobs.Store{DB: s.DB, Prefix: "cap", OnFinish: s.finish} }

func (s Store) ForEachCapture(ctx context.Context, visit func(Capture) error) error {
	rows, err := s.DB.QueryContext(ctx, "SELECT "+columns+" FROM captures ORDER BY id")
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		c, err := scan(rows)
		if err != nil {
			return err
		}
		if err = visit(c); err != nil {
			return fmt.Errorf("capture %s original: %w", c.ID, err)
		}
	}
	return rows.Err()
}

func (s Store) PublishOriginal(ctx context.Context, projectID, name string, obj domain.Original, settingsVersion string, settings json.RawMessage) (Capture, jobs.Job, bool, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Capture{}, jobs.Job{}, false, err
	}
	defer tx.Rollback()
	c, err := scan(tx.QueryRowContext(ctx, "SELECT "+columns+" FROM captures WHERE project_id=?1 AND sha256=?2", projectID, obj.SHA256))
	if err == nil {
		var jobID string
		if err = tx.QueryRowContext(ctx, "SELECT id FROM jobs WHERE project_id=?1 AND resource_id=?2 AND kind=?3 ORDER BY created_at,id LIMIT 1", projectID, c.ID, ImportKind).Scan(&jobID); err != nil {
			return Capture{}, jobs.Job{}, false, err
		}
		if err = tx.Commit(); err != nil {
			return Capture{}, jobs.Job{}, false, err
		}
		j, err := s.Jobs().Get(ctx, jobID)
		return c, j, true, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Capture{}, jobs.Job{}, false, err
	}
	c, err = scan(tx.QueryRowContext(ctx, "INSERT INTO captures(id,project_id,sha256,original_name,relative_path,size_bytes,format) VALUES(?1,?2,?3,?4,?5,?6,?7) RETURNING "+columns, identifier.New("capture"), projectID, obj.SHA256, filepath.Base(strings.ReplaceAll(name, "\\", "/")), obj.RelativePath, obj.Size, obj.Format))
	if err != nil {
		return Capture{}, jobs.Job{}, false, err
	}
	j, err := s.Jobs().EnqueueTx(ctx, tx, projectID, ImportKind, &c.ID, map[string]any{"captureId": c.ID, "sha256": obj.SHA256, "settingsVersion": settingsVersion, "settings": settings})
	if err != nil {
		return Capture{}, jobs.Job{}, false, err
	}
	return c, j, false, tx.Commit()
}

func (s Store) Get(ctx context.Context, projectID, id string) (Capture, error) {
	return scan(s.DB.QueryRowContext(ctx, "SELECT "+columns+" FROM captures WHERE project_id=?1 AND id=?2", projectID, id))
}

func (s Store) EnqueueAssemblyTx(ctx context.Context, tx *sql.Tx, projectID, captureID, settingsVersion string, settings json.RawMessage, engine string) (string, jobs.Job, error) {
	var status string
	if err := tx.QueryRowContext(ctx, "SELECT status FROM captures WHERE project_id=?1 AND id=?2", projectID, captureID).Scan(&status); err != nil {
		return "", jobs.Job{}, err
	}
	if status != "READY" {
		return "", jobs.Job{}, errors.New("capture is not ready")
	}
	id := identifier.New("assembly")
	j, err := s.Jobs().EnqueueTx(ctx, tx, projectID, AssembleKind, &id, map[string]string{"assemblyId": id})
	if err != nil {
		return "", jobs.Job{}, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO assemblies(id,project_id,capture_id,settings_version,settings_json,engine_version,job_id) VALUES(?1,?2,?3,?4,?5,?6,?7)", id, projectID, captureID, settingsVersion, string(settings), engine, j.ID)
	return id, j, err
}

func (s Store) finish(ctx context.Context, tx *sql.Tx, j jobs.Job, status string, failure *jobs.JobError) error {
	if j.ResourceID == nil {
		return nil
	}
	var current string
	var query string
	switch j.Kind {
	case ImportKind:
		query = "SELECT status FROM captures WHERE project_id=?1 AND id=?2"
	case AssembleKind:
		query = "SELECT status FROM assemblies WHERE project_id=?1 AND id=?2"
	default:
		return errors.New("unknown capture job kind")
	}
	if err := tx.QueryRowContext(ctx, query, j.ProjectID, *j.ResourceID).Scan(&current); err != nil {
		return err
	}
	if status == "SUCCEEDED" {
		if current != "READY" {
			return errors.New("job cannot succeed before its resource is ready")
		}
		return nil
	}
	if current == "READY" {
		return errors.New("ready resource cannot be failed or cancelled")
	}
	data, _ := json.Marshal(failure)
	if j.Kind == ImportKind {
		target := "ERROR"
		if status == "CANCELLED" {
			target = "CANCELLED"
		}
		_, err := tx.ExecContext(ctx, "UPDATE captures SET status=?3,diagnostics_json=json_array(json(?4)) WHERE project_id=?1 AND id=?2", j.ProjectID, *j.ResourceID, target, string(data))
		return err
	}
	_, err := tx.ExecContext(ctx, "UPDATE assemblies SET status=?3,finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')),diagnostics_json=json_array(json(?4)) WHERE project_id=?1 AND id=?2 AND status='BUILDING'", j.ProjectID, *j.ResourceID, status, string(data))
	return err
}

func (s Store) EnqueueAssembly(ctx context.Context, projectID, captureID, settingsVersion string, settings json.RawMessage, engine string) (string, jobs.Job, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", jobs.Job{}, err
	}
	defer tx.Rollback()
	id, job, err := s.EnqueueAssemblyTx(ctx, tx, projectID, captureID, settingsVersion, settings, engine)
	if err != nil {
		return "", jobs.Job{}, domain.AssemblyRequestError{Cause: err}
	}
	return id, job, tx.Commit()
}
