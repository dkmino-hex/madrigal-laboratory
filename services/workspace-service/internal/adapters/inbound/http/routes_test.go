package api_test

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/platform/testdatabase"
	workspace "github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/bootstrap"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/application/projects"
)

func TestWorkspaceHTTPRoutes(t *testing.T) {
	ctx := context.Background()
	db, err := storage.Open(ctx, testdatabase.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	handler := workspace.New(db)
	store := projects.Store{Repository: storage.Store{DB: db}}
	call := func(method, path, contentType string, body io.Reader, want int) map[string]any {
		t.Helper()
		request := httptest.NewRequest(method, path, body)
		request.Header.Set("Content-Type", contentType)
		request.Header.Set("Idempotency-Key", "http-route-check")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s %s: want %d, got %d: %s", method, path, want, response.Code, response.Body.String())
		}
		if response.Header().Get("X-Request-ID") == "" {
			t.Fatalf("%s %s: request ID is missing", method, path)
		}
		var result map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	jsonCall := func(method, path, body string, want int) map[string]any {
		t.Helper()
		return call(method, path, "application/json", strings.NewReader(body), want)
	}
	upload := func(path, filename string, content []byte, want int) map[string]any {
		t.Helper()
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, err := form.CreateFormFile("file", filename)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatal(err)
		}
		if err := form.Close(); err != nil {
			t.Fatal(err)
		}
		return call("POST", path, form.FormDataContentType(), &body, want)
	}
	jsonCall("GET", "/healthz", "", 200)
	jsonCall("GET", "/readyz", "", 200)
	created := jsonCall("POST", "/api/v1/projects", `{"name":"HTTP route check"}`, 201)
	projectID := created["projectId"].(string)
	base := "/api/v1/projects/" + projectID
	jsonCall("GET", "/api/v1/projects?limit=1", "", 200)
	jsonCall("GET", base, "", 200)
	settings := jsonCall("PATCH", base+"/settings", `{"settings":{"tcp":{"overlapPolicy":"report"}}}`, 200)
	jsonCall("GET", "/internal/v1/projects/"+projectID+"/context?settingsVersion="+settings["settingsVersion"].(string), "", 200)

	csv := "capture,session,action_id,start_utc,end_utc,action,parameters,observed_result\n" +
		"sample.pcap,s1,a1,2026-10-14T12:00:00Z,2026-10-14T12:00:01Z,configure,{},{}\n"
	journal := upload(base+"/action-log", "journal.csv", []byte(csv), 202)
	job, err := store.Jobs().Claim(ctx, []string{projects.JournalKind})
	if err != nil || job.ID != journal["jobId"] {
		t.Fatalf("journal job: %+v %v", job, err)
	}
	if err := store.ImportJournal(ctx, job, func(stage string, n int64, total *int64) error {
		return store.Jobs().Progress(ctx, job.ID, stage, n, total)
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Jobs().Finish(ctx, job.ID, "SUCCEEDED", nil); err != nil {
		t.Fatal(err)
	}
	actions := jsonCall("GET", base+"/actions?type=configure&from=2026-10-14T11:00:00Z", "", 200)
	if len(actions["items"].([]any)) != 1 {
		t.Fatalf("imported action missing: %v", actions)
	}
	observation := jsonCall("POST", base+"/observations", `{"kind":"HYPOTHESIS","text":"Configuration changes the payload"}`, 201)
	observationID := observation["observationId"].(string)
	jsonCall("GET", base+"/observations?kind=HYPOTHESIS&status=DRAFT", "", 200)
	patched := jsonCall("PATCH", base+"/observations/"+observationID, `{"text":"Revised hypothesis","status":"INCONCLUSIVE","selectedEvidenceIds":[]}`, 200)
	if patched["text"] != "Revised hypothesis" || patched["status"] != "INCONCLUSIVE" {
		t.Fatalf("observation patch lost: %v", patched)
	}
	report := jsonCall("POST", base+"/reports", `{"runId":"run_http"}`, 202)
	reportJobID := report["jobId"].(string)
	jsonCall("GET", "/api/v1/jobs/"+reportJobID, "", 200)
	cancelled := jsonCall("POST", "/api/v1/jobs/"+reportJobID+"/cancel", "{}", 200)
	if cancelled["status"] != "CANCELLED" {
		t.Fatalf("queued job was not cancelled: %v", cancelled)
	}
	jsonCall("GET", "/api/v1/artifacts/"+report["artifactId"].(string), "", 409)
	jsonCall("GET", "/api/v1/artifacts/missing", "", 404)
	exported := jsonCall("POST", base+"/exports", "{}", 202)
	jsonCall("POST", "/api/v1/jobs/"+exported["jobId"].(string)+"/cancel", "{}", 200)
	jsonCall("POST", "/internal/v1/projects/"+projectID+"/snapshots", "{}", 201)

	snapshot, err := store.CreateSnapshot(ctx, projectID)
	if err != nil {
		t.Fatal(err)
	}
	archive := workspaceUploadArchive(t, snapshot)
	imported := upload("/api/v1/projects/import", "project.zip", archive, 202)
	card := jsonCall("GET", "/api/v1/projects/"+imported["projectId"].(string), "", 200)
	if card["status"] != "IMPORTING" {
		t.Fatalf("incomplete import appeared ready: %v", card)
	}
	jsonCall("POST", "/api/v1/jobs/"+imported["jobId"].(string)+"/cancel", "{}", 200)
	for _, check := range []struct{ method, path, body string }{
		{"PATCH", base + "/settings", `{"settings":null}`},
		{"GET", base + "/actions?from=invalid", ""},
		{"GET", base + "/observations?kind=invalid", ""},
		{"PATCH", base + "/observations/" + observationID, `{"selectedEvidenceIds":["missing"]}`},
		{"POST", base + "/reports", `{"runId":"bad run"}`},
	} {
		jsonCall(check.method, check.path, check.body, 400)
	}
	upload("/api/v1/projects/import", "broken.zip", []byte("broken"), 400)
	jsonCall("GET", "/api/v1/jobs/cap_wrong_owner", "", 404)
	jsonCall("GET", "/api/v1/unknown", "", 404)
}

func workspaceUploadArchive(t *testing.T, snapshot projects.Snapshot) []byte {
	t.Helper()
	var empty bytes.Buffer
	if err := zip.NewWriter(&empty).Close(); err != nil {
		t.Fatal(err)
	}
	parts := map[string][]byte{
		"workspace.json": snapshot.Metadata, "workspace-manifest.json": snapshot.Manifest,
		"capture.zip": empty.Bytes(), "analysis.zip": empty.Bytes(),
	}
	hashes := map[string]string{}
	for name, body := range parts {
		hash := sha256.Sum256(body)
		hashes[name] = hex.EncodeToString(hash[:])
	}
	manifest, err := json.Marshal(map[string]any{
		"version": 1, "projectId": snapshot.ProjectID, "workspaceSnapshotId": snapshot.ID,
		"captureSnapshotId": "capture_snapshot", "analysisSnapshotId": "analysis_snapshot", "files": hashes,
	})
	if err != nil {
		t.Fatal(err)
	}
	parts["manifest.json"] = manifest
	var body bytes.Buffer
	archive := zip.NewWriter(&body)
	for name, content := range parts {
		entry, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return body.Bytes()
}
