// Package engine interprets byte ranges without inventing bytes for gaps or conflicts.
// The schema contract is documented in docs/analysis-schema.md at the repository root.
package engine

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
)

const Version = "analysis-0.3"

type Span struct {
	AssemblyID  string          `json:"assemblyId"`
	StreamID    string          `json:"streamId"`
	StartOffset string          `json:"startOffset"`
	EndOffset   string          `json:"endOffset"`
	PacketRefs  []domain.Source `json:"packetRefs,omitempty"`
}
type Field struct {
	Type       string `json:"type,omitempty"`
	ValueText  string `json:"valueText,omitempty"`
	Name       string `json:"name"`
	Value      any    `json:"value,omitempty"`
	SourceSpan Span   `json:"sourceSpan"`
}
type Diagnostic struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	SourceSpan *Span  `json:"sourceSpan,omitempty"`
}
type CheckResult struct {
	RuleID     string `json:"ruleId"`
	Status     string `json:"status"`
	Message    string `json:"message,omitempty"`
	SourceSpan *Span  `json:"sourceSpan,omitempty"`
}
type Message struct {
	SourceSpan Span          `json:"sourceSpan"`
	Status     string        `json:"status"`
	Fields     []Field       `json:"fields"`
	Checks     []CheckResult `json:"checks"`
}
type Result struct {
	Messages       []Message     `json:"messages"`
	Fields         []Field       `json:"fields"`
	Checks         []CheckResult `json:"checks"`
	UnknownRegions []Span        `json:"unknownRegions"`
	Errors         []Diagnostic  `json:"errors"`
}
type Definition struct {
	Framing       Framing    `json:"framing"`
	Fields        []FieldDef `json:"fields"`
	Checks        []CheckDef `json:"checks"`
	Scope         string     `json:"scope,omitempty"`
	Direction     string     `json:"direction,omitempty"`
	Match         []MatchDef `json:"match,omitempty"`
	MessageLength uint64     `json:"messageLength,omitempty"`
}
type MatchDef struct {
	Offset uint64 `json:"offset"`
	Hex    string `json:"hex"`
}
type ActionMatcher func(domain.Block, Span, string) (string, string)
type Framing struct {
	Magic                string `json:"magic,omitempty"`
	HeaderLength         uint64 `json:"headerLength,omitempty"`
	LengthOffset         uint64 `json:"lengthOffset,omitempty"`
	LengthType           string `json:"lengthType,omitempty"`
	LengthIncludesHeader bool   `json:"lengthIncludesHeader,omitempty"`
	FixedLength          uint64 `json:"fixedLength,omitempty"`
}
type FieldDef struct {
	Name       string       `json:"name"`
	Type       string       `json:"type"`
	Offset     *uint64      `json:"offset,omitempty"`
	Length     uint64       `json:"length,omitempty"`
	LengthFrom string       `json:"lengthFrom,omitempty"`
	Endian     string       `json:"endian,omitempty"`
	Scale      *json.Number `json:"scale,omitempty"`
}
type CheckDef struct {
	ID        string          `json:"id"`
	Field     string          `json:"field"`
	Op        string          `json:"op"`
	Value     json.RawMessage `json:"value,omitempty"`
	Min       *json.Number    `json:"min,omitempty"`
	Max       *json.Number    `json:"max,omitempty"`
	Parameter string          `json:"parameter,omitempty"`
	Tolerance *json.Number    `json:"tolerance,omitempty"`
}

