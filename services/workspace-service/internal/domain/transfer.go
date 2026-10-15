package domain

import (
	"encoding/json"
	"errors"
	"regexp"
)

type Snapshot struct {
	ID        string          `json:"snapshotId"`
	ProjectID string          `json:"projectId"`
	Manifest  json.RawMessage `json:"manifest"`
	Metadata  json.RawMessage `json:"metadata"`
}

type JournalInput struct {
	Timezone       string
	OffsetNS       int64
	Name           string
	IdempotencyKey string
}

type JournalImport struct {
	ID           string          `json:"importId"`
	JobID        string          `json:"jobId"`
	Status       string          `json:"status"`
	SHA256       string          `json:"sha256"`
	TotalRows    int64           `json:"totalRows"`
	AcceptedRows int64           `json:"acceptedRows"`
	Diagnostics  json.RawMessage `json:"diagnostics"`
}

type ActionQuery struct {
	Cursor, Name, Search string
	From, To             *int64
	Limit                int
}

type ProjectArchiveManifest struct {
	Version             int               `json:"version"`
	ProjectID           string            `json:"projectId"`
	WorkspaceSnapshotID string            `json:"workspaceSnapshotId"`
	CaptureSnapshotID   string            `json:"captureSnapshotId"`
	AnalysisSnapshotID  string            `json:"analysisSnapshotId"`
	Files               map[string]string `json:"files"`
}

type ImportContext struct {
	Archive     ProjectArchiveManifest `json:"archive"`
	SettingsMap map[string]string      `json:"settingsMap"`
}

type CaptureImportResult struct {
	Status            string            `json:"status"`
	JobID             string            `json:"jobId"`
	CaptureIDs        map[string]string `json:"captureIds"`
	AssemblyIDs       map[string]string `json:"assemblyIds"`
	StreamIDs         map[string]string `json:"streamIds"`
	SessionIDs        map[string]string `json:"sessionIds"`
	AlternativeIDs    map[string]string `json:"alternativeIds"`
	InterpretationIDs map[string]string `json:"interpretationIds"`
	RevisionIDs       map[string]string `json:"revisionIds"`
	RunIDs            map[string]string `json:"runIds"`
}

var ErrInvalidArchive = errors.New("invalid project archive")

var runIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func ValidRunID(id string) bool { return runIDPattern.MatchString(id) }

func IntValue(v any) (int64, error) {
	switch value := v.(type) {
	case json.Number:
		n, err := value.Int64()
		if err != nil {
			return 0, ErrInvalidArchive
		}
		return n, nil
	case float64:
		if value != float64(int64(value)) {
			return 0, ErrInvalidArchive
		}
		return int64(value), nil
	default:
		return 0, ErrInvalidArchive
	}
}

func TextValue(row map[string]any, key string) (string, error) {
	v, ok := row[key].(string)
	if !ok {
		return "", ErrInvalidArchive
	}
	return v, nil
}

const JournalKind = "ACTION_LOG_IMPORT"
const ReportKind = "REPORT_BUILD"
const ExportKind = "PROJECT_EXPORT"
const ProjectImportKind = "PROJECT_IMPORT"

type JournalAction struct {
	SourceID                       string
	Line                           int64
	Capture, Session               string
	Start, End                     int64
	Name, Type, Parameters, Result string
}
type JournalSource struct {
	Path, Timezone string
	Offset         int64
}
type ImportState struct {
	ArchivePath, Hash, ContextJSON string
	WorkspaceRestored              bool
}
type Artifact struct {
	Status, Name, ContentType, RelativePath, SHA256 string
	Size                                            int64
	Valid                                           bool
}
