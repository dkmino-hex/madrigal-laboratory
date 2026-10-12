package storage

import (
	"context"
	"database/sql"
	"embed"

	"github.com/dkmino-hex/madrigal-laboratory/internal/database"
)

//go:embed migrations/*.sql
var Migrations embed.FS

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
