package main

import (
	"bytes"
	"github.com/dkmino-hex/madrigal-laboratory/internal/testdatabase"
	"os"
	"strings"
	"testing"
)

func TestMigrateCLI(t *testing.T) {
	workspacePath, capturePath := testdatabase.New(t), testdatabase.New(t)
	for _, action := range []string{"up", "up", "status"} {
		var output bytes.Buffer
		if err := run([]string{"-workspace-db", workspacePath, "-capture-db", capturePath, "-action", action}, &output); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(output.String(), "pending") || !strings.Contains(output.String(), "SQLite") || !strings.Contains(output.String(), "0005_job_stages.sql") {
			t.Fatalf("unexpected status: %s", output.String())
		}
	}
}

func TestMigrateRejectsAmbiguousOrInvalidFlags(t *testing.T) {
	for _, args := range [][]string{{"-db", "shared.sqlite"}, {"-service", "analysis"}, {"-action", "down"}, {"extra"}} {
		var output bytes.Buffer
		if err := run(args, &output); err == nil {
			t.Fatalf("accepted %v", args)
		}
	}
}

func TestMigrateDefaultsWithoutServer(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("WORKSPACE_DB_PATH", "")
	t.Setenv("CAPTURE_DB_PATH", "")
	var output bytes.Buffer
	if err := run(nil, &output); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"data/workspace/workspace.sqlite", "data/capture/capture.sqlite"} {
		if _, err := os.Stat(path); err != nil {
			t.Fatal(err)
		}
	}
}
