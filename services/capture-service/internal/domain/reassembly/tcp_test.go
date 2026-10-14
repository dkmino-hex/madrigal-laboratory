package reassembly_test

import (
	"bytes"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain/reassembly"
)

func TestReassemblyOwnsBytesAcrossSequenceWrap(t *testing.T) {
	packets := []reassembly.Packet{
		{Number: 1, Sequence: ^uint32(0) - 1, Flags: 2},
		{Number: 2, Sequence: ^uint32(0), PayloadLength: 1, Frame: []byte{1}},
		{Number: 3, Sequence: 0, PayloadLength: 1, Frame: []byte{2}},
	}
	for i := range packets {
		packets[i].SourceIP, packets[i].DestinationIP = "10.0.0.1", "10.0.0.2"
		packets[i].SourcePort, packets[i].DestinationPort = 1000, 2000
	}
	sessions := reassembly.BuildSessions("capture", "assembly", packets)
	if len(sessions) != 1 || sessions[0].Streams[0].Length != 2 || !sessions[0].Streams[0].KnownStart {
		t.Fatalf("sequence wrap changed stream: %+v", sessions)
	}
	packets[1].Frame[0], packets[2].Frame[0] = 9, 9
	var restored []byte
	for _, interval := range sessions[0].Streams[0].Intervals {
		restored = append(restored, interval.Data...)
		if len(interval.Sources) != 1 || interval.Sources[0].FrameStart != 0 || interval.Sources[0].FrameEnd != 1 {
			t.Fatalf("source coordinates changed: %+v", interval)
		}
	}
	if !bytes.Equal(restored, []byte{1, 2}) {
		t.Fatalf("reassembly retained mutable packet buffers: %v", restored)
	}
}
