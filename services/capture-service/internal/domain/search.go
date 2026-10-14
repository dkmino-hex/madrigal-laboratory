package domain

import (
	"encoding/hex"
	"errors"
	"strings"
)

func SearchPattern(mode, raw string) ([]byte, error) {
	if raw == "" || len(raw) > 2048 {
		return nil, errPattern
	}
	switch strings.ToUpper(mode) {
	case "HEX":
		clean := strings.Join(strings.Fields(raw), "")
		if len(clean) == 0 || len(clean)%2 != 0 {
			return nil, errPattern
		}
		b, err := hex.DecodeString(clean)
		if err != nil {
			return nil, errPattern
		}
		return b, nil
	case "ASCII":
		for i := 0; i < len(raw); i++ {
			if raw[i] > 127 {
				return nil, errPattern
			}
		}
		return []byte(raw), nil
	default:
		return nil, errPattern
	}
}

var errPattern = errors.New("mode must be HEX or ASCII and pattern must be nonempty and valid")
