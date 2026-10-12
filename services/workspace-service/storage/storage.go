// Package storage owns the workspace database schema.
package storage

import (
	"context"
	"database/sql"
	"embed"

	"github.com/dkmino-hex/madrigal-laboratory/internal/database"
)

//go:embed migrations/*.sql
var Migrations embed.FS

// Open opens the private service database and applies its migrations.
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
