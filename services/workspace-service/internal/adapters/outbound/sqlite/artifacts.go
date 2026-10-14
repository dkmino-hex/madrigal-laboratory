package storage

import (
	"context"
	"database/sql"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func (s Store) RequestReport(ctx context.Context, projectID, runID string) (map[string]any, error) {
	if !domain.ValidRunID(runID) {
		return nil, ErrInvalid
	}
	snapshot, err := s.CreateSnapshot(ctx, projectID)
	if err != nil {
		return nil, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	artifactID := identifier.New("artifact")
	job, err := s.Jobs().EnqueueTx(ctx, tx, projectID, ReportKind, &artifactID, map[string]string{"runId": runID, "snapshotId": snapshot.ID})
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO artifacts(id,project_id,job_id,snapshot_id,kind,run_id,filename,content_type) VALUES(?1,?2,?3,?4,'REPORT_MARKDOWN',?5,?6,'text/markdown; charset=utf-8')`, artifactID, projectID, job.ID, snapshot.ID, runID, "report-"+runID+".md")
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"artifactId": artifactID, "jobId": job.ID, "snapshotId": snapshot.ID, "status": "BUILDING"}, nil
}

func (s Store) finishReport(ctx context.Context, tx *sql.Tx, j jobs.Job, status string) error {
	if j.ResourceID == nil {
		return ErrInvalid
	}
	artifactStatus := "ERROR"
	if status == "SUCCEEDED" {
		artifactStatus = "READY"
	}
	if status == "CANCELLED" {
		artifactStatus = "CANCELLED"
	}
	_, err := tx.ExecContext(ctx, "UPDATE artifacts SET status=?2 WHERE id=?1", *j.ResourceID, artifactStatus)
	return err
}

func (s Store) RequestExport(ctx context.Context, projectID string) (map[string]any, error) {
	snapshot, err := s.CreateSnapshot(ctx, projectID)
	if err != nil {
		return nil, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	artifactID := identifier.New("artifact")
	job, err := s.Jobs().EnqueueTx(ctx, tx, projectID, ExportKind, &artifactID, map[string]string{"snapshotId": snapshot.ID})
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO artifacts(id,project_id,job_id,snapshot_id,kind,filename,content_type) VALUES(?1,?2,?3,?4,'PROJECT_ZIP',?5,'application/zip')`, artifactID, projectID, job.ID, snapshot.ID, "project-"+projectID+".zip")
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"artifactId": artifactID, "jobId": job.ID, "snapshotId": snapshot.ID, "status": "BUILDING"}, nil
}

func (s Store) SnapshotData(ctx context.Context, id, projectID string) ([]byte, []byte, error) {
	var metadata, manifest []byte
	err := s.DB.QueryRowContext(ctx, "SELECT metadata_json,manifest_json FROM snapshots WHERE id=?1 AND project_id=?2", id, projectID).Scan(&metadata, &manifest)
	return metadata, manifest, err
}

func (s Store) SetArtifact(ctx context.Context, id, name, hash string, size int64) error {
	_, err := s.DB.ExecContext(ctx, "UPDATE artifacts SET relative_path=?2,sha256=?3,size_bytes=?4 WHERE id=?1 AND status='BUILDING'", id, name, hash, size)
	return err
}

func (s Store) ForEachJournal(ctx context.Context, projectID string, visit func(string, string) error) error {
	rows, err := s.DB.QueryContext(ctx, "SELECT source_path,sha256 FROM journal_imports WHERE project_id=?1 AND status='READY' ORDER BY id", projectID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var source, hash string
		if err := rows.Scan(&source, &hash); err != nil {
			return err
		}
		if err := visit(source, hash); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (s Store) Artifact(ctx context.Context, id string) (domain.Artifact, error) {
	var a domain.Artifact
	var relative, hash sql.NullString
	var size sql.NullInt64
	err := s.DB.QueryRowContext(ctx, "SELECT status,filename,content_type,relative_path,sha256,size_bytes FROM artifacts WHERE id=?1", id).Scan(&a.Status, &a.Name, &a.ContentType, &relative, &hash, &size)
	a.RelativePath, a.SHA256, a.Size, a.Valid = relative.String, hash.String, size.Int64, relative.Valid && hash.Valid && size.Valid
	return a, err
}
