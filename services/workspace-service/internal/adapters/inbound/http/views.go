package api

import (
	"net/http"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/application/projects"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func registerViews(mux *http.ServeMux, s projects.Store, fail func(http.ResponseWriter, error)) {
	mux.HandleFunc("POST /api/v1/projects/{projectId}/observations/automatic", func(w http.ResponseWriter, r *http.Request) {
		var input domain.AutomaticObservation
		if err := httpapi.Decode(w, r, &input); err != nil {
			fail(w, projects.ErrInvalid)
			return
		}
		input.IdempotencyKey = r.Header.Get("Idempotency-Key")
		result, err := s.CreateAutomaticObservation(r.Context(), r.PathValue("projectId"), input)
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 201, result)
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/settings", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.Settings(r.Context(), r.PathValue("projectId"), r.URL.Query().Get("settingsVersion"))
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, map[string]any{"items": items})
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/artifacts", func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpapi.Limit(r)
		if err != nil {
			fail(w, projects.ErrInvalid)
			return
		}
		page, err := s.Artifacts(r.Context(), r.PathValue("projectId"), r.URL.Query().Get("cursor"), limit)
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, page)
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/action-log/{importId}", func(w http.ResponseWriter, r *http.Request) {
		item, err := s.JournalImport(r.Context(), r.PathValue("projectId"), r.PathValue("importId"))
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, item)
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/evidence", func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpapi.Limit(r)
		if err != nil {
			fail(w, projects.ErrInvalid)
			return
		}
		page, err := s.Links(r.Context(), r.PathValue("projectId"), r.URL.Query().Get("cursor"), r.URL.Query().Get("actionId"), limit)
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, page)
	})
	save := func(w http.ResponseWriter, r *http.Request) {
		var input domain.SourceLink
		if err := httpapi.Decode(w, r, &input); err != nil {
			fail(w, projects.ErrInvalid)
			return
		}
		if id := r.PathValue("evidenceId"); id != "" {
			if input.ID != "" && input.ID != id {
				fail(w, projects.ErrInvalid)
				return
			}
			input.ID = id
		}
		item, err := s.SaveLink(r.Context(), r.PathValue("projectId"), input, r.Header.Get("Idempotency-Key"))
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, item)
	}
	mux.HandleFunc("POST /api/v1/projects/{projectId}/evidence", save)
	mux.HandleFunc("PATCH /api/v1/projects/{projectId}/evidence/{evidenceId}", save)
	mux.HandleFunc("DELETE /api/v1/projects/{projectId}/observations/{observationId}", func(w http.ResponseWriter, r *http.Request) {
		project, id := r.PathValue("projectId"), r.PathValue("observationId")
		if err := s.DeleteObservation(r.Context(), project, id); err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, map[string]any{"projectId": project, "hypothesisId": id, "deleted": true})
	})
}
