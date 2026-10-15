package projects

import (
	"archive/zip"
	"context"
	"encoding/json"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

type Repository interface {
	PersistObservation(ctx context.Context, projectID string, in ObservationInput) (map[string]any, error)
	PersistAutomaticObservation(context.Context, string, domain.AutomaticObservation) (map[string]any, error)
	Observation(ctx context.Context, projectID, id string) (map[string]any, error)
	Observations(ctx context.Context, projectID, cursor, kind, status, source string, limit int) (map[string]any, error)
	PatchObservation(ctx context.Context, projectID, id string, in ObservationPatch) (map[string]any, error)
	Create(ctx context.Context, input CreateInput, key string) (Project, bool, error)
	Get(ctx context.Context, id string) (Project, error)
	List(ctx context.Context, token string, limit int, search ...string) (Page, error)
	SettingsContext(ctx context.Context, projectID, version string) (Context, error)
	UpdateSettings(ctx context.Context, projectID string, settings map[string]any, key string) (SettingsVersion, bool, error)
	CreateSnapshot(ctx context.Context, projectID string) (Snapshot, error)
	Jobs() jobs.Store
	Actions(ctx context.Context, projectID string, q ActionQuery) (map[string]any, error)
	RequestReport(ctx context.Context, projectID, runID string) (map[string]any, error)
	RequestExport(ctx context.Context, projectID string) (map[string]any, error)
	RegisterJournal(ctx context.Context, projectID string, in JournalInput, final, hash string) (JournalImport, error)
	JournalSource(ctx context.Context, id string) (domain.JournalSource, error)
	WriteJournal(ctx context.Context, j jobs.Job, parse func(func(domain.JournalAction) error) (int64, int64, []map[string]any, error)) (int64, error)
	ExistingProjectImport(ctx context.Context, importID, hash string) (map[string]any, bool, error)
	RegisterProjectImport(ctx context.Context, importID, final, hash string, manifest domain.ProjectArchiveManifest, workspace map[string][]map[string]any) (map[string]any, error)
	RestoreWorkspaceRows(ctx context.Context, projectID string, data map[string][]map[string]any, capture domain.CaptureImportResult, journalPaths map[string]string) error
	ImportState(ctx context.Context, id, projectID string) (domain.ImportState, error)
	SetImportState(ctx context.Context, id, status string, children map[string]string) error
	DataDirectory(ctx context.Context) (string, error)
	PingContext(ctx context.Context) error
	SnapshotData(ctx context.Context, id, projectID string) ([]byte, []byte, error)
	SetArtifact(ctx context.Context, id, name, hash string, size int64) error
	ForEachJournal(ctx context.Context, projectID string, visit func(string, string) error) error
	Artifact(ctx context.Context, id string) (domain.Artifact, error)
	Settings(ctx context.Context, projectID, version string) ([]SettingsVersion, error)
	Artifacts(ctx context.Context, projectID, cursor string, limit int) (map[string]any, error)
	JournalImport(ctx context.Context, projectID, id string) (JournalImport, error)
	Links(ctx context.Context, projectID, cursor, actionID string, limit int) (map[string]any, error)
	PersistLink(ctx context.Context, projectID string, link domain.SourceLink, key string) (domain.SourceLink, error)
	DeleteObservation(ctx context.Context, projectID, id string) error
}

type PeerClient interface {
	Snapshot(context.Context, string, string) (string, error)
	WriteArchive(context.Context, *zip.Writer, string, string, string) (string, error)
	Restore(context.Context, string, string, string, *zip.File, map[string]string, func(string) error) (domain.CaptureImportResult, error)
	ValidateEvidence(context.Context, string, []map[string]any) error
	ReadRun(context.Context, string, string) (map[string]any, []json.RawMessage, error)
}
