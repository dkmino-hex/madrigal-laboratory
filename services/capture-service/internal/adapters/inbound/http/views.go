package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

type viewRange = domain.ViewRange

func registerViews(mux *http.ServeMux, store captures.Store) {
	mux.HandleFunc("GET /internal/v1/projects/{projectId}/captures/{captureId}/research-data", func(w http.ResponseWriter, r *http.Request) {
		budget, err := positiveInt(r.URL.Query().Get("maxBytes"), 256<<10, 1<<20)
		if err != nil || budget < 1 {
			httpapi.Error(w, 400, "INVALID_REQUEST", "invalid research budget")
			return
		}
		data, err := store.ResearchData(r.Context(), r.PathValue("projectId"), r.PathValue("captureId"), r.URL.Query().Get("assemblyId"), budget)
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, data)
	})
	mux.HandleFunc("POST /internal/v1/projects/{projectId}/assembly-views", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Ranges []viewRange `json:"ranges"`
		}
		if err := httpapi.Decode(w, r, &input); err != nil || len(input.Ranges) == 0 || len(input.Ranges) > 256 {
			httpapi.Error(w, 400, "INVALID_REQUEST", "1..256 ranges are required")
			return
		}
		for _, entry := range input.Ranges {
			if entry.AssemblyID == "" || entry.StreamID == "" || entry.Offset < 0 || entry.Length < 1 || entry.Length > 1<<20 || entry.Offset > 1<<40-entry.Length {
				httpapi.Error(w, 400, "INVALID_REQUEST", "invalid range")
				return
			}
			streamLength, err := store.StreamInfo(r.Context(), r.PathValue("projectId"), entry.AssemblyID, entry.StreamID)
			if err == sql.ErrNoRows {
				httpapi.Error(w, 409, "ASSEMBLY_NOT_READY", "assembly or stream is not ready")
				return
			}
			if err != nil {
				captureError(w, err)
				return
			}
			if entry.Offset+entry.Length > streamLength {
				httpapi.Error(w, 400, "INVALID_REQUEST", "range exceeds stream length")
				return
			}
		}
		result, err := store.CreateView(r.Context(), r.PathValue("projectId"), input.Ranges)
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 201, result)
	})
	mux.HandleFunc("GET /internal/v1/assembly-views/{viewId}/data", func(w http.ResponseWriter, r *http.Request) {
		manifest, err := store.ViewManifest(r.Context(), r.PathValue("viewId"))
		if err != nil {
			captureError(w, err)
			return
		}
		var ranges []viewRange
		if err := json.Unmarshal([]byte(manifest), &ranges); err != nil {
			captureError(w, err)
			return
		}
		start, err := positiveInt(r.URL.Query().Get("cursor"), 0, int64(len(ranges)))
		if err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", "invalid cursor")
			return
		}
		limit, err := positiveInt(r.URL.Query().Get("limit"), 16, 64)
		if err != nil || limit < 1 {
			httpapi.Error(w, 400, "INVALID_REQUEST", "invalid limit")
			return
		}
		items := make([]map[string]any, 0)
		for i := start; i < int64(len(ranges)) && i < start+limit; i++ {
			entry := ranges[i]
			metadata, err := store.StreamReadContext(r.Context(), entry.AssemblyID, entry.StreamID)
			if err != nil {
				captureError(w, err)
				return
			}
			intervals, err := store.StreamIntervalsUnchecked(r.Context(), entry.AssemblyID, entry.StreamID, entry.Offset, entry.Length)
			if err != nil {
				captureError(w, err)
				return
			}
			sources, err := store.SourceSpansUnchecked(r.Context(), entry.AssemblyID, entry.StreamID, entry.Offset, entry.Length)
			if err != nil {
				captureError(w, err)
				return
			}
			items = append(items, map[string]any{"assemblyId": entry.AssemblyID, "streamId": entry.StreamID, "offset": entry.Offset, "length": entry.Length, "intervals": intervals, "sources": sources, "captureId": metadata["captureId"], "captureName": metadata["captureName"], "direction": metadata["direction"]})
		}
		next := ""
		if start+int64(len(items)) < int64(len(ranges)) {
			next = strconv.FormatInt(start+int64(len(items)), 10)
		}
		httpapi.JSON(w, 200, map[string]any{"viewId": r.PathValue("viewId"), "blocks": items, "nextCursor": next})
	})
}
