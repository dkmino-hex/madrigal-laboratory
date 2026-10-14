package corpus_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gopacket/gopacket"
	"github.com/gopacket/gopacket/layers"
	"github.com/gopacket/gopacket/pcapgo"

	"github.com/dkmino-hex/madrigal-laboratory/internal/corpus"
)

func TestProvidedAcceptanceCorpus(t *testing.T) {
	var acceptance struct {
		Captures []struct {
			File             string `json:"file"`
			SHA256           string `json:"sha256"`
			PacketCount      int    `json:"packetCount"`
			ConnectionStarts []int  `json:"connectionStarts"`
			Truncated        []int  `json:"truncatedPackets"`
			Checksum         []int  `json:"checksumUncertainPackets"`
		}
	}
	data, err := os.ReadFile("../../testdata/acceptance/day1.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &acceptance); err != nil {
		t.Fatal(err)
	}
	if len(acceptance.Captures) != 12 {
		t.Fatal("expected all 12 captures")
	}
	for _, expected := range acceptance.Captures {
		t.Run(expected.File, func(t *testing.T) {
			path := filepath.Join("../../testdata/sample_protocol", filepath.FromSlash(expected.File))
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			hash := sha256.Sum256(data)
			if hex.EncodeToString(hash[:]) != expected.SHA256 {
				t.Fatal("fixture was changed")
			}
			report, err := corpus.Inspect(path)
			if err != nil {
				t.Fatal(err)
			}
			if len(report.Packets) != expected.PacketCount {
				t.Fatalf("count=%d", len(report.Packets))
			}
			var starts, truncated, checksum []int
			for i, p := range report.Packets {
				if p.No != i+1 {
					t.Fatal("numbering")
				}
				if p.SYN && !p.ACK {
					starts = append(starts, p.No)
				}
				if p.CapturedLength < p.OriginalLength {
					truncated = append(truncated, p.No)
				}
				if p.Checksum == "INVALID_OR_OFFLOAD" {
					checksum = append(checksum, p.No)
				}
				payload, err := hex.DecodeString(p.PayloadHex)
				if err != nil {
					t.Fatal(err)
				}
				if p.PayloadOffset+len(payload) > p.CapturedLength {
					t.Fatal("payload is outside frame")
				}
			}
			for _, pair := range [][2][]int{{starts, expected.ConnectionStarts}, {truncated, expected.Truncated}, {checksum, expected.Checksum}} {
				if !equal(pair[0], pair[1]) {
					t.Fatalf("observed=%v expected=%v", pair[0], pair[1])
				}
			}
		})
	}
	base, err := corpus.Inspect("../../testdata/sample_protocol/research/01_configuration.pcap")
	if err != nil {
		t.Fatal(err)
	}
	if base.Packets[3].PayloadHex != "a65c00" || base.Packets[3].PayloadOffset != 54 || base.Packets[5].PayloadHex != "0000" {
		t.Fatal("first length field source coordinates changed")
	}
}

func equal(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestPayloadOffsetIncludesTCPOptions(t *testing.T) {
	eth := &layers.Ethernet{SrcMAC: net.HardwareAddr{1, 2, 3, 4, 5, 6}, DstMAC: net.HardwareAddr{6, 5, 4, 3, 2, 1}, EthernetType: layers.EthernetTypeIPv4}
	ip := &layers.IPv4{Version: 4, TTL: 64, Protocol: layers.IPProtocolTCP, SrcIP: net.IPv4(10, 0, 0, 1), DstIP: net.IPv4(10, 0, 0, 2)}
	tcp := &layers.TCP{SrcPort: 42010, DstPort: 46123, Seq: 10, ACK: true, Window: 1024, Options: []layers.TCPOption{{OptionType: layers.TCPOptionKindMSS, OptionLength: 4, OptionData: []byte{5, 180}}}}
	if err := tcp.SetNetworkLayerForChecksum(ip); err != nil {
		t.Fatal(err)
	}
	payload := []byte{0xa6, 0x5c, 0, 0, 0, 1, 0, 0x10}
	buffer := gopacket.NewSerializeBuffer()
	if err := gopacket.SerializeLayers(buffer, gopacket.SerializeOptions{FixLengths: true, ComputeChecksums: true}, eth, ip, tcp, gopacket.Payload(payload)); err != nil {
		t.Fatal(err)
	}
	var capture bytes.Buffer
	writer := pcapgo.NewWriter(&capture)
	if err := writer.WriteFileHeader(65535, layers.LinkTypeEthernet); err != nil {
		t.Fatal(err)
	}
	data := buffer.Bytes()
	if err := writer.WritePacket(gopacket.CaptureInfo{Timestamp: time.Unix(1, 123456000), CaptureLength: len(data), Length: len(data)}, data); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "options.pcap")
	if err := os.WriteFile(path, capture.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	report, err := corpus.Inspect(path)
	if err != nil {
		t.Fatal(err)
	}
	p := report.Packets[0]
	if p.PayloadOffset != 58 || p.PayloadHex != hex.EncodeToString(payload) || p.Checksum != "VALID" {
		t.Fatalf("options: %+v", p)
	}
}
