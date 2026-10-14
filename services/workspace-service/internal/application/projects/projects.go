package projects

import (
	"context"

	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

type CreateInput = domain.CreateInput
type Project = domain.Project
type Page = domain.Page
type SettingsVersion = domain.SettingsVersion
type Context = domain.Context
type EvidenceInput = domain.EvidenceInput
type ObservationInput = domain.ObservationInput
type ObservationPatch = domain.ObservationPatch
type Snapshot = domain.Snapshot
type JournalInput = domain.JournalInput
type JournalImport = domain.JournalImport
type ActionQuery = domain.ActionQuery
type projectArchiveManifest = domain.ProjectArchiveManifest
type importContext = domain.ImportContext
type captureImportResult = domain.CaptureImportResult

var ErrInvalid = domain.ErrInvalid
var ErrConflict = domain.ErrConflict
var ErrProjectNotReady = domain.ErrProjectNotReady
var ErrSourceUnavailable = domain.ErrSourceUnavailable
var ErrInvalidArchive = domain.ErrInvalidArchive

const JournalKind = domain.JournalKind
const ReportKind = domain.ReportKind
const ExportKind = domain.ExportKind
const ProjectImportKind = domain.ProjectImportKind

type Store struct {
	Repository
	Peers    PeerClient
	Evidence func(context.Context, string, EvidenceInput) error
}

func (s Store) CreateObservation(ctx context.Context, projectID string, in ObservationInput, validate func(context.Context, string, EvidenceInput) error) (map[string]any, error) {
	if err := in.Normalize(); err != nil {
		return nil, err
	}
	for _, e := range in.Evidence {
		if err := e.Validate(); err != nil {
			return nil, err
		}
		if err := validate(ctx, projectID, e); err != nil {
			return nil, err
		}
	}
	return s.PersistObservation(ctx, projectID, in)
}
