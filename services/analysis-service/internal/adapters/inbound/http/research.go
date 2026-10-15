package handler

import (
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/application/analysis"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/research"
	"net/http"
)

func registerResearch(mux *http.ServeMux, s service.ResearchService) {
	mux.HandleFunc("POST /api/v1/projects/{projectId}/discoveries", func(w http.ResponseWriter, r *http.Request) {
		var input research.Input
		if err := readBody(w, r, &input); err != nil {
			writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid discovery input"})
			return
		}
		result, err := s.Discover(r.Context(), r.PathValue("projectId"), input)
		if err != nil {
			analysisError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
}
