package database

import (
	"embed"
	"io/fs"
)

//go:embed migrations/*.sql
var embeddedMigrations embed.FS

var MigrationFiles fs.FS

func init() {
	var err error

	MigrationFiles, err = fs.Sub(embeddedMigrations, "migrations")
	if err != nil {
		panic(err)
	}
}
