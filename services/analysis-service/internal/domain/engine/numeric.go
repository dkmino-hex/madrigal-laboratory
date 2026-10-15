package engine

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"
	"strings"
)

func numericRat(value any) (*big.Rat, bool) {
	var text string
	switch n := value.(type) {
	case uint64:
		return new(big.Rat).SetInt(new(big.Int).SetUint64(n)), true
	case int64:
		return new(big.Rat).SetInt64(n), true
	case json.Number:
		text = string(n)
	case float64:
		text = strconv.FormatFloat(n, 'g', -1, 64)
	default:
		return nil, false
	}
	if len(text) > 100 {
		return nil, false
	}
	if at := strings.IndexAny(text, "eE"); at >= 0 {
		e, err := strconv.Atoi(text[at+1:])
		if err != nil || e < -100 || e > 100 {
			return nil, false
		}
	}
	return new(big.Rat).SetString(text)
}
func scaleValue(value any, factor json.Number) (any, error) {
	n, ok := numericRat(value)
	scale, valid := numericRat(factor)
	if !ok || !valid {
		return nil, fmt.Errorf("scale requires finite numbers")
	}
	n.Mul(n, scale)
	denominator := new(big.Int).Set(n.Denom())
	two, five := big.NewInt(2), big.NewInt(5)
	counts := [2]int{}
	for i, prime := range []*big.Int{two, five} {
		for new(big.Int).Mod(denominator, prime).Sign() == 0 {
			denominator.Div(denominator, prime)
			counts[i]++
		}
	}
	if denominator.Cmp(big.NewInt(1)) != 0 {
		return nil, fmt.Errorf("non-decimal scale")
	}
	text := n.FloatString(max(counts[0], counts[1]))
	if strings.Contains(text, ".") {
		text = strings.TrimRight(strings.TrimRight(text, "0"), ".")
	}
	if text == "-0" {
		text = "0"
	}
	return json.Number(text), nil
}
