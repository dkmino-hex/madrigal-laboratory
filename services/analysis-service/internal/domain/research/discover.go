package research

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strconv"
	"strings"
)

func identity(value any) string {
	data, _ := json.Marshal(value)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:12])
}
func basename(name string) string { return path.Base(strings.ReplaceAll(name, "\\", "/")) }

// BindActions associates by capture filename and capture time, never by the numeric value being sought.
// Conflicting values in overlapping action windows remain unknown.
func BindActions(row *Row, actions []Action) {
	NewActionIndex(actions).Bind(row)
}
func clippedSources(stream Stream, start, end int64, capture string) ([]FrameSource, string, bool) {
	out := []FrameSource{}
	firstTime := ""
	coverage := start
	sources := append([]Source(nil), stream.Sources...)
	sort.SliceStable(sources, func(i, j int) bool {
		if sources[i].StreamStart != sources[j].StreamStart {
			return sources[i].StreamStart < sources[j].StreamStart
		}
		return sources[i].PacketNo < sources[j].PacketNo
	})
	for _, source := range sources {
		lo, hi := max(start, source.StreamStart), min(end, source.StreamEnd)
		if lo >= hi {
			continue
		}
		if lo > coverage {
			return out, firstTime, false
		}
		if hi <= coverage {
			continue
		} // identical retransmissions do not create a second logical example
		lo = max(lo, coverage)
		frame := source.FrameStart + lo - source.StreamStart
		out = append(out, FrameSource{capture, source.PacketNo, strconv.FormatInt(frame, 10), strconv.FormatInt(hi-lo, 10), strconv.FormatInt(lo, 10), "primary"})
		if firstTime == "" {
			firstTime = source.Timestamp
		}
		coverage = hi
		if coverage >= end {
			break
		}
	}
	return out, firstTime, coverage >= end
}

