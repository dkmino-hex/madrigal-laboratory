package api_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/platform/database"
	"github.com/dkmino-hex/madrigal-laboratory/platform/testdatabase"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/inbound/http"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/filestore"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/pcap"
	capturestorage "github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/workspacehttp"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
	workspaceapi "github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/bootstrap"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/migrations"
)

func requestJSON(t *testing.T, handler http.Handler, method, path string, body io.Reader, want int) map[string]any {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s %s: HTTP %d: %s", method, path, rec.Code, rec.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestDay2CaptureAPIOnReferenceCorpus(t *testing.T) {
	ctx := context.Background()
	wdb, err := database.Open(ctx, testdatabase.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer wdb.Close()
	if err := database.Apply(ctx, wdb, "workspace", migrations.Files); err != nil {
		t.Fatal(err)
	}
	project, err := createWorkspaceProject(t, workspaceapi.New(wdb), "Day two", "create-day2")
	if err != nil {
		t.Fatal(err)
	}
	workspace := httptest.NewServer(workspaceapi.New(wdb))
	defer workspace.Close()
	initial := requestJSON(t, workspaceapi.New(wdb), "GET", "/internal/v1/projects/"+project.ID+"/context?settingsVersion=current", nil, 200)
	if initial["settingsVersion"] != *project.SettingsVersion {
		t.Fatal("initial settings context mismatch")
	}
	cdb, err := capturestorage.Open(ctx, testdatabase.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer cdb.Close()
	files, err := originals.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := captures.Store{Repository: capturestorage.Store{DB: cdb}, Files: files, Projects: workspacehttp.Client{URL: workspace.URL}, ReadCapture: pcap.ReadCaptureContext}
	handler := api.New(store)
	base := "/api/v1/projects/" + project.ID
	requestJSON(t, handler, "GET", "/healthz", nil, 200)
	requestJSON(t, handler, "GET", "/readyz", nil, 200)
	corpus, err := filepath.Glob("../../../../../../testdata/sample_protocol/**/*.pcap*")
	if err != nil {
		t.Fatal(err)
	}
	if len(corpus) == 0 {
		t.Fatal("reference corpus missing")
	}
	if len(corpus) != 12 {
		t.Fatalf("expected 12 PCAP fixtures, got %d", len(corpus))
	}
	var captureID, assemblyID, streamID string
	for _, path := range corpus {
		input, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var form bytes.Buffer
		part := multipart.NewWriter(&form)
		file, err := part.CreateFormFile("file", filepath.Base(path))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(input); err != nil {
			t.Fatal(err)
		}
		if err := part.Close(); err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", base+"/captures", &form)
		req.Header.Set("Content-Type", part.FormDataContentType())
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != 202 {
			t.Fatalf("upload %s: HTTP %d %s", path, rec.Code, rec.Body.String())
		}
		var response map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		job, err := store.Jobs().Claim(ctx, []string{captures.ImportKind})
		if err != nil {
			t.Fatal(err)
		}
		if err := store.ImportJob(ctx, job, func(stage string, completed int64, total *int64) error {
			return store.Jobs().Progress(ctx, job.ID, stage, completed, total)
		}); err != nil {
			t.Fatalf("import %s: %v", path, err)
		}
		id := response["captureId"].(string)
		items := requestJSON(t, handler, "GET", base+"/captures/"+id+"/assemblies", nil, 200)["items"].([]any)
		if len(items) != 1 || items[0].(map[string]any)["status"] != "READY" {
			t.Fatalf("assemblies %s: %v", path, items)
		}
		requestJSON(t, handler, "GET", base+"/captures/"+id+"/packets/1", nil, 200)
		assembly := items[0].(map[string]any)["assemblyId"].(string)
		checkCount := func(query string, args ...any) int {
			t.Helper()
			var n int
			if err := cdb.QueryRowContext(ctx, query, args...).Scan(&n); err != nil {
				t.Fatal(err)
			}
			return n
		}
		if strings.Contains(path, "missing_segment") && checkCount("SELECT COUNT(*) FROM stream_intervals WHERE assembly_id=?1 AND kind='GAP'", assembly) == 0 {
			t.Fatal("missing segment was not marked GAP")
		}
		if strings.Contains(path, "missing_beginning") && checkCount("SELECT COUNT(*) FROM streams WHERE assembly_id=?1 AND known_start=0", assembly) == 0 {
			t.Fatal("unknown stream beginning was lost")
		}
		if strings.Contains(path, "snaplen_truncated") && checkCount("SELECT COUNT(*) FROM packets WHERE capture_id=?1 AND captured_length<original_length", id) == 0 {
			t.Fatal("truncation was lost")
		}
		if strings.Contains(path, "checksum_offload") && checkCount("SELECT COUNT(*) FROM packets WHERE capture_id=?1 AND checksum_status='OFFLOADED'", id) == 0 {
			var statuses string
			cdb.QueryRowContext(ctx, "SELECT group_concat(checksum_status) FROM packets WHERE capture_id=?1", id).Scan(&statuses)
			t.Fatalf("offload candidate was not marked: %s", statuses)
		}
		if strings.Contains(path, "bad_checksum") && checkCount("SELECT COUNT(*) FROM packets WHERE capture_id=?1 AND checksum_status='INVALID'", id) == 0 {
			t.Fatal("invalid TCP checksum was not marked")
		}
		if strings.Contains(path, "conflicting_overlap") {
			found := false
			sessions := requestJSON(t, handler, "GET", base+"/sessions?assemblyId="+items[0].(map[string]any)["assemblyId"].(string), nil, 200)["items"].([]any)
			for _, s := range sessions {
				detail := requestJSON(t, handler, "GET", base+"/sessions/"+s.(map[string]any)["sessionId"].(string)+"?assemblyId="+items[0].(map[string]any)["assemblyId"].(string), nil, 200)
				for _, stream := range detail["streams"].([]any) {
					sid := stream.(map[string]any)["streamId"].(string)
					result := requestJSON(t, handler, "GET", base+"/streams/"+sid+"/bytes?assemblyId="+items[0].(map[string]any)["assemblyId"].(string)+"&length=1024", nil, 200)
					for _, iv := range result["intervals"].([]any) {
						if iv.(map[string]any)["kind"] == "CONFLICT" {
							found = true
						}
					}
				}
			}
			if !found {
				t.Fatal("conflict interval missing")
			}
		}
		if strings.Contains(path, "01_configuration.pcap") {
			captureID = id
			assemblyID = items[0].(map[string]any)["assemblyId"].(string)
		}
	}
	if captureID == "" {
		t.Fatal("baseline missing")
	}
	page := requestJSON(t, handler, "GET", base+"/captures?limit=1", nil, 200)
	if len(page["items"].([]any)) != 1 || page["nextCursor"] == "" {
		t.Fatalf("capture pagination: %v", page)
	}
	baseline, err := os.ReadFile("../../../../../../testdata/sample_protocol/research/01_configuration.pcap")
	if err != nil {
		t.Fatal(err)
	}
	var duplicateForm bytes.Buffer
	duplicateWriter := multipart.NewWriter(&duplicateForm)
	duplicatePart, err := duplicateWriter.CreateFormFile("file", "same-bytes-other-name.pcap")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := duplicatePart.Write(baseline); err != nil {
		t.Fatal(err)
	}
	if err := duplicateWriter.Close(); err != nil {
		t.Fatal(err)
	}
	duplicateRequest := httptest.NewRequest("POST", base+"/captures", &duplicateForm)
	duplicateRequest.Header.Set("Content-Type", duplicateWriter.FormDataContentType())
	duplicateResponse := httptest.NewRecorder()
	handler.ServeHTTP(duplicateResponse, duplicateRequest)
	if duplicateResponse.Code != 202 {
		t.Fatalf("duplicate upload: %d %s", duplicateResponse.Code, duplicateResponse.Body.String())
	}
	var duplicate map[string]any
	if err := json.Unmarshal(duplicateResponse.Body.Bytes(), &duplicate); err != nil {
		t.Fatal(err)
	}
	if duplicate["duplicate"] != true || duplicate["captureId"] != captureID {
		t.Fatalf("duplicate mismatch: %v", duplicate)
	}
	list := requestJSON(t, handler, "GET", base+"/sessions?assemblyId="+assemblyID, nil, 200)["items"].([]any)
	requestJSON(t, handler, "GET", base+"/sessions?port=invalid", nil, 400)
	requestJSON(t, handler, "GET", base+"/sessions?from=invalid", nil, 400)
	if len(list) != 2 {
		t.Fatalf("baseline sessions: %d", len(list))
	}
	session := list[0].(map[string]any)["sessionId"].(string)
	detail := requestJSON(t, handler, "GET", base+"/sessions/"+session+"?assemblyId="+assemblyID, nil, 200)
	streams := detail["streams"].([]any)
	streamID = streams[0].(map[string]any)["streamId"].(string)
	requestJSON(t, handler, "GET", base+"/streams/"+streamID+"/bytes?assemblyId="+assemblyID+"&offset=0&length=64", nil, 200)
	requestJSON(t, handler, "GET", base+"/streams/"+streamID+"/sources?assemblyId="+assemblyID+"&offset=0&length=64", nil, 200)
	foundField := false
	for _, candidate := range streams {
		sid := candidate.(map[string]any)["streamId"].(string)
		result := requestJSON(t, handler, "GET", base+"/streams/"+sid+"/sources?assemblyId="+assemblyID+"&offset=2&length=2", nil, 200)
		spans := result["sources"].([]any)
		var packet4, packet6 bool
		for _, entry := range spans {
			span := entry.(map[string]any)
			if span["packetNo"] == float64(4) && span["frameStart"] == float64(56) && span["frameEnd"] == float64(57) {
				packet4 = true
			}
			if span["packetNo"] == float64(6) && span["frameStart"] == float64(54) && span["frameEnd"] == float64(55) {
				packet6 = true
			}
		}
		if packet4 && packet6 {
			foundField = true
			streamID = sid
		}
	}
	if !foundField {
		t.Fatal("cross-packet SourceMap did not preserve exact frame offsets")
	}
	patch := httptest.NewRequest("PATCH", "/api/v1/projects/"+project.ID+"/settings", strings.NewReader(`{"settings":{"tcp":{"overlapPolicy":"report"}}}`))
	patch.Header.Set("Content-Type", "application/json")
	patch.Header.Set("Idempotency-Key", "day2-settings")
	patchResponse := httptest.NewRecorder()
	workspaceapi.New(wdb).ServeHTTP(patchResponse, patch)
	if patchResponse.Code != 200 {
		t.Fatalf("settings PATCH: %d %s", patchResponse.Code, patchResponse.Body.String())
	}
	var settings map[string]any
	if err := json.Unmarshal(patchResponse.Body.Bytes(), &settings); err != nil {
		t.Fatal(err)
	}
	old := requestJSON(t, workspaceapi.New(wdb), "GET", "/internal/v1/projects/"+project.ID+"/context?settingsVersion="+*project.SettingsVersion, nil, 200)
	if old["settingsVersion"] != *project.SettingsVersion {
		t.Fatal("old settings version changed")
	}
	assemblyRequest := `{"settingsVersion":"` + settings["settingsVersion"].(string) + `"}`
	created := requestJSON(t, handler, "POST", base+"/captures/"+captureID+"/assemblies", strings.NewReader(assemblyRequest), 202)
	job, err := store.Jobs().Claim(ctx, []string{captures.AssembleKind})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AssembleJob(ctx, job, func(stage string, completed int64, total *int64) error {
		return store.Jobs().Progress(ctx, job.ID, stage, completed, total)
	}); err != nil {
		t.Fatal(err)
	}
	items := requestJSON(t, handler, "GET", base+"/captures/"+captureID+"/assemblies", nil, 200)["items"].([]any)
	if len(items) != 2 || created["assemblyId"] == assemblyID {
		t.Fatalf("versioned assemblies: %v", items)
	}
	requestJSON(t, handler, "GET", base+"/streams/"+streamID+"/sources?assemblyId="+assemblyID+"&offset=2&length=2", nil, 200)
	viewBody := `{"ranges":[{"assemblyId":"` + assemblyID + `","streamId":"` + streamID + `","offset":0,"length":1}]}`
	view := requestJSON(t, handler, "POST", "/internal/v1/projects/"+project.ID+"/assembly-views", strings.NewReader(viewBody), 201)
	data := requestJSON(t, handler, "GET", "/internal/v1/assembly-views/"+view["viewId"].(string)+"/data", nil, 200)
	if len(data["blocks"].([]any)) != 1 {
		t.Fatal("view data missing")
	}
	var known []byte
	if err := cdb.QueryRowContext(ctx, "SELECT data FROM stream_intervals WHERE stream_id=?1 AND kind='DATA' AND length(data)>=3 ORDER BY start_offset LIMIT 1", streamID).Scan(&known); err != nil {
		t.Fatal(err)
	}
	search := requestJSON(t, handler, "GET", base+"/streams/"+streamID+"/search?assemblyId="+assemblyID+"&mode=HEX&pattern="+hex.EncodeToString(known[:3])+"&limit=1", nil, 200)
	if len(search["items"].([]any)) != 1 {
		t.Fatalf("search result: %v", search)
	}
	requestJSON(t, handler, "GET", base+"/streams/"+streamID+"/search?assemblyId="+assemblyID+"&mode=HEX&pattern=0", nil, 400)
	snapshot := requestJSON(t, handler, "POST", "/internal/v1/projects/"+project.ID+"/snapshots", strings.NewReader(`{}`), 201)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("GET", "/internal/v1/snapshots/"+snapshot["snapshotId"].(string)+"/archive", nil))
	if rec.Code != 200 {
		t.Fatalf("capture archive: %d %s", rec.Code, rec.Body.String())
	}
	z, e := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if e != nil {
		t.Fatal(e)
	}
	foundManifest, foundOriginal := false, false
	for _, f := range z.File {
		if f.Name == "manifest.json" {
			foundManifest = true
		}
		if strings.HasPrefix(f.Name, "originals/") {
			foundOriginal = true
		}
	}
	if !foundManifest || !foundOriginal {
		t.Fatal("capture archive omitted manifest or original")
	}
	restoredProject, err := createWorkspaceProject(t, workspaceapi.New(wdb), "Restored", "restore-project")
	if err != nil {
		t.Fatal(err)
	}
	restorePath := "/internal/v1/projects/" + restoredProject.ID + "/imports/test-import"
	first := requestJSON(t, handler, "PUT", restorePath, bytes.NewReader(rec.Body.Bytes()), 200)
	second := requestJSON(t, handler, "PUT", restorePath, bytes.NewReader(rec.Body.Bytes()), 200)
	if first["status"] != "READY" || first["captureIds"].(map[string]any)[captureID] != second["captureIds"].(map[string]any)[captureID] {
		t.Fatalf("restore not idempotent: %v %v", first, second)
	}
	restoredCapture := first["captureIds"].(map[string]any)[captureID].(string)
	requestJSON(t, handler, "GET", "/api/v1/projects/"+restoredProject.ID+"/captures/"+restoredCapture+"/packets/1", nil, 200)
	for _, kind := range []string{"CONFLICT", "GAP"} {
		var before, after int
		query := `SELECT COUNT(*) FROM stream_intervals i JOIN assemblies a ON a.id=i.assembly_id WHERE a.project_id=?1 AND i.kind=?2`
		if err = cdb.QueryRowContext(ctx, query, project.ID, kind).Scan(&before); err != nil {
			t.Fatal(err)
		}
		if err = cdb.QueryRowContext(ctx, query, restoredProject.ID, kind).Scan(&after); err != nil {
			t.Fatal(err)
		}
		if before == 0 || after != before {
			t.Fatalf("%s intervals changed: %d to %d", kind, before, after)
		}
	}
	var originalSources, restoredSources int
	sourceCount := `SELECT COUNT(*) FROM source_spans ss JOIN stream_intervals i ON i.id=ss.interval_id JOIN assemblies a ON a.id=i.assembly_id WHERE a.project_id=?1`
	if err = cdb.QueryRowContext(ctx, sourceCount, project.ID).Scan(&originalSources); err != nil {
		t.Fatal(err)
	}
	if err = cdb.QueryRowContext(ctx, sourceCount, restoredProject.ID).Scan(&restoredSources); err != nil {
		t.Fatal(err)
	}
	if originalSources == 0 || originalSources != restoredSources {
		t.Fatalf("SourceMap changed: %d to %d", originalSources, restoredSources)
	}
	captureServer := httptest.NewServer(handler)
	defer captureServer.Close()
	t.Setenv("CAPTURE_INTERNAL_URL", captureServer.URL)
	var captureSHA string
	if err = cdb.QueryRowContext(ctx, "SELECT sha256 FROM captures WHERE id=?1", captureID).Scan(&captureSHA); err != nil {
		t.Fatal(err)
	}
	validEvidence := map[string]any{"kind": "OBSERVATION", "text": "Source-backed byte", "evidence": []map[string]any{{"kind": "SUPPORT", "captureId": captureID, "captureSha256": captureSHA, "packetNo": 4, "frameOffset": 56, "byteLength": 1, "assemblyId": assemblyID, "streamId": streamID, "streamOffset": 2}}}
	body, err := json.Marshal(validEvidence)
	if err != nil {
		t.Fatal(err)
	}
	validation, err := json.Marshal(map[string]any{"evidence": validEvidence["evidence"]})
	if err != nil {
		t.Fatal(err)
	}
	requestJSON(t, handler, "POST", "/internal/v1/projects/"+project.ID+"/evidence/validate", bytes.NewReader(validation), 200)
	badRange := map[string]any{"evidence": []map[string]any{{"captureSha256": captureSHA, "packetNo": 999999, "frameOffset": 0, "byteLength": 1}}}
	invalidBytes, err := json.Marshal(badRange)
	if err != nil {
		t.Fatal(err)
	}
	requestJSON(t, handler, "POST", "/internal/v1/projects/"+project.ID+"/evidence/validate", bytes.NewReader(invalidBytes), 400)
	requestJSON(t, workspaceapi.New(wdb), "POST", "/api/v1/projects/"+project.ID+"/observations", bytes.NewReader(body), 201)
	requestJSON(t, workspaceapi.New(wdb), "POST", "/api/v1/projects/"+restoredProject.ID+"/observations", bytes.NewReader(body), 400)
	if _, err = wdb.ExecContext(ctx, "UPDATE projects SET status='IMPORTING' WHERE id=?1", restoredProject.ID); err != nil {
		t.Fatal(err)
	}
	requestJSON(t, handler, "GET", "/api/v1/projects/"+restoredProject.ID+"/captures/"+restoredCapture+"/packets/1", nil, 409)
	if _, err = wdb.ExecContext(ctx, "UPDATE projects SET status='READY' WHERE id=?1", restoredProject.ID); err != nil {
		t.Fatal(err)
	}
}

func createWorkspaceProject(t *testing.T, handler http.Handler, name, key string) (struct {
	ID              string  `json:"projectId"`
	SettingsVersion *string `json:"settingsVersion"`
}, error) {
	t.Helper()
	var result struct {
		ID              string  `json:"projectId"`
		SettingsVersion *string `json:"settingsVersion"`
	}
	body, err := json.Marshal(map[string]any{"name": name})
	if err != nil {
		return result, err
	}
	req := httptest.NewRequest("POST", "/api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != 201 {
		t.Fatalf("create workspace project: %d %s", response.Code, response.Body.String())
	}
	err = json.Unmarshal(response.Body.Bytes(), &result)
	return result, err
}
