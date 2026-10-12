package testdatabase

import (
	"path/filepath"
	"testing"
)

func New(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "test.sqlite")
}

func Bind(query string) string { return query }
