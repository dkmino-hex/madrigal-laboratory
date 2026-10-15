package engine

import (
	"encoding/base64"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
)

func TestUint64ChecksRetainPrecision(t *testing.T) {
	data := base64.StdEncoding.EncodeToString([]byte{255, 255, 255, 255, 255, 255, 255, 255})
	block := domain.Block{AssemblyID: "assembly", StreamID: "stream", Length: 8, Intervals: []domain.Interval{{Kind: "DATA", EndOffset: 8, Data: data}}}
	schema := `{"fields":[{"name":"number","type":"uint64le"}],"checks":[{"id":"equal","field":"number","op":"eq","value":18446744073709551615},{"id":"different","field":"number","op":"eq","value":18446744073709551614},{"id":"range","field":"number","op":"range","max":18446744073709551614}]}`
	result, err := Parse(schema, []domain.Block{block})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Fields) != 1 || result.Fields[0].ValueText != "18446744073709551615" {
		t.Fatalf("exact value lost: %+v", result.Fields)
	}
	for i, want := range []string{"PASS", "FAIL", "FAIL"} {
		if result.Checks[i].Status != want {
			t.Fatalf("check %d: got %s, want %s", i, result.Checks[i].Status, want)
		}
	}
}
