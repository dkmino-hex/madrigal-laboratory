package model

import "time"

type Revision struct {
	ID               string    `json:"id"`
	InterpretationID string    `json:"interpretationId"`
	Version          int       `json:"version"`
	SchemaJSON       string    `json:"-"`
	CreatedAt        time.Time `json:"createdAt"`
}
