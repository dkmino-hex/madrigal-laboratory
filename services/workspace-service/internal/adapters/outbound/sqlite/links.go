package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func mutationHash(input any) (string, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(body)
	return hex.EncodeToString(hash[:]), nil
}
func replayMutation(ctx context.Context, tx *sql.Tx, scope, key, hash string, out any) (bool, error) {
	if key == "" {
		return false, nil
	}
	if !domain.ValidIdempotencyKey(key) {
		return false, ErrInvalid
	}
	var old, response string
	err := tx.QueryRowContext(ctx, `SELECT request_sha256,response_json FROM idempotency_keys WHERE scope=? AND key=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`, scope, key).Scan(&old, &response)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = tx.ExecContext(ctx, `DELETE FROM idempotency_keys WHERE scope=? AND key=?`, scope, key)
		return false, err
	}
	if err != nil {
		return false, err
	}
	if old != hash {
		return false, ErrConflict
	}
	return true, json.Unmarshal([]byte(response), out)
}
func rememberMutation(ctx context.Context, tx *sql.Tx, scope, key, hash, resource string, status int, response any) error {
	if key == "" {
		return nil
	}
	body, err := json.Marshal(response)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO idempotency_keys(scope,key,request_sha256,response_status,response_json,resource_id,expires_at) VALUES(?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 days'))`, scope, key, hash, status, string(body), resource)
	return err
}
func ready(ctx context.Context, tx *sql.Tx, projectID string) error {
	var status string
	if err := tx.QueryRowContext(ctx, `SELECT status FROM projects WHERE id=?`, projectID).Scan(&status); err != nil {
		return err
	}
	if status != "READY" {
		return ErrProjectNotReady
	}
	return nil
}

func (s Store) PersistLink(ctx context.Context, projectID string, link domain.SourceLink, key string) (domain.SourceLink, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return link, err
	}
	defer tx.Rollback()
	if err = ready(ctx, tx, projectID); err != nil {
		return link, err
	}
	hash, err := mutationHash(link)
	if err != nil {
		return link, err
	}
	scope := "links:" + projectID + ":" + link.ID
	var cached domain.SourceLink
	seen, err := replayMutation(ctx, tx, scope, key, hash, &cached)
	if err != nil {
		return link, err
	}
	if seen {
		return cached, tx.Commit()
	}
	if link.ActionID != "" {
		var n int
		if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM actions WHERE project_id=? AND id=?`, projectID, link.ActionID).Scan(&n); err != nil {
			return link, err
		}
		if n != 1 {
			return link, ErrInvalid
		}
	}
	creating := link.ID == ""
	if creating {
		link.ID = identifier.New("link")
	} else {
		var old string
		if err = tx.QueryRowContext(ctx, `SELECT id FROM source_links WHERE project_id=? AND id=?`, projectID, link.ID).Scan(&old); err != nil {
			return link, err
		}
	}
	body, err := json.Marshal(link)
	if err != nil {
		return link, err
	}
	var action any
	if link.ActionID != "" {
		action = link.ActionID
	}
	if creating {
		_, err = tx.ExecContext(ctx, `INSERT INTO source_links(id,project_id,action_id,data_json) VALUES(?,?,?,?)`, link.ID, projectID, action, string(body))
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE source_links SET action_id=?,data_json=? WHERE project_id=? AND id=?`, action, string(body), projectID, link.ID)
	}
	if err != nil {
		return link, err
	}
	if err = rememberMutation(ctx, tx, scope, key, hash, link.ID, 200, link); err != nil {
		return link, err
	}
	return link, tx.Commit()
}
func (s Store) Links(ctx context.Context, projectID, cursor, actionID string, limit int) (map[string]any, error) {
	if limit < 1 || limit > 100 {
		return nil, ErrInvalid
	}
	project, err := s.Get(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if project.Status != "READY" {
		return nil, ErrProjectNotReady
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT data_json FROM source_links WHERE project_id=? AND id>? AND (?='' OR action_id=?) ORDER BY id LIMIT ?`, projectID, cursor, actionID, actionID, limit+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.SourceLink{}
	for rows.Next() {
		var raw string
		var item domain.SourceLink
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(raw), &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	next := ""
	if len(items) > limit {
		items = items[:limit]
		next = items[len(items)-1].ID
	}
	return map[string]any{"items": items, "nextCursor": next}, nil
}
func replaceObservationLinks(ctx context.Context, tx *sql.Tx, projectID, id string, links []domain.LinkReference) error {
	seen := map[string]bool{}
	for _, link := range links {
		if link.ID == "" || seen[link.ID] || (link.Kind != "support" && link.Kind != "counterexample") {
			return ErrInvalid
		}
		seen[link.ID] = true
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM source_links WHERE project_id=? AND id=?`, projectID, link.ID).Scan(&exists); err != nil {
			return err
		}
		if exists != 1 {
			return ErrInvalid
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM observation_source_links WHERE project_id=? AND observation_id=?`, projectID, id); err != nil {
		return err
	}
	for _, link := range links {
		if _, err := tx.ExecContext(ctx, `INSERT INTO observation_source_links(project_id,observation_id,link_id,kind) VALUES(?,?,?,?)`, projectID, id, link.ID, link.Kind); err != nil {
			return err
		}
	}
	return nil
}
func (s Store) DeleteObservation(ctx context.Context, projectID, id string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = ready(ctx, tx, projectID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM observation_source_links WHERE project_id=? AND observation_id=?`, projectID, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM evidence WHERE project_id=? AND observation_id=?`, projectID, id); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM observations WHERE project_id=? AND id=?`, projectID, id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}
