package storage

import (
	"context"
	"database/sql"
	"path/filepath"

	"github.com/dkmino-hex/madrigal-laboratory/platform/database"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/migrations"
)

var Migrations = migrations.Files

func Open(ctx context.Context, path string) (*sql.DB, error) {
	db, err := database.Open(ctx, path)
	if err != nil {
		return nil, err
	}
	if err := database.Apply(ctx, db, "workspace", Migrations); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func (s Store) DataDirectory(ctx context.Context) (string, error) {
	name, err := database.Path(ctx, s.DB)
	return filepath.Dir(name), err
}

func (s Store) PingContext(ctx context.Context) error { return s.DB.PingContext(ctx) }
