package storage

import (
	"context"
	"encoding/json"
	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
	"strings"
)

func (s Store) PersistAutomaticObservation(ctx context.Context, project string, input domain.AutomaticObservation) (map[string]any, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = ready(ctx, tx, project); err != nil {
		return nil, err
	}
	hash, err := mutationHash(input)
	if err != nil {
		return nil, err
	}
	scope := "automatic-observations:" + project
	var cached map[string]any
	if replayed, e := replayMutation(ctx, tx, scope, input.IdempotencyKey, hash, &cached); e != nil {
		return nil, e
	} else if replayed {
		return cached, tx.Commit()
	}
	id := identifier.New("obs")
	generation, _ := json.Marshal(input.Generation)
	_, err = tx.ExecContext(ctx, `INSERT INTO observations(id,project_id,kind,text,status,basis,generation_json) VALUES(?,?,?,?,'DRAFT',?,?)`, id, project, input.Kind, strings.TrimSpace(input.Text), input.Basis, string(generation))
	if err != nil {
		return nil, err
	}
	links := []domain.LinkReference{}
	for _, example := range input.Examples {
		var action any
		if example.ActionID != "" {
			var count int
			if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM actions WHERE id=? AND project_id=?`, example.ActionID, project).Scan(&count); err != nil {
				return nil, err
			}
			if count != 1 {
				return nil, ErrInvalid
			}
			action = example.ActionID
		}
		example.ID = identifier.New("link")
		body, e := json.Marshal(example)
		if e != nil {
			return nil, e
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO source_links(id,project_id,action_id,data_json) VALUES(?,?,?,?)`, example.ID, project, action, string(body))
		if err != nil {
			return nil, err
		}
		links = append(links, domain.LinkReference{ID: example.ID, Kind: example.Kind})
	}
	if err = replaceObservationLinks(ctx, tx, project, id, links); err != nil {
		return nil, err
	}
	result, err := observation(ctx, tx, project, id)
	if err != nil {
		return nil, err
	}
	if err = rememberMutation(ctx, tx, scope, input.IdempotencyKey, hash, id, 201, result); err != nil {
		return nil, err
	}
	return result, tx.Commit()
}
