package api

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"

	"github.com/dkmino-hex/madrigal-laboratory/internal/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/projects"
)

func New(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	s := projects.Store{DB: db}
	httpapi.Health(mux, db)
	fail := func(w http.ResponseWriter, err error) {
		switch {
		case errors.Is(err, sql.ErrNoRows):
			httpapi.Error(w, 404, "NOT_FOUND", "project was not found")
		case errors.Is(err, projects.ErrInvalid):
			httpapi.Error(w, 400, "INVALID_REQUEST", "check name, Idempotency-Key, cursor and limit")
		case errors.Is(err, projects.ErrConflict):
			httpapi.Error(w, 409, "IDEMPOTENCY_CONFLICT", err.Error())
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
	mux.HandleFunc("GET /api/v1/projects", func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpapi.Limit(r)
		if err != nil {
			fail(w, projects.ErrInvalid)
			return
		}
		page, err := s.List(r.Context(), r.URL.Query().Get("cursor"), limit)
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
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		httpapi.Error(w, 404, "NOT_FOUND", "route was not found")
	})
	return httpapi.Wrap(mux)
}
