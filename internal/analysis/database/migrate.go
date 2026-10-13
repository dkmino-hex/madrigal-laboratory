package database

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"

	"github.com/golang-migrate/migrate/v4"
	migratesqlite "github.com/golang-migrate/migrate/v4/database/sqlite"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

func RunMigrations(db *sql.DB, migrationFiles fs.FS) error {
	driver, err := migratesqlite.WithInstance(
		db,
		&migratesqlite.Config{},
	)
	if err != nil {
		return fmt.Errorf("create migration driver: %w", err)
	}

	source, err := iofs.New(migrationFiles, ".")
	if err != nil {
		return fmt.Errorf("create migration source: %w", err)
	}

	m, err := migrate.NewWithInstance(
		"iofs",
		source,
		"sqlite",
		driver,
	)
	if err != nil {
		return fmt.Errorf("initialize migrations: %w", err)
	}

	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("apply migrations: %w", err)
	}

	return nil
}
