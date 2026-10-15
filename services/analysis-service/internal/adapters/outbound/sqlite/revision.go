package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
)

func parseSQLiteTime(value string) (time.Time, error) {
	t, err := time.ParseInLocation("2006-01-02 15:04:05", value, time.UTC)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse SQLite timestamp %q: %w", value, err)
	}
	return t, nil
}

func (r *InterpretationRepository) CreateRevision(ctx context.Context, projectID, interpretationID string, revision *domain.Revision, keys ...string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	key, scope := optionalKey(keys), "revisions:"+projectID+":"+interpretationID
	hash, err := requestHash([]string{revision.SchemaJSON, revision.ChangeComment, revision.ParentRevisionID})
	if err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, "UPDATE interpretations SET name=name WHERE id=? AND project_id=?", interpretationID, projectID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	exists, err := replay(ctx, tx, scope, key, hash, revision)
	if err != nil {
		return err
	}
	if exists {
		return tx.Commit()
	}
	if revision.ParentRevisionID != "" {
		var belongs int
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM revisions WHERE id=? AND interpretation_id=?", revision.ParentRevisionID, interpretationID).Scan(&belongs); err != nil {
			return err
		}
		if belongs != 1 {
			return domain.ErrNotFound
		}
	}
	if err = tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0)+1 FROM revisions WHERE interpretation_id=?", interpretationID).Scan(&revision.Version); err != nil {
		return err
	}
	revision.InterpretationID = interpretationID
	if _, err = tx.ExecContext(ctx, "INSERT INTO revisions(id,interpretation_id,version,schema_json,change_comment,parent_revision_id) VALUES(?,?,?,?,?,?)", revision.ID, interpretationID, revision.Version, revision.SchemaJSON, revision.ChangeComment, revision.ParentRevisionID); err != nil {
		return err
	}
	var created string
	if err = tx.QueryRowContext(ctx, "SELECT created_at FROM revisions WHERE id=?", revision.ID).Scan(&created); err != nil {
		return err
	}
	revision.CreatedAt, err = parseSQLiteTime(created)
	if err != nil {
		return err
	}
	if err = remember(ctx, tx, scope, key, hash, revision); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *InterpretationRepository) ListRevisions(ctx context.Context, projectID, interpretationID string, limit, offset int) ([]domain.Revision, bool, error) {
	var exists int
	err := r.db.QueryRowContext(ctx, `SELECT 1 FROM interpretations WHERE id = ? AND project_id = ?`, interpretationID, projectID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, domain.ErrNotFound
	}
	if err != nil {
		return nil, false, fmt.Errorf("check interpretation: %w", err)
	}

	rows, err := r.db.QueryContext(ctx, `SELECT r.id, r.interpretation_id, r.version, r.schema_json, r.created_at, r.change_comment, r.parent_revision_id FROM revisions r JOIN interpretations i ON i.id = r.interpretation_id WHERE i.id = ? AND i.project_id = ? ORDER BY r.version DESC LIMIT ? OFFSET ?`, interpretationID, projectID, limit+1, offset)
	if err != nil {
		return nil, false, fmt.Errorf("list revisions: %w", err)
	}
	defer rows.Close()
	items := make([]domain.Revision, 0)
	for rows.Next() {
		var rev domain.Revision
		var created string
		if err := rows.Scan(&rev.ID, &rev.InterpretationID, &rev.Version, &rev.SchemaJSON, &created, &rev.ChangeComment, &rev.ParentRevisionID); err != nil {
			return nil, false, fmt.Errorf("scan revision: %w", err)
		}
		rev.CreatedAt, err = parseSQLiteTime(created)
		if err != nil {
			return nil, false, err
		}
		items = append(items, rev)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("iterate revisions: %w", err)
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return items, hasMore, nil
}

func (r *InterpretationRepository) GetRevision(ctx context.Context, projectID, interpretationID, revisionID string) (*domain.Revision, error) {
	var rev domain.Revision
	var created string
	err := r.db.QueryRowContext(ctx, `SELECT r.id, r.interpretation_id, r.version, r.schema_json, r.created_at, r.change_comment, r.parent_revision_id FROM revisions r JOIN interpretations i ON i.id = r.interpretation_id WHERE r.id = ? AND i.id = ? AND i.project_id = ?`, revisionID, interpretationID, projectID).Scan(&rev.ID, &rev.InterpretationID, &rev.Version, &rev.SchemaJSON, &created, &rev.ChangeComment, &rev.ParentRevisionID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get revision: %w", err)
	}
	rev.CreatedAt, err = parseSQLiteTime(created)
	if err != nil {
		return nil, err
	}
	return &rev, nil
}

func (r *InterpretationRepository) CurrentRevisionID(ctx context.Context, interpretationID string) (string, error) {
	var id string
	err := r.db.QueryRowContext(ctx, `SELECT id FROM revisions WHERE interpretation_id = ? ORDER BY version DESC LIMIT 1`, interpretationID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get current revision: %w", err)
	}
	return id, nil
}
