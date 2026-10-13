package api

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/internal/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/captures"
)

func New(store captures.Store) http.Handler {
	mux := http.NewServeMux()
	httpapi.Health(mux, store.DB)
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
	return httpapi.Wrap(mux)
}