func Validate(schema string) (Definition, error) {
	var d Definition
	if err := json.Unmarshal([]byte(schema), &d); err != nil {
		return d, fmt.Errorf("schema: %w", err)
	}
	if d.Fields == nil {
		return d, fmt.Errorf("fields: required array")
	}
	if d.Direction != "" && d.Direction != "A_TO_B" && d.Direction != "B_TO_A" {
		return d, fmt.Errorf("direction: unsupported")
	}
	if d.MessageLength > 1<<20 {
		return d, fmt.Errorf("messageLength: too large")
	}
	for _, match := range d.Match {
		data, e := hex.DecodeString(match.Hex)
		if e != nil || len(data) == 0 || len(data) > 64 || match.Offset > 1<<20 {
			return d, fmt.Errorf("match: invalid byte condition")
		}
	}
	if d.Framing.Magic != "" {
		m, e := hex.DecodeString(strings.ReplaceAll(d.Framing.Magic, " ", ""))
		if e != nil || len(m) == 0 {
			return d, fmt.Errorf("framing.magic: invalid hex")
		}
	}
	if d.Framing.LengthType != "" {
		if d.Framing.LengthType != "uint8" && d.Framing.LengthType != "uint16be" && d.Framing.LengthType != "uint16le" && d.Framing.LengthType != "uint32be" && d.Framing.LengthType != "uint32le" {
			return d, fmt.Errorf("framing.lengthType: unsupported")
		}
		if d.Framing.HeaderLength == 0 {
			return d, fmt.Errorf("framing.headerLength: required")
		}
	}
	if d.Framing.LengthType != "" && d.Framing.LengthOffset+uint64(typeSize(d.Framing.LengthType)) > d.Framing.HeaderLength {
		return d, fmt.Errorf("framing.lengthOffset: outside header")
	}
	if d.Framing.FixedLength > 1<<20 || d.Framing.HeaderLength > 1<<20 {
		return d, fmt.Errorf("framing: message too large")
	}
	names := map[string]bool{}
	for i, f := range d.Fields {
		if f.Name == "" || names[f.Name] {
			return d, fmt.Errorf("fields[%d].name: empty or duplicate", i)
		}
		if f.Offset != nil && *f.Offset > 1<<20 {
			return d, fmt.Errorf("fields[%d].offset: too large", i)
		}
		if f.Length > 1<<20 {
			return d, fmt.Errorf("fields[%d].length: too large", i)
		}
		if f.LengthFrom != "" && !names[f.LengthFrom] {
			return d, fmt.Errorf("fields[%d].lengthFrom: must refer to earlier field", i)
		}
		names[f.Name] = true
		switch f.Type {
		case "string", "ascii", "utf8", "hex", "bytes", "base64", "uint8", "u8", "uint16", "uint16be", "uint16le", "u16be", "u16le", "uint32", "uint32be", "uint32le", "u32be", "u32le", "uint64be", "uint64le", "float32be", "float32le", "int8", "int16le", "int16be", "int32le", "int32be", "int64le", "int64be":
		default:
			return d, fmt.Errorf("fields[%d].type: unsupported %q", i, f.Type)
		}
		if f.Scale != nil {
			scale, ok := numericRat(*f.Scale)
			if !ok || scale.Sign() == 0 || typeSize(f.Type) == 0 {
				return d, fmt.Errorf("fields[%d].scale: invalid numeric factor", i)
			}
		}
	}
	ruleIDs := map[string]bool{}
	for i, c := range d.Checks {
		if ruleIDs[c.ID] {
			return d, fmt.Errorf("checks[%d]: duplicate id", i)
		}
		ruleIDs[c.ID] = true
		for _, bound := range []*json.Number{c.Min, c.Max} {
			if bound != nil {
				if _, ok := new(big.Rat).SetString(string(*bound)); !ok {
					return d, fmt.Errorf("checks[%d]: invalid bound", i)
				}
			}
		}
		if c.Op == "eq" || c.Op == "length" {
			if !json.Valid(c.Value) {
				return d, fmt.Errorf("checks[%d]: value required", i)
			}
		}
		if c.ID == "" || !names[c.Field] {
			return d, fmt.Errorf("checks[%d]: id and existing field required", i)
		}
		switch c.Op {
		case "eq", "range", "length":
		case "action":
			if c.Parameter == "" || len(c.Parameter) > 256 {
				return d, fmt.Errorf("checks[%d].parameter: required", i)
			}
		default:
			return d, fmt.Errorf("checks[%d].op: unsupported", i)
		}
		if c.Tolerance != nil {
			t, ok := numericRat(*c.Tolerance)
			if !ok || t.Sign() < 0 {
				return d, fmt.Errorf("checks[%d].tolerance: invalid", i)
			}
		}
	}
	return d, nil
}
func Parse(schema string, blocks []domain.Block, matchers ...ActionMatcher) (Result, error) {
	d, e := Validate(schema)
	if e != nil {
		return Result{}, e
	}
	out := Result{Messages: []Message{}, Fields: []Field{}, Checks: []CheckResult{}, UnknownRegions: []Span{}, Errors: []Diagnostic{}}
	var matcher ActionMatcher
	if len(matchers) > 0 {
		matcher = matchers[0]
	}
	for _, b := range blocks {
		parseBlock(&out, d, b, matcher)
	}
	return out, nil
}
func parseBlock(out *Result, d Definition, b domain.Block, matcher ActionMatcher) {
	if b.Length > 1<<20 {
		out.Errors = append(out.Errors, Diagnostic{Code: "LIMIT", Message: "block exceeds 1 MiB"})
		return
	}
	data := make([]byte, int(b.Length))
	valid := make([]bool, int(b.Length))
	ambiguous := make([]bool, int(b.Length))
	for _, in := range b.Intervals {
		if in.EndOffset <= in.StartOffset || in.StartOffset < b.Offset || in.EndOffset > b.Offset+b.Length {
			out.Errors = append(out.Errors, Diagnostic{Code: "INVALID_INTERVAL", Message: "invalid interval coordinates"})
			continue
		}
		start := int(in.StartOffset - b.Offset)
		end := int(in.EndOffset - b.Offset)
		switch in.Kind {
		case "DATA":
			raw, e := base64.StdEncoding.DecodeString(in.Data)
			if e != nil || len(raw) != end-start {
				out.Errors = append(out.Errors, Diagnostic{Code: "INVALID_DATA", Message: "invalid DATA encoding"})
				continue
			}
			for i, v := range raw {
				p := start + i
				if valid[p] && data[p] != v {
					ambiguous[p] = true
				}
				if !ambiguous[p] {
					data[p] = v
					valid[p] = true
				}
			}
		case "GAP", "CONFLICT":
			for i := start; i < end; i++ {
				valid[i] = false
				ambiguous[i] = true
			}
		default:
			out.Errors = append(out.Errors, Diagnostic{Code: "INVALID_INTERVAL", Message: "unknown interval kind"})
		}
	}
	for i := 0; i < len(data); {
		if valid[i] && !ambiguous[i] {
			i++
			continue
		}
		start := i
		for i < len(data) && (!valid[i] || ambiguous[i]) {
			i++
		}
		s := makeSpan(b, b.Offset+uint64(start), b.Offset+uint64(i))
		out.UnknownRegions = append(out.UnknownRegions, s)
		out.Errors = append(out.Errors, Diagnostic{Code: "INCONCLUSIVE", Message: "missing or conflicting stream bytes", SourceSpan: &s})
	}
	magic, _ := hex.DecodeString(strings.ReplaceAll(d.Framing.Magic, " ", ""))
	for pos := 0; pos < len(data); {
		length := len(data) - pos
		if d.Framing.FixedLength > 0 {
			length = int(d.Framing.FixedLength)
		}
		if len(magic) > 0 {
			if pos+len(magic) > len(data) || !allValid(valid, ambiguous, pos, pos+len(magic)) {
				appendUnknown(out, b, pos, len(data), "INCONCLUSIVE", "cannot determine message magic")
				break
			}
			if string(data[pos:pos+len(magic)]) != string(magic) {
				appendUnknown(out, b, pos, len(data), "FRAMING_MISMATCH", "unexpected magic; no implicit resynchronization")
				break
			}
		}
		if d.Framing.LengthType != "" {
			size := typeSize(d.Framing.LengthType)
			start := pos + int(d.Framing.LengthOffset)
			if start+size > len(data) || !allValid(valid, ambiguous, start, start+size) {
				appendUnknown(out, b, pos, len(data), "INCONCLUSIVE", "missing length header")
				break
			}
			n, err := decodeValue(d.Framing.LengthType, data[start:start+size], "")
			if err != nil {
				appendUnknown(out, b, pos, len(data), "FRAMING_ERROR", err.Error())
				break
			}
			v := int(n.(uint64))
			length = v
			if !d.Framing.LengthIncludesHeader {
				length += int(d.Framing.HeaderLength)
			}
		}
		if length <= 0 || length > 1<<20 {
			appendUnknown(out, b, pos, len(data), "FRAMING_ERROR", "invalid message length")
			break
		}
		if pos+length > len(data) {
			appendUnknown(out, b, pos, len(data), "INCONCLUSIVE", "truncated message or range boundary")
			break
		}
		msg := Message{SourceSpan: makeSpan(b, b.Offset+uint64(pos), b.Offset+uint64(pos+length)), Status: "PASS", Fields: []Field{}, Checks: []CheckResult{}}
		applicable := true
		undetermined := false
		if d.MessageLength > 0 && uint64(length) != d.MessageLength {
			applicable = false
		}
		if d.Direction != "" {
			if b.Direction == "" {
				undetermined = true
			} else if b.Direction != d.Direction {
				applicable = false
			}
		}
		for _, condition := range d.Match {
			expected, _ := hex.DecodeString(condition.Hex)
			start := pos + int(condition.Offset)
			if start+len(expected) > pos+length || !allValid(valid, ambiguous, start, start+len(expected)) {
				undetermined = true
				continue
			}
			if string(data[start:start+len(expected)]) != string(expected) {
				applicable = false
			}
		}
		if !applicable || undetermined {
			msg.Status = "NOT_APPLICABLE"
			if undetermined && applicable {
				msg.Status = "INCONCLUSIVE"
			}
			out.Messages = append(out.Messages, msg)
			pos += length
			continue
		}
		cursor := pos
		values := map[string]any{}
		raws := map[string][]byte{}
		spans := map[string]Span{}
		for _, f := range d.Fields {
			start := cursor
			if f.Offset != nil {
				start = pos + int(*f.Offset)
			}
			sz := int(f.Length)
			if sz == 0 {
				sz = typeSize(f.Type)
			}
			if f.LengthFrom != "" {
				v, ok := values[f.LengthFrom].(uint64)
				if !ok || v > 1<<20 {
					msg.Status = "INCONCLUSIVE"
					out.Errors = append(out.Errors, Diagnostic{Code: "INVALID_LENGTH", Message: "lengthFrom unavailable"})
					break
				}
				sz = int(v)
			}
			if sz < 0 || start < pos || start+sz > pos+length {
				msg.Status = "INCONCLUSIVE"
				s := msg.SourceSpan
				out.Errors = append(out.Errors, Diagnostic{Code: "FIELD_OUT_OF_RANGE", Message: f.Name, SourceSpan: &s})
				break
			}
			span := makeSpan(b, b.Offset+uint64(start), b.Offset+uint64(start+sz))
			spans[f.Name] = span
			if !allValid(valid, ambiguous, start, start+sz) {
				msg.Status = "INCONCLUSIVE"
				out.Errors = append(out.Errors, Diagnostic{Code: "INCONCLUSIVE", Message: "field " + f.Name + " contains unavailable bytes", SourceSpan: &span})
				cursor = start + sz
				continue
			}
			raw := data[start : start+sz]
			value, e := decodeValue(f.Type, raw, f.Endian)
			if e == nil && f.Scale != nil {
				value, e = scaleValue(value, *f.Scale)
			}
			if e != nil {
				msg.Status = "INCONCLUSIVE"
				out.Errors = append(out.Errors, Diagnostic{Code: "FIELD_DECODE", Message: e.Error(), SourceSpan: &span})
			} else {
				values[f.Name] = value
				raws[f.Name] = raw
				field := Field{Name: f.Name, Type: f.Type, Value: value, ValueText: fmt.Sprint(value), SourceSpan: span}
				msg.Fields = append(msg.Fields, field)
				out.Fields = append(out.Fields, field)
			}
			cursor = start + sz
		}
		for _, c := range d.Checks {
			check := CheckResult{RuleID: c.ID, Status: "INCONCLUSIVE"}
			span, hasSpan := spans[c.Field]
			if hasSpan {
				check.SourceSpan = &span
			}
			v, ok := values[c.Field]
			if ok {
				check.Status = "PASS"
				switch c.Op {
				case "eq":
					var expected any
					dec := json.NewDecoder(strings.NewReader(string(c.Value)))
					dec.UseNumber()
					_ = dec.Decode(&expected)
					if actual, number := numericRat(v); number {
						right, yes := numericRat(expected)
						if !yes || actual.Cmp(right) != 0 {
							check.Status = "FAIL"
						}
					} else if v != expected {
						check.Status = "FAIL"
					}
				case "range":
					n, yes := numericRat(v)
					if !yes {
						check.Status = "INCONCLUSIVE"
					} else {
						if c.Min != nil {
							bound, ok := numericRat(*c.Min)
							if !ok {
								check.Status = "INCONCLUSIVE"
							} else if n.Cmp(bound) < 0 {
								check.Status = "FAIL"
							}
						}
						if c.Max != nil {
							bound, ok := numericRat(*c.Max)
							if !ok {
								check.Status = "INCONCLUSIVE"
							} else if n.Cmp(bound) > 0 {
								check.Status = "FAIL"
							}
						}
					}
				case "action":
					check.Status = "INCONCLUSIVE"
					check.Message = "Нет однозначного значения параметра в закреплённом журнале"
					if matcher != nil {
						expected, reason := matcher(b, span, c.Parameter)
						if reason != "" {
							check.Message = reason
						}
						actual, aok := numericRat(v)
						right, rok := numericRat(json.Number(expected))
						if aok && rok {
							difference := new(big.Rat).Abs(new(big.Rat).Sub(actual, right))
							tolerance := new(big.Rat)
							if c.Tolerance != nil {
								tolerance, _ = numericRat(*c.Tolerance)
							}
							check.Status = "PASS"
							if difference.Cmp(tolerance) > 0 {
								check.Status = "FAIL"
							}
							check.Message = fmt.Sprintf("Журнал: %s; прочитано: %v", expected, v)
						}
					}
				case "length":
					var expected uint64
					if err := json.Unmarshal(c.Value, &expected); err != nil || uint64(len(raws[c.Field])) != expected {
						check.Status = "FAIL"
					}
				}
			}
			if check.Status == "FAIL" {
				msg.Status = "FAIL"
				if check.Message == "" {
					check.Message = "rule violated"
				}
			}
			if check.Status == "INCONCLUSIVE" && msg.Status == "PASS" {
				msg.Status = "INCONCLUSIVE"
			}
			msg.Checks = append(msg.Checks, check)
			out.Checks = append(out.Checks, check)
		}
		if len(msg.Checks) == 0 && msg.Status == "PASS" {
			msg.Status = "NOT_APPLICABLE"
		}
		if !allValid(valid, ambiguous, pos, pos+length) && (msg.Status == "PASS" || msg.Status == "NOT_APPLICABLE") {
			msg.Status = "INCONCLUSIVE"
		}
		out.Messages = append(out.Messages, msg)
		pos += length
	}
}
func appendUnknown(out *Result, b domain.Block, start, end int, code, msg string) {
	s := makeSpan(b, b.Offset+uint64(start), b.Offset+uint64(end))
	out.UnknownRegions = append(out.UnknownRegions, s)
	out.Errors = append(out.Errors, Diagnostic{Code: code, Message: msg, SourceSpan: &s})
}
func allValid(valid, bad []bool, start, end int) bool {
	if start < 0 || end > len(valid) || start > end {
		return false
	}
	for i := start; i < end; i++ {
		if !valid[i] || bad[i] {
			return false
		}
	}
	return true
}
func typeSize(t string) int {
	switch t {
	case "uint8", "u8", "int8":
		return 1
	case "uint16", "uint16be", "uint16le", "u16be", "u16le", "int16be", "int16le":
		return 2
	case "uint32", "uint32be", "uint32le", "u32be", "u32le", "float32be", "float32le", "int32be", "int32le":
		return 4
	case "uint64be", "uint64le", "int64be", "int64le":
		return 8
	}
	return 0
}
func decodeValue(t string, b []byte, endian string) (any, error) {
	if strings.HasPrefix(t, "int") {
		size := typeSize(t)
		if len(b) != size || size == 0 {
			return nil, fmt.Errorf("invalid signed width")
		}
		var n uint64
		var order binary.ByteOrder = binary.BigEndian
		if strings.HasSuffix(t, "le") {
			order = binary.LittleEndian
		}
		switch size {
		case 1:
			n = uint64(b[0])
			return int64(int8(n)), nil
		case 2:
			n = uint64(order.Uint16(b))
			return int64(int16(n)), nil
		case 4:
			n = uint64(order.Uint32(b))
			return int64(int32(n)), nil
		case 8:
			n = order.Uint64(b)
			return int64(n), nil
		}
	}
	switch t {
	case "string", "ascii", "utf8":
		if !utf8.Valid(b) {
			return nil, fmt.Errorf("invalid UTF-8")
		}
		return string(b), nil
	case "hex":
		return hex.EncodeToString(b), nil
	case "bytes", "base64":
		return base64.StdEncoding.EncodeToString(b), nil
	case "uint8", "u8":
		if len(b) == 1 {
			return uint64(b[0]), nil
		}
	case "uint16", "uint16be", "uint16le", "u16be", "u16le":
		if len(b) == 2 {
			if strings.HasSuffix(t, "le") || endian == "little" {
				return uint64(binary.LittleEndian.Uint16(b)), nil
			}
			return uint64(binary.BigEndian.Uint16(b)), nil
		}
	case "uint32", "uint32be", "uint32le", "u32be", "u32le":
		if len(b) == 4 {
			if strings.HasSuffix(t, "le") || endian == "little" {
				return uint64(binary.LittleEndian.Uint32(b)), nil
			}
			return uint64(binary.BigEndian.Uint32(b)), nil
		}
	case "uint64be", "uint64le":
		if len(b) == 8 {
			if strings.HasSuffix(t, "le") {
				return binary.LittleEndian.Uint64(b), nil
			}
			return binary.BigEndian.Uint64(b), nil
		}
	case "float32be", "float32le":
		if len(b) == 4 {
			if strings.HasSuffix(t, "le") {
				return float64(math.Float32frombits(binary.LittleEndian.Uint32(b))), nil
			}
			return float64(math.Float32frombits(binary.BigEndian.Uint32(b))), nil
		}
	}
	return nil, fmt.Errorf("invalid type or width %s/%s", t, strconv.Itoa(len(b)))
}
func makeSpan(b domain.Block, start, end uint64) Span {
	refs := []domain.Source{}
	for _, s := range b.Sources {
		if s.StreamStart < end && s.StreamEnd > start {
			refs = append(refs, s)
		}
	}
	return Span{AssemblyID: b.AssemblyID, StreamID: b.StreamID, StartOffset: strconv.FormatUint(start, 10), EndOffset: strconv.FormatUint(end, 10), PacketRefs: refs}
}

func compareNumber(actual uint64, expected json.Number) int {
	right, ok := new(big.Rat).SetString(string(expected))
	if !ok {
		return 1
	}
	return new(big.Rat).SetInt(new(big.Int).SetUint64(actual)).Cmp(right)
}
