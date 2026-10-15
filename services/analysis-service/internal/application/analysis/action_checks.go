package service

import (
	"context"
	"encoding/json"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/engine"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/research"
	"strconv"
)

func needsActionJournal(schema string) bool {
	var definition struct {
		Checks []struct {
			Op string `json:"op"`
		} `json:"checks"`
	}
	if json.Unmarshal([]byte(schema), &definition) != nil {
		return false
	}
	for _, check := range definition.Checks {
		if check.Op == "action" {
			return true
		}
	}
	return false
}
func actionSnapshot(ctx context.Context, project, schema string, workspace Workspace) ([]research.Action, bool, error) {
	if !needsActionJournal(schema) {
		return nil, true, nil
	}
	reader, ok := workspace.(ResearchWorkspace)
	if !ok {
		return nil, false, nil
	}
	return reader.ResearchActions(ctx, project)
}
func actionMatcher(actions []research.Action) engine.ActionMatcher {
	index := research.NewActionIndex(actions)
	return func(block domain.Block, span engine.Span, parameter string) (string, string) {
		start, _ := strconv.ParseUint(span.StartOffset, 10, 64)
		var first *domain.Source
		for i := range span.PacketRefs {
			source := &span.PacketRefs[i]
			if source.AlternativeID != "" || source.StreamStart > start || source.StreamEnd <= start {
				continue
			}
			if first == nil || source.PacketNo < first.PacketNo {
				first = source
			}
		}
		if first == nil || first.Timestamp == "" || block.CaptureName == "" {
			return "", "Недостаточно метаданных происхождения для связи с журналом"
		}
		row := research.Row{CaptureName: block.CaptureName, Timestamp: first.Timestamp}
		index.Bind(&row)
		value, ok := row.Values[parameter]
		if !ok {
			return "", "В окне времени нет однозначного значения «" + parameter + "»"
		}
		return value, ""
	}
}
