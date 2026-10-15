package domain

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

type CreateInput struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Settings    map[string]any `json:"settings,omitempty"`
}

type Project struct {
	ID              string    `json:"projectId"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	Status          string    `json:"status"`
	SettingsVersion *string   `json:"settingsVersion"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
	CreatedKey      string    `json:"-"`
}

type Page struct {
	Items      []Project `json:"items"`
	NextCursor string    `json:"nextCursor,omitempty"`
}

type SettingsVersion struct {
	ID        string          `json:"settingsVersion"`
	ProjectID string          `json:"projectId"`
	Version   int64           `json:"version"`
	Settings  json.RawMessage `json:"settings"`
	CreatedAt time.Time       `json:"createdAt"`
}

type Context struct {
	ProjectID       string          `json:"projectId"`
	Status          string          `json:"status"`
	SettingsVersion string          `json:"settingsVersion"`
	Version         int64           `json:"version"`
	Settings        json.RawMessage `json:"settings"`
}

type EvidenceInput struct {
	SessionID     string `json:"sessionId,omitempty"`
	Direction     string `json:"direction,omitempty"`
	AlternativeID string `json:"alternativeId,omitempty"`
	Kind          string `json:"kind"`
	CaptureID     string `json:"captureId"`
	CaptureSHA256 string `json:"captureSha256"`
	PacketNo      int64  `json:"packetNo"`
	FrameOffset   int64  `json:"frameOffset"`
	ByteLength    int64  `json:"byteLength"`
	AssemblyID    string `json:"assemblyId,omitempty"`
	StreamID      string `json:"streamId,omitempty"`
	StreamOffset  *int64 `json:"streamOffset,omitempty"`
}

type ObservationInput struct {
	Kind           string          `json:"kind"`
	Text           string          `json:"text"`
	Status         string          `json:"status,omitempty"`
	ActionID       string          `json:"actionId,omitempty"`
	Evidence       []EvidenceInput `json:"evidence,omitempty"`
	Basis          string          `json:"basis,omitempty"`
	Links          []LinkReference `json:"sourceLinks,omitempty"`
	IdempotencyKey string          `json:"-"`
}

type ObservationPatch struct {
	Kind                *string          `json:"kind,omitempty"`
	Text                *string          `json:"text,omitempty"`
	Status              *string          `json:"status,omitempty"`
	SelectedEvidenceIDs *[]string        `json:"selectedEvidenceIds,omitempty"`
	Basis               *string          `json:"basis,omitempty"`
	Links               *[]LinkReference `json:"sourceLinks,omitempty"`
	IdempotencyKey      string           `json:"-"`
}

var ErrInvalid = errors.New("invalid project request")
var ErrConflict = errors.New("idempotency key was used with a different request")
var ErrProjectNotReady = errors.New("project is not ready")
var ErrSourceUnavailable = errors.New("capture source is unavailable")

func ValidObservationKind(v string) bool { return v == "OBSERVATION" || v == "HYPOTHESIS" }

func ValidObservationStatus(v string) bool {
	return v == "DRAFT" || v == "SUPPORTED" || v == "REFUTED" || v == "INCONCLUSIVE"
}

func ValidEvidenceKind(v string) bool {
	return v == "SUPPORT" || v == "COUNTEREXAMPLE" || v == "CONTEXT"
}
func ValidIdempotencyKey(key string) bool {
	if len(key) < 1 || len(key) > 200 {
		return false
	}
	for _, r := range key {
		if r < 33 || r > 126 {
			return false
		}
	}
	return true
}
func (in *CreateInput) Normalize(key string) error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 200 || len(in.Description) > 8000 || !ValidIdempotencyKey(key) {
		return ErrInvalid
	}
	if in.Settings == nil {
		in.Settings = map[string]any{}
	}
	return nil
}
func (in *ObservationInput) Normalize() error {
	if !ValidObservationKind(in.Kind) || strings.TrimSpace(in.Text) == "" || len(in.Text) > 20000 || len(in.Evidence) > 100 || len(in.Basis) > 8000 || len(in.Links) > 100 {
		return ErrInvalid
	}
	if in.Status == "" {
		in.Status = "DRAFT"
	}
	if !ValidObservationStatus(in.Status) {
		return ErrInvalid
	}
	return nil
}
func (e EvidenceInput) Validate() error {
	if !ValidEvidenceKind(e.Kind) || e.PacketNo < 1 || e.FrameOffset < 0 || e.ByteLength < 1 || len(e.CaptureSHA256) != 64 || (e.AssemblyID == "") != (e.StreamID == "") || (e.AssemblyID == "") != (e.StreamOffset == nil) {
		return ErrInvalid
	}
	return nil
}
func (in ObservationPatch) Validate() error {
	if in.Text == nil && in.Status == nil && in.SelectedEvidenceIDs == nil && in.Basis == nil && in.Links == nil && in.Kind == nil {
		return ErrInvalid
	}
	if in.Kind != nil && !ValidObservationKind(*in.Kind) {
		return ErrInvalid
	}
	if in.Text != nil && (strings.TrimSpace(*in.Text) == "" || len(*in.Text) > 20000) {
		return ErrInvalid
	}
	if in.Status != nil && !ValidObservationStatus(*in.Status) {
		return ErrInvalid
	}
	if in.Basis != nil && len(*in.Basis) > 8000 {
		return ErrInvalid
	}
	if in.Links != nil && len(*in.Links) > 100 {
		return ErrInvalid
	}
	return nil
}
