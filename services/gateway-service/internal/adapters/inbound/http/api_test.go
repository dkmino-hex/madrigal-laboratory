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
