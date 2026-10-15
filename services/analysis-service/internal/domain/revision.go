package domain

import "time"

type Revision struct {
	ID               string    `json:"id"`
	InterpretationID string    `json:"interpretationId"`
	Version          int       `json:"version"`
	SchemaJSON       string    `json:"schemaJson"`
	CreatedAt        time.Time `json:"createdAt"`
	ChangeComment    string    `json:"changeComment"`
	ParentRevisionID string    `json:"parentRevisionId,omitempty"`
}
