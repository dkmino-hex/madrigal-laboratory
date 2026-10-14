package api

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

type captureSnapshotInput = domain.SnapshotInput

func registerCaptureTransfer(mux *http.ServeMux, store captures.Store) {
	mux.HandleFunc("POST /internal/v1/projects/{projectId}/snapshots", func(w http.ResponseWriter, r *http.Request) {
		var input captureSnapshotInput
		if err := httpapi.Decode(w, r, &input); err != nil {
			httpapi.Error(w, 400, "INVALID_JSON", "expected snapshot selection")
			return
		}
		meta, err := store.CreateCaptureSnapshot(r.Context(), r.PathValue("projectId"), input)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				captureError(w, err)
			} else if errors.Is(err, errSelection) {
				httpapi.Error(w, 400, "INVALID_SELECTION", err.Error())
			} else {
				captureError(w, err)
			}
			return
		}
		httpapi.JSON(w, 201, meta)
	})
	mux.HandleFunc("GET /internal/v1/snapshots/{snapshotId}/archive", func(w http.ResponseWriter, r *http.Request) {
		meta, err := store.SnapshotMetadata(r.Context(), r.PathValue("snapshotId"))
		if err != nil {
			captureError(w, err)
			return
		}
		archive, err := store.BuildCaptureArchive(r.Context(), meta)
		if err != nil {
			captureError(w, err)
			return
		}
		defer os.Remove(archive)
		f, err := os.Open(archive)
		if err != nil {
			captureError(w, err)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			captureError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", r.PathValue("snapshotId")+".zip"))
		w.Header().Set("Content-Length", fmt.Sprint(info.Size()))
		w.WriteHeader(200)
		_, _ = io.Copy(w, f)
	})
}

var errSelection = domain.ErrSelection
