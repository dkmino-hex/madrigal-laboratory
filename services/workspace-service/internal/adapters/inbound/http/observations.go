package api

import (
	"net/http"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/application/projects"
)

func registerObservations(mux *http.ServeMux, s projects.Store, fail func(http.ResponseWriter, error)) {
	mux.HandleFunc("POST /api/v1/projects/{projectId}/observations", func(w http.ResponseWriter, r *http.Request) {
		var input projects.ObservationInput
		if err := httpapi.Decode(w, r, &input); err != nil {
			httpapi.Error(w, 400, "INVALID_JSON", "expected observation JSON")
			return
		}
		item, err := s.CreateObservation(r.Context(), r.PathValue("projectId"), input, s.Evidence)
		if err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Location", "/api/v1/projects/"+r.PathValue("projectId")+"/observations/"+item["observationId"].(string))
		httpapi.JSON(w, 201, item)
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/observations", func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpapi.Limit(r)
		if err != nil {
			fail(w, projects.ErrInvalid)
			return
		}
		q := r.URL.Query()
		page, err := s.Observations(r.Context(), r.PathValue("projectId"), q.Get("cursor"), q.Get("kind"), q.Get("status"), q.Get("source"), limit)
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, page)
	})
	mux.HandleFunc("PATCH /api/v1/projects/{projectId}/observations/{observationId}", func(w http.ResponseWriter, r *http.Request) {
		var input projects.ObservationPatch
		if err := httpapi.Decode(w, r, &input); err != nil {
			httpapi.Error(w, 400, "INVALID_JSON", "expected observation patch JSON")
			return
		}
		item, err := s.PatchObservation(r.Context(), r.PathValue("projectId"), r.PathValue("observationId"), input)
		if err != nil {
			fail(w, err)
			return
		}
		httpapi.JSON(w, 200, item)
	})
}
