package api

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
)

func New(store captures.Store) http.Handler {
	mux := http.NewServeMux()
	httpapi.Health(mux, store.Repository)
	handle := func(cancel bool) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("jobId")
			if !strings.HasPrefix(id, "cap_") {
				httpapi.Error(w, 404, "NOT_FOUND", "capture job was not found")
				return
			}
			j, err := store.Jobs().Get(r.Context(), id)
			if err == nil && cancel {
				j, err = store.Jobs().Cancel(r.Context(), id)
			}
			if errors.Is(err, sql.ErrNoRows) {
				httpapi.Error(w, 404, "NOT_FOUND", "capture job was not found")
				return
			}
			if err != nil {
				slog.Error("capture job request failed", "error", err)
				httpapi.Error(w, 500, "INTERNAL_ERROR", "request could not be completed")
				return
			}
			httpapi.JSON(w, 200, j)
		}
	}
	mux.HandleFunc("GET /api/v1/jobs/{jobId}", handle(false))
	mux.HandleFunc("POST /api/v1/jobs/{jobId}/cancel", handle(true))
	registerCapture(mux, store)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		httpapi.Error(w, 404, "NOT_FOUND", "route was not found")
	})
	public := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/projects/") {
			parts := strings.Split(r.URL.Path, "/")
			if len(parts) > 4 && parts[4] != "" {
				_, err := store.Context(r.Context(), parts[4], "current")
				if errors.Is(err, sql.ErrNoRows) {
					httpapi.Error(w, 404, "NOT_FOUND", "project was not found")
					return
				}
				if err != nil {
					if strings.Contains(err.Error(), "project context is not ready") {
						httpapi.Error(w, 409, "PROJECT_NOT_READY", "project is not ready")
						return
					}
					httpapi.Error(w, 503, "WORKSPACE_UNAVAILABLE", "workspace context is unavailable")
					return
				}
			}
		}
		mux.ServeHTTP(w, r)
	})
	return httpapi.Wrap(public)
}
