package reassembly

import (
	"bytes"
	"fmt"
	"sort"
)

type segment struct {
	excluded   bool
	start      int64
	data       []byte
	packetNo   int
	frameStart int
}

type boundary struct {
	pos     int64
	segment int
	start   bool
}

type directionBuilder struct {
	checksum string
	packets  []Packet
	segments []segment
	baseSeq  uint32
	seen     bool
	synSeq   *uint32
}

type sessionBuilder struct {
	session  Session
	dirs     [2]directionBuilder
	firstSyn *uint32
	closed   bool
}

func endpointKey(e Endpoint) string { return fmt.Sprintf("%s:%d", e.IP, e.Port) }
func tupleKey(a, b Endpoint) string {
	x, y := endpointKey(a), endpointKey(b)
	if x > y {
		x, y = y, x
	}
	return x + "|" + y
}

func BuildSessions(captureID, assemblyID string, packets []Packet, checksumPolicy ...string) []Session {
	policy := "warn"
	if len(checksumPolicy) > 0 {
		policy = checksumPolicy[0]
	}
	groups := map[string][]*sessionBuilder{}
	ordered := make([]*sessionBuilder, 0)
	for _, p := range packets {
		if p.SourceIP == "" {
			continue
		}
		src := Endpoint{p.SourceIP, p.SourcePort}
		dst := Endpoint{p.DestinationIP, p.DestinationPort}
		key := tupleKey(src, dst)
		var current *sessionBuilder
		if group := groups[key]; len(group) > 0 {
			current = group[len(group)-1]
		}
		initialSYN := p.Flags&0x02 != 0 && p.Flags&0x10 == 0
		newGeneration := current == nil
		if current != nil && initialSYN && (current.firstSyn == nil || *current.firstSyn != p.Sequence || current.closed) {
			newGeneration = true
		}
		if newGeneration {
			generation := len(groups[key]) + 1
			id := fmt.Sprintf("%s_s%d", assemblyID, len(ordered)+1)
			current = &sessionBuilder{session: Session{ID: id, CaptureID: captureID, AssemblyID: assemblyID, Generation: generation, A: src, B: dst, FirstPacketNo: p.Number, LastPacketNo: p.Number, FirstSeen: p.Time, LastSeen: p.Time}}
			if initialSYN {
				seq := p.Sequence
				current.firstSyn = &seq
				current.session.Initiator = "A"
			} else {
				current.session.Diagnostics = append(current.session.Diagnostics, "initial SYN not observed; stream beginning may be unknown")
			}
			groups[key] = append(groups[key], current)
			ordered = append(ordered, current)
		}
		if p.Time.Before(current.session.FirstSeen) {
			current.session.FirstSeen = p.Time
		}
		if p.Time.After(current.session.LastSeen) {
			current.session.LastSeen = p.Time
		}
		if p.Number < current.session.FirstPacketNo {
			current.session.FirstPacketNo = p.Number
		}
		if p.Number > current.session.LastPacketNo {
			current.session.LastPacketNo = p.Number
		}
		dir := 0
		if current.session.A != src {
			dir = 1
		}
		d := &current.dirs[dir]
		d.checksum = policy
		d.packets = append(d.packets, p)
		if !d.seen {
			d.baseSeq = p.Sequence
			d.seen = true
		}
		if p.Flags&0x02 != 0 && d.synSeq == nil {
			seq := p.Sequence
			d.synSeq = &seq
		}
		if p.Flags&(0x01|0x04) != 0 {
			current.closed = true
		}
	}
	result := make([]Session, 0, len(ordered))
	for _, b := range ordered {
		for i := range b.dirs {
			label := "A_TO_B"
			if i == 1 {
				label = "B_TO_A"
			}
			b.session.Streams[i] = assemble(b.session.ID+fmt.Sprintf("_%d", i), label, &b.dirs[i])
		}
		result = append(result, b.session)
	}
	return result
}

