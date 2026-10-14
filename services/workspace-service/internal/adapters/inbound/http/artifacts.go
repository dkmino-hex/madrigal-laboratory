package api

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/application/projects"
)

func registerArtifactDownload(mux *http.ServeMux, s projects.Store) {
	mux.HandleFunc("GET /api/v1/artifacts/{artifactId}", func(w http.ResponseWriter, r *http.Request) {
		a, err := s.Artifact(r.Context(), r.PathValue("artifactId"))
		if err == sql.ErrNoRows {
			httpapi.Error(w, 404, "NOT_FOUND", "artifact was not found")
			return
		}
		if err != nil {
			httpapi.Error(w, 500, "INTERNAL_ERROR", "artifact lookup failed")
			return
		}
		if a.Status != "READY" {
			httpapi.Error(w, 409, "ARTIFACT_NOT_READY", "artifact is not ready")
			return
		}
		if !a.Valid || a.RelativePath != filepath.Base(a.RelativePath) || strings.ContainsAny(a.RelativePath, "/\\") || strings.Contains(a.RelativePath, "..") {
			httpapi.Error(w, 500, "ARTIFACT_CORRUPT", "invalid artifact path")
			return
		}
		dbPath, err := s.DataDirectory(r.Context())
		if err != nil {
			httpapi.Error(w, 500, "INTERNAL_ERROR", "artifact storage unavailable")
			return
		}
		root := filepath.Join(dbPath, "artifacts")
		path := filepath.Join(root, a.RelativePath)
		if !strings.HasPrefix(path, root+string(filepath.Separator)) {
			httpapi.Error(w, 500, "ARTIFACT_CORRUPT", "invalid artifact path")
			return
		}
		originalInfo, err := os.Lstat(path)
		if err != nil || !originalInfo.Mode().IsRegular() {
			httpapi.Error(w, 500, "ARTIFACT_CORRUPT", "artifact file is not regular")
			return
		}
		file, err := os.Open(path)
		if err != nil {
			httpapi.Error(w, 500, "ARTIFACT_MISSING", "artifact file is missing")
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() || info.Size() != a.Size {
			httpapi.Error(w, 500, "ARTIFACT_CORRUPT", "artifact size mismatch")
			return
		}
		digest := sha256.New()
		if _, err = io.Copy(digest, file); err != nil || hex.EncodeToString(digest.Sum(nil)) != a.SHA256 {
			httpapi.Error(w, 500, "ARTIFACT_CORRUPT", "artifact hash mismatch")
			return
		}
		if _, err = file.Seek(0, io.SeekStart); err != nil {
			httpapi.Error(w, 500, "INTERNAL_ERROR", "artifact seek failed")
			return
		}
		w.Header().Set("Content-Type", a.ContentType)
		w.Header().Set("Content-Length", fmt.Sprint(a.Size))
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(a.Name)))
		w.Header().Set("ETag", `"`+a.SHA256+`"`)
		w.WriteHeader(200)
		_, _ = io.Copy(w, file)
	})
}
