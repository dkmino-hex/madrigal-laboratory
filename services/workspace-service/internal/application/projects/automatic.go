package projects

import (
	"context"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func (s Store) CreateAutomaticObservation(ctx context.Context, project string, input domain.AutomaticObservation) (map[string]any, error) {
	if err := input.Validate(project); err != nil {
		return nil, err
	}
	current, err := s.Get(ctx, project)
	if err != nil {
		return nil, err
	}
	if current.Status != "READY" {
		return nil, ErrProjectNotReady
	}
	if s.Evidence == nil {
		return nil, ErrSourceUnavailable
	}
	for _, link := range input.Examples {
		proofs, _ := link.Evidence()
		for _, proof := range proofs {
			if err = s.Evidence(ctx, project, proof); err != nil {
				return nil, err
			}
		}
	}
	return s.PersistAutomaticObservation(ctx, project, input)
}
