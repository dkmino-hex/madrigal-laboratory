package api_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/platform/testdatabase"
	api "github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/bootstrap"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/adapters/outbound/peerhttp"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/application/projects"
)

func TestJournalImportSnapshotAndObservations(t *testing.T) {
	ctx := context.Background()
	db, err := storage.Open(ctx, testdatabase.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := projects.Store{Repository: storage.Store{DB: db}, Peers: peerhttp.Client{}}
	p, _, err := s.Create(ctx, projects.CreateInput{Name: "Research"}, "research-key")
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	cancelJob, err := s.Jobs().EnqueueTx(ctx, tx, p.ID, "TEST_CANCEL", nil, map[string]any{})
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	cancelResponse := httptest.NewRecorder()
	api.New(db).ServeHTTP(cancelResponse, httptest.NewRequest("POST", "/api/v1/jobs/"+cancelJob.ID+"/cancel", nil))
	if cancelResponse.Code != 200 || !strings.Contains(cancelResponse.Body.String(), `"status":"CANCELLED"`) {
		t.Fatalf("workspace cancellation: %d %s", cancelResponse.Code, cancelResponse.Body.String())
	}
	file, err := os.Open(filepath.Join("..", "..", "..", "..", "..", "..", "testdata", "sample_protocol", "action_journal.csv"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	imp, err := s.AcceptJournal(ctx, p.ID, projects.JournalInput{Name: "action_journal.csv", Timezone: "UTC"}, file)
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.Jobs().Claim(ctx, []string{projects.JournalKind})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ImportJournal(ctx, job, func(stage string, n int64, total *int64) error {
		return s.Jobs().Progress(ctx, job.ID, stage, n, total)
	}); err != nil {
		t.Fatal(err)
	}
	if err = s.Jobs().Finish(ctx, job.ID, "SUCCEEDED", nil); err != nil {
		t.Fatal(err)
	}
	badCSV := "capture,session,action_id,start_utc,end_utc,action,parameters,observed_result\nfile,s1,bad,invalid,invalid,read,{},{}\n"
	badImport, err := s.AcceptJournal(ctx, p.ID, projects.JournalInput{Name: "invalid.csv", Timezone: "UTC"}, strings.NewReader(badCSV))
	if err != nil {
		t.Fatal(err)
	}
	badJob, err := s.Jobs().Claim(ctx, []string{projects.JournalKind})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ImportJournal(ctx, badJob, func(stage string, n int64, total *int64) error {
		return s.Jobs().Progress(ctx, badJob.ID, stage, n, total)
	}); err != nil {
		t.Fatal(err)
	}
	if err = s.Jobs().Finish(ctx, badJob.ID, "SUCCEEDED", nil); err != nil {
		t.Fatal(err)
	}
	var diagnostics string
	if err = db.QueryRowContext(ctx, "SELECT diagnostics_json FROM journal_imports WHERE id=?1", badImport.ID).Scan(&diagnostics); err != nil || !strings.Contains(diagnostics, `"line":2`) {
		t.Fatalf("CSV diagnostics: %s %v", diagnostics, err)
	}
	page, err := s.Actions(ctx, p.ID, projects.ActionQuery{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	items := page["items"].([]map[string]any)
	if len(items) == 0 || page["incompleteImports"].(int) != 0 {
		t.Fatalf("actions: %+v", page)
	}
	firstPage, err := s.Actions(ctx, p.ID, projects.ActionQuery{Limit: 1})
	if err != nil || firstPage["nextCursor"] == "" {
		t.Fatalf("action pagination: %v %v", firstPage, err)
	}
	secondPage, err := s.Actions(ctx, p.ID, projects.ActionQuery{Limit: 1, Cursor: firstPage["nextCursor"].(string)})
	if err != nil || secondPage["items"].([]map[string]any)[0]["actionId"] == firstPage["items"].([]map[string]any)[0]["actionId"] {
		t.Fatalf("action cursor: %v %v", secondPage, err)
	}
	typed, err := s.Actions(ctx, p.ID, projects.ActionQuery{Limit: 100, Name: items[0]["name"].(string)})
	if err != nil || len(typed["items"].([]map[string]any)) == 0 {
		t.Fatalf("action filter: %v %v", typed, err)
	}
	var status string
	if err = db.QueryRowContext(ctx, "SELECT status FROM journal_imports WHERE id=?1", imp.ID).Scan(&status); err != nil || status != "READY" {
		t.Fatalf("import: %s %v", status, err)
	}
	observation, err := s.CreateObservation(ctx, p.ID, projects.ObservationInput{Kind: "HYPOTHESIS", Text: "Configuration change", ActionID: items[0]["actionId"].(string), Evidence: []projects.EvidenceInput{{Kind: "SUPPORT", CaptureID: "capture_fixture", CaptureSHA256: strings.Repeat("a", 64), PacketNo: 1, FrameOffset: 0, ByteLength: 1}}}, func(context.Context, string, projects.EvidenceInput) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := s.CreateSnapshot(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.UpdateSettings(ctx, p.ID, map[string]any{"tcp": "changed-after-snapshot"}, "later-settings"); err != nil {
		t.Fatal(err)
	}
	var retained []byte
	if err = db.QueryRowContext(ctx, "SELECT metadata_json FROM snapshots WHERE id=?1", snapshot.ID).Scan(&retained); err != nil || !bytes.Equal(retained, snapshot.Metadata) {
		t.Fatal("snapshot changed after settings update")
	}
	if !bytes.Contains(snapshot.Metadata, []byte(observation["observationId"].(string))) {
		t.Fatal("snapshot omitted observation")
	}
	if _, err = db.ExecContext(ctx, "UPDATE snapshots SET metadata_json='{}' WHERE id=?1", snapshot.ID); err == nil {
		t.Fatal("snapshot was mutable")
	}
	analysis := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/projects/"+p.ID+"/runs/run_1/results" {
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"items":[{"status":"FAIL","source":{"packetNo":1}}],"nextCursor":""}`)
			return
		}
		if r.URL.Path != "/api/v1/projects/"+p.ID+"/runs/run_1" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"runId":"run_1","status":"SUCCEEDED","summary":{"checked":12}}`)
	}))
	defer analysis.Close()
	t.Setenv("ANALYSIS_INTERNAL_URL", analysis.URL)
	report, err := s.RequestReport(ctx, p.ID, "run_1")
	if err != nil {
		t.Fatal(err)
	}
	reportJob, err := s.Jobs().Claim(ctx, []string{projects.ReportKind})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.BuildReport(ctx, reportJob, func(stage string, n int64, total *int64) error {
		return s.Jobs().Progress(ctx, reportJob.ID, stage, n, total)
	}); err != nil {
		t.Fatal(err)
	}
	if err = s.Jobs().Finish(ctx, reportJob.ID, "SUCCEEDED", nil); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	api.New(db).ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/artifacts/"+report["artifactId"].(string), nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Configuration change") || !strings.Contains(rec.Body.String(), "run_1") {
		t.Fatalf("report: %d %s", rec.Code, rec.Body.String())
	}
	var childArchive bytes.Buffer
	zw := zip.NewWriter(&childArchive)
	entry, err := zw.Create("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = entry.Write([]byte(`{"version":1}`)); err != nil {
		t.Fatal(err)
	}
	if err = zw.Close(); err != nil {
		t.Fatal(err)
	}
	var analysisAvailable atomic.Bool
	analysisAvailable.Store(true)
	var validatedEvidence atomic.Bool
	var evidenceAvailable atomic.Bool
	evidenceAvailable.Store(true)
	child := func(prefix string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case prefix == "capture" && r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/evidence/validate"):
				validatedEvidence.Store(true)
				if !evidenceAvailable.Load() {
					http.Error(w, "source missing", 400)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				io.WriteString(w, `{"valid":true}`)
			case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/snapshots"):
				w.Header().Set("Content-Type", "application/json")
				io.WriteString(w, `{"snapshotId":"`+prefix+`-snapshot"}`)
			case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/archive"):
				w.Write(childArchive.Bytes())
			case r.Method == "PUT" && strings.Contains(r.URL.Path, "/imports/"):
				if prefix == "analysis" && !analysisAvailable.Load() {
					http.Error(w, "temporarily unavailable", 503)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				io.WriteString(w, `{"status":"READY","captureIds":{},"assemblyIds":{},"streamIds":{}}`)
			default:
				http.NotFound(w, r)
			}
		}))
	}
	captureService := child("capture")
	defer captureService.Close()
	analysisService := child("analysis")
	defer analysisService.Close()
	t.Setenv("CAPTURE_INTERNAL_URL", captureService.URL)
	t.Setenv("ANALYSIS_INTERNAL_URL", analysisService.URL)
	export, err := s.RequestExport(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	var frozenExport []byte
	if err = db.QueryRowContext(ctx, "SELECT metadata_json FROM snapshots WHERE id=?1", export["snapshotId"]).Scan(&frozenExport); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.UpdateSettings(ctx, p.ID, map[string]any{"tcp": "changed-during-export"}, "export-edit"); err != nil {
		t.Fatal(err)
	}
	exportJob, err := s.Jobs().Claim(ctx, []string{projects.ExportKind})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.BuildExport(ctx, exportJob, func(stage string, n int64, total *int64) error {
		return s.Jobs().Progress(ctx, exportJob.ID, stage, n, total)
	}); err != nil {
		t.Fatal(err)
	}
	if err = s.Jobs().Finish(ctx, exportJob.ID, "SUCCEEDED", nil); err != nil {
		t.Fatal(err)
	}
	archiveResponse := httptest.NewRecorder()
	api.New(db).ServeHTTP(archiveResponse, httptest.NewRequest("GET", "/api/v1/artifacts/"+export["artifactId"].(string), nil))
	if archiveResponse.Code != 200 {
		t.Fatalf("export: %d %s", archiveResponse.Code, archiveResponse.Body.String())
	}
	zipReader, err := zip.NewReader(bytes.NewReader(archiveResponse.Body.Bytes()), int64(archiveResponse.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	frozenFound := false
	for _, entry := range zipReader.File {
		if entry.Name == "workspace.json" {
			reader, e := entry.Open()
			if e != nil {
				t.Fatal(e)
			}
			body, e := io.ReadAll(reader)
			reader.Close()
			if e != nil {
				t.Fatal(e)
			}
			if !bytes.Equal(body, frozenExport) {
				t.Fatal("export followed later settings instead of pinned snapshot")
			}
			frozenFound = true
		}
	}
	if !frozenFound {
		t.Fatal("workspace snapshot missing from export")
	}
	imported, err := s.AcceptProjectArchive(ctx, "test-import", bytes.NewReader(archiveResponse.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	importJob, err := s.Jobs().Claim(ctx, []string{projects.ProjectImportKind})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.RestoreProject(ctx, importJob, func(stage string, n int64, total *int64) error {
		return s.Jobs().Progress(ctx, importJob.ID, stage, n, total)
	}); err != nil {
		t.Fatal(err)
	}
	if err = s.Jobs().Finish(ctx, importJob.ID, "SUCCEEDED", nil); err != nil {
		t.Fatal(err)
	}
	if !validatedEvidence.Load() {
		t.Fatal("capture evidence was not revalidated")
	}
	newProject, err := s.Get(ctx, imported["projectId"].(string))
	if err != nil || newProject.Status != "READY" {
		t.Fatalf("restored project: %+v %v", newProject, err)
	}
	restoredActions, err := s.Actions(ctx, newProject.ID, projects.ActionQuery{Limit: 100})
	if err != nil || len(restoredActions["items"].([]map[string]any)) != len(items) {
		t.Fatalf("restored actions: %v %v", restoredActions, err)
	}
	var originalNS, restoredNS int64
	queryTime := "SELECT start_unix_ns FROM actions WHERE project_id=?1 AND source_action_id=?2"
	sourceAction := items[0]["sourceActionId"].(string)
	if err = db.QueryRowContext(ctx, queryTime, p.ID, sourceAction).Scan(&originalNS); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRowContext(ctx, queryTime, newProject.ID, sourceAction).Scan(&restoredNS); err != nil {
		t.Fatal(err)
	}
	if originalNS != restoredNS {
		t.Fatalf("nanosecond timestamp changed: %d to %d", originalNS, restoredNS)
	}
	broken := func(drop string, corrupt bool) []byte {
		t.Helper()
		input, e := zip.NewReader(bytes.NewReader(archiveResponse.Body.Bytes()), int64(archiveResponse.Body.Len()))
		if e != nil {
			t.Fatal(e)
		}
		var output bytes.Buffer
		writer := zip.NewWriter(&output)
		for _, part := range input.File {
			if part.Name == drop {
				continue
			}
			reader, e := part.Open()
			if e != nil {
				t.Fatal(e)
			}
			body, e := io.ReadAll(reader)
			reader.Close()
			if e != nil {
				t.Fatal(e)
			}
			if corrupt && part.Name == "capture.zip" {
				body = append(body, 0)
			}
			entry, e := writer.Create(part.Name)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = entry.Write(body); e != nil {
				t.Fatal(e)
			}
		}
		if drop == "../evil" {
			entry, e := writer.Create("../evil")
			if e != nil {
				t.Fatal(e)
			}
			if _, e = entry.Write([]byte("bad")); e != nil {
				t.Fatal(e)
			}
		}
		if e = writer.Close(); e != nil {
			t.Fatal(e)
		}
		return output.Bytes()
	}
	if _, err = s.AcceptProjectArchive(ctx, "corrupt-hash", bytes.NewReader(broken("", true))); !errors.Is(err, projects.ErrInvalidArchive) {
		t.Fatalf("corrupt hash accepted: %v", err)
	}
	if _, err = s.AcceptProjectArchive(ctx, "missing-analysis", bytes.NewReader(broken("analysis.zip", false))); !errors.Is(err, projects.ErrInvalidArchive) {
		t.Fatalf("missing dependency accepted: %v", err)
	}
	if _, err = s.AcceptProjectArchive(ctx, "unsafe-path", bytes.NewReader(broken("../evil", false))); !errors.Is(err, projects.ErrInvalidArchive) {
		t.Fatalf("unsafe path accepted: %v", err)
	}
	evidenceAvailable.Store(false)
	missingSource, err := s.AcceptProjectArchive(ctx, "missing-source", bytes.NewReader(archiveResponse.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	sourceJob, err := s.Jobs().Claim(ctx, []string{projects.ProjectImportKind})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.RestoreProject(ctx, sourceJob, func(stage string, n int64, total *int64) error {
		return s.Jobs().Progress(ctx, sourceJob.ID, stage, n, total)
	}); err == nil {
		t.Fatal("missing source accepted")
	}
	if err = s.Jobs().Finish(ctx, sourceJob.ID, "FAILED", &jobs.JobError{Code: "SOURCE_MISSING", Message: "source missing"}); err != nil {
		t.Fatal(err)
	}
	sourceProject, err := s.Get(ctx, missingSource["projectId"].(string))
	if err != nil || sourceProject.Status == "READY" {
		t.Fatalf("missing-source project became ready: %+v %v", sourceProject, err)
	}
	evidenceAvailable.Store(true)
	analysisAvailable.Store(false)
	failed, err := s.AcceptProjectArchive(ctx, "retry-import", bytes.NewReader(archiveResponse.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	failedJob, err := s.Jobs().Claim(ctx, []string{projects.ProjectImportKind})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.RestoreProject(ctx, failedJob, func(stage string, n int64, total *int64) error {
		return s.Jobs().Progress(ctx, failedJob.ID, stage, n, total)
	}); err == nil {
		t.Fatal("failed child import accepted")
	}
	if err = s.Jobs().Finish(ctx, failedJob.ID, "FAILED", &jobs.JobError{Code: "CHILD_FAILED", Message: "analysis unavailable"}); err != nil {
		t.Fatal(err)
	}
	failedProject, err := s.Get(ctx, failed["projectId"].(string))
	if err != nil || failedProject.Status == "READY" {
		t.Fatalf("incomplete project became ready: %+v %v", failedProject, err)
	}
	blocked := httptest.NewRecorder()
	api.New(db).ServeHTTP(blocked, httptest.NewRequest("GET", "/api/v1/projects/"+failedProject.ID+"/actions", nil))
	if blocked.Code != 409 {
		t.Fatalf("incomplete project actions: %d %s", blocked.Code, blocked.Body.String())
	}
	analysisAvailable.Store(true)
	retried, err := s.AcceptProjectArchive(ctx, "retry-import", bytes.NewReader(archiveResponse.Body.Bytes()))
	if err != nil || retried["projectId"] != failed["projectId"] {
		t.Fatalf("retry changed project: %v %v", retried, err)
	}
	retryJob, err := s.Jobs().Claim(ctx, []string{projects.ProjectImportKind})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.RestoreProject(ctx, retryJob, func(stage string, n int64, total *int64) error {
		return s.Jobs().Progress(ctx, retryJob.ID, stage, n, total)
	}); err != nil {
		t.Fatal(err)
	}
	if err = s.Jobs().Finish(ctx, retryJob.ID, "SUCCEEDED", nil); err != nil {
		t.Fatal(err)
	}
	var upload bytes.Buffer
	multipartWriter := multipart.NewWriter(&upload)
	part, err := multipartWriter.CreateFormFile("file", "project.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(archiveResponse.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err = multipartWriter.WriteField("importId", "api-import"); err != nil {
		t.Fatal(err)
	}
	if err = multipartWriter.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/api/v1/projects/import", &upload)
	request.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	response := httptest.NewRecorder()
	api.New(db).ServeHTTP(response, request)
	if response.Code != 202 {
		t.Fatalf("project import route: %d %s", response.Code, response.Body.String())
	}
}

func TestProjectsHTTPPersistenceAndIdempotency(t *testing.T) {
	ctx := context.Background()
	dsn := testdatabase.New(t)
	db, err := storage.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	server := httptest.NewServer(api.New(db))
	defer server.Close()
	request := func(method, path, key, body string) (int, []byte) {
		t.Helper()
		req, err := http.NewRequest(method, server.URL+path, bytes.NewBufferString(body))
		if err != nil {
			t.Fatal(err)
		}
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		if res.Header.Get("X-Request-ID") == "" {
			t.Error("missing request ID")
		}
		return res.StatusCode, data
	}
	var wg sync.WaitGroup
	ids := make(chan string, 12)
	for range 12 {
		wg.Go(func() {
			status, data := request("POST", "/api/v1/projects", "same-key", `{"name":"Thermostand","settings":{"endian":"big"}}`)
			if status != 201 {
				t.Errorf("create: %d %s", status, data)
				return
			}
			var p projects.Project
			if err := json.Unmarshal(data, &p); err != nil {
				t.Error(err)
				return
			}
			ids <- p.ID
		})
	}
	wg.Wait()
	close(ids)
	var id string
	for got := range ids {
		if id != "" && got != id {
			t.Errorf("duplicate project: %s %s", id, got)
		}
		id = got
	}
	var count int
	if err = db.QueryRow("SELECT count(*) FROM projects").Scan(&count); err != nil || count != 1 {
		t.Fatalf("projects=%d err=%v", count, err)
	}
	for _, tt := range []struct {
		body, key string
		status    int
	}{
		{`{"name":"Other"}`, "same-key", 409},
		{`{"name":"Valid"}`, "", 400},
		{`{"name":"   "}`, "empty", 400},
		{`{"name":"Valid","extra":true}`, "extra", 400},
		{`{"name":"Valid"} {}`, "trailing", 400},
		{`null`, "null", 400},
	} {
		status, data := request("POST", "/api/v1/projects", tt.key, tt.body)
		if status != tt.status {
			t.Errorf("%s: %d %s", tt.key, status, data)
		}
	}
	status, _ := request("GET", "/api/v1/projects/missing", "", "")
	if status != 404 {
		t.Fatalf("missing status=%d", status)
	}
	for i := range 4 {
		status, data := request("POST", "/api/v1/projects", fmt.Sprint("p", i), fmt.Sprintf(`{"name":"Project %d"}`, i))
		if status != 201 {
			t.Fatalf("%d %s", status, data)
		}
	}
	if _, err = db.Exec("INSERT INTO projects(id,name,status) VALUES('importing','Incoming','IMPORTING'),('broken','Broken','ERROR')"); err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{}
	token := ""
	for range 5 {
		status, data := request("GET", "/api/v1/projects?limit=2&cursor="+token, "", "")
		if status != 200 {
			t.Fatalf("list: %d %s", status, data)
		}
		var page projects.Page
		if err = json.Unmarshal(data, &page); err != nil {
			t.Fatal(err)
		}
		for _, p := range page.Items {
			if _, ok := seen[p.ID]; ok {
				t.Fatal("duplicate page item")
			}
			seen[p.ID] = p.Status
		}
		token = page.NextCursor
		if token == "" {
			break
		}
	}
	if len(seen) != 7 || seen["importing"] != "IMPORTING" || seen["broken"] != "ERROR" {
		t.Fatalf("list: %#v", seen)
	}
	for _, path := range []string{"/api/v1/projects?limit=0", "/api/v1/projects?cursor=garbage"} {
		status, _ = request("GET", path, "", "")
		if status != 400 {
			t.Fatalf("bad cursor/limit: %d", status)
		}
	}
	server.Close()
	db.Close()
	db, err = storage.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	p, err := (projects.Store{Repository: storage.Store{DB: db}, Peers: peerhttp.Client{}}).Get(ctx, id)
	if err != nil || p.SettingsVersion == nil || p.Name != "Thermostand" {
		t.Fatalf("restart: %+v %v", p, err)
	}
}
