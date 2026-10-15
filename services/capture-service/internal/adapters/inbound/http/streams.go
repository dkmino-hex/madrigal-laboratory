package api

import (
	"errors"
	"net/http"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
)

func rangeArgs(r *http.Request) (int64, int64, error) {
	offset, err := positiveInt(r.URL.Query().Get("offset"), 0, 1<<40)
	if err != nil {
		return 0, 0, err
	}
	length, err := positiveInt(r.URL.Query().Get("length"), 65536, 1<<20)
	if err != nil || length < 1 || offset > 1<<40-length {
		return 0, 0, errors.New("invalid range")
	}
	return offset, length, nil
}

func registerSessions(mux *http.ServeMux, store captures.Store) {
	mux.HandleFunc("GET /api/v1/projects/{projectId}/sessions", func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpapi.Limit(r)
		if err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", err.Error())
			return
		}
		q := r.URL.Query()
		filters := map[string]string{}
		for _, key := range []string{"cursor", "captureId", "assemblyId", "ip", "port", "from", "to", "streamId", "q", "defects"} {
			filters[key] = q.Get(key)
		}

		result, err := store.Sessions(r.Context(), r.PathValue("projectId"), filters, limit)
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/sessions/{sessionId}", func(w http.ResponseWriter, r *http.Request) {
		aid := r.URL.Query().Get("assemblyId")
		if aid == "" {
			httpapi.Error(w, 400, "INVALID_REQUEST", "assemblyId is required")
			return
		}

		result, err := store.Session(r.Context(), r.PathValue("projectId"), aid, r.PathValue("sessionId"))
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/streams/{streamId}/bytes", func(w http.ResponseWriter, r *http.Request) { streamRange(w, r, store, false) })
	mux.HandleFunc("GET /api/v1/projects/{projectId}/streams/{streamId}/sources", func(w http.ResponseWriter, r *http.Request) { streamRange(w, r, store, true) })
	registerSearch(mux, store)
}

func streamRange(w http.ResponseWriter, r *http.Request, store captures.Store, sources bool) {
	aid := r.URL.Query().Get("assemblyId")
	if aid == "" {
		httpapi.Error(w, 400, "INVALID_REQUEST", "assemblyId is required")
		return
	}
	offset, length, err := rangeArgs(r)
	if err != nil {
		httpapi.Error(w, 400, "INVALID_REQUEST", err.Error())
		return
	}
	streamID := r.PathValue("streamId")
	if sources {
		items, err := store.SourceSpans(r.Context(), r.PathValue("projectId"), aid, streamID, offset, length)
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, map[string]any{"assemblyId": aid, "streamId": streamID, "offset": offset, "length": length, "sources": items})
		return
	}
	items, err := store.StreamIntervals(r.Context(), r.PathValue("projectId"), aid, streamID, offset, length)
	if err != nil {
		captureError(w, err)
		return
	}
	httpapi.JSON(w, 200, map[string]any{"assemblyId": aid, "streamId": streamID, "offset": offset, "length": length, "intervals": items})
}
