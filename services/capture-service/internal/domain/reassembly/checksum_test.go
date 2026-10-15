package reassembly_test

import (
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain/reassembly"
	"testing"
)

func TestStrictChecksumKeepsMissingBytesAndValidRetransmission(t *testing.T) {
	packets := []reassembly.Packet{{Number: 1, Sequence: 100, Flags: 2}, {Number: 2, Sequence: 101, PayloadLength: 2, Frame: []byte{1, 2}, ChecksumStatus: "INVALID"}, {Number: 3, Sequence: 103, PayloadLength: 1, Frame: []byte{3}, ChecksumStatus: "VALID"}}
	for i := range packets {
		packets[i].SourceIP = "10.0.0.1"
		packets[i].DestinationIP = "10.0.0.2"
	}
	strict := reassembly.BuildSessions("capture", "assembly", packets, "strict")[0].Streams[0]
	if strict.Length != 3 || len(strict.Intervals) != 2 || strict.Intervals[0].Kind != "GAP" || len(strict.Intervals[0].Sources) != 0 {
		t.Fatalf("excluded payload became known or changed coordinates: %+v", strict)
	}
	warn := reassembly.BuildSessions("capture", "assembly", packets, "warn")[0].Streams[0]
	if warn.Intervals[0].Kind != "KNOWN" || len(warn.Diagnostic) == 0 {
		t.Fatalf("warn lost original bytes or warning: %+v", warn)
	}
	packets = append(packets, reassembly.Packet{Number: 4, Sequence: 101, PayloadLength: 2, Frame: []byte{1, 2}, SourceIP: "10.0.0.1", DestinationIP: "10.0.0.2", ChecksumStatus: "VALID"})
	retransmission := reassembly.BuildSessions("capture", "assembly", packets, "strict")[0].Streams[0]
	if retransmission.Intervals[0].Kind != "KNOWN" || retransmission.Intervals[0].Sources[0].PacketNo != 4 {
		t.Fatalf("valid retransmission not retained: %+v", retransmission)
	}
}
