package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestJobRouting(t *testing.T) {
	for _, tc := range []struct{ id, want string }{{"ana_1", "analysis"}, {"cap_1", "capture"}, {"ws_1", "workspace"}} {
		got := ""
		mk := func(name string) http.Handler {
			return http.HandlerFunc(func(http.ResponseWriter, *http.Request) { got = name })
		}
		r := httptest.NewRequest("GET", "/api/v1/jobs/"+tc.id, nil)
		r.SetPathValue("jobId", tc.id)
		jobProxy(httptest.NewRecorder(), r, mk("workspace"), mk("capture"), mk("analysis"))
		if got != tc.want {
			t.Errorf("%s got %s", tc.id, got)
		}
	}
}
func TestUnknownJob(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/v1/jobs/unknown", nil)
	r.SetPathValue("jobId", "unknown")
	w := httptest.NewRecorder()
	jobProxy(w, r, nil, nil, nil)
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}

func TestWorkspaceResearchRoutes(t *testing.T) {
	for _, test := range []struct{ method, path string }{
		{"GET", "/api/v1/projects/p/settings"},
		{"GET", "/api/v1/projects/p/artifacts"},
		{"GET", "/api/v1/projects/p/evidence"},
		{"POST", "/api/v1/projects/p/evidence"},
		{"PATCH", "/api/v1/projects/p/evidence/e"},
		{"GET", "/api/v1/projects/p/action-log/i"},
		{"DELETE", "/api/v1/projects/p/observations/o"},
	} {
		owner := ""
		proxy := func(name string) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { owner = name; w.WriteHeader(200) })
		}
		handler := New(proxy("workspace"), proxy("capture"), proxy("analysis"), "")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
		if owner != "workspace" || response.Code != 200 {
			t.Fatalf("%s %s: owner %s, HTTP %d", test.method, test.path, owner, response.Code)
		}
	}
}

func TestDevelopmentOriginsExposeRequestID(t *testing.T) {
	proxy := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-ID", "request")
		w.WriteHeader(200)
	})
	handler := New(proxy, proxy, proxy, "http://localhost:5173,http://127.0.0.1:5173")
	for _, origin := range []string{"http://localhost:5173", "http://127.0.0.1:5173", "http://untrusted.example"} {
		request := httptest.NewRequest("OPTIONS", "/api/v1/projects", nil)
		request.Header.Set("Origin", origin)
		request.Header.Set("Access-Control-Request-Method", "POST")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		want := 204
		if origin == "http://untrusted.example" {
			want = 403
		}
		if response.Code != want {
			t.Fatalf("%s: %d", origin, response.Code)
		}
		if want == 204 && (response.Header().Get("Access-Control-Allow-Origin") != origin || response.Header().Get("Access-Control-Expose-Headers") == "") {
			t.Fatalf("missing CORS headers: %v", response.Header())
		}
	}
}
