package repository

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/database"
)

func snapshotTestDB(t *testing.T) *InterpretationRepository {
	t.Helper()
	path := filepath.Join(t.TempDir(), "analysis.db")
	db, e := database.Open(path)
	if e != nil {
		t.Fatal(e)
	}
	if e = database.RunMigrations(db, database.MigrationFiles); e != nil {
		t.Fatal(e)
	}
	db, e = database.Open(path)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewInterpretationRepository(db)
}
func TestSnapshotExportImport(t *testing.T) {
	ctx := context.Background()
	repo := snapshotTestDB(t)
	_, e := repo.db.ExecContext(ctx, `INSERT INTO interpretations(id,project_id,name,description) VALUES('i','source','test','')`)
	if e != nil {
		t.Fatal(e)
	}
	_, e = repo.db.ExecContext(ctx, `INSERT INTO revisions(id,interpretation_id,version,schema_json) VALUES('rev','i',1,'{"fields":[]}')`)
	if e != nil {
		t.Fatal(e)
	}
	_, e = repo.db.ExecContext(ctx, `INSERT INTO analysis_runs(id,revision_id,assembly_id,status,project_id,capture_id,settings_version,summary_json,request_json,input_manifest_json) VALUES('run','rev','a-old','completed','source','c-old','s-old','{}','{}','{"assemblyId":"a-old","captureId":"c-old","settingsVersion":"s-old","ranges":[{"streamId":"stream-old"}]}')`)
	if e != nil {
		t.Fatal(e)
	}
	_, e = repo.db.ExecContext(ctx, `INSERT INTO analysis_results(id,run_id,result_json) VALUES('result','run','{"sourceSpan":{"streamId":"stream-old","assemblyId":"a-old"}}')`)
	if e != nil {
		t.Fatal(e)
	}
	snap, e := repo.ExportSnapshot(ctx, "source")
	if e != nil {
		t.Fatal(e)
	}
	if len(snap.Interpretations) != 1 || len(snap.Revisions) != 1 || len(snap.Runs) != 1 || len(snap.Results) != 1 {
		t.Fatalf("unexpected snapshot: %+v", snap)
	}
	dest := snapshotTestDB(t)
	if e = dest.ImportSnapshot(ctx, "target", snap, map[string]string{"c-old": "c-new"}, map[string]string{"a-old": "a-new"}, map[string]string{"stream-old": "stream-new"}, map[string]string{"s-old": "s-new"}, "import-1", "sha256"); e != nil {
		t.Fatal(e)
	}
	restored, e := dest.ExportSnapshot(ctx, "target")
	if e != nil {
		t.Fatal(e)
	}
	if len(restored.Runs) != 1 || restored.Runs[0].AssemblyID != "a-new" || restored.Runs[0].SettingsVersion != "s-new" {
		t.Fatalf("incorrect remap: %+v", restored.Runs)
	}
	if restored.Results[0].ResultJSON != `{"sourceSpan":{"assemblyId":"a-new","streamId":"stream-new"}}` {
		t.Fatalf("result SourceMap not remapped: %s", restored.Results[0].ResultJSON)
	}
	if e = dest.ImportSnapshot(ctx, "target", snap, map[string]string{"c-old": "c-new"}, map[string]string{"a-old": "a-new"}, map[string]string{"stream-old": "stream-new"}, map[string]string{"s-old": "s-new"}, "import-2", "sha256"); e == nil {
		t.Fatal("expected destination conflict")
	}
}
func TestRemapJSONRejectsUnmappedReferences(t *testing.T) {
	_, e := remapJSON(`{"sourceSpan":{"streamId":"old","assemblyId":"a"}}`, nil, nil, nil, nil)
	if e == nil {
		t.Fatal("expected missing ID map error")
	}
	got, e := remapJSON(`{"sourceSpan":{"streamId":"old","assemblyId":"a"}}`, nil, map[string]string{"a": "b"}, map[string]string{"old": "new"}, nil)
	if e != nil {
		t.Fatal(e)
	}
	if got != `{"sourceSpan":{"assemblyId":"b","streamId":"new"}}` {
		t.Fatalf("unexpected JSON: %s", got)
	}
}
