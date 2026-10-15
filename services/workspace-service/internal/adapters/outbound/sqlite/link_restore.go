package storage

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func optionalText(row map[string]any, key string) string { value, _ := row[key].(string); return value }
func restoreLinks(ctx context.Context, tx *sql.Tx, projectID string, data map[string][]map[string]any, maps domain.CaptureImportResult, actions, observations map[string]string) error {
	links := map[string]string{}
	for _, row := range data["sourceLinks"] {
		oldID, raw := optionalText(row, "id"), optionalText(row, "data_json")
		var link domain.SourceLink
		if json.Unmarshal([]byte(raw), &link) != nil || oldID == "" || link.ID != oldID || links[oldID] != "" {
			return ErrInvalidArchive
		}
		var err error
		link, err = link.Remap(projectID, maps)
		if err != nil {
			return err
		}
		if link.ActionID != "" {
			link.ActionID = actions[link.ActionID]
			if link.ActionID == "" {
				return ErrInvalidArchive
			}
		}
		if _, err = link.Evidence(); err != nil {
			return ErrInvalidArchive
		}
		link.ID = identifier.New("link")
		links[oldID] = link.ID
		body, err := json.Marshal(link)
		if err != nil {
			return err
		}
		var action any
		if link.ActionID != "" {
			action = link.ActionID
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO source_links(id,project_id,action_id,data_json) VALUES(?,?,?,?)`, link.ID, projectID, action, string(body)); err != nil {
			return err
		}
	}
	for _, row := range data["observationLinks"] {
		obs, link := observations[optionalText(row, "observation_id")], links[optionalText(row, "link_id")]
		if obs == "" || link == "" {
			return ErrInvalidArchive
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO observation_source_links(project_id,observation_id,link_id,kind) VALUES(?,?,?,?)`, projectID, obs, link, row["kind"]); err != nil {
			return err
		}
	}
	return nil
}
