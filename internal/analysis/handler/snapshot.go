package handler

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/capture"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/repository"
	"github.com/google/uuid"
)

// Snapshots are immutable copies of Analysis-owned project records.
type SnapshotHandler struct {
	Repo    *repository.InterpretationRepository
	Capture *capture.Client
}

func NewSnapshotHandler(repo *repository.InterpretationRepository, cap *capture.Client) *SnapshotHandler {
	return &SnapshotHandler{Repo: repo, Capture: cap}
}
func (h *SnapshotHandler) Create(w http.ResponseWriter, r *http.Request) {
	s, e := h.Repo.ExportSnapshot(r.Context(), r.PathValue("projectId"))
	if e != nil {
		analysisError(w, e)
		return
	}
	payload, e := json.Marshal(s)
	if e != nil {
		analysisError(w, e)
		return
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	f, e := zw.Create("analysis.json")
	if e == nil {
		_, e = f.Write(payload)
	}
	if e == nil {
		e = zw.Close()
	}
	if e != nil {
		analysisError(w, e)
		return
	}
	if buf.Len() > 750<<20 {
		http.Error(w, "snapshot too large", http.StatusRequestEntityTooLarge)
		return
	}
	id := "snapshot_analysis_" + uuid.NewString()
	if e = h.Repo.SaveSnapshot(r.Context(), id, r.PathValue("projectId"), buf.Bytes()); e != nil {
		analysisError(w, e)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"snapshotId": id})
}
func (h *SnapshotHandler) Download(w http.ResponseWriter, r *http.Request) {
	b, e := h.Repo.LoadSnapshot(r.Context(), r.PathValue("snapshotId"))
	if e != nil {
		writeJSON(w, 404, map[string]string{"code": "NOT_FOUND", "message": "snapshot not found"})
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=analysis.zip")
	w.Header().Set("X-Content-SHA256", fmt.Sprintf("%x", sha256.Sum256(b)))
	w.WriteHeader(200)
	_, _ = w.Write(b)
}
func parseMap(header string) (map[string]string, error) {
	if header == "" {
		return map[string]string{}, nil
	}
	m := map[string]string{}
	e := json.Unmarshal([]byte(header), &m)
	return m, e
}
func (h *SnapshotHandler) Import(w http.ResponseWriter, r *http.Request) {
	if !strings.Contains(r.Header.Get("Content-Type"), "application/zip") {
		writeJSON(w, 415, map[string]string{"code": "UNSUPPORTED_MEDIA_TYPE", "message": "application/zip required"})
		return
	}
	body, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 100<<20))
	if e != nil {
		writeJSON(w, 413, map[string]string{"code": "TOO_LARGE", "message": "import exceeds 100 MiB"})
		return
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(body))
	seen, seenErr := h.Repo.ImportSeen(r.Context(), r.PathValue("projectId"), r.PathValue("importId"), digest)
	if seenErr != nil {
		writeJSON(w, 409, map[string]string{"code": "IMPORT_CONFLICT", "message": seenErr.Error()})
		return
	}
	if seen {
		writeJSON(w, 200, map[string]string{"status": "READY"})
		return
	}
	zr, e := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if e != nil {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid ZIP"})
		return
	}
	if len(zr.File) != 1 || zr.File[0].Name != "analysis.json" || zr.File[0].UncompressedSize64 > 100<<20 {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "expected single analysis.json"})
		return
	}
	f, e := zr.File[0].Open()
	if e != nil {
		analysisError(w, e)
		return
	}
	raw, e := io.ReadAll(io.LimitReader(f, 100<<20+1))
	f.Close()
	if e != nil || len(raw) > 100<<20 {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid analysis.json"})
		return
	}
	var s repository.Snapshot
	if e = json.Unmarshal(raw, &s); e != nil {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid snapshot JSON"})
		return
	}
	captureMap, e1 := parseMap(r.Header.Get("X-Capture-Id-Map"))
	assemblyMap, e2 := parseMap(r.Header.Get("X-Assembly-Id-Map"))
	streamMap, e3 := parseMap(r.Header.Get("X-Stream-Id-Map"))
	settingsMap, e4 := parseMap(r.Header.Get("X-Settings-Version-Map"))
	if e1 != nil || e2 != nil || e3 != nil || e4 != nil {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid ID mapping headers"})
		return
	}
	// Backend 1 does not currently send X-Settings-Version-Map. Resolve it
	// from the new Capture assembly rather than leaving dangling references.
	for _, oldRun := range s.Runs {
		if oldRun.SettingsVersion == "" {
			continue
		}
		if settingsMap[oldRun.SettingsVersion] != "" {
			continue
		}
		newAssembly := assemblyMap[oldRun.AssemblyID]
		if newAssembly == "" {
			writeJSON(w, 409, map[string]string{"code": "IMPORT_CONFLICT", "message": "assembly ID mapping missing"})
			return
		}
		_, meta, resolveErr := h.Capture.Assembly(r.Context(), r.PathValue("projectId"), newAssembly)
		if resolveErr != nil || meta.SettingsVersion == "" {
			writeJSON(w, 409, map[string]string{"code": "IMPORT_CONFLICT", "message": "cannot resolve restored settings version"})
			return
		}
		settingsMap[oldRun.SettingsVersion] = meta.SettingsVersion
	}
	if e = h.Repo.ImportSnapshot(r.Context(), r.PathValue("projectId"), s, captureMap, assemblyMap, streamMap, settingsMap, r.PathValue("importId"), digest); e != nil {
		writeJSON(w, 409, map[string]string{"code": "IMPORT_CONFLICT", "message": e.Error()})
		return
	}

	writeJSON(w, 200, map[string]string{"status": "READY"})
}
