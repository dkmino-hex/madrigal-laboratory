package projects

import (
	"strings"
	"testing"
)

func TestReportIncludesAutomaticSourcesAndCounterexamples(t *testing.T) {
	var out strings.Builder
	observation := map[string]any{"id": "o", "basis": "Разные значения", "generation_json": `{"engineVersion":"research-0.1"}`}
	metadata := map[string][]map[string]any{
		"sourceLinks":      {{"id": "l", "data_json": `{"location":{"captureId":"c","assemblyId":"a","streamId":"s","direction":"A_TO_B","start":"14","length":"2"},"captureSha256":"abcdef","actionId":"action-1","status":"tentative","sources":[{"packetNo":7,"frameOffset":"54","length":"2","streamStart":"14","relation":"primary"}]}`}},
		"observationLinks": {{"observation_id": "o", "link_id": "l", "kind": "counterexample"}, {"observation_id": "other", "link_id": "l", "kind": "support"}},
	}
	indexReportProvenance(metadata).writeObservation(&out, observation)
	for _, expected := range []string{"Разные значения", "research-0.1", "counterexample", "abcdef", "action-1", "Пакет 7", "смещение кадра 54", "длина 2"} {
		if !strings.Contains(out.String(), expected) {
			t.Fatalf("missing %q: %s", expected, out.String())
		}
	}
	if strings.Contains(out.String(), "support") {
		t.Fatal("another observation's link leaked")
	}
}
