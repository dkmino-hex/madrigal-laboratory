package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/engine"
)

// checksPage filters individual checks before pagination, independently of the
// aggregate message status. Checks without a source keep their missing context.
func (h *AnalysisHandler) checksPage(w http.ResponseWriter, r *http.Request, run domain.Run, limit, offset int) {
	status, rule, source := r.URL.Query().Get("status"), r.URL.Query().Get("ruleId"), r.URL.Query().Get("source")
	query, capture := strings.ToLower(r.URL.Query().Get("q")), r.URL.Query().Get("captureId")
	if status != "" && status != "PASS" && status != "FAIL" && status != "INCONCLUSIVE" && status != "NOT_APPLICABLE" && status != "UNKNOWN" {
		writeJSON(w, 400, map[string]string{"code": "BAD_REQUEST", "message": "invalid check status"})
		return
	}
	allowed := map[string]bool{}
	if capture != "" {
		var manifest struct {
			Corpus []domain.CorpusEntry `json:"corpus"`
		}
		if err := json.Unmarshal([]byte(run.InputManifestJSON), &manifest); err != nil {
			analysisError(w, err)
			return
		}
		for _, entry := range manifest.Corpus {
			if entry.CaptureID == capture {
				allowed[entry.AssemblyID] = true
			}
		}
		if run.CaptureID == capture {
			allowed[run.AssemblyID] = true
		}
	}
	items := []engine.CheckResult{}
	total := 0
	err := h.Repo.VisitResults(r.Context(), run.ProjectID, run.RunID, func(payload string) error {
		var result engine.Result
		decoder := json.NewDecoder(strings.NewReader(payload))
		decoder.UseNumber()
		if err := decoder.Decode(&result); err != nil {
			return err
		}
		for _, check := range result.Checks {
			if status != "" && check.Status != status || rule != "" && check.RuleID != rule {
				continue
			}
			if source != "" && (check.SourceSpan == nil || check.SourceSpan.StreamID != source) {
				continue
			}
			if capture != "" && (check.SourceSpan == nil || !allowed[check.SourceSpan.AssemblyID]) {
				continue
			}
			if query != "" && !strings.Contains(strings.ToLower(check.RuleID+" "+check.Message), query) {
				continue
			}
			if total >= offset && len(items) < limit {
				items = append(items, check)
			}
			total++
		}
		return r.Context().Err()
	})
	if err != nil {
		analysisError(w, err)
		return
	}
	next := ""
	if offset+len(items) < total {
		next = strconv.Itoa(offset + limit)
	}
	writeJSON(w, 200, map[string]any{"items": items, "nextCursor": next, "total": strconv.Itoa(total)})
}
