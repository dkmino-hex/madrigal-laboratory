package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/application/analysis"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
)

type InterpretationHandler struct {
	service *service.InterpretationService
}

func NewInterpretationHandler(s *service.InterpretationService) *InterpretationHandler {
	return &InterpretationHandler{service: s}
}

type CreateInterpretationRequest struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Revision    json.RawMessage `json:"revision"`
	// Legacy alias for clients using the earlier prototype.
	Schema     json.RawMessage `json:"schema,omitempty"`
	SchemaJSON string          `json:"schemaJson,omitempty"`
}

type interpretationResponse struct {
	InterpretationID  string `json:"interpretationId"`
	ProjectID         string `json:"projectId"`
	Name              string `json:"name"`
	Description       string `json:"description"`
	CurrentRevisionID string `json:"currentRevisionId"`
	CreatedAt         string `json:"createdAt"`
}

func interpretationDTO(i domain.Interpretation, currentRevisionID string) interpretationResponse {
	return interpretationResponse{InterpretationID: i.ID, ProjectID: i.ProjectID, Name: i.Name, Description: i.Description, CurrentRevisionID: currentRevisionID, CreatedAt: i.CreatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")}
}
func (h *InterpretationHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateInterpretationRequest
	if err := readBody(w, r, &req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid JSON body"})
		return
	}
	if len(req.Revision) == 0 {
		req.Revision = req.Schema
	}
	if req.SchemaJSON != "" {
		if len(req.Revision) != 0 {
			writeJSON(w, 400, map[string]string{"error": "use revision or schemaJson"})
			return
		}
		req.Revision = json.RawMessage(req.SchemaJSON)
	}
	result, err := h.service.Create(r.Context(), service.CreateInterpretationInput{ProjectID: r.PathValue("projectId"), Name: req.Name, Description: req.Description, Schema: req.Revision, IdempotencyKey: r.Header.Get("Idempotency-Key")})
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, interpretationDTO(*result.Interpretation, result.Revision.ID))
}
func (h *InterpretationHandler) List(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeJSON(w, 400, map[string]string{"error": "limit must be between 1 and 100"})
			return
		}
		limit = parsed
	}
	offset := 0
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			writeJSON(w, 400, map[string]string{"error": "invalid cursor"})
			return
		}
		offset = parsed
	}
	all, err := h.service.ListByProject(r.Context(), r.PathValue("projectId"))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if offset > len(all) {
		offset = len(all)
	}
	end := offset + limit
	if end > len(all) {
		end = len(all)
	}
	items := make([]interpretationResponse, 0, end-offset)
	for _, i := range all[offset:end] {
		currentID, err := h.service.CurrentRevisionID(r.Context(), i.ID)
		if err != nil {
			log.Printf("current revision: %v", err)
			writeAPIError(w, err)
			return
		}
		items = append(items, interpretationDTO(i, currentID))
	}
	page := struct {
		Limit      int    `json:"limit"`
		NextCursor string `json:"nextCursor,omitempty"`
	}{Limit: limit}
	if end < len(all) {
		page.NextCursor = strconv.Itoa(end)
	}
	writeJSON(w, 200, map[string]any{"items": items, "page": page})
}

func (h *InterpretationHandler) Get(w http.ResponseWriter, r *http.Request) {
	item, err := h.service.Get(r.Context(), r.PathValue("projectId"), r.PathValue("interpretationId"))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	current, err := h.service.CurrentRevisionID(r.Context(), item.ID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, 200, interpretationDTO(*item, current))
}
