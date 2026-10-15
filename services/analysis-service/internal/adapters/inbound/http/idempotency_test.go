package handler

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRevisionRetriesPreserveExactJSONAndComment(t *testing.T) {
	router := testRouter(t)
	call := func(path, key, body string, want int) map[string]any {
		t.Helper()
		request := httptest.NewRequest("POST", path, strings.NewReader(body))
		request.Header.Set("Idempotency-Key", key)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s: %d %s", path, response.Code, response.Body.String())
		}
		var result map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	base := "/api/v1/projects/project/interpretations"
	first := call(base, "create", `{"name":"Schema","revision":{"fields":[]}}`, 201)
	replayed := call(base, "create", `{"name":"Schema","revision":{"fields":[]}}`, 201)
	if first["interpretationId"] != replayed["interpretationId"] || first["currentRevisionId"] != replayed["currentRevisionId"] {
		t.Fatal("retry created another interpretation")
	}
	call(base, "create", `{"name":"Other","revision":{"fields":[]}}`, 409)
	schema := "{\n  \"fields\": []\n}\n"
	body, _ := json.Marshal(map[string]any{"schemaJson": schema, "changeComment": "Основание изменения", "parentRevisionId": first["currentRevisionId"]})
	path := base + "/" + first["interpretationId"].(string) + "/revisions"
	second := call(path, "revision", string(body), 201)
	again := call(path, "revision", string(body), 201)
	if second["revisionId"] != again["revisionId"] || second["schemaJson"] != schema || second["changeComment"] != "Основание изменения" || second["parentRevisionId"] != first["currentRevisionId"] {
		t.Fatalf("revision metadata lost: %+v", second)
	}
	call(path, "revision", `{"revision":{"fields":[]},"changeComment":"Other"}`, 409)
}
