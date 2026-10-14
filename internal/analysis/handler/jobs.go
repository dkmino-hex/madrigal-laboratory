package handler

import (
	"net/http"
	"strings"
)

func (h *AnalysisHandler) JobGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("jobId")
	if !strings.HasPrefix(id, "ana_") {
		writeJSON(w, 404, map[string]string{"code": "NOT_FOUND", "message": "job not found"})
		return
	}
	job, e := h.Repo.GetJob(r.Context(), id)
	if e != nil {
		analysisError(w, e)
		return
	}
	writeJSON(w, 200, job)
}
func (h *AnalysisHandler) JobCancel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("jobId")
	if !strings.HasPrefix(id, "ana_") {
		writeJSON(w, 404, map[string]string{"code": "NOT_FOUND", "message": "job not found"})
		return
	}
	job, e := h.Repo.CancelJob(r.Context(), id)
	if e != nil {
		analysisError(w, e)
		return
	}
	writeJSON(w, 200, job)
}
