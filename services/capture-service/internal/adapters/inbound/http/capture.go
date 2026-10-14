package api

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/filestore"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

func captureError(w http.ResponseWriter, err error) {
	var requestError domain.RequestError
	var evidenceError domain.EvidenceError
	switch {
	case errors.As(err, &requestError):
		httpapi.Error(w, 400, "INVALID_REQUEST", err.Error())
	case errors.As(err, &evidenceError):
		httpapi.Error(w, 400, "INVALID_EVIDENCE", err.Error())
	case errors.Is(err, sql.ErrNoRows):
		httpapi.Error(w, 404, "NOT_FOUND", "resource was not found")
	case errors.Is(err, originals.ErrFormat), errors.Is(err, originals.ErrTooLarge):
		httpapi.Error(w, 400, "INVALID_CAPTURE", err.Error())
	default:
		slog.Error("capture request failed", "error", err)
		httpapi.Error(w, 500, "INTERNAL_ERROR", "request could not be completed")
	}
}

func positiveInt(raw string, fallback, maximum int64) (int64, error) {
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 || n > maximum {
		return 0, errors.New("invalid range")
	}
	return n, nil
}

func registerCapture(mux *http.ServeMux, store captures.Store) {
	mux.HandleFunc("POST /api/v1/projects/{projectId}/captures", func(w http.ResponseWriter, r *http.Request) {
		projectID := r.PathValue("projectId")
		project, err := store.Context(r.Context(), projectID, "current")
		if err != nil {
			captureError(w, err)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, originals.MaxSize+(1<<20))
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", "expected multipart capture upload")
			return
		}
		defer r.MultipartForm.RemoveAll()
		file, header, err := r.FormFile("file")
		if err != nil {
			file, header, err = r.FormFile("capture")
		}
		if err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", "file part is required")
			return
		}
		defer file.Close()
		c, j, duplicate, err := store.AcceptOriginalWithSettings(r.Context(), projectID, header.Filename, file, project.SettingsVersion, project.Settings)
		if err != nil {
			captureError(w, err)
			return
		}
		w.Header().Set("Location", "/api/v1/jobs/"+j.ID)
		httpapi.JSON(w, 202, map[string]any{"captureId": c.ID, "jobId": j.ID, "status": c.Status, "sha256": c.SHA256, "duplicate": duplicate})
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/captures", func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpapi.Limit(r)
		if err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", err.Error())
			return
		}

		result, err := store.ListCaptures(r.Context(), r.PathValue("projectId"), r.URL.Query().Get("cursor"), limit)
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/captures/{captureId}/packets/{packetNo}", func(w http.ResponseWriter, r *http.Request) {
		n, err := strconv.ParseInt(r.PathValue("packetNo"), 10, 64)
		if err != nil || n < 1 {
			httpapi.Error(w, 400, "INVALID_REQUEST", "invalid packet number")
			return
		}

		result, err := store.Packet(r.Context(), r.PathValue("projectId"), r.PathValue("captureId"), n)
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, result)
	})
	mux.HandleFunc("POST /api/v1/projects/{projectId}/captures/{captureId}/assemblies", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			SettingsVersion string `json:"settingsVersion"`
		}
		if err := httpapi.Decode(w, r, &input); err != nil || input.SettingsVersion == "" {
			httpapi.Error(w, 400, "INVALID_REQUEST", "settingsVersion is required")
			return
		}
		project, err := store.Context(r.Context(), r.PathValue("projectId"), input.SettingsVersion)
		if err != nil {
			captureError(w, err)
			return
		}
		id, job, err := store.EnqueueAssembly(r.Context(), project.ProjectID, r.PathValue("captureId"), project.SettingsVersion, project.Settings, "capture-0.1")
		if err != nil {
			var rejected domain.AssemblyRequestError
			if errors.Is(err, sql.ErrNoRows) {
				captureError(w, err)
			} else if errors.As(err, &rejected) {
				httpapi.Error(w, 409, "NOT_READY", err.Error())
			} else {
				captureError(w, err)
			}
			return
		}
		w.Header().Set("Location", "/api/v1/jobs/"+job.ID)
		httpapi.JSON(w, 202, map[string]any{"assemblyId": id, "jobId": job.ID, "status": "BUILDING", "settingsVersion": project.SettingsVersion})
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/captures/{captureId}/assemblies", func(w http.ResponseWriter, r *http.Request) {

		result, err := store.Assemblies(r.Context(), r.PathValue("projectId"), r.PathValue("captureId"))
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, result)
	})
	registerSessions(mux, store)
	registerViews(mux, store)
	registerCaptureTransfer(mux, store)
	registerCaptureRestore(mux, store)
	registerEvidenceValidation(mux, store)
}
