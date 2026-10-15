package service_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/application/analysis"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/migrations"
)

func newSnapshotRepository(t *testing.T) *storage.InterpretationRepository {
	t.Helper()
	path := filepath.Join(t.TempDir(), "nested", "analysis.sqlite")
	db, err := storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = storage.RunMigrations(db, migrations.Files); err != nil {
		t.Fatal(err)
	}
	db, err = storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return storage.NewInterpretationRepository(db)
}

func TestSnapshotArchiveAndIdempotentRestore(t *testing.T) {
	ctx := context.Background()
	repo := newSnapshotRepository(t)
	interpretations := service.NewInterpretationService(repo)
	schema := json.RawMessage(`{"fields":[]}`)
	if _, err := interpretations.Create(ctx, service.CreateInterpretationInput{ProjectID: "source", Name: "Parser", Schema: schema}); err != nil {
		t.Fatal(err)
	}
	snapshots := service.Snapshots{Repo: repo}
	id, err := snapshots.Create(ctx, "source")
	if err != nil {
		t.Fatal(err)
	}
	body, err := snapshots.Archive(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil || len(archive.File) != 1 || archive.File[0].Name != "analysis.json" {
		t.Fatalf("invalid archive: %v", err)
	}
	destination := repo
	snapshots = service.Snapshots{Repo: destination}
	interpretations = service.NewInterpretationService(destination)
	for i := 0; i < 2; i++ {
		if err = snapshots.Restore(ctx, "restored", "import", body, service.RestoreMaps{}); err != nil {
			t.Fatal(err)
		}
	}
	items, err := interpretations.ListByProject(ctx, "restored")
	if err != nil || len(items) != 1 {
		t.Fatalf("restore duplicated interpretations: %v %v", items, err)
	}
	revisions, _, err := interpretations.ListRevisions(ctx, "restored", items[0].ID, 10, 0)
	if err != nil || len(revisions) != 1 || revisions[0].SchemaJSON != string(schema) {
		t.Fatalf("revision changed: %v %v", revisions, err)
	}
	if err = snapshots.Restore(ctx, "restored", "broken", []byte("broken"), service.RestoreMaps{}); !errors.Is(err, service.ErrInvalidArchive) {
		t.Fatalf("invalid ZIP: %v", err)
	}
	if err = snapshots.Restore(ctx, "restored", "import", []byte("different"), service.RestoreMaps{}); !errors.Is(err, service.ErrImportConflict) {
		t.Fatalf("import key reuse: %v", err)
	}
}
