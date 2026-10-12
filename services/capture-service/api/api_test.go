package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/internal/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/internal/testdatabase"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/api"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/captures"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/storage"
)

func TestJobStatusAndCancelHTTP(t *testing.T) {
	ctx := context.Background()
	db, err := storage.Open(ctx, testdatabase.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := captures.Store{DB: db}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	j, err := store.Jobs().EnqueueTx(ctx, tx, "p1", captures.ImportKind, nil, map[string]any{})
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	handler := api.New(store)
	for _, tt := range []struct {
		method, path, status string
		code                 int
	}{
		{http.MethodGet, "/api/v1/jobs/" + j.ID, "QUEUED", 200},
		{http.MethodPost, "/api/v1/jobs/" + j.ID + "/cancel", "CANCELLED", 200},
		{http.MethodPost, "/api/v1/jobs/" + j.ID + "/cancel", "CANCELLED", 200},
		{http.MethodGet, "/api/v1/jobs/" + j.ID, "CANCELLED", 200},
		{http.MethodGet, "/api/v1/jobs/cap_missing", "", 404},
		{http.MethodGet, "/api/v1/jobs/ws_missing", "", 404},
	} {
		request := httptest.NewRequest(tt.method, tt.path, nil)
		request.Header.Set("X-Request-ID", "defense-request")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != tt.code || response.Header().Get("X-Request-ID") != "defense-request" {
			t.Fatalf("HTTP response: %d %s", response.Code, response.Body.String())
		}
		if tt.code == 200 {
			var got jobs.Job
			if err = json.Unmarshal(response.Body.Bytes(), &got); err != nil || got.Status != tt.status {
				t.Fatalf("job: %+v %v", got, err)
			}
			if !strings.Contains(response.Body.String(), `"completed":"0"`) {
				t.Fatal("counter is not a decimal string")
			}
		}
	}
}
