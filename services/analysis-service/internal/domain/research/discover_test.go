package research

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func experiment() (CaptureData, []Action) {
	stream := Stream{StreamID: "stream", SessionID: "session", Direction: "A_TO_B"}
	actions := []Action{}
	for i, value := range []int16{1250, -550, 2125, 2200} {
		frame := []byte{0xA6, 0x5C, 0, 0, 2, 0, byte(i + 1), 0x20, 0, 0}
		binary.BigEndian.PutUint16(frame[8:], uint16(value))
		start := int64(len(stream.Intervals)) * 10
		stream.Intervals = append(stream.Intervals, Interval{Start: start, End: start + 10, Kind: "DATA", Data: frame})
		instant := time.Date(2026, 10, 15, 0, i, 0, 0, time.UTC).Format(time.RFC3339Nano)
		stream.Sources = append(stream.Sources, Source{PacketNo: int64(i + 1), FrameStart: 54, FrameEnd: 64, StreamStart: start, StreamEnd: start + 10, Timestamp: instant})
		expected := float64(value) / 100
		if i == 3 {
			expected = 99
		}
		actions = append(actions, Action{ID: fmt.Sprint(i), Name: "Изменить температуру", CapturePath: "experiments/temp.pcap", Start: instant, End: instant, Parameters: json.RawMessage(fmt.Sprintf(`{"temperature":%g}`, expected))})
	}
	stream.LogicalLength = 40
	stream.SampleLength = 40
	return CaptureData{CaptureID: "capture", CaptureName: "temp.pcap", SHA256: fmt.Sprintf("%064d", 1), AssemblyID: "assembly", SettingsVersion: "settings", Complete: true, Streams: []Stream{stream}}, actions
}
func TestDiscoveryFindsSignedScaledValueAndKeepsCounterexample(t *testing.T) {
	capture, actions := experiment()
	result := Discover("project", Input{}, []CaptureData{capture}, actions, nil)
	if len(result.Rows) != 4 {
		t.Fatalf("expected four framed messages, got %d: %v", len(result.Rows), result.Warnings)
	}
	var found *Candidate
	for i := range result.Candidates {
		c := &result.Candidates[i]
		if c.Kind == "parameter" && c.Offset == 8 && c.Encoding == "int16be" && c.Divisor == 100 {
			found = c
			break
		}
	}
	if found == nil {
		t.Fatalf("signed scaled field not found: %+v", result.Candidates)
	}
	if found.Matches != 3 || found.Total != 4 || len(found.Counterexamples) != 1 {
		t.Fatalf("incorrect evidence counts: %+v", found)
	}
	if len(found.Examples) != 4 || found.Examples[0].Sources[0].FrameOffset != "62" {
		t.Fatalf("source clipping lost: %+v", found.Examples)
	}
	var schema map[string]any
	if json.Unmarshal([]byte(found.SchemaJSON), &schema) != nil || schema["direction"] != "A_TO_B" {
		t.Fatalf("invalid proposed schema: %s", found.SchemaJSON)
	}
	for _, row := range result.Rows {
		if row.Boundary != "inferred-length-prefix" {
			t.Fatalf("coalesced stream treated as TCP packets: %+v", row)
		}
	}
}
func TestAmbiguousJournalDoesNotUseTheDesiredValueToChooseAnAction(t *testing.T) {
	capture, actions := experiment()
	other := actions[0]
	other.ID = "conflicting"
	other.Parameters = json.RawMessage(`{"temperature":42}`)
	actions = append(actions, other)
	result := Discover("project", Input{}, []CaptureData{capture}, actions, nil)
	if _, known := result.Rows[0].Values["params.temperature"]; known {
		t.Fatal("overlapping contradictory actions must remain unknown")
	}
	if result.Rows[0].Association != "overlapping-windows" {
		t.Fatal("ambiguity not reported")
	}
}
func TestGapsAreNeverUsedAsNumericValues(t *testing.T) {
	capture, actions := experiment()
	capture.Streams[0].Intervals[1] = Interval{Start: 10, End: 20, Kind: "GAP"}
	result := Discover("project", Input{}, []CaptureData{capture}, actions, nil)
	for _, row := range result.Rows {
		if row.Start < 20 && row.Start+int64(len(row.Raw)) > 10 {
			t.Fatalf("invented bytes in gap: %+v", row)
		}
	}
	if len(result.Warnings) < 2 {
		t.Fatal("capture defect not explained")
	}
}
func TestExactUnsigned64Candidates(t *testing.T) {
	bytes := make([]byte, 8)
	binary.BigEndian.PutUint64(bytes, ^uint64(0))
	text, ok := Decode(bytes, 0, "uint64be")
	if !ok || text != "18446744073709551615" {
		t.Fatal("uint64 rounded", text)
	}
	if equalValue(text, "18446744073709551614", 1, "uint64be") {
		t.Fatal("adjacent uint64 values compared equal")
	}
}
