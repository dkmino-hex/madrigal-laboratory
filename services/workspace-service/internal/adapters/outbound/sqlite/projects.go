package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/platform/database"
	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

var ErrInvalid = domain.ErrInvalid
var ErrConflict = domain.ErrConflict
var ErrProjectNotReady = domain.ErrProjectNotReady

type CreateInput = domain.CreateInput

type Project = domain.Project

type Page = domain.Page

type Store struct{ DB *sql.DB }

type cursor struct {
	Time string `json:"time"`
	ID   string `json:"id"`
}

const columns = "id,name,description,status,current_settings_version,created_at,updated_at"

type scanner interface{ Scan(...any) error }

func scan(row scanner) (Project, error) {
	var p Project
	var created, updated database.Timestamp
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.Status, &p.SettingsVersion, &created, &updated)
	p.CreatedAt, p.UpdatedAt, p.CreatedKey = created.Time, updated.Time, created.Text
	return p, err
}

func (s Store) Create(ctx context.Context, input CreateInput, key string) (Project, bool, error) {
	if err := input.Normalize(key); err != nil {
		return Project{}, false, err
	}
	body, err := json.Marshal(input)
	if err != nil {
		return Project{}, false, ErrInvalid
	}
	hash := sha256.Sum256(body)
	hashText := hex.EncodeToString(hash[:])
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, false, err
	}
	defer tx.Rollback()
	var oldHash string
	var response []byte
	err = tx.QueryRowContext(ctx, "SELECT request_sha256,response_json FROM idempotency_keys WHERE scope='projects:create' AND key=?1 AND expires_at>(strftime('%Y-%m-%dT%H:%M:%fZ','now'))", key).Scan(&oldHash, &response)
	if err == nil {
		if oldHash != hashText {
			return Project{}, false, ErrConflict
		}
		var p Project
		if err = json.Unmarshal(response, &p); err != nil {
			return Project{}, false, err
		}
		return p, true, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Project{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM idempotency_keys WHERE scope='projects:create' AND key=?1", key); err != nil {
		return Project{}, false, err
	}
	id, settingsID := identifier.New("prj"), identifier.New("set")
	p, err := scan(tx.QueryRowContext(ctx, "INSERT INTO projects(id,name,description,current_settings_version) VALUES(?1,?2,?3,?4) RETURNING "+columns, id, input.Name, input.Description, settingsID))
	if err != nil {
		return Project{}, false, err
	}
	settings, err := json.Marshal(input.Settings)
	if err != nil {
		return Project{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO project_settings(id,project_id,version,settings_json) VALUES(?1,?2,1,?3)", settingsID, id, string(settings)); err != nil {
		return Project{}, false, err
	}
	response, err = json.Marshal(p)
	if err != nil {
		return Project{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO idempotency_keys(scope,key,request_sha256,response_status,response_json,resource_id,expires_at) VALUES('projects:create',?1,?2,201,?3,?4,strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 days'))", key, hashText, string(response), id); err != nil {
		return Project{}, false, err
	}
	return p, false, tx.Commit()
}

func (s Store) Get(ctx context.Context, id string) (Project, error) {
	return scan(s.DB.QueryRowContext(ctx, "SELECT "+columns+" FROM projects WHERE id=?1", id))
}

func (s Store) List(ctx context.Context, token string, limit int, search ...string) (Page, error) {
	if limit < 1 || limit > 100 {
		return Page{}, ErrInvalid
	}
	queryText := ""
	if len(search) > 0 {
		queryText = strings.ToLower(search[0])
	}
	fetchLimit := limit + 1
	if queryText != "" {
		fetchLimit = -1
	}
	var rows *sql.Rows
	var err error
	if token == "" {
		rows, err = s.DB.QueryContext(ctx, "SELECT "+columns+" FROM projects ORDER BY created_at,id LIMIT ?1", fetchLimit)
	} else {
		var c cursor
		data, decodeErr := base64.RawURLEncoding.DecodeString(token)
		if decodeErr != nil || len(data) > 1024 || json.Unmarshal(data, &c) != nil || c.ID == "" || c.Time == "" {
			return Page{}, ErrInvalid
		}
		if _, err := time.Parse(time.RFC3339Nano, c.Time); err != nil {
			return Page{}, ErrInvalid
		}
		rows, err = s.DB.QueryContext(ctx, "SELECT "+columns+" FROM projects WHERE (created_at,id)>(?1,?2) ORDER BY created_at,id LIMIT ?3", c.Time, c.ID, fetchLimit)
	}
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	page := Page{Items: []Project{}}
	for rows.Next() {
		p, err := scan(rows)
		if err != nil {
			return Page{}, err
		}
		if queryText != "" && !strings.Contains(strings.ToLower(p.Name+" "+p.Description), queryText) {
			continue
		}
		page.Items = append(page.Items, p)
		if len(page.Items) > limit {
			break
		}
	}
	if err = rows.Err(); err != nil {
		return Page{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		last := page.Items[limit-1]
		data, _ := json.Marshal(cursor{Time: last.CreatedKey, ID: last.ID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(data)
	}
	return page, nil
}
