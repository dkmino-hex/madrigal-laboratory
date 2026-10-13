package handler

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/model"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/repository"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/service"
)

type revisionResponse struct {
	RevisionID       string          `json:"revisionId"`
	InterpretationID string          `json:"interpretationId"`
	Version          int             `json:"version"`
	Revision         json.RawMessage `json:"revision"`
	CreatedAt        string          `json:"createdAt"`
}

func revisionDTO(rev model.Revision) revisionResponse {
	return revisionResponse{RevisionID: rev.ID, InterpretationID: rev.InterpretationID, Version: rev.Version, Revision: json.RawMessage(rev.SchemaJSON), CreatedAt: rev.CreatedAt.UTC().Format("2006-01-02T15:04:05Z")}
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
	case errors.Is(err, repository.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "resource not found"})
	default:
		log.Printf("Analysis error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
	}
}
func (h *InterpretationHandler) CreateRevision(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Revision      json.RawMessage `json:"revision"`
		ChangeComment string          `json:"changeComment"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid JSON body"})
		return
	}
	var extra any
	if err := dec.Decode(&extra); err == nil {
		writeJSON(w, 400, map[string]string{"error": "multiple JSON values"})
		return
	}
	rev, err := h.service.CreateRevision(r.Context(), service.CreateRevisionInput{ProjectID: r.PathValue("projectId"), InterpretationID: r.PathValue("interpretationId"), Revision: req.Revision})
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
