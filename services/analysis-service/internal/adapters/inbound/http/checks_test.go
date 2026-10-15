package handler

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	service "github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/application/analysis"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/engine"
)

type checksRepository struct{ service.Repository }

func (checksRepository) VisitResults(ctx context.Context, project, run string, visit func(string) error) error {
	return visit(`{"checks":[{"ruleId":"bound","status":"FAIL","message":"too big","sourceSpan":{"assemblyId":"a1","streamId":"s1","startOffset":"0","endOffset":"8"}},{"ruleId":"bound","status":"PASS","message":"within range","sourceSpan":{"assemblyId":"a2","streamId":"s2","startOffset":"0","endOffset":"8"}},{"ruleId":"other","status":"NOT_APPLICABLE","message":"no examples"},{"ruleId":"bound","status":"PASS","message":"within range","sourceSpan":{"assemblyId":"a2","streamId":"s2","startOffset":"8","endOffset":"16"}}]}`)
}
func TestChecksFilterBeforePagination(t *testing.T) {
	h := AnalysisHandler{Repo: checksRepository{}}
	run := domain.Run{ProjectID: "p", RunID: "r", InputManifestJSON: `{"corpus":[{"captureId":"c1","assemblyId":"a1"},{"captureId":"c2","assemblyId":"a2"}]}`}
	for _, test := range []struct {
		query, total, next string
		count              int
	}{
		{"status=PASS&ruleId=bound&captureId=c2&source=s2&q=within", "2", "1", 1},
		{"captureId=c1&status=PASS", "0", "", 0},
		{"status=NOT_APPLICABLE", "1", "", 1},
		{"captureId=c2&source=s1", "0", "", 0},
	} {
		recorder := httptest.NewRecorder()
		h.checksPage(recorder, httptest.NewRequest("GET", "/?"+test.query, nil), run, 1, 0)
		var page struct {
			Items []engine.CheckResult `json:"items"`
			Total string               `json:"total"`
			Next  string               `json:"nextCursor"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if recorder.Code != 200 || len(page.Items) != test.count || page.Total != test.total || page.Next != test.next {
			t.Fatalf("%s: %d %s", test.query, recorder.Code, recorder.Body.String())
		}
	}
}
