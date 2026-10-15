package research

import (
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
)

type segment struct {
	start int64
	bytes []byte
}

func knownSegments(stream Stream) []segment {
	out := []segment{}
	for _, interval := range stream.Intervals {
		if interval.Kind != "DATA" || interval.End < interval.Start || int64(len(interval.Data)) != interval.End-interval.Start {
			continue
		}
		if len(out) > 0 && out[len(out)-1].start+int64(len(out[len(out)-1].bytes)) == interval.Start {
			out[len(out)-1].bytes = append(out[len(out)-1].bytes, interval.Data...)
		} else {
			out = append(out, segment{interval.Start, append([]byte(nil), interval.Data...)})
		}
	}
	return out
}
func inferredFraming(segments []segment) (Framing, bool) {
	best := Framing{}
	bestScore := 0
	for _, encoding := range []string{"uint16be", "uint16le", "uint8"} {
		size := 2
		if encoding == "uint8" {
			size = 1
		}
		for offset := 1; offset <= 8; offset++ {
			for header := offset + size; header <= 16; header++ {
				frames, consumed, total := 0, 0, 0
				lengths := map[int]bool{}
				var prefix []byte
				valid := true
				for _, seg := range segments {
					data := seg.bytes
					if len(data) > 8192 {
						data = data[:8192]
					}
					total += len(data)
					for at := 0; at+header <= len(data) && frames < 256; {
						v, ok := Decode(data, at+offset, encoding)
						if !ok {
							break
						}
						payload, _ := strconv.Atoi(v)
						length := header + payload
						if length < header || length > 4096 || at+length > len(data) {
							break
						}
						if prefix == nil {
							prefix = append([]byte(nil), data[at:at+offset]...)
						} else {
							for i := range prefix {
								if prefix[i] != data[at+i] {
									valid = false
									break
								}
							}
						}
						if !valid {
							break
						}
						frames++
						consumed += length
						lengths[length] = true
						at += length
					}
					if !valid {
						break
					}
				}
				if !valid || frames < 3 || consumed*100 < total*80 || len(prefix) == 0 {
					continue
				}
				score := consumed*100/max(total, 1) + min(frames, 50) + len(lengths)*4 + size
				if score > bestScore {
					bestScore = score
					best = Framing{Magic: hex.EncodeToString(prefix), HeaderLength: uint64(header), LengthOffset: uint64(offset), LengthType: encoding}
				}
			}
		}
	}
	return best, bestScore > 0
}
func splitSegments(segments []segment, framing Framing) []segment {
	rows := []segment{}
	magic, _ := hex.DecodeString(framing.Magic)
	for _, seg := range segments {
		for at := 0; at < len(seg.bytes) && len(rows) < MaxRows; {
			length := int(framing.FixedLength)
			if length == 0 {
				if len(magic) > 0 {
					if at+len(magic) > len(seg.bytes) {
						break
					}
					matched := true
					for i := range magic {
						if seg.bytes[at+i] != magic[i] {
							matched = false
							break
						}
					}
					if !matched {
						at++
						continue
					}
				}
				value, ok := Decode(seg.bytes, at+int(framing.LengthOffset), framing.LengthType)
				if !ok {
					break
				}
				payload, err := strconv.Atoi(value)
				if err != nil {
					break
				}
				length = int(framing.HeaderLength) + payload
			}
			if length < 1 || length > 1<<20 || at+length > len(seg.bytes) {
				break
			}
			rows = append(rows, segment{seg.start + int64(at), seg.bytes[at : at+length]})
			at += length
		}
	}
	return rows
}
func assignGroups(rows []Row) {
	// A repeated, low-cardinality header byte is a possible message discriminator, not a named opcode.
	byDirection := map[string][]int{}
	for i, row := range rows {
		family := row.Location.Direction + "|" + identity(row.Framing)
		byDirection[family] = append(byDirection[family], i)
	}
	for direction, indices := range byDirection {
		bestOffset := -1
		bestScore := 0
		for offset := 0; offset < 16; offset++ {
			counts := map[byte]int{}
			valid := true
			for _, i := range indices {
				row := rows[i]
				h := int(row.Framing.HeaderLength)
				if row.Framing.FixedLength > 0 {
					h = min(int(row.Framing.FixedLength), 16)
				}
				if offset >= h || offset >= len(row.Raw) {
					valid = false
					break
				}
				lengthSize := 2
				if row.Framing.LengthType == "uint8" {
					lengthSize = 1
				}
				if row.Framing.LengthType != "" && offset >= int(row.Framing.LengthOffset) && offset < int(row.Framing.LengthOffset)+lengthSize {
					valid = false
					break
				}
				counts[row.Raw[offset]]++
			}
			if !valid || len(counts) < 2 || len(counts) > 12 || len(counts)*2 > len(indices) {
				continue
			}
			repeated := 0
			for _, count := range counts {
				if count > 1 {
					repeated += count
				}
			}
			score := repeated*10 - len(counts)
			if score >= bestScore {
				bestOffset, bestScore = offset, score
			}
		}
		for _, i := range indices {
			if bestOffset >= 0 {
				rows[i].GroupID = fmt.Sprintf("%s:@%d=%02X", direction, bestOffset, rows[i].Raw[bestOffset])
			} else {
				rows[i].GroupID = fmt.Sprintf("%s:%d-bytes", direction, len(rows[i].Raw))
			}
		}
	}
}
func columnStats(rows []Row) []Column {
	width := 0
	for _, row := range rows {
		width = max(width, len(row.Raw))
	}
	width = min(width, MaxWidth)
	out := []Column{}
	for offset := 0; offset < width; offset++ {
		values := map[byte]bool{}
		present := 0
		for _, row := range rows {
			if offset < len(row.Raw) {
				present++
				values[row.Raw[offset]] = true
			}
		}
		kind := "variable"
		heat := 1
		if present < len(rows) {
			kind = "partial"
			heat = 0
		} else if len(values) <= 1 {
			kind = "constant"
			heat = 0
		} else if present > 1 {
			heat = 1 + (len(values)-1)*4/(present-1)
		}
		out = append(out, Column{offset, present, len(values), kind, heat})
	}
	return out
}
func sortedKeys[V any](items map[string]V) []string {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
