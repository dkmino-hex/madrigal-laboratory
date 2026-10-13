package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/dkmino-hex/madrigal-laboratory/internal/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/internal/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/captures"
)

type viewRange struct {
	AssemblyID string `json:"assemblyId"`
	StreamID   string `json:"streamId"`
	Offset     int64  `json:"offset"`
	Length     int64  `json:"length"`
}

func registerViews(mux *http.ServeMux, store captures.Store) {
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
			var streamLength int64
			err := store.DB.QueryRowContext(r.Context(), `SELECT s.logical_length FROM streams s JOIN assemblies a ON a.id=s.assembly_id WHERE a.project_id=?1 AND a.id=?2 AND a.status='READY' AND s.id=?3`, r.PathValue("projectId"), entry.AssemblyID, entry.StreamID).Scan(&streamLength)
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
		id := identifier.New("view")
		manifest, _ := json.Marshal(input.Ranges)
		tx, err := store.DB.BeginTx(r.Context(), nil)
		if err != nil {
			captureError(w, err)
			return
		}
		defer tx.Rollback()
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO assembly_views(id,project_id,manifest_json) VALUES(?1,?2,?3)`, id, r.PathValue("projectId"), string(manifest)); err != nil {
			captureError(w, err)
			return
		}
		for _, entry := range input.Ranges {
			if _, err := tx.ExecContext(r.Context(), `INSERT OR IGNORE INTO assembly_view_items(view_id,assembly_id,stream_id,start_offset,end_offset) VALUES(?1,?2,?3,?4,?5)`, id, entry.AssemblyID, entry.StreamID, entry.Offset, entry.Offset+entry.Length); err != nil {
				captureError(w, err)
				return
			}
		}
		if _, err := tx.ExecContext(r.Context(), `UPDATE assembly_views SET status='READY' WHERE id=?1`, id); err != nil {
			captureError(w, err)
			return
		}
		if err := tx.Commit(); err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 201, map[string]any{"viewId": id, "projectId": r.PathValue("projectId"), "ranges": input.Ranges, "dataUrl": "/internal/v1/assembly-views/" + id + "/data"})
	})
	mux.HandleFunc("GET /internal/v1/assembly-views/{viewId}/data", func(w http.ResponseWriter, r *http.Request) {
		var manifest string
		err := store.DB.QueryRowContext(r.Context(), `SELECT manifest_json FROM assembly_views WHERE id=?1 AND status='READY'`, r.PathValue("viewId")).Scan(&manifest)
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
			req := r.Clone(r.Context())
			req.SetPathValue("projectId", "")
			req.SetPathValue("streamId", entry.StreamID)
			intervals, err := viewIntervals(req, store, entry)
			if err != nil {
				captureError(w, err)
				return
			}
			sources, err := viewSources(req, store, entry)
			if err != nil {
				captureError(w, err)
				return
			}
			items = append(items, map[string]any{"assemblyId": entry.AssemblyID, "streamId": entry.StreamID, "offset": entry.Offset, "length": entry.Length, "intervals": intervals, "sources": sources})
		}
		next := ""
		if start+int64(len(items)) < int64(len(ranges)) {
			next = strconv.FormatInt(start+int64(len(items)), 10)
		}
		httpapi.JSON(w, 200, map[string]any{"viewId": r.PathValue("viewId"), "blocks": items, "nextCursor": next})
	})
}

func viewIntervals(r *http.Request, store captures.Store, entry viewRange) ([]map[string]any, error) {
	return streamIntervalsUnchecked(r, store, entry.AssemblyID, entry.StreamID, entry.Offset, entry.Length)
}
func viewSources(r *http.Request, store captures.Store, entry viewRange) ([]map[string]any, error) {
	return sourceSpansUnchecked(r, store, entry.AssemblyID, entry.StreamID, entry.Offset, entry.Length)
}
