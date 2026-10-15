package storage

import (
	"context"
	"testing"
)

func TestRunBecomesHistoricalWhenInterpretationChanges(t *testing.T) {
	repo := snapshotTestDB(t)
	ctx := context.Background()
	for _, sql := range []string{
		`INSERT INTO interpretations(id,project_id,name,description) VALUES('i','p','schema','')`,
		`INSERT INTO revisions(id,interpretation_id,version,schema_json) VALUES('v1','i',1,'{"fields":[]}')`,
		`INSERT INTO analysis_runs(id,revision_id,assembly_id,status,project_id) VALUES('run','v1','a','completed','p')`,
	} {
		if _, err := repo.db.ExecContext(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	before, err := repo.GetRun(ctx, "p", "run")
	if err != nil {
		t.Fatal(err)
	}
	if before.Historical {
		t.Fatal("latest revision reported historical")
	}
	if _, err = repo.db.ExecContext(ctx, `INSERT INTO revisions(id,interpretation_id,version,schema_json) VALUES('v2','i',2,'{"fields":[]}')`); err != nil {
		t.Fatal(err)
	}
	after, err := repo.GetRun(ctx, "p", "run")
	if err != nil {
		t.Fatal(err)
	}
	if !after.Historical || after.RevisionID != "v1" {
		t.Fatalf("incorrect pinned history: %+v", after)
	}
}
