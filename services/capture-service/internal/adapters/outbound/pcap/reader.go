package pcap

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"os"

	"github.com/gopacket/gopacket"
	"github.com/gopacket/gopacket/layers"
	"github.com/gopacket/gopacket/pcapgo"

	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain/reassembly"
)

func ReadCaptureContext(ctx context.Context, path string, maxPackets int) (string, []Packet, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", nil, err
	}
	defer f.Close()
	r := bufio.NewReader(f)
	header, err := r.Peek(4)
	if err != nil {
		return "", nil, err
	}
	var source gopacket.PacketDataSource
	var format string
	var linkType func(gopacket.CaptureInfo) layers.LinkType
	if binary.LittleEndian.Uint32(header) == 0x0a0d0d0a {
		ng, err := pcapgo.NewNgReader(r, pcapgo.NgReaderOptions{WantMixedLinkType: true})
		if err != nil {
			return "", nil, err
		}
		source, format = ng, "pcapng"
		linkType = func(ci gopacket.CaptureInfo) layers.LinkType {
			if len(ci.AncillaryData) > 0 {
				if lt, ok := ci.AncillaryData[0].(layers.LinkType); ok {
					return lt
				}
			}
			return ng.LinkType()
		}
	} else {
		pc, err := pcapgo.NewReader(r)
		if err != nil {
			return "", nil, err
		}
		source, format = pc, "pcap"
		linkType = func(gopacket.CaptureInfo) layers.LinkType { return pc.LinkType() }
	}
	packets := make([]Packet, 0)
	for {
		if err := ctx.Err(); err != nil {
			return "", nil, err
		}
		data, ci, err := source.ReadPacketData()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", nil, fmt.Errorf("packet %d: %w", len(packets)+1, err)
		}
		if len(packets) >= maxPackets {
			return "", nil, fmt.Errorf("packet limit %d exceeded", maxPackets)
		}
		p := Packet{Number: len(packets) + 1, Time: ci.Timestamp, InterfaceNo: ci.InterfaceIndex, LinkType: int(linkType(ci)), CapturedLength: ci.CaptureLength, OriginalLength: ci.Length, Frame: append([]byte(nil), data...), ChecksumStatus: "UNKNOWN"}
		if p.CapturedLength != len(data) {
			p.CapturedLength = len(data)
		}
		if linkType(ci) != layers.LinkTypeEthernet {
			p.Diagnostic = "unsupported link type"
		} else {
			decodeTCP(&p)
		}
		packets = append(packets, p)
	}
	return format, packets, nil
}

func decodeTCP(p *Packet) {
	b := p.Frame
	if len(b) < 14 {
		p.Diagnostic = "truncated ethernet header"
		return
	}
	ethType := binary.BigEndian.Uint16(b[12:14])
	off := 14
	for ethType == 0x8100 || ethType == 0x88a8 {
		if len(b) < off+4 {
			p.Diagnostic = "truncated VLAN header"
			return
		}
		ethType = binary.BigEndian.Uint16(b[off+2 : off+4])
		off += 4
	}
	if ethType != 0x0800 {
		return
	}
	if len(b) < off+20 {
		p.Diagnostic = "truncated IPv4 header"
		return
	}
	if b[off]>>4 != 4 {
		p.Diagnostic = "invalid IPv4 version"
		return
	}
	ihl := int(b[off]&0x0f) * 4
	if ihl < 20 || len(b) < off+ihl {
		p.Diagnostic = "invalid IPv4 header length"
		return
	}
	ipLen := int(binary.BigEndian.Uint16(b[off+2 : off+4]))
	if ipLen < ihl {
		p.Diagnostic = "invalid IPv4 total length"
		return
	}
	if b[off+9] != 6 {
		return
	}
	frag := binary.BigEndian.Uint16(b[off+6 : off+8])
	if frag&0x3fff != 0 {
		p.Diagnostic = "fragmented IPv4 unsupported"
		return
	}
	ipEnd := off + ipLen
	if ipEnd > len(b) {
		ipEnd = len(b)
		p.Diagnostic = "truncated IPv4 packet"
	}
	tcpStart := off + ihl
	if ipEnd < tcpStart+20 {
		p.Diagnostic = "truncated TCP header"
		return
	}
	tcpLen := int(b[tcpStart+12]>>4) * 4
	if tcpLen < 20 || ipEnd < tcpStart+tcpLen {
		p.Diagnostic = "invalid TCP header length"
		return
	}
	src, _ := netip.AddrFromSlice(b[off+12 : off+16])
	dst, _ := netip.AddrFromSlice(b[off+16 : off+20])
	p.SourceIP, p.DestinationIP = src.String(), dst.String()
	p.SourcePort = binary.BigEndian.Uint16(b[tcpStart : tcpStart+2])
	p.DestinationPort = binary.BigEndian.Uint16(b[tcpStart+2 : tcpStart+4])
	p.Sequence = binary.BigEndian.Uint32(b[tcpStart+4 : tcpStart+8])
	p.Acknowledgment = binary.BigEndian.Uint32(b[tcpStart+8 : tcpStart+12])
	p.Flags = b[tcpStart+13]
	p.PayloadStart = tcpStart + tcpLen
	p.PayloadLength = ipEnd - p.PayloadStart
	if off+ipLen <= len(b) {
		checksum := binary.BigEndian.Uint16(b[tcpStart+16 : tcpStart+18])
		partial := partialTCPChecksum(b[off+12:off+20], ipLen-ihl)
		if validTCPChecksum(b[off+12:off+20], b[tcpStart:off+ipLen]) {
			p.ChecksumStatus = "VALID"
		} else if checksum == 0 || checksum == partial || checksum == ^partial {
			p.ChecksumStatus = "OFFLOADED"
			p.Diagnostic = "partial TCP checksum; possible checksum offloading"
		} else {
			p.ChecksumStatus = "INVALID"
			p.Diagnostic = "invalid TCP checksum"
		}
	}
}

func partialTCPChecksum(addresses []byte, tcpLength int) uint16 {
	pseudo := make([]byte, 12)
	copy(pseudo, addresses)
	pseudo[9] = 6
	binary.BigEndian.PutUint16(pseudo[10:], uint16(tcpLength))
	var sum uint32
	for i := 0; i < len(pseudo); i += 2 {
		sum += uint32(binary.BigEndian.Uint16(pseudo[i : i+2]))
	}
	for sum>>16 != 0 {
		sum = (sum & 0xffff) + (sum >> 16)
	}
	return ^uint16(sum)
}

func validTCPChecksum(addresses, tcp []byte) bool {
	pseudo := make([]byte, 12)
	copy(pseudo, addresses)
	pseudo[9] = 6
	binary.BigEndian.PutUint16(pseudo[10:], uint16(len(tcp)))
	var sum uint32
	for _, part := range [][]byte{pseudo, tcp} {
		for i := 0; i+1 < len(part); i += 2 {
			sum += uint32(binary.BigEndian.Uint16(part[i : i+2]))
		}
		if len(part)%2 != 0 {
			sum += uint32(part[len(part)-1]) << 8
		}
	}
	for sum>>16 != 0 {
		sum = (sum & 0xffff) + (sum >> 16)
	}
	return sum == 0xffff
}

// Packet is the capture context model populated by the file decoder.
type Packet = reassembly.Packet
