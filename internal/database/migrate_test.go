package database_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/dkmino-hex/madrigal-laboratory/internal/database"
)

func openDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := database.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func migrations(first, second string) fstest.MapFS {
	files := fstest.MapFS{"migrations/0001_first.sql": &fstest.MapFile{Data: []byte(first)}}
	if second != "" {
		files["migrations/0002_second.sql"] = &fstest.MapFile{Data: []byte(second)}
	}
	return files
}

func TestApplyPersistsAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "кириллица и пробелы", "workspace.sqlite")
	db := openDB(t, path)
	files := migrations("CREATE TABLE examples (id INTEGER PRIMARY KEY, value TEXT) STRICT;", "")
	for i := 0; i < 2; i++ {
		if err := database.Apply(ctx, db, "workspace", files); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec("INSERT INTO examples VALUES (1, 'saved')"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db = openDB(t, path)
	if err := database.Apply(ctx, db, "workspace", files); err != nil {
		t.Fatal(err)
	}
	var value string
	if err := db.QueryRow("SELECT value FROM examples WHERE id=1").Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != "saved" {
		t.Fatalf("lost data: %q", value)
	}
	states, err := database.Status(ctx, db, "workspace", files)
	if err != nil {
		t.Fatal(err)
	}
	if len(states) != 1 || !states[0].Applied || states[0].AppliedAt == "" {
		t.Fatalf("bad history: %+v", states)
	}
	var fk, timeout, synchronous int
	var mode, integrity string
	for query, dst := range map[string]any{
		"PRAGMA foreign_keys": &fk, "PRAGMA busy_timeout": &timeout,
		"PRAGMA synchronous": &synchronous, "PRAGMA journal_mode": &mode,
		"PRAGMA integrity_check": &integrity,
	} {
		if err := db.QueryRow(query).Scan(dst); err != nil {
			t.Fatal(err)
		}
	}
	if fk != 1 || timeout != 5000 || synchronous != 2 || mode != "wal" || integrity != "ok" {
		t.Fatalf("connection settings: fk=%d timeout=%d sync=%d journal=%s integrity=%s", fk, timeout, synchronous, mode, integrity)
	}
}

func TestApplyRollsBackWholeBatch(t *testing.T) {
	ctx := context.Background()
	db := openDB(t, filepath.Join(t.TempDir(), "workspace.sqlite"))
	files := migrations("CREATE TABLE first (id INTEGER PRIMARY KEY) STRICT;", "INSERT INTO absent VALUES (1);")
	if err := database.Apply(ctx, db, "workspace", files); err == nil {
		t.Fatal("invalid migration succeeded")
	}
	var tables int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if tables != 0 {
		t.Fatalf("partial migration persisted: %d tables", tables)
	}
	files = migrations("CREATE TABLE first (id INTEGER PRIMARY KEY) STRICT;", "CREATE TABLE second (id INTEGER PRIMARY KEY) STRICT;")
	if err := database.Apply(ctx, db, "workspace", files); err != nil {
		t.Fatal(err)
	}
}

func TestApplyRejectsChangedMigrationAndWrongOwner(t *testing.T) {
	ctx := context.Background()
	db := openDB(t, filepath.Join(t.TempDir(), "workspace.sqlite"))
	files := migrations("CREATE TABLE first (id INTEGER PRIMARY KEY) STRICT;", "")
	if err := database.Apply(ctx, db, "workspace", files); err != nil {
		t.Fatal(err)
	}
	if err := database.Apply(ctx, db, "capture", files); err == nil || !strings.Contains(err.Error(), "belongs to workspace") {
		t.Fatalf("wrong owner: %v", err)
	}
	changed := migrations("CREATE TABLE first (id INTEGER PRIMARY KEY, extra TEXT) STRICT;", "")
	if err := database.Apply(ctx, db, "workspace", changed); err == nil || !strings.Contains(err.Error(), "was changed") {
		t.Fatalf("changed migration accepted: %v", err)
	}
	if _, err := database.Status(ctx, db, "workspace", changed); err == nil {
		t.Fatal("status ignored changed migration")
	}
}

func TestApplyRejectsUnownedAndNewerDatabases(t *testing.T) {
	ctx := context.Background()
	files := migrations("CREATE TABLE first (id INTEGER PRIMARY KEY) STRICT;", "")
	t.Run("unowned", func(t *testing.T) {
		db := openDB(t, filepath.Join(t.TempDir(), "existing.sqlite"))
		if _, err := db.Exec("CREATE TABLE other (id INTEGER PRIMARY KEY)"); err != nil {
			t.Fatal(err)
		}
		if err := database.Apply(ctx, db, "workspace", files); err == nil {
			t.Fatal("adopted a database with unknown tables")
		}
	})
	t.Run("newer", func(t *testing.T) {
		db := openDB(t, filepath.Join(t.TempDir(), "newer.sqlite"))
		newer := migrations("CREATE TABLE first (id INTEGER PRIMARY KEY) STRICT;", "CREATE TABLE second (id INTEGER PRIMARY KEY) STRICT;")
		if err := database.Apply(ctx, db, "workspace", newer); err != nil {
			t.Fatal(err)
		}
		if err := database.Apply(ctx, db, "workspace", files); err == nil {
			t.Fatal("accepted newer database")
		}
	})
	t.Run("invalid sequence", func(t *testing.T) {
		db := openDB(t, filepath.Join(t.TempDir(), "gap.sqlite"))
		gap := fstest.MapFS{"migrations/0002_gap.sql": &fstest.MapFile{Data: []byte("SELECT 1;")}}
		if err := database.Apply(ctx, db, "workspace", gap); err == nil {
			t.Fatal("accepted migration gap")
		}
	})
}

func TestConcurrentMigrationStartup(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "workspace.sqlite")
	a, b := openDB(t, path), openDB(t, path)
	files := migrations("CREATE TABLE first (id INTEGER PRIMARY KEY) STRICT;", "")
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, db := range []*sql.DB{a, b} {
		wg.Add(1)
		go func(db *sql.DB) { defer wg.Done(); <-start; results <- database.Apply(ctx, db, "workspace", files) }(db)
	}
	close(start)
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := a.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("duplicate history: %d", count)
	}
}
