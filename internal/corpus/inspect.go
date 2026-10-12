package corpus

import (
	"bufio"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/gopacket/gopacket"
	"github.com/gopacket/gopacket/layers"
	"github.com/gopacket/gopacket/pcapgo"
)

type Packet struct {
	No             int       `json:"packetNo"`
	Time           time.Time `json:"time"`
	CapturedLength int       `json:"capturedLength"`
	OriginalLength int       `json:"originalLength"`
	Interface      int       `json:"interface"`
	LinkType       uint16    `json:"linkType"`
	Source         string    `json:"source,omitempty"`
	Destination    string    `json:"destination,omitempty"`
	Seq            uint32    `json:"seq"`
	Ack            uint32    `json:"ack"`
	SYN            bool      `json:"syn"`
	ACK            bool      `json:"ackFlag"`
	FIN            bool      `json:"fin"`
	RST            bool      `json:"rst"`
	PayloadOffset  int       `json:"payloadOffset,omitempty"`
	PayloadHex     string    `json:"payloadHex,omitempty"`
	Checksum       string    `json:"checksum,omitempty"`
	ChecksumValue  uint16    `json:"checksumValue,omitempty"`
	Diagnostics    []string  `json:"diagnostics,omitempty"`
}

type Report struct {
	File    string   `json:"file"`
	Packets []Packet `json:"packets"`
}
type reader interface {
	ReadPacketData() ([]byte, gopacket.CaptureInfo, error)
	LinkType() layers.LinkType
}

func Inspect(path string) (Report, error) {
	file, err := os.Open(path)
	if err != nil {
		return Report{}, err
	}
	defer file.Close()
	buffer := bufio.NewReader(file)
	magic, err := buffer.Peek(4)
	if err != nil {
		return Report{}, err
	}
	var source reader
	if string(magic) == "\x0a\x0d\x0d\x0a" {
		source, err = pcapgo.NewNgReader(buffer, pcapgo.NgReaderOptions{WantMixedLinkType: true})
	} else {
		source, err = pcapgo.NewReader(buffer)
	}
	if err != nil {
		return Report{}, err
	}
	report := Report{File: filepath.ToSlash(path), Packets: []Packet{}}
	for {
		data, ci, err := source.ReadPacketData()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return Report{}, fmt.Errorf("packet %d: %w", len(report.Packets)+1, err)
		}
		if len(report.Packets) >= 250000 {
			return Report{}, errors.New("research probe packet limit exceeded")
		}
		link := source.LinkType()
		if len(ci.AncillaryData) > 0 {
			if mixed, ok := ci.AncillaryData[0].(layers.LinkType); ok {
				link = mixed
			}
		}
		p := Packet{No: len(report.Packets) + 1, Time: ci.Timestamp.UTC(), CapturedLength: ci.CaptureLength, OriginalLength: ci.Length, Interface: ci.InterfaceIndex, LinkType: uint16(link)}
		if ci.CaptureLength < ci.Length {
			p.Diagnostics = append(p.Diagnostics, "CAPTURE_TRUNCATED")
		}
		decoded := gopacket.NewPacket(data, link, gopacket.Default)
		if failure := decoded.ErrorLayer(); failure != nil {
			p.Diagnostics = append(p.Diagnostics, failure.Error().Error())
		}
		ipLayer, tcpLayer := decoded.Layer(layers.LayerTypeIPv4), decoded.Layer(layers.LayerTypeTCP)
		if ipLayer != nil && tcpLayer != nil {
			ip, tcp := ipLayer.(*layers.IPv4), tcpLayer.(*layers.TCP)
			p.Source, p.Destination = fmt.Sprintf("%s:%d", ip.SrcIP, tcp.SrcPort), fmt.Sprintf("%s:%d", ip.DstIP, tcp.DstPort)
			p.Seq, p.Ack, p.SYN, p.ACK, p.FIN, p.RST = tcp.Seq, tcp.Ack, tcp.SYN, tcp.ACK, tcp.FIN, tcp.RST
			for _, layer := range decoded.Layers() {
				p.PayloadOffset += len(layer.LayerContents())
				if layer.LayerType() == layers.LayerTypeTCP {
					break
				}
			}
			p.PayloadHex = hex.EncodeToString(tcp.Payload)
			p.Checksum, p.ChecksumValue = "UNKNOWN", tcp.Checksum
			if ci.CaptureLength == ci.Length && decoded.ErrorLayer() == nil {
				if err = tcp.SetNetworkLayerForChecksum(ip); err != nil {
					return Report{}, err
				}
				checksum, err := tcp.ComputeChecksum()
				if err != nil {
					return Report{}, err
				}
				if checksum == 0 {
					p.Checksum = "VALID"
				} else {
					p.Checksum = "INVALID_OR_OFFLOAD"
				}
			}
		} else {
			p.Diagnostics = append(p.Diagnostics, "OUTSIDE_IPV4_TCP_PROFILE")
		}
		report.Packets = append(report.Packets, p)
	}
	return report, nil
}
