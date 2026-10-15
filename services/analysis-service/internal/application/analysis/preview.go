package service

import (
	"context"
	"fmt"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/engine"
)

// PreviewService applies a saved revision to an explicit Capture byte range.
type PreviewService struct {
	Repo      Repository
	Capture   Capture
	Workspace Workspace
}

func (s *PreviewService) Run(ctx context.Context, projectID, revisionID, assemblyID, streamID string, offset, length uint64) (engine.Result, error) {
	if projectID == "" || revisionID == "" || assemblyID == "" || streamID == "" || length == 0 || length > 1<<20 || offset > ^uint64(0)-length {
		return engine.Result{}, fmt.Errorf("%w: invalid preview parameters", ErrInvalidInput)
	}
	schema, err := s.Repo.SchemaByRevision(ctx, projectID, revisionID)
	if err != nil {
		return engine.Result{}, err
	}
	if _, err = engine.Validate(schema); err != nil {
		return engine.Result{}, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	blocks, err := s.Capture.Read(ctx, projectID, []domain.Range{{AssemblyID: assemblyID, StreamID: streamID, Offset: offset, Length: length}})
	if err != nil {
		return engine.Result{}, err
	}
	actions, _, err := actionSnapshot(ctx, projectID, schema, s.Workspace)
	if err != nil {
		return engine.Result{}, err
	}
	return engine.Parse(schema, blocks, actionMatcher(actions))
}
