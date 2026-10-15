package captures

import (
	"archive/zip"
	"context"
	"encoding/json"
	"io"
	"os"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain/reassembly"
)

type OriginalStore interface {
	Put(context.Context, io.Reader) (domain.Original, error)
	Open(domain.Original) (*os.File, error)
	Verify(context.Context, domain.Original) error
}
type PacketReader func(context.Context, string, int) (string, []reassembly.Packet, error)
type ProjectContexts interface {
	Context(context.Context, string, string) (domain.ProjectContext, error)
}

// Repository keeps atomic Capture writes and read models behind the storage boundary.
type Repository interface {
	AssemblySettings(context.Context, string, string) (json.RawMessage, error)
	PingContext(context.Context) error
	Jobs() jobs.Store
	ForEachCapture(context.Context, func(Capture) error) error
	PublishOriginal(context.Context, string, string, domain.Original, string, json.RawMessage) (Capture, jobs.Job, bool, error)
	Get(context.Context, string, string) (Capture, error)
	EnqueueAssembly(context.Context, string, string, string, json.RawMessage, string) (string, jobs.Job, error)
	SaveImport(context.Context, jobs.Job, Capture, string, json.RawMessage, string, []reassembly.Packet, []reassembly.Session) error
	LoadAssembly(context.Context, jobs.Job) (string, []reassembly.Packet, error)
	SaveAssembly(context.Context, jobs.Job, string, []reassembly.Packet, []reassembly.Session) error
	ListCaptures(ctx context.Context, projectID, cursorToken string, limit int) (map[string]any, error)
	Packet(ctx context.Context, projectID, captureID string, n int64) (map[string]any, error)
	Assemblies(ctx context.Context, projectID, captureID string) (map[string]any, error)
	ResearchData(context.Context, string, string, string, int64) (domain.ResearchData, error)
	Search(ctx context.Context, assemblyID, streamID string, pattern []byte, cursor int64, limit int) (map[string]any, error)
	StreamInfo(ctx context.Context, projectID string, assemblyID, streamID string) (int64, error)
	StreamReadContext(context.Context, string, string) (map[string]any, error)
	StreamIntervals(ctx context.Context, projectID string, assemblyID, streamID string, offset, length int64) ([]map[string]any, error)
	StreamIntervalsUnchecked(ctx context.Context, assemblyID, streamID string, offset, length int64) ([]map[string]any, error)
	SourceSpans(ctx context.Context, projectID string, assemblyID, streamID string, offset, length int64) ([]map[string]any, error)
	SourceSpansUnchecked(ctx context.Context, assemblyID, streamID string, offset, length int64) ([]map[string]any, error)
	Sessions(ctx context.Context, projectID string, q map[string]string, limit int) (map[string]any, error)
	Session(ctx context.Context, projectID, aid, sessionID string) (map[string]any, error)
	CreateView(ctx context.Context, projectID string, ranges []domain.ViewRange) (map[string]any, error)

	ViewManifest(ctx context.Context, id string) (string, error)
	ValidateEvidence(ctx context.Context, projectID string, entries []domain.EvidenceCheck) error
	CreateSnapshot(context.Context, string, domain.SnapshotInput) (map[string]any, error)
	SnapshotMetadata(context.Context, string) (domain.SnapshotMeta, error)
	WriteSnapshotTables(context.Context, *zip.Writer, domain.SnapshotMeta) (map[string]string, error)
	ExistingImport(context.Context, string, string, string) (map[string]any, bool, error)
	RestoreTables(context.Context, string, string, string, map[string][]map[string]any, map[string]string) (map[string]any, error)
}
