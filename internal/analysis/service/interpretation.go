package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/engine"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/model"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/repository"
)

var ErrInvalidInput = errors.New("invalid input")

type InterpretationService struct {
	repo *repository.InterpretationRepository
}

func NewInterpretationService(repo *repository.InterpretationRepository) *InterpretationService {
	return &InterpretationService{repo: repo}
}

type CreateInterpretationInput struct {
	ProjectID   string
	Name        string
	Description string
	Schema      json.RawMessage
}

type CreateInterpretationResult struct {
	Interpretation *model.Interpretation
	Revision       *model.Revision
}

func (s *InterpretationService) Create(ctx context.Context, input CreateInterpretationInput) (*CreateInterpretationResult, error) {
	if strings.TrimSpace(input.ProjectID) == "" {
		return nil, fmt.Errorf("%w: project ID is required", ErrInvalidInput)
	}

	if strings.TrimSpace(input.Name) == "" {
		return nil, fmt.Errorf("%w: name is required", ErrInvalidInput)
	}

	if err := validateRevision(input.Schema); err != nil {
		return nil, err
	}

	interpretation := &model.Interpretation{
		ID:          uuid.NewString(),
		ProjectID:   input.ProjectID,
		Name:        strings.TrimSpace(input.Name),
		Description: input.Description,
	}

	revision := &model.Revision{
		ID:               uuid.NewString(),
		InterpretationID: interpretation.ID,
		Version:          1,
		SchemaJSON:       string(input.Schema),
	}

	if err := s.repo.CreateWithRevision(ctx, interpretation, revision); err != nil {
		return nil, fmt.Errorf("create interpretation with revision: %w", err)
	}

	return &CreateInterpretationResult{
		Interpretation: interpretation,
		Revision:       revision,
	}, nil
}

func (s *InterpretationService) ListByProject(ctx context.Context, projectID string) ([]model.Interpretation, error) {
	if projectID == "" {
		return nil, fmt.Errorf("%w: projectId is required", ErrInvalidInput)
	}

	return s.repo.ListByProject(ctx, projectID)
}

type CreateRevisionInput struct {
	ProjectID        string
	InterpretationID string
	Revision         json.RawMessage
}

func (s *InterpretationService) CreateRevision(ctx context.Context, input CreateRevisionInput) (*model.Revision, error) {
	if strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.InterpretationID) == "" {
		return nil, fmt.Errorf("%w: projectId and interpretationId are required", ErrInvalidInput)
	}
	if err := validateRevision(input.Revision); err != nil {
		return nil, err
	}
	rev := &model.Revision{ID: uuid.NewString(), SchemaJSON: string(input.Revision)}
	if err := s.repo.CreateRevision(ctx, input.ProjectID, input.InterpretationID, rev); err != nil {
		return nil, fmt.Errorf("create revision: %w", err)
	}
	return rev, nil
}

func validateRevision(data json.RawMessage) error {
	if _, err := engine.Validate(string(data)); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	return nil
}

func (s *InterpretationService) ListRevisions(ctx context.Context, projectID, interpretationID string, limit, offset int) ([]model.Revision, bool, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(interpretationID) == "" || limit < 1 || offset < 0 {
		return nil, false, fmt.Errorf("%w: invalid list parameters", ErrInvalidInput)
	}
	return s.repo.ListRevisions(ctx, projectID, interpretationID, limit, offset)
}

func (s *InterpretationService) GetRevision(ctx context.Context, projectID, interpretationID, revisionID string) (*model.Revision, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(interpretationID) == "" || strings.TrimSpace(revisionID) == "" {
		return nil, fmt.Errorf("%w: IDs are required", ErrInvalidInput)
	}
	return s.repo.GetRevision(ctx, projectID, interpretationID, revisionID)
}

func (s *InterpretationService) CurrentRevisionID(ctx context.Context, interpretationID string) (string, error) {
	return s.repo.CurrentRevisionID(ctx, interpretationID)
}
