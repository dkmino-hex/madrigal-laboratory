package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/engine"
	"github.com/google/uuid"
)

var ErrInvalidInput = errors.New("invalid input")

type InterpretationService struct {
	repo      Repository
	workspace Workspace
}

func NewInterpretationService(repo Repository, workspace ...Workspace) *InterpretationService {
	s := &InterpretationService{repo: repo}
	if len(workspace) > 0 {
		s.workspace = workspace[0]
	}
	return s
}

type CreateInterpretationInput struct {
	ProjectID      string
	Name           string
	Description    string
	Schema         json.RawMessage
	IdempotencyKey string
}

type CreateInterpretationResult struct {
	Interpretation *domain.Interpretation
	Revision       *domain.Revision
}

func (s *InterpretationService) Create(ctx context.Context, input CreateInterpretationInput) (*CreateInterpretationResult, error) {
	if strings.TrimSpace(input.ProjectID) == "" {
		return nil, fmt.Errorf("%w: project ID is required", ErrInvalidInput)
	}

	if strings.TrimSpace(input.Name) == "" || len(input.Name) > 800 || len(input.Description) > 8000 || !validKey(input.IdempotencyKey) {
		return nil, fmt.Errorf("%w: name is required", ErrInvalidInput)
	}

	if err := validateRevision(input.Schema); err != nil {
		return nil, err
	}
	if s.workspace != nil {
		project, err := s.workspace.Get(ctx, input.ProjectID, "current")
		if err != nil {
			return nil, err
		}
		if project.Status != "READY" {
			return nil, fmt.Errorf("%w: project not ready", ErrInvalidInput)
		}
	}

	interpretation := &domain.Interpretation{
		ID:          uuid.NewString(),
		ProjectID:   input.ProjectID,
		Name:        strings.TrimSpace(input.Name),
		Description: input.Description,
	}

	revision := &domain.Revision{
		ID:               uuid.NewString(),
		InterpretationID: interpretation.ID,
		Version:          1,
		SchemaJSON:       string(input.Schema),
	}

	if err := s.repo.CreateWithRevision(ctx, interpretation, revision, input.IdempotencyKey); err != nil {
		return nil, fmt.Errorf("create interpretation with revision: %w", err)
	}

	return &CreateInterpretationResult{
		Interpretation: interpretation,
		Revision:       revision,
	}, nil
}

func (s *InterpretationService) ListByProject(ctx context.Context, projectID string) ([]domain.Interpretation, error) {
	if projectID == "" {
		return nil, fmt.Errorf("%w: projectId is required", ErrInvalidInput)
	}

	return s.repo.ListByProject(ctx, projectID)
}

type CreateRevisionInput struct {
	ProjectID                                       string
	InterpretationID                                string
	Revision                                        json.RawMessage
	ChangeComment, ParentRevisionID, IdempotencyKey string
}

func (s *InterpretationService) CreateRevision(ctx context.Context, input CreateRevisionInput) (*domain.Revision, error) {
	if strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.InterpretationID) == "" {
		return nil, fmt.Errorf("%w: projectId and interpretationId are required", ErrInvalidInput)
	}
	if err := validateRevision(input.Revision); err != nil {
		return nil, err
	}
	if len(input.ChangeComment) > 8000 || !validKey(input.IdempotencyKey) {
		return nil, ErrInvalidInput
	}
	rev := &domain.Revision{ID: uuid.NewString(), SchemaJSON: string(input.Revision), ChangeComment: input.ChangeComment, ParentRevisionID: input.ParentRevisionID}
	if err := s.repo.CreateRevision(ctx, input.ProjectID, input.InterpretationID, rev, input.IdempotencyKey); err != nil {
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

func validKey(key string) bool {
	if len(key) > 200 {
		return false
	}
	for _, r := range key {
		if r < 33 || r > 126 {
			return false
		}
	}
	return true
}

func (s *InterpretationService) ListRevisions(ctx context.Context, projectID, interpretationID string, limit, offset int) ([]domain.Revision, bool, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(interpretationID) == "" || limit < 1 || offset < 0 {
		return nil, false, fmt.Errorf("%w: invalid list parameters", ErrInvalidInput)
	}
	return s.repo.ListRevisions(ctx, projectID, interpretationID, limit, offset)
}

func (s *InterpretationService) GetRevision(ctx context.Context, projectID, interpretationID, revisionID string) (*domain.Revision, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(interpretationID) == "" || strings.TrimSpace(revisionID) == "" {
		return nil, fmt.Errorf("%w: IDs are required", ErrInvalidInput)
	}
	return s.repo.GetRevision(ctx, projectID, interpretationID, revisionID)
}

func (s *InterpretationService) CurrentRevisionID(ctx context.Context, interpretationID string) (string, error) {
	return s.repo.CurrentRevisionID(ctx, interpretationID)
}

func (s *InterpretationService) Get(ctx context.Context, project, id string) (*domain.Interpretation, error) {
	return s.repo.GetByID(ctx, project, id)
}
