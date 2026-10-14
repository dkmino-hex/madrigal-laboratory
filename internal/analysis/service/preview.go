package service

import (
    "context"
    "fmt"

    "github.com/dkmino-hex/madrigal-laboratory/internal/analysis/capture"
    "github.com/dkmino-hex/madrigal-laboratory/internal/analysis/engine"
    "github.com/dkmino-hex/madrigal-laboratory/internal/analysis/repository"
)

// PreviewService applies a saved revision to an explicit Capture byte range.
type PreviewService struct {
    Repo    *repository.InterpretationRepository
    Capture *capture.Client
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
    blocks, err := s.Capture.Read(ctx, projectID, []capture.Range{{AssemblyID: assemblyID, StreamID: streamID, Offset: offset, Length: length}})
    if err != nil {
        return engine.Result{}, err
    }
    return engine.Parse(schema, blocks)
}
