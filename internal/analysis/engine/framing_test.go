package engine

import (
	"encoding/base64"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/capture"
	"testing"
)

func TestFramingChecksAndSources(t *testing.T) {
	// Two protocol messages, 8-byte header; payload length at bytes [2:4].
	payload := []byte{0xa6, 0x5c, 0, 2, 1, 2, 3, 4, 'O', 'K', 0xa6, 0x5c, 0, 1, 1, 2, 3, 4, 'X'}
	schema := `{"framing":{"magic":"A65C","headerLength":8,"lengthOffset":2,"lengthType":"uint16be"},"fields":[{"name":"magic","type":"hex","length":2},{"name":"size","type":"uint16be","length":2},{"name":"tag","type":"uint8"}],"checks":[{"id":"tag1","field":"tag","op":"eq","value":1}]}`
	blocks := []capture.Block{{AssemblyID: "a", StreamID: "s", Length: uint64(len(payload)), Intervals: []capture.Interval{{Kind: "DATA", StartOffset: 0, EndOffset: uint64(len(payload)), Data: base64.StdEncoding.EncodeToString(payload)}}, Sources: []capture.Source{{PacketNo: 1, StreamStart: 0, StreamEnd: 5}, {PacketNo: 2, StreamStart: 5, StreamEnd: uint64(len(payload))}}}}
	got, e := Parse(schema, blocks)
	if e != nil {
		t.Fatal(e)
	}
	if len(got.Messages) != 2 {
		t.Fatalf("messages=%d errors=%v", len(got.Messages), got.Errors)
	}
	if got.Messages[0].Status != "PASS" || got.Messages[1].Status != "PASS" {
		t.Fatalf("statuses: %+v", got.Messages)
	}
	if len(got.Messages[0].Fields[2].SourceSpan.PacketRefs) != 1 {
		t.Fatal("incorrect source mapping")
	}
}
func TestTruncatedMessageInconclusive(t *testing.T) {
	schema := `{"framing":{"magic":"A65C","headerLength":8,"lengthOffset":2,"lengthType":"uint16be"},"fields":[]}`
	data := []byte{0xa6, 0x5c, 0, 10, 0, 0, 0, 0}
	blocks := []capture.Block{{Length: 8, Intervals: []capture.Interval{{Kind: "DATA", StartOffset: 0, EndOffset: 8, Data: base64.StdEncoding.EncodeToString(data)}}}}
	r, e := Parse(schema, blocks)
	if e != nil {
		t.Fatal(e)
	}
	if len(r.Messages) != 0 || len(r.UnknownRegions) == 0 {
		t.Fatalf("expected inconclusive: %+v", r)
	}
}
func TestInvalidSchemaPath(t *testing.T) {
	_, e := Validate(`{"fields":[{"name":"x","type":"invalid"}]}`)
	if e == nil {
		t.Fatal("expected schema error")
	}
}
