package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/engine"
)

// messagesPage retains field/check grouping and exact numeric values. The legacy
// flattened results endpoint remains available when view is omitted.
func (h *AnalysisHandler) messagesPage(w http.ResponseWriter, r *http.Request, run domain.Run, limit, offset int) {
	items := []engine.Message{}
	total := 0
	status, rule, source := r.URL.Query().Get("status"), r.URL.Query().Get("ruleId"), r.URL.Query().Get("source")
	query := strings.ToLower(r.URL.Query().Get("q"))
	if status != "" && status != "PASS" && status != "FAIL" && status != "INCONCLUSIVE" && status != "NOT_APPLICABLE" && status != "UNKNOWN" {
		writeJSON(w, 400, map[string]string{"error": "invalid status"})
		return
	}
	captureFilter := r.URL.Query().Get("captureId")
	allowed := map[string]bool{}
	if captureFilter != "" {
		var manifest struct {
			Corpus []domain.CorpusEntry `json:"corpus"`
		}
		if err := json.Unmarshal([]byte(run.InputManifestJSON), &manifest); err != nil {
			analysisError(w, err)
			return
		}
		for _, entry := range manifest.Corpus {
			if entry.CaptureID == captureFilter {
				allowed[entry.AssemblyID] = true
			}
		}
		if run.CaptureID == captureFilter {
			allowed[run.AssemblyID] = true
		}
	}
	err := h.Repo.VisitResults(r.Context(), run.ProjectID, run.RunID, func(payload string) error {
		var result engine.Result
		decoder := json.NewDecoder(strings.NewReader(payload))
		decoder.UseNumber()
		if err := decoder.Decode(&result); err != nil {
			return err
		}
		for _, message := range result.Messages {
			for i := range message.Fields {
				if message.Fields[i].ValueText == "" && message.Fields[i].Value != nil {
					message.Fields[i].ValueText = fmt.Sprint(message.Fields[i].Value)
				}
			}
			if captureFilter != "" && !allowed[message.SourceSpan.AssemblyID] {
				continue
			}
			if status != "" && message.Status != status || source != "" && message.SourceSpan.StreamID != source {
				continue
			}
			if rule != "" {
				found := false
				for _, check := range message.Checks {
					if check.RuleID == rule {
						found = true
						break
					}
				}
				if !found {
					continue
				}
			}
			if query != "" {
				data, _ := json.Marshal(message.Fields)
				if !strings.Contains(strings.ToLower(string(data)), query) {
					continue
				}
			}
			if total >= offset && len(items) < limit+1 {
				items = append(items, message)
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
	if len(items) > limit {
		next = strconv.Itoa(offset + limit)
		items = items[:limit]
	}
	writeJSON(w, 200, map[string]any{"items": items, "nextCursor": next, "total": strconv.Itoa(total)})
}
