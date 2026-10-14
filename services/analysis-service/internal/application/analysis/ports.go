package service

import (
	"context"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
)

type Repository interface {
	SchemaByRevision(ctx context.Context, project, revision string) (string, error)
	CreateRun(ctx context.Context, project string, in domain.RunInput, key string) (domain.Run, bool, error)
	GetRun(ctx context.Context, project, id string) (domain.Run, error)
	ListRuns(ctx context.Context, project, status string, limit, offset int) ([]domain.Run, bool, error)
	SetRunStatus(ctx context.Context, id, status string, summary string) error
	SaveResult(ctx context.Context, id, result string) error
	Results(ctx context.Context, project, id string) ([]string, error)
	RecoverRuns(ctx context.Context) error
	CreateWithRevision(ctx context.Context, interpretation *domain.Interpretation, revision *domain.Revision) error
	ListByProject(ctx context.Context, projectID string) ([]domain.Interpretation, error)
	GetJob(ctx context.Context, id string) (domain.Job, error)
	CancelJob(ctx context.Context, id string) (domain.Job, error)
	StartJob(ctx context.Context, id string) (bool, error)
	ProgressJob(ctx context.Context, id string, done, total int) error
	FinishJob(ctx context.Context, id, status, code, message string) error
	JobCancelRequested(ctx context.Context, id string) (bool, error)
	RecoverJobs(ctx context.Context) error
	QueuedRuns(ctx context.Context) ([]domain.Run, error)
	CreateRevision(ctx context.Context, projectID, interpretationID string, revision *domain.Revision) error
	ListRevisions(ctx context.Context, projectID, interpretationID string, limit, offset int) ([]domain.Revision, bool, error)
	GetRevision(ctx context.Context, projectID, interpretationID, revisionID string) (*domain.Revision, error)
	CurrentRevisionID(ctx context.Context, interpretationID string) (string, error)
	ExportSnapshot(ctx context.Context, project string) (domain.Snapshot, error)
	ImportSnapshot(ctx context.Context, dest string, s domain.Snapshot, captures, assemblies, streams, settings map[string]string, importID, digest string) error
	SaveSnapshot(ctx context.Context, id, project string, data []byte) error
	LoadSnapshot(ctx context.Context, id string) ([]byte, error)
	ImportSeen(ctx context.Context, project, importID, digest string) (bool, error)
}

type Capture interface {
	Read(context.Context, string, []domain.Range) ([]domain.Block, error)
	Streams(context.Context, string, string) ([]domain.Stream, error)
	Assembly(context.Context, string, string) (domain.CaptureMetadata, domain.AssemblyMetadata, error)
}

type Workspace interface {
	Get(context.Context, string, string) (domain.ProjectContext, error)
}
