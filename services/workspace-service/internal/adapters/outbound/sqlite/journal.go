package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func (s Store) Jobs() jobs.Store {
	return jobs.Store{DB: s.DB, Prefix: "ws", OnFinish: s.finishJournal}
}

func (s Store) finishJournal(ctx context.Context, tx *sql.Tx, j jobs.Job, status string, failure *jobs.JobError) error {
	if j.Kind == ProjectImportKind {
		return s.finishProjectImport(ctx, tx, j, status)
	}
	if j.Kind == ReportKind || j.Kind == ExportKind {
		return s.finishReport(ctx, tx, j, status)
	}
	if j.Kind != JournalKind || j.ResourceID == nil {
		return nil
	}
	importStatus := "ERROR"
	if status == "SUCCEEDED" {
		importStatus = "READY"
	}
	if status == "CANCELLED" {
		importStatus = "CANCELLED"
	}
	_, err := tx.ExecContext(ctx, "UPDATE journal_imports SET status=?2 WHERE id=?1", *j.ResourceID, importStatus)
	return err
}

func (s Store) Actions(ctx context.Context, projectID string, q ActionQuery) (map[string]any, error) {
	if q.Limit < 1 || q.Limit > 100 || q.From != nil && q.To != nil && *q.From > *q.To {
		return nil, ErrInvalid
	}
	var status string
	if err := s.DB.QueryRowContext(ctx, "SELECT status FROM projects WHERE id=?1", projectID).Scan(&status); err != nil {
		return nil, err
	}
	if status != "READY" {
		return nil, ErrProjectNotReady
	}
	query := `SELECT a.id,a.journal_import_id,a.source_action_id,a.source_line,a.capture_path,a.session_label,a.start_unix_ns,a.end_unix_ns,a.name,a.parameters_json,a.observed_result_json,a.type,ji.original_name,ji.timezone,ji.time_offset_ns FROM actions a JOIN journal_imports ji ON ji.id=a.journal_import_id AND ji.status='READY' WHERE a.project_id=?1 AND a.id>?2`
	args := []any{projectID, q.Cursor}
	if q.Name != "" {
		query += " AND coalesce(nullif(a.type,''),a.name)=?" + strconv.Itoa(len(args)+1)
		args = append(args, q.Name)
	}
	if q.From != nil {
		query += " AND a.end_unix_ns>=?" + strconv.Itoa(len(args)+1)
		args = append(args, *q.From)
	}
	if q.To != nil {
		query += " AND a.start_unix_ns<=?" + strconv.Itoa(len(args)+1)
		args = append(args, *q.To)
	}
	query += " ORDER BY a.id"
	if q.Search == "" {
		query += " LIMIT ?" + strconv.Itoa(len(args)+1)
		args = append(args, q.Limit+1)
	}
	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, imp, sourceID, path, name, params, result, kind, filename, timezone string
		var session sql.NullString
		var line, start, end, offset int64
		if err := rows.Scan(&id, &imp, &sourceID, &line, &path, &session, &start, &end, &name, &params, &result, &kind, &filename, &timezone, &offset); err != nil {
			return nil, err
		}
		if q.Search != "" && !strings.Contains(strings.ToLower(name+" "+kind+" "+params), strings.ToLower(q.Search)) {
			continue
		}
		if kind == "" {
			kind = name
		}
		items = append(items, map[string]any{"projectId": projectID, "type": kind, "sourceFile": filename, "timezone": timezone, "timeOffsetNs": strconv.FormatInt(offset, 10), "parametersJson": params, "actionId": id, "importId": imp, "sourceActionId": sourceID, "sourceLine": line, "capturePath": path, "session": session.String, "start": time.Unix(0, start).UTC().Format(time.RFC3339Nano), "end": time.Unix(0, end).UTC().Format(time.RFC3339Nano), "name": name, "parameters": json.RawMessage(params), "observedResult": json.RawMessage(result)})
		if len(items) > q.Limit {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	cursor := ""
	if len(items) > q.Limit {
		items = items[:q.Limit]
		cursor = items[len(items)-1]["actionId"].(string)
	}
	var incomplete int
	if err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM journal_imports WHERE project_id=?1 AND status!='READY'", projectID).Scan(&incomplete); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "nextCursor": cursor, "incompleteImports": incomplete}, nil
}

func (s Store) RegisterJournal(ctx context.Context, projectID string, in JournalInput, final, hash string) (JournalImport, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return JournalImport{}, err
	}
	defer tx.Rollback()
	scope := "projects:" + projectID + ":journal"
	requestHash, err := mutationHash(map[string]any{"input": in, "sha256": hash})
	if err != nil {
		return JournalImport{}, err
	}
	var replayed JournalImport
	if ok, err := replayMutation(ctx, tx, scope, in.IdempotencyKey, requestHash, &replayed); err != nil {
		return JournalImport{}, err
	} else if ok {
		return replayed, tx.Commit()
	}
	id := identifier.New("journal")
	job, err := s.Jobs().EnqueueTx(ctx, tx, projectID, JournalKind, &id, map[string]string{"importId": id})
	if err != nil {
		return JournalImport{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO journal_imports(id,project_id,job_id,original_name,source_path,sha256,timezone,time_offset_ns) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`, id, projectID, job.ID, filepath.Base(in.Name), final, hash, in.Timezone, in.OffsetNS)
	if err != nil {
		return JournalImport{}, err
	}
	result := JournalImport{ID: id, JobID: job.ID, Status: "IMPORTING", SHA256: hash, Diagnostics: json.RawMessage("[]")}
	if err = rememberMutation(ctx, tx, scope, in.IdempotencyKey, requestHash, id, 202, result); err != nil {
		return JournalImport{}, err
	}
	return result, tx.Commit()

}

func (s Store) JournalSource(ctx context.Context, id string) (domain.JournalSource, error) {
	var result domain.JournalSource
	err := s.DB.QueryRowContext(ctx, "SELECT source_path,timezone,time_offset_ns FROM journal_imports WHERE id=?1", id).Scan(&result.Path, &result.Timezone, &result.Offset)
	return result, err
}

func (s Store) WriteJournal(ctx context.Context, j jobs.Job, parse func(func(domain.JournalAction) error) (int64, int64, []map[string]any, error)) (int64, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	total, accepted, diagnostics, err := parse(func(row domain.JournalAction) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO actions(id,project_id,journal_import_id,source_action_id,source_line,capture_path,session_label,start_unix_ns,end_unix_ns,name,parameters_json,observed_result_json,type) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`, identifier.New("act"), j.ProjectID, *j.ResourceID, row.SourceID, row.Line, row.Capture, row.Session, row.Start, row.End, row.Name, row.Parameters, row.Result, row.Type)
		return err
	})
	if err != nil {
		return 0, err
	}
	diag, _ := json.Marshal(diagnostics)
	_, err = tx.ExecContext(ctx, "UPDATE journal_imports SET total_rows=?2,accepted_rows=?3,diagnostics_json=?4 WHERE id=?1", *j.ResourceID, total, accepted, string(diag))
	if err != nil {
		return 0, err
	}
	return total, tx.Commit()
}
