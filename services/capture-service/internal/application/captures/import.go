package captures

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain/reassembly"
)

type ProjectContext = domain.ProjectContext

func (s Store) Context(ctx context.Context, projectID, version string) (ProjectContext, error) {
	if s.Projects == nil {
		return ProjectContext{}, errors.New("workspace URL is required")
	}
	return s.Projects.Context(ctx, projectID, version)
}

func (s Store) ImportJob(ctx context.Context, j jobs.Job, progress func(string, int64, *int64) error) error {
	if j.ResourceID == nil {
		return errors.New("import job has no capture ID")
	}
	var payload struct {
		SettingsVersion string          `json:"settingsVersion"`
		Settings        json.RawMessage `json:"settings"`
	}
	if err := json.Unmarshal(j.Payload, &payload); err != nil {
		return err
	}
	if payload.SettingsVersion == "" || len(payload.Settings) == 0 {
		project, err := s.Context(ctx, j.ProjectID, "current")
		if err != nil {
			return err
		}
		payload.SettingsVersion, payload.Settings = project.SettingsVersion, project.Settings
	}
	c, err := s.Get(ctx, j.ProjectID, *j.ResourceID)
	if err != nil {
		return err
	}
	file, err := s.Files.Open(domain.Original{SHA256: c.SHA256, RelativePath: c.RelativePath, Size: c.Size, Format: c.Format})
	if err != nil {
		return err
	}
	path := file.Name()
	file.Close()
	if err := progress("READING", 0, nil); err != nil {
		return err
	}
	if s.ReadCapture == nil {
		return errors.New("capture reader is not configured")
	}
	_, packets, err := s.ReadCapture(ctx, path, 250000)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	total := int64(len(packets))
	if err := progress("INDEXING", 0, &total); err != nil {
		return err
	}
	assemblyID := identifier.New("assembly")
	policy, err := checksumPolicy(payload.Settings)
	if err != nil {
		return err
	}
	sessions := reassembly.BuildSessions(c.ID, assemblyID, packets, policy)
	return s.SaveImport(ctx, j, c, payload.SettingsVersion, payload.Settings, assemblyID, packets, sessions)
}

func (s Store) AssembleJob(ctx context.Context, j jobs.Job, progress func(string, int64, *int64) error) error {
	if j.ResourceID == nil {
		return errors.New("assembly job has no resource ID")
	}
	captureID, packets, err := s.LoadAssembly(ctx, j)
	if err != nil {
		return err
	}
	if err := progress("ASSEMBLING", 0, nil); err != nil {
		return err
	}
	settings, err := s.AssemblySettings(ctx, j.ProjectID, *j.ResourceID)
	if err != nil {
		return err
	}
	policy, err := checksumPolicy(settings)
	if err != nil {
		return err
	}
	sessions := reassembly.BuildSessions(captureID, *j.ResourceID, packets, policy)
	return s.SaveAssembly(ctx, j, captureID, packets, sessions)
}

func checksumPolicy(settings json.RawMessage) (string, error) {
	var input struct {
		Checksum string `json:"checksum"`
	}
	if err := json.Unmarshal(settings, &input); err != nil {
		return "", err
	}
	if input.Checksum == "" {
		return "warn", nil
	}
	if input.Checksum != "warn" && input.Checksum != "strict" && input.Checksum != "ignore" {
		return "", errors.New("unsupported checksum policy")
	}
	return input.Checksum, nil
}
