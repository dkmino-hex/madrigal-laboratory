package handler

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/application/analysis"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
)

type revisionResponse struct {
	SchemaJSON       string          `json:"schemaJson"`
	RevisionID       string          `json:"revisionId"`
	InterpretationID string          `json:"interpretationId"`
	Version          int             `json:"version"`
	Revision         json.RawMessage `json:"revision"`
	CreatedAt        string          `json:"createdAt"`
	ChangeComment    string          `json:"changeComment"`
	ParentRevisionID string          `json:"parentRevisionId,omitempty"`
}

func revisionDTO(rev domain.Revision) revisionResponse {
	return revisionResponse{SchemaJSON: rev.SchemaJSON, RevisionID: rev.ID, InterpretationID: rev.InterpretationID, Version: rev.Version, Revision: json.RawMessage(rev.SchemaJSON), CreatedAt: rev.CreatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"), ChangeComment: rev.ChangeComment, ParentRevisionID: rev.ParentRevisionID}
}
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("encode response: %v", err)
	}
}
func writeAPIError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, domain.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "resource not found"})
	case errors.Is(err, domain.ErrConflict):
		writeJSON(w, 409, map[string]string{"code": "IDEMPOTENCY_CONFLICT", "message": err.Error()})
	default:
		log.Printf("Analysis error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
	}
}
func (h *InterpretationHandler) CreateRevision(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SchemaJSON       string          `json:"schemaJson,omitempty"`
		Revision         json.RawMessage `json:"revision"`
		ChangeComment    string          `json:"changeComment"`
		ParentRevisionID string          `json:"parentRevisionId"`
	}
	if err := readBody(w, r, &req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid JSON body"})
		return
	}
	if req.SchemaJSON != "" {
		if len(req.Revision) != 0 {
			writeJSON(w, 400, map[string]string{"error": "use revision or schemaJson"})
			return
		}
		req.Revision = json.RawMessage(req.SchemaJSON)
	}
	rev, err := h.service.CreateRevision(r.Context(), service.CreateRevisionInput{ProjectID: r.PathValue("projectId"), InterpretationID: r.PathValue("interpretationId"), Revision: req.Revision, ChangeComment: req.ChangeComment, ParentRevisionID: req.ParentRevisionID, IdempotencyKey: r.Header.Get("Idempotency-Key")})
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, revisionDTO(*rev))
}
func (h *InterpretationHandler) ListRevisions(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if s := r.URL.Query().Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 100 {
			writeJSON(w, 400, map[string]string{"error": "limit must be between 1 and 100"})
			return
		}
		limit = n
	}
	offset := 0
	if s := r.URL.Query().Get("cursor"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 0 {
			writeJSON(w, 400, map[string]string{"error": "invalid cursor"})
			return
		}
		offset = n
	}
	revs, more, err := h.service.ListRevisions(r.Context(), r.PathValue("projectId"), r.PathValue("interpretationId"), limit, offset)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	items := make([]revisionResponse, 0, len(revs))
	for _, rev := range revs {
		items = append(items, revisionDTO(rev))
	}
	page := struct {
		Limit      int    `json:"limit"`
		NextCursor string `json:"nextCursor,omitempty"`
	}{Limit: limit}
	if more {
		page.NextCursor = strconv.Itoa(offset + limit)
	}
	writeJSON(w, 200, map[string]any{"items": items, "page": page})
}
func (h *InterpretationHandler) GetRevision(w http.ResponseWriter, r *http.Request) {
	rev, err := h.service.GetRevision(r.Context(), strings.TrimSpace(r.PathValue("projectId")), strings.TrimSpace(r.PathValue("interpretationId")), strings.TrimSpace(r.PathValue("revisionId")))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, 200, revisionDTO(*rev))
}
