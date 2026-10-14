package api

import (
	"net/http"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

type evidenceCheck = domain.EvidenceCheck

func registerEvidenceValidation(mux *http.ServeMux, store captures.Store) {
	mux.HandleFunc("POST /internal/v1/projects/{projectId}/evidence/validate", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Evidence []evidenceCheck `json:"evidence"`
		}
		if err := httpapi.Decode(w, r, &input); err != nil || len(input.Evidence) > 100 {
			httpapi.Error(w, 400, "INVALID_REQUEST", "expected up to 100 evidence ranges")
			return
		}
		if err := store.ValidateEvidence(r.Context(), r.PathValue("projectId"), input.Evidence); err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, map[string]any{"valid": true, "checked": len(input.Evidence)})
	})
}