func Discover(project string, input Input, captures []CaptureData, actions []Action, explicit *Framing) Result {
	actionIndex := NewActionIndex(actions)
	result := Result{ProjectID: project, EngineVersion: Version, Complete: true, Captures: []CaptureSelection{}, Rows: []Row{}, Groups: []Group{}, Candidates: []Candidate{}, Warnings: []string{}}
	sort.SliceStable(captures, func(i, j int) bool { return captures[i].CaptureID < captures[j].CaptureID })
	heuristic, fallback, unknown, missingSources, shortened := false, false, 0, 0, false
	for _, capture := range captures {
		result.Captures = append(result.Captures, CaptureSelection{capture.CaptureID, capture.AssemblyID})
		result.Complete = result.Complete && capture.Complete
		for _, stream := range capture.Streams {
			if input.Direction != "" && stream.Direction != input.Direction {
				continue
			}
			for _, interval := range stream.Intervals {
				if interval.Kind != "DATA" {
					unknown++
				}
			}
			segments := knownSegments(stream)
			framing := Framing{}
			inferred := false
			if explicit != nil {
				framing = *explicit
			} else {
				framing, inferred = inferredFraming(segments)
			}
			parts := []segment{}
			boundary := "tcp-fragment"
			if explicit != nil || inferred {
				parts = splitSegments(segments, framing)
				boundary = "schema"
				if inferred {
					boundary = "inferred-length-prefix"
					heuristic = true
				}
			}
			if len(parts) == 0 && explicit == nil {
				fallback = true
				// TCP packet boundaries are only fragments and are labelled accordingly.
				seen := map[int64]bool{}
				for _, source := range stream.Sources {
					if seen[source.StreamStart] {
						continue
					}
					seen[source.StreamStart] = true
					for _, seg := range segments {
						lo, hi := max(source.StreamStart, seg.start), min(source.StreamEnd, seg.start+int64(len(seg.bytes)))
						if lo < hi {
							parts = append(parts, segment{lo, seg.bytes[lo-seg.start : hi-seg.start]})
						}
					}
					if len(parts) >= MaxRows {
						break
					}
				}
			}
			for _, part := range parts {
				if len(result.Rows) >= MaxRows {
					result.Complete = false
					break
				}
				if len(part.bytes) > 4096 {
					shortened = true
					continue
				}
				sources, timestamp, covered := clippedSources(stream, part.start, part.start+int64(len(part.bytes)), capture.CaptureID)
				if !covered {
					missingSources++
					result.Complete = false
					continue
				}
				location := Location{project, capture.CaptureID, stream.SessionID, capture.AssemblyID, stream.StreamID, stream.Direction, strconv.FormatInt(part.start, 10), strconv.Itoa(len(part.bytes))}
				row := Row{ID: identity(location), Label: fmt.Sprintf("%s · @%d", capture.CaptureName, part.start), CaptureName: capture.CaptureName, CaptureSHA256: capture.SHA256, Location: location, Bytes: base64.StdEncoding.EncodeToString(part.bytes), Timestamp: timestamp, Boundary: boundary, Sources: sources, Raw: part.bytes, Start: part.start, Framing: framing}
				actionIndex.Bind(&row)
				result.Rows = append(result.Rows, row)
			}
		}
	}
	assignGroups(result.Rows)
	groupRows := map[string][]Row{}
	for _, row := range result.Rows {
		groupRows[row.GroupID] = append(groupRows[row.GroupID], row)
	}
	for _, id := range sortedKeys(groupRows) {
		rows := groupRows[id]
		parameters := map[string]bool{}
		for _, row := range rows {
			for key := range row.Values {
				parameters[key] = true
			}
		}
		family, kind, _ := strings.Cut(id, ":")
		direction := strings.Split(family, "|")[0]
		group := Group{id, direction + " · " + kind, len(rows), sortedKeys(parameters), columnStats(rows)}
		names := map[string]bool{}
		for _, row := range rows {
			if row.Association == "time-window" {
				names[row.Label] = true
			}
		}
		if len(names) == 1 {
			group.Title = sortedKeys(names)[0] + " · " + group.Title
		}
		group.Title = strings.ReplaceAll(strings.ReplaceAll(group.Title, "A_TO_B", "A→B"), "B_TO_A", "B→A")
		result.Groups = append(result.Groups, group)
		result.Candidates = append(result.Candidates, fieldCandidates(rows, group)...)
		result.Candidates = append(result.Candidates, patternCandidates(rows, group)...)
	}
	sort.SliceStable(result.Candidates, func(i, j int) bool {
		a, b := result.Candidates[i], result.Candidates[j]
		if a.Kind != b.Kind {
			return a.Kind == "parameter"
		}
		if a.Matches != b.Matches {
			return a.Matches > b.Matches
		}
		if a.Total != b.Total {
			return a.Total > b.Total
		}
		if a.Divisor != b.Divisor {
			return a.Divisor < b.Divisor
		}
		if a.Length != b.Length {
			return a.Length > b.Length
		}
		return a.ID < b.ID
	})
	// Keep a useful bounded set per group, so a large group cannot hide another message type.
	kept := []Candidate{}
	counts := map[string]int{}
	for _, candidate := range result.Candidates {
		if counts[candidate.GroupID] >= 12 || len(kept) >= 80 {
			continue
		}
		kept = append(kept, candidate)
		counts[candidate.GroupID]++
	}
	result.Candidates = kept
	if heuristic {
		result.Warnings = append(result.Warnings, "Границы сообщений предположены по повторяющемуся префиксу и полю длины. Это проверяемый кандидат в кадрирование.")
	}
	if fallback {
		result.Warnings = append(result.Warnings, "Для части потоков границы сообщений не определены: показаны TCP-фрагменты, а не подтверждённые сообщения.")
	}
	if unknown > 0 {
		result.Warnings = append(result.Warnings, fmt.Sprintf("Пропуски и конфликты (%d участков) исключены из чтения значений; журнал не заполняет неизвестные байты.", unknown))
	}
	if missingSources > 0 {
		result.Warnings = append(result.Warnings, "Часть примеров не показана: не получено полное происхождение байтов.")
	}
	if shortened {
		result.Complete = false
		result.Warnings = append(result.Warnings, "Сообщения больше 4096 байт пропущены в интерактивном сравнении.")
	}
	if !result.Complete {
		result.Warnings = append(result.Warnings, "Достигнут предел интерактивной выборки. Счётчики относятся только к показанным примерам.")
	}
	result.Warnings = append(result.Warnings, "Совпадение значения с журналом — основание для гипотезы. Назначение поля проверяется на дополнительных опытах.")
	result.Fingerprint = identity(struct {
		Version  string
		Input    Input
		Captures []CaptureData
		Actions  []Action
	}{Version, input, captures, actions})
	return result
}
