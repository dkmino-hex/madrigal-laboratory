package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
)

func registerCaptureRestore(mux *http.ServeMux, store captures.Store) {
	mux.HandleFunc("PUT /internal/v1/projects/{projectId}/imports/{importId}", func(w http.ResponseWriter, r *http.Request) {
		if store.Files == nil {
			httpapi.Error(w, 503, "STORAGE_UNAVAILABLE", "original storage unavailable")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, captures.MaxArchiveBytes)
		archive, err := io.ReadAll(r.Body)
		if err != nil {
			httpapi.Error(w, 400, "INVALID_ARCHIVE", "archive exceeds size limit")
			return
		}
		manifest, parts, hash, err := captures.ParseCaptureArchive(archive)
		if err != nil {
			httpapi.Error(w, 400, "INVALID_ARCHIVE", err.Error())
			return
		}
		settingsMap := map[string]string{}
		if value := r.Header.Get("X-Settings-Version-Map"); value != "" {
			if json.Unmarshal([]byte(value), &settingsMap) != nil {
				httpapi.Error(w, 400, "INVALID_REQUEST", "invalid settings version map")
				return
			}
		}
		result, err := store.RestoreCaptureArchive(r.Context(), r.PathValue("projectId"), r.PathValue("importId"), manifest, parts, hash, settingsMap)
		if errors.Is(err, errSelection) {
			httpapi.Error(w, 409, "IMPORT_CONFLICT", err.Error())
			return
		}
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, result)
	})
}
