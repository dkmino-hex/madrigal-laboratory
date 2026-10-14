package captures

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

const ImportKind = "CAPTURE_IMPORT"
const AssembleKind = "CAPTURE_ASSEMBLE"

type Capture = domain.Capture
type Store struct {
	Repository
	Files       OriginalStore
	ReadCapture PacketReader
	Projects    ProjectContexts
}

func (s Store) AuditOriginals(ctx context.Context) error {
	return s.ForEachCapture(ctx, func(c Capture) error {
		return s.Files.Verify(ctx, domain.Original{SHA256: c.SHA256, RelativePath: c.RelativePath, Size: c.Size, Format: c.Format})
	})
}
func (s Store) AcceptOriginal(ctx context.Context, projectID, name string, input io.Reader) (Capture, jobs.Job, bool, error) {
	return s.AcceptOriginalWithSettings(ctx, projectID, name, input, "", nil)
}
func (s Store) AcceptOriginalWithSettings(ctx context.Context, projectID, name string, input io.Reader, settingsVersion string, settings json.RawMessage) (Capture, jobs.Job, bool, error) {
	if projectID == "" || strings.TrimSpace(name) == "" {
		return Capture{}, jobs.Job{}, false, errors.New("project and filename are required")
	}
	obj, err := s.Files.Put(ctx, input)
	if err != nil {
		return Capture{}, jobs.Job{}, false, err
	}
	return s.PublishOriginal(ctx, projectID, name, obj, settingsVersion, settings)
}
