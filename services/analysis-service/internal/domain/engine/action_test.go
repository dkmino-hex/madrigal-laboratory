package engine

import (
	"encoding/base64"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"testing"
)

func TestSignedScaleActionCheckAndApplicability(t *testing.T) {
	schema := `{"framing":{"fixedLength":4},"direction":"B_TO_A","match":[{"offset":0,"hex":"33"}],"fields":[{"name":"temperature","type":"int16be","offset":1,"scale":0.01}],"checks":[{"id":"temperature-journal","field":"temperature","op":"action","parameter":"observed.temperature"}]}`
	block := domain.Block{AssemblyID: "assembly", StreamID: "stream", Direction: "B_TO_A", Length: 4, Intervals: []domain.Interval{{StartOffset: 0, EndOffset: 4, Kind: "DATA", Data: base64.StdEncoding.EncodeToString([]byte{0x33, 0xFD, 0xDA, 0})}}}
	for _, tc := range []struct{ expected, status string }{{"-5.5", "PASS"}, {"-5.4", "FAIL"}, {"", "INCONCLUSIVE"}} {
		result, err := Parse(schema, []domain.Block{block}, func(domain.Block, Span, string) (string, string) { return tc.expected, "" })
		if err != nil {
			t.Fatal(err)
		}
		if result.Fields[0].ValueText != "-5.5" || result.Checks[0].Status != tc.status {
			t.Fatalf("wrong scaled check: %+v", result)
		}
	}
	block.Direction = "A_TO_B"
	result, err := Parse(schema, []domain.Block{block})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Fields) != 0 || result.Messages[0].Status != "NOT_APPLICABLE" {
		t.Fatal("another message direction was analysed")
	}
}
