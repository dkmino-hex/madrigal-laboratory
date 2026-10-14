package api_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/platform/testdatabase"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/inbound/http"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

type readyProject struct{}

func (readyProject) Context(_ context.Context, projectID, version string) (domain.ProjectContext, error) {
	return domain.ProjectContext{ProjectID: projectID, Status: "READY", SettingsVersion: version, Settings: json.RawMessage(`{}`)}, nil
}

func TestAssemblyRejectionAndStorageErrorsKeepHTTPStatus(t *testing.T) {
	db, err := storage.Open(context.Background(), testdatabase.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	handler := api.New(captures.Store{Repository: storage.Store{DB: db}, Projects: readyProject{}})
	request := func(captureID string, want int) {
		t.Helper()
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/projects/p1/captures/"+captureID+"/assemblies", strings.NewReader(`{"settingsVersion":"set_test"}`)))
		if response.Code != want {
			t.Fatalf("assembly %s: want %d, got %d: %s", captureID, want, response.Code, response.Body.String())
		}
	}
	request("missing", 404)
	_, err = db.Exec("INSERT INTO captures(id,project_id,sha256,original_name,relative_path,size_bytes,format) VALUES('c1','p1',?,'sample.pcap','objects/sample',24,'PCAP')", strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	request("c1", 409)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	request("c1", 500)
}
