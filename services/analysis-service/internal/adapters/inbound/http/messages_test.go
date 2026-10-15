package handler

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	service "github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/application/analysis"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
)

type messageRepository struct{ service.Repository }

func (messageRepository) VisitResults(ctx context.Context, project, run string, visit func(string) error) error {
	for i := 0; i < 6; i++ {
		if err := visit(`{"messages":[{"sourceSpan":{"assemblyId":"assembly","streamId":"stream","startOffset":"0","endOffset":"8"},"status":"PASS","fields":[{"name":"number","value":18446744073709551615}],"checks":[]}]}`); err != nil {
			return err
		}
	}
	return nil
}

func TestMessagePaginationPreservesExactNumbers(t *testing.T) {
	handler := AnalysisHandler{Repo: messageRepository{}}
	response := httptest.NewRecorder()
	handler.messagesPage(response, httptest.NewRequest("GET", "/?view=messages", nil), domain.Run{ProjectID: "p", RunID: "r"}, 2, 1)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `18446744073709551615`) {
		t.Fatalf("numeric value lost: %d %s", response.Code, response.Body.String())
	}
	var page struct {
		Items []json.RawMessage `json:"items"`
		Next  string            `json:"nextCursor"`
		Total string            `json:"total"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 || page.Next != "3" || page.Total != "6" {
		t.Fatalf("wrong page: %+v", page)
	}
	filtered := httptest.NewRecorder()
	handler.messagesPage(filtered, httptest.NewRequest("GET", "/?status=FAIL", nil), domain.Run{ProjectID: "p", RunID: "r"}, 2, 0)
	if !strings.Contains(filtered.Body.String(), `"items":[]`) {
		t.Fatal(filtered.Body.String())
	}
}
