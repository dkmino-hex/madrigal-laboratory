package projects

import (
	"context"

	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func (s Store) SaveLink(ctx context.Context, projectID string, link domain.SourceLink, key string) (domain.SourceLink, error) {
	if link.Location.ProjectID != projectID {
		return domain.SourceLink{}, ErrInvalid
	}
	evidence, err := link.Evidence()
	if err != nil {
		return domain.SourceLink{}, err
	}
	project, err := s.Get(ctx, projectID)
	if err != nil {
		return domain.SourceLink{}, err
	}
	if project.Status != "READY" {
		return domain.SourceLink{}, ErrProjectNotReady
	}
	if s.Evidence == nil {
		return domain.SourceLink{}, ErrSourceUnavailable
	}
	for _, e := range evidence {
		if err := s.Evidence(ctx, projectID, e); err != nil {
			return domain.SourceLink{}, err
		}
	}
	return s.PersistLink(ctx, projectID, link, key)
}
