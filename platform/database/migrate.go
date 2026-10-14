package database

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
)

type MigrationStatus struct {
	Version   int
	Name      string
	Applied   bool
	AppliedAt string
}

type migration struct {
	version  int
	name     string
	body     string
	checksum string
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

const metadataSQL = `
CREATE TABLE schema_owner (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    service TEXT NOT NULL CHECK (service IN ('workspace', 'capture'))
) STRICT;
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL CHECK (length(checksum) = 64),
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
`

func Apply(ctx context.Context, db *sql.DB, owner string, files fs.FS) error {
	if err := validateOwner(owner); err != nil {
		return err
	}
	expected, err := load(files)
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration: %w", err)
	}
	defer tx.Rollback()
	initialized, err := checkOwner(ctx, tx, owner)
	if err != nil {
		return err
	}
	if !initialized {
		if _, err := tx.ExecContext(ctx, metadataSQL); err != nil {
			return fmt.Errorf("create migration metadata: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_owner(singleton, service) VALUES (1, ?)", owner); err != nil {
			return err
		}
	}
	states, err := state(ctx, tx, expected)
	if err != nil {
		return err
	}
	for i, m := range expected {
		if states[i].Applied {
			continue
		}
		if _, err := tx.ExecContext(ctx, m.body); err != nil {
			return fmt.Errorf("apply %s: %w", m.name, err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)", m.version, m.name, m.checksum); err != nil {
			return fmt.Errorf("record %s: %w", m.name, err)
		}
	}
	rows, err := tx.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return fmt.Errorf("check foreign keys: %w", err)
	}
	hasViolation := rows.Next()
	readErr := rows.Err()
	rows.Close()
	if readErr != nil {
		return readErr
	}
	if hasViolation {
		return fmt.Errorf("migration leaves foreign key violations")
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migrations: %w", err)
	}
	return nil
}

func Status(ctx context.Context, db *sql.DB, owner string, files fs.FS) ([]MigrationStatus, error) {
	if err := validateOwner(owner); err != nil {
		return nil, err
	}
	expected, err := load(files)
	if err != nil {
		return nil, err
	}
	initialized, err := checkOwner(ctx, db, owner)
	if err != nil {
		return nil, err
	}
	if !initialized {
		result := make([]MigrationStatus, len(expected))
		for i, m := range expected {
			result[i] = MigrationStatus{Version: m.version, Name: m.name}
		}
		return result, nil
	}
	return state(ctx, db, expected)
}

func validateOwner(owner string) error {
	if owner != "workspace" && owner != "capture" {
		return fmt.Errorf("unknown database owner %q", owner)
	}
	return nil
}

func checkOwner(ctx context.Context, q queryer, owner string) (bool, error) {
	var present int
	if err := q.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_owner'").Scan(&present); err != nil {
		return false, err
	}
	if present == 0 {
		var tables int
		if err := q.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&tables); err != nil {
			return false, err
		}
		if tables != 0 {
			return false, fmt.Errorf("database already has tables but no service owner; refusing to adopt it")
		}
		return false, nil
	}
	var actual string
	if err := q.QueryRowContext(ctx, "SELECT service FROM schema_owner WHERE singleton=1").Scan(&actual); err != nil {
		return false, fmt.Errorf("read database owner: %w", err)
	}
	if actual != owner {
		return false, fmt.Errorf("database belongs to %s, requested %s", actual, owner)
	}
	return true, nil
}

func load(files fs.FS) ([]migration, error) {
	names, err := fs.Glob(files, "*.sql")
	if err == nil && len(names) == 0 {
		names, err = fs.Glob(files, "migrations/*.sql")
	}
	if err != nil {
		return nil, err
	}
	if len(names) == 0 {
		return nil, fmt.Errorf("no SQL migrations")
	}
	sort.Strings(names)
	result := make([]migration, 0, len(names))
	for i, path := range names {
		name := strings.TrimPrefix(path, "migrations/")
		prefix, _, found := strings.Cut(name, "_")
		version, err := strconv.Atoi(prefix)
		if !found || len(prefix) != 4 || err != nil || version != i+1 {
			return nil, fmt.Errorf("migration %s: expected sequential four-digit version %04d", name, i+1)
		}
		body, err := fs.ReadFile(files, path)
		if err != nil {
			return nil, err
		}
		result = append(result, migration{version, name, string(body), fmt.Sprintf("%x", sha256.Sum256(body))})
	}
	return result, nil
}

func state(ctx context.Context, q queryer, expected []migration) ([]MigrationStatus, error) {
	rows, err := q.QueryContext(ctx, "SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version")
	if err != nil {
		return nil, fmt.Errorf("read migration history: %w", err)
	}
	defer rows.Close()
	result := make([]MigrationStatus, len(expected))
	for i, m := range expected {
		result[i] = MigrationStatus{Version: m.version, Name: m.name}
	}
	index := 0
	for rows.Next() {
		var version int
		var name, checksum, appliedAt string
		if err := rows.Scan(&version, &name, &checksum, &appliedAt); err != nil {
			return nil, err
		}
		if index >= len(expected) || version != expected[index].version {
			return nil, fmt.Errorf("migration history is newer than this binary or has a gap at version %d", version)
		}
		m := expected[index]
		if name != m.name || checksum != m.checksum {
			return nil, fmt.Errorf("applied migration %04d was changed; add a new migration", version)
		}
		result[index].Applied = true
		result[index].AppliedAt = appliedAt
		index++
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
