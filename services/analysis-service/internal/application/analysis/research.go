package service

import (
	"context"
	"fmt"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/engine"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/research"
)

type ResearchCapture interface {
	ResearchCaptures(context.Context, string, []research.CaptureSelection) ([]research.CaptureData, bool, error)
}
type ResearchWorkspace interface {
	ResearchActions(context.Context, string) ([]research.Action, bool, error)
}
type ResearchService struct {
	Capture   ResearchCapture
	Workspace ResearchWorkspace
	Repo      Repository
}

func (s ResearchService) Discover(ctx context.Context, project string, input research.Input) (research.Result, error) {
	if project == "" || len(input.Captures) > 8 || input.Direction != "" && input.Direction != "A_TO_B" && input.Direction != "B_TO_A" {
		return research.Result{}, fmt.Errorf("%w: invalid discovery input", ErrInvalidInput)
	}
	seen := map[string]bool{}
	for _, capture := range input.Captures {
		if capture.CaptureID == "" || seen[capture.CaptureID] {
			return research.Result{}, fmt.Errorf("%w: duplicate or empty capture", ErrInvalidInput)
		}
		seen[capture.CaptureID] = true
	}
	if s.Capture == nil || s.Workspace == nil {
		return research.Result{}, fmt.Errorf("%w: research dependencies unavailable", ErrInvalidInput)
	}
	captures, capturesComplete, err := s.Capture.ResearchCaptures(ctx, project, input.Captures)
	if err != nil {
		return research.Result{}, err
	}
	actions, actionsComplete, err := s.Workspace.ResearchActions(ctx, project)
	if err != nil {
		return research.Result{}, err
	}
	var framing *research.Framing
	if input.RevisionID != "" {
		schema, e := s.Repo.SchemaByRevision(ctx, project, input.RevisionID)
		if e != nil {
			return research.Result{}, e
		}
		definition, e := engine.Validate(schema)
		if e != nil {
			return research.Result{}, fmt.Errorf("%w: invalid revision", ErrInvalidInput)
		}
		if definition.Framing.LengthIncludesHeader {
			return research.Result{}, fmt.Errorf("%w: use automatic framing or a payload-length revision", ErrInvalidInput)
		}
		framing = &research.Framing{Magic: definition.Framing.Magic, HeaderLength: definition.Framing.HeaderLength, LengthOffset: definition.Framing.LengthOffset, LengthType: definition.Framing.LengthType, FixedLength: definition.Framing.FixedLength}
		if framing.FixedLength == 0 && framing.LengthType == "" {
			return research.Result{}, fmt.Errorf("%w: revision needs fixed or length-prefixed framing", ErrInvalidInput)
		}
	}
	result := research.Discover(project, input, captures, actions, framing)
	if !capturesComplete || !actionsComplete {
		result.Complete = false
		result.Warnings = append(result.Warnings, "Часть записей или журнала не вошла в интерактивный предел: максимум 8 записей и 2000 действий.")
	}
	if err = ctx.Err(); err != nil {
		return research.Result{}, err
	}
	return result, nil
}
