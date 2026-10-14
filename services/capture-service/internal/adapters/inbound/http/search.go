package api

import (
	"net/http"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

func registerSearch(mux *http.ServeMux, store captures.Store) {
	mux.HandleFunc("GET /api/v1/projects/{projectId}/streams/{streamId}/search", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		assemblyID := q.Get("assemblyId")
		if assemblyID == "" {
			httpapi.Error(w, 400, "INVALID_REQUEST", "assemblyId is required")
			return
		}
		pattern, err := domain.SearchPattern(q.Get("mode"), q.Get("pattern"))
		if err != nil {
			httpapi.Error(w, 400, "INVALID_PATTERN", err.Error())
			return
		}
		limit, err := httpapi.Limit(r)
		if err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", err.Error())
			return
		}
		cursor, err := positiveInt(q.Get("cursor"), 0, 1<<40)
		if err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", "invalid cursor")
			return
		}
		if _, err = store.StreamInfo(r.Context(), r.PathValue("projectId"), assemblyID, r.PathValue("streamId")); err != nil {
			captureError(w, err)
			return
		}

		result, err := store.Search(r.Context(), assemblyID, r.PathValue("streamId"), pattern, cursor, limit)
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, result)
	})
}
