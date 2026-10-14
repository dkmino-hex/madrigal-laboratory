package storage

import (
	"context"
	"database/sql"

	"github.com/dkmino-hex/madrigal-laboratory/platform/database"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/migrations"
)

var Migrations = migrations.Files

func Open(ctx context.Context, path string) (*sql.DB, error) {
	db, err := database.Open(ctx, path)
	if err != nil {
		return nil, err
	}
	if err := database.Apply(ctx, db, "capture", Migrations); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
