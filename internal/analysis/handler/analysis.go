package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/capture"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/engine"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/repository"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/service"
	"io"
	"net/http"
	"strconv"
	"strings"
)

type AnalysisHandler struct {
	Preview *service.PreviewService
	Runs    *service.RunsService
	Repo    *repository.InterpretationRepository
}

func readBody(w http.ResponseWriter, r *http.Request, out any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if e := dec.Decode(out); e != nil {
		return e
	}
	var extra any
	if e := dec.Decode(&extra); e != io.EOF {
		return fmt.Errorf("extra JSON values")
	}
	return nil
}
func analysisError(w http.ResponseWriter, err error) {
	code := 500
	msg := "internal server error"
	switch {
	case errors.Is(err, service.ErrInvalidInput):
		code = 400
		msg = err.Error()
	case errors.Is(err, repository.ErrNotFound):
		code = 404
		msg = "resource not found"
	case errors.Is(err, capture.ErrUnavailable):
		code = 503
		msg = err.Error()
	}
	writeJSON(w, code, map[string]any{"code": http.StatusText(code), "message": msg})
}
func (h *AnalysisHandler) PreviewPost(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RevisionID string `json:"revisionId"`
		AssemblyID string `json:"assemblyId"`
		StreamID   string `json:"streamId"`
		Offset     string `json:"offset"`
		Length     string `json:"length"`
	}
	if e := readBody(w, r, &req); e != nil {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid JSON body"})
		return
	}
	offset, e := capture.ParseUnsigned(req.Offset)
	if e != nil {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid offset"})
		return
	}
	length, e := capture.ParseUnsigned(req.Length)
	if e != nil {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid length"})
		return
	}
	result, e := h.Preview.Run(r.Context(), r.PathValue("projectId"), req.RevisionID, req.AssemblyID, req.StreamID, offset, length)
	if e != nil {
		analysisError(w, e)
		return
	}
	writeJSON(w, 200, result)
}
func (h *AnalysisHandler) RunPost(w http.ResponseWriter, r *http.Request) {
	var req repository.RunInput
	if e := readBody(w, r, &req); e != nil {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid JSON body"})
		return
	}
	run, e := h.Runs.Start(r.Context(), r.PathValue("projectId"), req, r.Header.Get("Idempotency-Key"))
	if e != nil {
		analysisError(w, e)
		return
	}
	writeJSON(w, 202, map[string]any{"runId": run.RunID, "jobId": run.JobID, "status": run.Status})
}
func pageParams(r *http.Request) (int, int, error) {
	limit := 50
	offset := 0
	var e error
	if s := r.URL.Query().Get("limit"); s != "" {
		limit, e = strconv.Atoi(s)
		if e != nil || limit < 1 || limit > 100 {
			return 0, 0, errors.New("limit must be 1..100")
		}
	}
	if s := r.URL.Query().Get("cursor"); s != "" {
		offset, e = strconv.Atoi(s)
		if e != nil || offset < 0 {
			return 0, 0, errors.New("invalid cursor")
		}
	}
	return limit, offset, nil
}
func (h *AnalysisHandler) RunsList(w http.ResponseWriter, r *http.Request) {
	limit, offset, e := pageParams(r)
	if e != nil {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": e.Error()})
		return
	}
	status := r.URL.Query().Get("status")
	if status != "" && !strings.Contains("|pending|running|completed|failed|", "|"+status+"|") {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid status"})
		return
	}
	runs, more, e := h.Repo.ListRuns(r.Context(), r.PathValue("projectId"), status, limit, offset)
	if e != nil {
		analysisError(w, e)
		return
	}
	page := map[string]any{"limit": limit}
	nextCursor := ""
	if more {
		page["nextCursor"] = strconv.Itoa(offset + limit)
		nextCursor = strconv.Itoa(offset + limit)
	}
	writeJSON(w, 200, map[string]any{"items": runs, "page": page, "nextCursor": nextCursor})
}
func (h *AnalysisHandler) RunGet(w http.ResponseWriter, r *http.Request) {
	run, e := h.Repo.GetRun(r.Context(), r.PathValue("projectId"), r.PathValue("runId"))
	if e != nil {
		analysisError(w, e)
		return
	}
	// Workspace reports expect an execution status, not a PASS/FAIL check result.
	switch run.Status {
	case "completed":
		run.Status = "SUCCEEDED"
	case "pending":
		run.Status = "QUEUED"
	case "running":
		run.Status = "RUNNING"
	case "failed":
		run.Status = "FAILED"
	}
	writeJSON(w, 200, run)
}
func (h *AnalysisHandler) ResultsGet(w http.ResponseWriter, r *http.Request) {
	limit, offset, e := pageParams(r)
	if e != nil {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": e.Error()})
		return
	}
	run, e := h.Repo.GetRun(r.Context(), r.PathValue("projectId"), r.PathValue("runId"))
	if e != nil {
		analysisError(w, e)
		return
	}
	if run.Status == "pending" || run.Status == "running" {
		writeJSON(w, 409, map[string]string{"code": "CONFLICT", "message": "run not completed"})
		return
	}
	raw, e := h.Repo.Results(r.Context(), run.ProjectID, run.RunID)
	if e != nil {
		analysisError(w, e)
		return
	}
	fields := []engine.Field{}
	checks := []engine.CheckResult{}
	counterexamples := []engine.CheckResult{}
	for _, item := range raw {
		var result engine.Result
		if e = json.Unmarshal([]byte(item), &result); e != nil {
			analysisError(w, e)
			return
		}
		fields = append(fields, result.Fields...)
		checks = append(checks, result.Checks...)
		for _, c := range result.Checks {
			if c.Status == "FAIL" {
				counterexamples = append(counterexamples, c)
			}
		}
	}
	// Apply the documented filters before pagination. Each array is paginated
	// using the same cursor so large result sets are not returned unbounded.
	statusFilter := r.URL.Query().Get("status")
	ruleFilter := r.URL.Query().Get("ruleId")
	sourceFilter := r.URL.Query().Get("source")
	if statusFilter != "" && statusFilter != "PASS" && statusFilter != "FAIL" && statusFilter != "INCONCLUSIVE" && statusFilter != "NOT_APPLICABLE" && statusFilter != "UNKNOWN" {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid check status"})
		return
	}
	filteredFields := make([]engine.Field, 0, len(fields))
	for _, f := range fields {
		if sourceFilter == "" || f.SourceSpan.StreamID == sourceFilter {
			filteredFields = append(filteredFields, f)
		}
	}
	filteredChecks := make([]engine.CheckResult, 0, len(checks))
	filteredCounterexamples := make([]engine.CheckResult, 0, len(counterexamples))
	for _, c := range checks {
		if statusFilter != "" && c.Status != statusFilter {
			continue
		}
		if ruleFilter != "" && c.RuleID != ruleFilter {
			continue
		}
		if sourceFilter != "" && (c.SourceSpan == nil || c.SourceSpan.StreamID != sourceFilter) {
			continue
		}
		filteredChecks = append(filteredChecks, c)
		if c.Status == "FAIL" {
			filteredCounterexamples = append(filteredCounterexamples, c)
		}
	}
	paginateFields := func(values []engine.Field) []engine.Field {
		if offset >= len(values) {
			return []engine.Field{}
		}
		end := offset + limit
		if end > len(values) {
			end = len(values)
		}
		return values[offset:end]
	}
	paginateChecks := func(values []engine.CheckResult) []engine.CheckResult {
		if offset >= len(values) {
			return []engine.CheckResult{}
		}
		end := offset + limit
		if end > len(values) {
			end = len(values)
		}
		return values[offset:end]
	}
	nextCursor := ""
	if offset+limit < len(filteredFields) || offset+limit < len(filteredChecks) || offset+limit < len(filteredCounterexamples) {
		nextCursor = strconv.Itoa(offset + limit)
	}
	page := map[string]any{"limit": limit}
	if nextCursor != "" {
		page["nextCursor"] = nextCursor
	}
	writeJSON(w, 200, map[string]any{"items": paginateFields(filteredFields), "fields": paginateFields(filteredFields), "checks": paginateChecks(filteredChecks), "counterexamples": paginateChecks(filteredCounterexamples), "page": page, "nextCursor": nextCursor})
}
