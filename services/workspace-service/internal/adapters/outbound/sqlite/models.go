package storage

import (
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

type JournalInput = domain.JournalInput
type JournalImport = domain.JournalImport
type ActionQuery = domain.ActionQuery
type importContext = domain.ImportContext

var ErrInvalidArchive = domain.ErrInvalidArchive

const JournalKind = domain.JournalKind
const ReportKind = domain.ReportKind
const ExportKind = domain.ExportKind
const ProjectImportKind = domain.ProjectImportKind
