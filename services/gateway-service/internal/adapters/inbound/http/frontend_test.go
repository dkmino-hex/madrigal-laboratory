package api_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	api "github.com/dkmino-hex/madrigal-laboratory/services/gateway-service/internal/adapters/inbound/http"
)

func TestSPAFallbackDoesNotHideMissingAPIRoutes(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "index.html"), []byte("<html>frontend</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	upstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"items":[]}`))
	})
	handler := api.New(upstream, upstream, upstream, "", directory)
	for _, test := range []struct {
		path   string
		status int
		html   bool
	}{{"/projects/example/runs/run", 200, true}, {"/api/v1/missing", 404, false}, {"/internal/v1/projects", 404, false}, {"/assets/missing.js", 404, false}, {"/api/v1/projects", 200, false}} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", test.path, nil))
		if response.Code != test.status || strings.Contains(response.Body.String(), "<html>") != test.html {
			t.Fatalf("%s: %d %s", test.path, response.Code, response.Body.String())
		}
	}
}