func assemble(id, direction string, d *directionBuilder) Stream {
	out := Stream{ID: id, Direction: direction, Intervals: []Interval{}}
	if !d.seen {
		return out
	}
	if d.synSeq != nil {
		seq := *d.synSeq
		out.InitialSeq = &seq
		out.KnownStart = true
	}
	base := int64(0)
	if d.synSeq != nil {
		base = int64(int32(*d.synSeq-d.baseSeq)) + 1
	}
	first := true
	checksumDiagnostic := false
	for _, p := range d.packets {
		if p.PayloadLength == 0 {
			continue
		}
		start := int64(int32(p.Sequence - d.baseSeq))
		if p.Flags&0x02 != 0 {
			start++
		}
		if first && d.synSeq == nil {
			base = start
			first = false
		}
		excluded := p.ChecksumStatus == "INVALID" && d.checksum == "strict"
		if p.ChecksumStatus == "INVALID" && d.checksum != "ignore" && !checksumDiagnostic {
			message := "invalid TCP checksum; payload retained"
			if excluded {
				message = "invalid TCP checksum; payload excluded by strict policy"
			}
			out.Diagnostic = append(out.Diagnostic, message)
			checksumDiagnostic = true
		}
		d.segments = append(d.segments, segment{excluded: excluded, start: start, data: p.Frame[p.PayloadStart : p.PayloadStart+p.PayloadLength], packetNo: p.Number, frameStart: p.PayloadStart})
	}
	if len(d.segments) == 0 {
		return out
	}
	if d.synSeq == nil {
		for _, s := range d.segments {
			if s.start < base {
				base = s.start
			}
		}
		out.Diagnostic = append(out.Diagnostic, "initial sequence unknown")
	}
	for i := range d.segments {
		d.segments[i].start -= base
	}
	events := []boundary{}
	for i, s := range d.segments {
		if s.start < 0 {
			out.Diagnostic = append(out.Diagnostic, "payload precedes observed SYN; excluded")
			continue
		}
		events = append(events, boundary{pos: s.start, segment: i, start: !s.excluded}, boundary{pos: s.start + int64(len(s.data)), segment: i})
	}
	sort.Slice(events, func(i, j int) bool { return events[i].pos < events[j].pos })
	active := map[int]bool{}
	lo := int64(0)
	for index := 0; index < len(events); {
		pos := events[index].pos
		if pos > lo {
			out.Intervals = append(out.Intervals, intervalsFor(d.segments, active, lo, pos)...)
		}
		for index < len(events) && events[index].pos == pos {
			if events[index].start {
				active[events[index].segment] = true
			} else {
				delete(active, events[index].segment)
			}
			index++
		}
		lo = pos
	}
	out.Length = uint64(lo)
	return out
}

func intervalsFor(segments []segment, active map[int]bool, lo, hi int64) []Interval {
	if hi <= lo {
		return nil
	}
	if len(active) == 1 {
		for index := range active {
			s := segments[index]
			return []Interval{{
				Start: uint64(lo), End: uint64(hi), Kind: "KNOWN",
				Data: append([]byte(nil), s.data[lo-s.start:hi-s.start]...),
				Sources: []SourceSpan{{PacketNo: s.packetNo,
					FrameStart: s.frameStart + int(lo-s.start), FrameEnd: s.frameStart + int(hi-s.start),
					StreamStart: uint64(lo), StreamEnd: uint64(hi)}},
			}}
		}
	}
	indices := make([]int, 0, len(active))
	for index := range active {
		indices = append(indices, index)
	}
	sort.Slice(indices, func(i, j int) bool { return segments[indices[i]].packetNo < segments[indices[j]].packetNo })
	if len(indices) == 0 {
		return []Interval{{Start: uint64(lo), End: uint64(hi), Kind: "GAP"}}
	}
	first := segments[indices[0]]
	firstData := first.data[lo-first.start : hi-first.start]
	conflicts := make([]bool, len(firstData))
	for _, index := range indices[1:] {
		s := segments[index]
		part := s.data[lo-s.start : hi-s.start]
		if bytes.Equal(firstData, part) {
			continue
		}
		for i := range firstData {
			if firstData[i] != part[i] {
				conflicts[i] = true
			}
		}
	}
	result := []Interval{}
	for from := 0; from < len(conflicts); {
		to := from + 1
		for to < len(conflicts) && conflicts[to] == conflicts[from] {
			to++
		}
		start, end := lo+int64(from), lo+int64(to)
		iv := Interval{Start: uint64(start), End: uint64(end), Kind: "KNOWN"}
		if conflicts[from] {
			iv.Kind = "CONFLICT"
		} else {
			iv.Data = append([]byte(nil), firstData[from:to]...)
		}
		for _, index := range indices {
			s := segments[index]
			iv.Sources = append(iv.Sources, SourceSpan{PacketNo: s.packetNo, FrameStart: s.frameStart + int(start-s.start), FrameEnd: s.frameStart + int(end-s.start), StreamStart: uint64(start), StreamEnd: uint64(end)})
		}
		result = append(result, iv)
		from = to
	}
	return result
}
