package domain

import (
	"encoding/json"
	"errors"
	"time"
)

type Capture struct {
	ID           string    `json:"captureId"`
	ProjectID    string    `json:"projectId"`
	SHA256       string    `json:"sha256"`
	OriginalName string    `json:"originalName"`
	RelativePath string    `json:"-"`
	Size         int64     `json:"sizeBytes,string"`
	Format       string    `json:"format"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

type ProjectContext struct {
	ProjectID       string          `json:"projectId"`
	Status          string          `json:"status"`
	SettingsVersion string          `json:"settingsVersion"`
	Settings        json.RawMessage `json:"settings"`
}

type Original struct {
	SHA256       string
	RelativePath string
	Size         int64
	Format       string
}

const MaxCaptureSize int64 = 100 << 20

var ErrFormat = errors.New("expected PCAP or PCAPNG")
var ErrTooLarge = errors.New("capture exceeds 100 MiB")
var ErrSelection = errors.New("selected capture or assembly is not ready in this project")

// AssemblyRequestError distinguishes a rejected assembly from a storage failure.
type AssemblyRequestError struct{ Cause error }

func (e AssemblyRequestError) Error() string { return e.Cause.Error() }
func (e AssemblyRequestError) Unwrap() error { return e.Cause }

func DetectFormat(magic []byte) (string, error) {
	if len(magic) < 4 {
		return "", ErrFormat
	}
	switch string(magic[:4]) {
	case "\xd4\xc3\xb2\xa1", "\xa1\xb2\xc3\xd4", "\x4d\x3c\xb2\xa1", "\xa1\xb2\x3c\x4d":
		return "PCAP", nil
	case "\x0a\x0d\x0d\x0a":
		return "PCAPNG", nil
	default:
		return "", ErrFormat
	}
}
