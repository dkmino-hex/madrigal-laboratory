package api

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/application/projects"
)

func New(s projects.Store) http.Handler {
	mux := http.NewServeMux()
	httpapi.Health(mux, s.Repository)
	fail := func(w http.ResponseWriter, err error) {
		switch {
		case errors.Is(err, sql.ErrNoRows):
			httpapi.Error(w, 404, "NOT_FOUND", "project was not found")
		case errors.Is(err, projects.ErrInvalid):
			httpapi.Error(w, 400, "INVALID_REQUEST", "check name, Idempotency-Key, cursor and limit")
		case errors.Is(err, projects.ErrInvalidArchive):
			httpapi.Error(w, 400, "INVALID_ARCHIVE", err.Error())
		case errors.Is(err, projects.ErrConflict):
			httpapi.Error(w, 409, "IDEMPOTENCY_CONFLICT", err.Error())
		case errors.Is(err, projects.ErrSourceUnavailable):
			httpapi.Error(w, 503, "SOURCE_UNAVAILABLE", "capture service could not validate evidence")
		case errors.Is(err, projects.ErrProjectNotReady):
			httpapi.Error(w, 409, "PROJECT_NOT_READY", "project is not ready")
		default:
			slog.Error("workspace request failed", "error", err)
			httpapi.Error(w, 500, "INTERNAL_ERROR", "request could not be completed")
		}
	}
	mux.HandleFunc("POST /api/v1/projects", func(w http.ResponseWriter, r *http.Request) {
		var input projects.CreateInput
		if err := httpapi.Decode(w, r, &input); err != nil {
			httpapi.Error(w, 400, "INVALID_JSON", "expected a project JSON object")
			return
		}
		p, replayed, err := s.Create(r.Context(), input, r.Header.Get("Idempotency-Key"))
		if err != nil {
			fail(w, err)
			return
		}
		if replayed {
			w.Header().Set("Idempotency-Replayed", "true")
		}
		w.Header().Set("Location", "/api/v1/projects/"+p.ID)
		httpapi.JSON(w, 201, p)
	})
	mux.HandleFunc("POST /api/v1/projects/import", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, (1501 << 20))
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			httpapi.Error(w, 400, "INVALID_ARCHIVE", "expected multipart ZIP upload")
			return
		}
		defer r.MultipartForm.RemoveAll()
		file, _, err := r.FormFile("file")
		if err != nil {
			file, _, err = r.FormFile("archive")
		}
		if err != nil {
			httpapi.Error(w, 400, "INVALID_ARCHIVE", "file part is required")
			return
		}
		defer file.Close()
		result, err := s.AcceptProjectArchive(r.Context(), r.FormValue("importId"), file)
		if err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Location", "/api/v1/jobs/"+result["jobId"].(string))
		httpapi.JSON(w, 202, result)
	})
	mux.HandleFunc("GET /api/v1/projects", func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpapi.Limit(r)
		if err != nil {
			fail(w, projects.ErrInvalid)
			return
		}
		page, err := s.List(r.Context(), r.URL.Query().Get("cursor"), limit, r.URL.Query().Get("q"))
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, page)
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}", func(w http.ResponseWriter, r *http.Request) {
		p, err := s.Get(r.Context(), r.PathValue("projectId"))
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, p)
	})
	mux.HandleFunc("PATCH /api/v1/projects/{projectId}/settings", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Settings map[string]any `json:"settings"`
		}
		if err := httpapi.Decode(w, r, &input); err != nil {
			httpapi.Error(w, 400, "INVALID_JSON", "expected settings JSON object")
			return
		}
		v, replayed, err := s.UpdateSettings(r.Context(), r.PathValue("projectId"), input.Settings, r.Header.Get("Idempotency-Key"))
		if err != nil {
			fail(w, err)
			return
		}
		if replayed {
			w.Header().Set("Idempotency-Replayed", "true")
		}
		httpapi.JSON(w, 200, v)
	})
	mux.HandleFunc("GET /internal/v1/projects/{projectId}/context", func(w http.ResponseWriter, r *http.Request) {
		context, err := s.SettingsContext(r.Context(), r.PathValue("projectId"), r.URL.Query().Get("settingsVersion"))
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, context)
	})
	registerResearch(mux, s, fail)
	registerViews(mux, s, fail)
	registerObservations(mux, s, fail)
	registerArtifactDownload(mux, s)
	mux.HandleFunc("POST /api/v1/projects/{projectId}/reports", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			RunID string `json:"runId"`
		}
		if err := httpapi.Decode(w, r, &input); err != nil {
			httpapi.Error(w, 400, "INVALID_JSON", "expected runId")
			return
		}
		result, err := s.RequestReport(r.Context(), r.PathValue("projectId"), input.RunID)
		if err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Location", "/api/v1/jobs/"+result["jobId"].(string))
		httpapi.JSON(w, 202, result)
	})
	mux.HandleFunc("POST /api/v1/projects/{projectId}/exports", func(w http.ResponseWriter, r *http.Request) {
		result, err := s.RequestExport(r.Context(), r.PathValue("projectId"))
		if err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Location", "/api/v1/jobs/"+result["jobId"].(string))
		httpapi.JSON(w, 202, result)
	})
	mux.HandleFunc("POST /internal/v1/projects/{projectId}/snapshots", func(w http.ResponseWriter, r *http.Request) {
		snapshot, err := s.CreateSnapshot(r.Context(), r.PathValue("projectId"))
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 201, snapshot)
	})
	mux.HandleFunc("GET /api/v1/jobs/{jobId}", func(w http.ResponseWriter, r *http.Request) { workspaceJob(w, r, s, false) })
	mux.HandleFunc("POST /api/v1/jobs/{jobId}/cancel", func(w http.ResponseWriter, r *http.Request) { workspaceJob(w, r, s, true) })
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		httpapi.Error(w, 404, "NOT_FOUND", "route was not found")
	})
	return httpapi.Wrap(mux)
}

