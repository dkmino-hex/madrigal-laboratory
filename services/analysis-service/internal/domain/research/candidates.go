package research

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

func fieldCandidates(rows []Row, group Group) []Candidate {
	out := []Candidate{}
	seen := map[string]bool{}
	for _, parameter := range group.Parameters {
		distinct := map[string]bool{}
		total := 0
		for _, row := range rows {
			if value, ok := row.Values[parameter]; ok {
				r, _ := rational(value)
				distinct[r.RatString()] = true
				total++
			}
		}
		if len(distinct) < 2 || total < 2 {
			continue
		}
		for offset := 0; offset < len(group.Columns); offset++ {
			for _, encoding := range encodings {
				for _, divisor := range []int64{1, 10, 100, 1000} {
					candidate := Candidate{GroupID: group.ID, Kind: "parameter", Parameter: parameter, Name: fieldName(parameter), Offset: offset, Length: encoding.size, Encoding: encoding.name, Divisor: divisor, Total: total, Support: []string{}, Counterexamples: []string{}, Inconclusive: []string{}, Examples: []Evidence{}}
					decodedSignature := ""
					matchedValues := map[string]bool{}
					for _, row := range rows {
						expected, ok := row.Values[parameter]
						if !ok {
							candidate.Inconclusive = append(candidate.Inconclusive, row.ID)
							continue
						}
						decoded, ok := Decode(row.Raw, offset, encoding.name)
						if !ok {
							candidate.Inconclusive = append(candidate.Inconclusive, row.ID)
							continue
						}
						decodedSignature += row.ID + ":" + decoded + ";"
						if equalValue(decoded, expected, divisor, encoding.name) {
							candidate.Support = append(candidate.Support, row.ID)
							r, _ := rational(expected)
							matchedValues[r.RatString()] = true
						} else {
							candidate.Counterexamples = append(candidate.Counterexamples, row.ID)
						}
					}
					candidate.Matches = len(candidate.Support)
					if candidate.Matches < 2 || candidate.Matches*2 < total || len(matchedValues) < 2 {
						continue
					}
					key := fmt.Sprintf("%s:%s:%d:%d:%d:%s", group.ID, parameter, offset, encoding.size, divisor, decodedSignature)
					if seen[key] {
						continue
					}
					seen[key] = true
					candidate.ID = identity([]any{group.ID, parameter, offset, encoding.name, divisor})
					candidate.Statement = fmt.Sprintf("Байты %d–%d, прочитанные как %s ÷ %d, совпадают с «%s» в %d из %d примеров.", offset, offset+encoding.size-1, encoding.name, divisor, parameter, candidate.Matches, total)
					candidate.Basis = "Значения и названия взяты из журнала. Связь с примером установлена по имени записи и окну времени, независимо от искомого значения. Есть не менее двух разных совпавших значений."
					candidate.SchemaJSON = candidateSchema(rows[0].Framing, candidate, rows)
					addExamples(&candidate, rows)
					out = append(out, candidate)
				}
			}
		}
	}
	return out
}
func fieldName(parameter string) string {
	parts := strings.Split(parameter, ".")
	name := parts[len(parts)-1]
	var out strings.Builder
	for _, r := range name {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' {
			out.WriteRune(r)
		} else {
			out.WriteByte('_')
		}
	}
	if out.Len() == 0 {
		return "field"
	}
	return out.String()
}
func candidateSchema(framing Framing, candidate Candidate, rows []Row) string {
	if framing.HeaderLength == 0 && framing.FixedLength == 0 {
		return ""
	}
	field := map[string]any{"name": candidate.Name, "type": candidate.Encoding, "offset": candidate.Offset}
	if candidate.Divisor != 1 {
		field["scale"] = json.Number("0." + strings.Repeat("0", len(strconv.FormatInt(candidate.Divisor, 10))-2) + "1")
	}
	check := map[string]any{"id": "journal-" + candidate.Name, "field": candidate.Name, "op": "action", "parameter": candidate.Parameter}
	if strings.HasPrefix(candidate.Encoding, "float") {
		check["tolerance"] = json.Number(strconv.FormatFloat(0.000001/float64(candidate.Divisor), 'g', -1, 64))
	}
	schema := map[string]any{"framing": framing, "fields": []any{field}, "checks": []any{check}, "research": map[string]any{"engineVersion": Version, "parameter": candidate.Parameter, "group": candidate.GroupID, "basis": "candidate; requires independent verification"}}
	training := map[string]bool{}
	for _, row := range rows {
		training[row.CaptureSHA256] = true
	}
	schema["research"].(map[string]any)["learningCaptureSha256"] = sortedKeys(training)
	direction, condition, matched := strings.Cut(candidate.GroupID, ":@")
	if matched {
		offset, value, ok := strings.Cut(condition, "=")
		if ok {
			position, e := strconv.Atoi(offset)
			if e == nil {
				schema["direction"] = strings.Split(direction, "|")[0]
				schema["match"] = []any{map[string]any{"offset": position, "hex": value}}
			}
		}
	}
	if !matched {
		family, kind, _ := strings.Cut(candidate.GroupID, ":")
		schema["direction"] = strings.Split(family, "|")[0]
		length, e := strconv.Atoi(strings.TrimSuffix(kind, "-bytes"))
		if e == nil {
			schema["messageLength"] = length
		}
	}
	body, _ := json.Marshal(schema)
	return string(body)
}
func patternCandidates(rows []Row, group Group) []Candidate {
	out := []Candidate{}
	if len(rows) < 2 {
		return out
	}
	for offset := 0; offset < len(group.Columns); {
		column := group.Columns[offset]
		if column.Kind == "partial" {
			offset++
			continue
		}
		end := offset + 1
		for end < len(group.Columns) && end-offset < 8 && group.Columns[end].Kind == column.Kind {
			end++
		}
		kind := column.Kind
		statement := ""
		if kind == "constant" {
			statement = fmt.Sprintf("В %d примерах байты %d–%d постоянны: %s.", len(rows), offset, end-1, strings.ToUpper(hex.EncodeToString(rows[0].Raw[offset:end])))
		} else {
			statement = fmt.Sprintf("В %d примерах байты %d–%d изменяются; назначение этого участка пока неизвестно.", len(rows), offset, end-1)
		}
		candidate := Candidate{ID: identity([]any{group.ID, kind, offset, end}), GroupID: group.ID, Kind: kind, Name: "field_" + strconv.Itoa(offset), Offset: offset, Length: end - offset, Encoding: "hex", Divisor: 1, Matches: len(rows), Total: len(rows), Support: []string{}, Counterexamples: []string{}, Inconclusive: []string{}, Statement: statement, Basis: "Сравнение одинаковых позиций внутри выбранной группы. Подсветка показывает изменчивость, а не установленный смысл поля.", Examples: []Evidence{}}
		for _, row := range rows {
			candidate.Support = append(candidate.Support, row.ID)
		}
		addExamples(&candidate, rows)
		out = append(out, candidate)
		offset = end
	}
	return out
}
func addExamples(candidate *Candidate, rows []Row) {
	roles := map[string]string{}
	for _, id := range candidate.Support {
		roles[id] = "support"
	}
	for _, id := range candidate.Counterexamples {
		roles[id] = "counterexample"
	}
	counts := map[string]int{}
	for _, row := range rows {
		role := roles[row.ID]
		if role == "" || counts[role] >= 12 || candidate.Offset+candidate.Length > len(row.Raw) {
			continue
		}
		start := row.Start + int64(candidate.Offset)
		end := start + int64(candidate.Length)
		sources := []FrameSource{}
		for _, source := range row.Sources {
			sourceStart, _ := strconv.ParseInt(source.StreamStart, 10, 64)
			length, _ := strconv.ParseInt(source.Length, 10, 64)
			frame, _ := strconv.ParseInt(source.FrameOffset, 10, 64)
			lo, hi := max(start, sourceStart), min(end, sourceStart+length)
			if lo >= hi {
				continue
			}
			source.StreamStart = strconv.FormatInt(lo, 10)
			source.FrameOffset = strconv.FormatInt(frame+lo-sourceStart, 10)
			source.Length = strconv.FormatInt(hi-lo, 10)
			sources = append(sources, source)
		}
		location := row.Location
		location.Start = strconv.FormatInt(start, 10)
		location.Length = strconv.Itoa(candidate.Length)
		action := ""
		if len(row.ActionIDs) == 1 {
			action = row.ActionIDs[0]
		}
		candidate.Examples = append(candidate.Examples, Evidence{Location: location, Sources: sources, CaptureSHA256: row.CaptureSHA256, Status: "tentative", Basis: row.Label + " · " + candidate.Statement, ActionID: action, Kind: role})
		counts[role]++
	}
}
