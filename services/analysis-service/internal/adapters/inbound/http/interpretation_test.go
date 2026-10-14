package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/application/analysis"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/migrations"
)

func testRouter(t *testing.T) *http.ServeMux {
	t.Helper()
	path := filepath.Join(t.TempDir(), "analysis.db")
	migrationDB, err := storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := storage.RunMigrations(migrationDB, migrations.Files); err != nil {
		t.Fatal(err)
	}
	db, err := storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	h := NewInterpretationHandler(service.NewInterpretationService(storage.NewInterpretationRepository(db)))
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/projects/{projectId}/interpretations", h.Create)
	mux.HandleFunc("GET /api/v1/projects/{projectId}/interpretations", h.List)
	mux.HandleFunc("POST /api/v1/projects/{projectId}/interpretations/{interpretationId}/revisions", h.CreateRevision)
	mux.HandleFunc("GET /api/v1/projects/{projectId}/interpretations/{interpretationId}/revisions", h.ListRevisions)
	mux.HandleFunc("GET /api/v1/projects/{projectId}/interpretations/{interpretationId}/revisions/{revisionId}", h.GetRevision)
	return mux
}
func request(t *testing.T, router http.Handler, method, path, body string, status int) map[string]any {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != status {
		t.Fatalf("%s %s: want %d, got %d: %s", method, path, status, rec.Code, rec.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}
func TestInterpretationsAndRevisions(t *testing.T) {
	router := testRouter(t)
	base := "/api/v1/projects/project-a/interpretations"
	created := request(t, router, "POST", base, `{"name":"Parser","revision":{"fields":[]}}`, 201)
	id := created["interpretationId"].(string)
	if created["currentRevisionId"] == "" {
		t.Fatal("missing currentRevisionId")
	}
	if created["createdAt"] == "0001-01-01T00:00:00Z" {
		t.Fatal("zero createdAt")
	}
	listed := request(t, router, "GET", base, "", 200)
	if len(listed["items"].([]any)) != 1 {
		t.Fatalf("expected one interpretation: %v", listed)
	}
	other := request(t, router, "GET", "/api/v1/projects/project-b/interpretations", "", 200)
	if len(other["items"].([]any)) != 0 {
		t.Fatal("project isolation failed")
	}
	revPath := base + "/" + id + "/revisions"
	second := request(t, router, "POST", revPath, `{"revision":{"fields":[{"name":"a","type":"uint8"}]}}`, 201)
	if second["version"] != float64(2) {
		t.Fatalf("want version 2: %v", second)
	}
	third := request(t, router, "POST", revPath, `{"revision":{"fields":[]}}`, 201)
	if third["version"] != float64(3) {
		t.Fatalf("want version 3: %v", third)
	}
	revs := request(t, router, "GET", revPath+"?limit=2", "", 200)
	if len(revs["items"].([]any)) != 2 {
		t.Fatal("expected 2 revisions")
	}
	next := revs["page"].(map[string]any)["nextCursor"].(string)
	last := request(t, router, "GET", revPath+"?limit=2&cursor="+next, "", 200)
	if len(last["items"].([]any)) != 1 {
		t.Fatal("expected final revision")
	}
	retrieved := request(t, router, "GET", revPath+"/"+second["revisionId"].(string), "", 200)
	if retrieved["version"] != float64(2) {
		t.Fatal("wrong revision")
	}
	request(t, router, "GET", "/api/v1/projects/project-b/interpretations/"+id+"/revisions", "", 404)
	request(t, router, "GET", revPath+"/missing", "", 404)
	request(t, router, "POST", revPath, `{"revision":{"checks":[]}}`, 400)
	request(t, router, "POST", base+"/missing/revisions", `{"revision":{"fields":[]}}`, 404)
}