func workspaceJob(w http.ResponseWriter, r *http.Request, s projects.Store, cancel bool) {
	if !strings.HasPrefix(r.PathValue("jobId"), "ws_") {
		httpapi.Error(w, 404, "NOT_FOUND", "workspace job was not found")
		return
	}
	j, err := s.Jobs().Get(r.Context(), r.PathValue("jobId"))
	if err == nil && cancel {
		j, err = s.Jobs().Cancel(r.Context(), j.ID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		httpapi.Error(w, 404, "NOT_FOUND", "workspace job was not found")
		return
	}
	if err != nil {
		httpapi.Error(w, 500, "INTERNAL_ERROR", "job request failed")
		return
	}
	httpapi.JSON(w, 200, j)
}

func registerResearch(mux *http.ServeMux, s projects.Store, fail func(http.ResponseWriter, error)) {
	mux.HandleFunc("POST /api/v1/projects/{projectId}/action-log", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 17<<20)
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", "expected multipart CSV upload")
			return
		}
		defer r.MultipartForm.RemoveAll()
		f, h, err := r.FormFile("file")
		if err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", "file part is required")
			return
		}
		defer f.Close()
		offset := int64(0)
		if raw := r.FormValue("timeOffsetNs"); raw != "" {
			offset, err = strconv.ParseInt(raw, 10, 64)
			if err != nil {
				httpapi.Error(w, 400, "INVALID_REQUEST", "invalid timeOffsetNs")
				return
			}
		}
		imp, err := s.AcceptJournal(r.Context(), r.PathValue("projectId"), projects.JournalInput{Timezone: r.FormValue("timezone"), OffsetNS: offset, Name: h.Filename, IdempotencyKey: r.Header.Get("Idempotency-Key")}, f)
		if err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Location", "/api/v1/jobs/"+imp.JobID)
		httpapi.JSON(w, 202, imp)
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/actions", func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpapi.Limit(r)
		if err != nil {
			fail(w, projects.ErrInvalid)
			return
		}
		q := projects.ActionQuery{Cursor: r.URL.Query().Get("cursor"), Name: r.URL.Query().Get("type"), Search: r.URL.Query().Get("q"), Limit: limit}
		for _, v := range []struct {
			key    string
			target **int64
		}{{"from", &q.From}, {"to", &q.To}} {
			if raw := r.URL.Query().Get(v.key); raw != "" {
				t, e := parseActionTime(raw)
				if e != nil {
					fail(w, projects.ErrInvalid)
					return
				}
				*v.target = &t
			}
		}
		page, err := s.Actions(r.Context(), r.PathValue("projectId"), q)
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, page)
	})
}

func parseActionTime(raw string) (int64, error) {
	if n, err := strconv.ParseInt(raw, 10, 64); err == nil {
		return n, nil
	}
	t, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return 0, err
	}
	return t.UnixNano(), nil
}
