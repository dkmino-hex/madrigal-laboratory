package projects

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/internal/database"
	"github.com/dkmino-hex/madrigal-laboratory/internal/identifier"
)

type SettingsVersion struct {
	ID        string          `json:"settingsVersion"`
	ProjectID string          `json:"projectId"`
	Version   int64           `json:"version"`
	Settings  json.RawMessage `json:"settings"`
	CreatedAt time.Time       `json:"createdAt"`
}

type Context struct {
	ProjectID       string          `json:"projectId"`
	Status          string          `json:"status"`
	SettingsVersion string          `json:"settingsVersion"`
	Version         int64           `json:"version"`
	Settings        json.RawMessage `json:"settings"`
}

func scanSettings(row scanner) (SettingsVersion, error) {
	var v SettingsVersion
	var created database.Timestamp
	var settings string
	err := row.Scan(&v.ID, &v.ProjectID, &v.Version, &settings, &created)
	v.Settings = json.RawMessage(settings)
	v.CreatedAt = created.Time
	return v, err
}

func (s Store) SettingsContext(ctx context.Context, projectID, version string) (Context, error) {
	if projectID == "" || version == "" {
		return Context{}, ErrInvalid
	}
	var status, current string
	if err := s.DB.QueryRowContext(ctx, "SELECT status,current_settings_version FROM projects WHERE id=?1", projectID).Scan(&status, &current); err != nil {
		return Context{}, err
	}
	if version == "current" {
		version = current
	}
	v, err := scanSettings(s.DB.QueryRowContext(ctx, "SELECT id,project_id,version,settings_json,created_at FROM project_settings WHERE project_id=?1 AND id=?2", projectID, version))
	if err != nil {
		return Context{}, err
	}
	return Context{ProjectID: projectID, Status: status, SettingsVersion: v.ID, Version: v.Version, Settings: v.Settings}, nil
}

func (s Store) UpdateSettings(ctx context.Context, projectID string, settings map[string]any, key string) (SettingsVersion, bool, error) {
	if projectID == "" || settings == nil || len(key) < 1 || len(key) > 200 {
		return SettingsVersion{}, false, ErrInvalid
	}
	for _, r := range key {
		if r < 33 || r > 126 {
			return SettingsVersion{}, false, ErrInvalid
		}
	}
	data, err := json.Marshal(settings)
	if err != nil {
		return SettingsVersion{}, false, ErrInvalid
	}
	hash := sha256.Sum256(data)
	hashText := hex.EncodeToString(hash[:])
	scope := "projects:" + projectID + ":settings"
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return SettingsVersion{}, false, err
	}
	defer tx.Rollback()
	var priorHash string
	var priorResponse []byte
	err = tx.QueryRowContext(ctx, "SELECT request_sha256,response_json FROM idempotency_keys WHERE scope=?1 AND key=?2 AND expires_at>(strftime('%Y-%m-%dT%H:%M:%fZ','now'))", scope, key).Scan(&priorHash, &priorResponse)
	if err == nil {
		if priorHash != hashText {
			return SettingsVersion{}, false, ErrConflict
		}
		var v SettingsVersion
		if err = json.Unmarshal(priorResponse, &v); err != nil {
			return SettingsVersion{}, false, err
		}
		return v, true, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SettingsVersion{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM idempotency_keys WHERE scope=?1 AND key=?2", scope, key); err != nil {
		return SettingsVersion{}, false, err
	}
	var currentVersion int64
	var status string
	if err = tx.QueryRowContext(ctx, "SELECT status,coalesce((SELECT max(version) FROM project_settings WHERE project_id=?1),0) FROM projects WHERE id=?1", projectID).Scan(&status, &currentVersion); err != nil {
		return SettingsVersion{}, false, err
	}
	if strings.ToUpper(status) != "READY" {
		return SettingsVersion{}, false, ErrInvalid
	}
	id := identifier.New("set")
	v, err := scanSettings(tx.QueryRowContext(ctx, "INSERT INTO project_settings(id,project_id,version,settings_json) VALUES(?1,?2,?3,?4) RETURNING id,project_id,version,settings_json,created_at", id, projectID, currentVersion+1, string(data)))
	if err != nil {
		return SettingsVersion{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE projects SET current_settings_version=?2,updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1", projectID, id); err != nil {
		return SettingsVersion{}, false, err
	}
	response, err := json.Marshal(v)
	if err != nil {
		return SettingsVersion{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO idempotency_keys(scope,key,request_sha256,response_status,response_json,resource_id,expires_at) VALUES(?1,?2,?3,200,?4,?5,strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 days'))", scope, key, hashText, string(response), id); err != nil {
		return SettingsVersion{}, false, err
	}
	return v, false, tx.Commit()
}
