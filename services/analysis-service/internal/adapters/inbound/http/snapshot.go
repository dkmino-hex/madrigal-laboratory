package handler

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/application/analysis"
)

type SnapshotHandler struct{ snapshots service.Snapshots }

func NewSnapshotHandler(repo service.Repository, capture service.Capture) *SnapshotHandler {
	return &SnapshotHandler{snapshots: service.Snapshots{Repo: repo, Capture: capture}}
}

func (h *SnapshotHandler) Create(w http.ResponseWriter, r *http.Request) {
	id, err := h.snapshots.Create(r.Context(), r.PathValue("projectId"))
	if errors.Is(err, service.ErrSnapshotTooLarge) {
		http.Error(w, "snapshot too large", http.StatusRequestEntityTooLarge)
		return
	}
	if err != nil {
		analysisError(w, err)
		return
	}
	writeJSON(w, 201, map[string]string{"snapshotId": id})
}

func (h *SnapshotHandler) Download(w http.ResponseWriter, r *http.Request) {
	body, err := h.snapshots.Archive(r.Context(), r.PathValue("snapshotId"))
	if err != nil {
		writeJSON(w, 404, map[string]string{"code": "NOT_FOUND", "message": "snapshot not found"})
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=analysis.zip")
	w.Header().Set("X-Content-SHA256", fmt.Sprintf("%x", sha256.Sum256(body)))
	w.WriteHeader(200)
	_, _ = w.Write(body)
}

func parseMap(header string) (map[string]string, error) {
	m := map[string]string{}
	if header == "" {
		return m, nil
	}
	err := json.Unmarshal([]byte(header), &m)
	return m, err
}

func (h *SnapshotHandler) Import(w http.ResponseWriter, r *http.Request) {
	if !strings.Contains(r.Header.Get("Content-Type"), "application/zip") {
		writeJSON(w, 415, map[string]string{"code": "UNSUPPORTED_MEDIA_TYPE", "message": "application/zip required"})
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 100<<20))
	if err != nil {
		writeJSON(w, 413, map[string]string{"code": "TOO_LARGE", "message": "import exceeds 100 MiB"})
		return
	}
	captures, e1 := parseMap(r.Header.Get("X-Capture-Id-Map"))
	assemblies, e2 := parseMap(r.Header.Get("X-Assembly-Id-Map"))
	streams, e3 := parseMap(r.Header.Get("X-Stream-Id-Map"))
	settings, e4 := parseMap(r.Header.Get("X-Settings-Version-Map"))
	if e1 != nil || e2 != nil || e3 != nil || e4 != nil {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid ID mapping headers"})
		return
	}
	err = h.snapshots.Restore(r.Context(), r.PathValue("projectId"), r.PathValue("importId"), body, service.RestoreMaps{Captures: captures, Assemblies: assemblies, Streams: streams, Settings: settings})
	switch {
	case errors.Is(err, service.ErrInvalidArchive):
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": strings.TrimPrefix(err.Error(), service.ErrInvalidArchive.Error()+": ")})
	case errors.Is(err, service.ErrImportConflict):
		writeJSON(w, 409, map[string]string{"code": "IMPORT_CONFLICT", "message": strings.TrimPrefix(err.Error(), service.ErrImportConflict.Error()+": ")})
	case err != nil:
		analysisError(w, err)
	default:
		writeJSON(w, 200, map[string]string{"status": "READY"})
	}
}
