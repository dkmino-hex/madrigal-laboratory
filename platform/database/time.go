package database

import (
	"fmt"
	"time"
)

type Timestamp struct {
	Time  time.Time
	Text  string
	Valid bool
}

func (t *Timestamp) Scan(value any) error {
	*t = Timestamp{}
	if value == nil {
		return nil
	}
	switch v := value.(type) {
	case string:
		t.Text = v
	case []byte:
		t.Text = string(v)
	default:
		return fmt.Errorf("unexpected timestamp type %T", value)
	}
	parsed, err := time.Parse(time.RFC3339Nano, t.Text)
	if err != nil {
		return fmt.Errorf("invalid stored timestamp: %w", err)
	}
	t.Time, t.Valid = parsed.UTC(), true
	return nil
}

func (t Timestamp) Pointer() *time.Time {
	if !t.Valid {
		return nil
	}
	value := t.Time
	return &value
}
