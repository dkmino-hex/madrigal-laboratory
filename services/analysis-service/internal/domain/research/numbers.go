package research

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"math/big"
	"strconv"
	"strings"
)

var encodings = []struct {
	name   string
	size   int
	signed bool
}{
	{"uint8", 1, false}, {"int8", 1, true}, {"uint16le", 2, false}, {"int16le", 2, true}, {"uint16be", 2, false}, {"int16be", 2, true},
	{"uint32le", 4, false}, {"int32le", 4, true}, {"uint32be", 4, false}, {"int32be", 4, true}, {"uint64le", 8, false}, {"int64le", 8, true}, {"uint64be", 8, false}, {"int64be", 8, true},
	{"float32le", 4, true}, {"float32be", 4, true},
}

func rational(text string) (*big.Rat, bool) {
	// Numeric journal strings must not allocate arbitrarily large exponents.
	if len(text) > 80 {
		return nil, false
	}
	if at := strings.IndexAny(text, "eE"); at >= 0 {
		exponent, err := strconv.Atoi(text[at+1:])
		if err != nil || exponent < -30 || exponent > 30 {
			return nil, false
		}
	}
	return new(big.Rat).SetString(text)
}
func Decode(data []byte, offset int, encoding string) (string, bool) {
	var size int
	var signed bool
	for _, e := range encodings {
		if e.name == encoding {
			size, signed = e.size, e.signed
			break
		}
	}
	if size == 0 || offset < 0 || offset > len(data)-size {
		return "", false
	}
	part := data[offset : offset+size]
	var value uint64
	var order binary.ByteOrder = binary.BigEndian
	if strings.HasSuffix(encoding, "le") {
		order = binary.LittleEndian
	}
	switch size {
	case 1:
		value = uint64(part[0])
	case 2:
		value = uint64(order.Uint16(part))
	case 4:
		value = uint64(order.Uint32(part))
	case 8:
		value = order.Uint64(part)
	}
	if strings.HasPrefix(encoding, "float") {
		f := float64(math.Float32frombits(uint32(value)))
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return "", false
		}
		return strconv.FormatFloat(f, 'g', -1, 32), true
	}
	if signed {
		switch size {
		case 1:
			return strconv.FormatInt(int64(int8(value)), 10), true
		case 2:
			return strconv.FormatInt(int64(int16(value)), 10), true
		case 4:
			return strconv.FormatInt(int64(int32(value)), 10), true
		case 8:
			return strconv.FormatInt(int64(value), 10), true
		}
	}
	return strconv.FormatUint(value, 10), true
}
func numericValues(raw json.RawMessage, prefix string) map[string]string {
	result := map[string]string{}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if len(raw) > 1<<16 || decoder.Decode(&value) != nil {
		return result
	}
	var visit func(any, string, int)
	visit = func(value any, path string, depth int) {
		if depth > 5 || len(result) >= 48 || len(path) > 256 {
			return
		}
		switch x := value.(type) {
		case json.Number:
			if _, ok := rational(string(x)); ok {
				result[path] = string(x)
			}
		case map[string]any:
			for _, key := range sortedKeys(x) {
				visit(x[key], path+"."+key, depth+1)
			}
		case []any:
			for i, child := range x {
				if i >= 8 {
					break
				}
				visit(child, path+"["+strconv.Itoa(i)+"]", depth+1)
			}
		}
	}
	visit(value, prefix, 0)
	return result
}
func equalValue(raw, expected string, divisor int64, encoding string) bool {
	a, ok := rational(raw)
	if !ok {
		return false
	}
	b, ok := rational(expected)
	if !ok {
		return false
	}
	b.Mul(b, new(big.Rat).SetInt64(divisor))
	if !strings.HasPrefix(encoding, "float") {
		return a.Cmp(b) == 0
	}
	difference := new(big.Rat).Abs(new(big.Rat).Sub(a, b))
	tolerance := new(big.Rat).SetFrac64(1, 1000000)
	return difference.Cmp(tolerance) <= 0
}
