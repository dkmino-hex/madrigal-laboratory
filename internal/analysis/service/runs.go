package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/capture"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/engine"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/repository"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/workspace"
	"sync"
	"time"
)

type RunsService struct {
	Repo      *repository.InterpretationRepository
	Capture   *capture.Client
	Workspace *workspace.Client
	wg        sync.WaitGroup
	semaphore chan struct{}
}

func NewRunsService(repo *repository.InterpretationRepository, client *capture.Client) *RunsService {
	return &RunsService{Repo: repo, Capture: client, semaphore: make(chan struct{}, 2)}
}
func (s *RunsService) Start(ctx context.Context, project string, in repository.RunInput, key string) (repository.Run, error) {
	if project == "" || in.RevisionID == "" || in.AssemblyID == "" {
		return repository.Run{}, fmt.Errorf("%w: projectId, revisionId and assemblyId required", ErrInvalidInput)
	}
	if _, err := s.Repo.SchemaByRevision(ctx, project, in.RevisionID); err != nil {
		return repository.Run{}, err
	}
	// Resolve and pin real Capture metadata; never trust a client-supplied version.
	capMeta, assemblyMeta, err := s.Capture.Assembly(ctx, project, in.AssemblyID)
	if err != nil {
		return repository.Run{}, err
	}
	if assemblyMeta.Status != "READY" || capMeta.Status != "READY" {
		return repository.Run{}, fmt.Errorf("%w: Capture assembly not READY", ErrInvalidInput)
	}
	if in.CaptureID != "" && in.CaptureID != capMeta.CaptureID {
		return repository.Run{}, fmt.Errorf("%w: captureId does not match assembly", ErrInvalidInput)
	}
	if in.SettingsVersion != "" && in.SettingsVersion != assemblyMeta.SettingsVersion {
		return repository.Run{}, fmt.Errorf("%w: settingsVersion does not match assembly", ErrInvalidInput)
	}
	in.CaptureID = capMeta.CaptureID
	in.SettingsVersion = assemblyMeta.SettingsVersion
	in.CaptureSHA256 = capMeta.SHA256
	in.CaptureEngineVersion = assemblyMeta.EngineVersion
	in.SettingsJSON = "{}"
	if s.Workspace != nil {
		settings, e := s.Workspace.Get(ctx, project, assemblyMeta.SettingsVersion)
		if e != nil {
			return repository.Run{}, e
		}
		if settings.Status != "READY" || settings.SettingsVersion != assemblyMeta.SettingsVersion {
			return repository.Run{}, fmt.Errorf("%w: Workspace settings not READY", ErrInvalidInput)
		}
		in.SettingsJSON = string(settings.Settings)
	}
	streams, err := s.Capture.Streams(ctx, project, in.AssemblyID)
	if err != nil {
		return repository.Run{}, err
	}
	ranges := capture.Split(in.AssemblyID, streams)
	manifest, err := json.Marshal(map[string]any{"captureId": in.CaptureID, "captureSha256": in.CaptureSHA256, "assemblyId": in.AssemblyID, "captureEngineVersion": in.CaptureEngineVersion, "settingsVersion": in.SettingsVersion, "settings": json.RawMessage(in.SettingsJSON), "ranges": ranges, "filters": in.Filters})
	if err != nil {
		return repository.Run{}, err
	}
	in.InputManifestJSON = string(manifest)
	run, existing, err := s.Repo.CreateRun(ctx, project, in, key)
	if err != nil {
		return repository.Run{}, err
	}
	if existing {
		if run.RevisionID != in.RevisionID || run.AssemblyID != in.AssemblyID || run.CaptureID != in.CaptureID || run.SettingsVersion != in.SettingsVersion || run.InputManifestJSON != in.InputManifestJSON {
			return repository.Run{}, fmt.Errorf("%w: idempotency key used with different request", ErrInvalidInput)
		}
		return run, nil
	}
	s.wg.Add(1)
	go func() { defer s.wg.Done(); s.semaphore <- struct{}{}; defer func() { <-s.semaphore }(); s.execute(run) }()
	return run, nil
}
func (s *RunsService) ResumeQueued(ctx context.Context) error {
	runs, e := s.Repo.QueuedRuns(ctx)
	if e != nil {
		return e
	}
	for _, run := range runs {
		s.wg.Add(1)
		go func(run repository.Run) {
			defer s.wg.Done()
			s.semaphore <- struct{}{}
			defer func() { <-s.semaphore }()
			s.execute(run)
		}(run)
	}
	return nil
}
func (s *RunsService) execute(run repository.Run) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	started, e := s.Repo.StartJob(ctx, run.JobID)
	if e != nil || !started {
		return
	}
	_ = s.Repo.SetRunStatus(ctx, run.RunID, "running", `{}`)
	if err := s.process(ctx, run); err != nil {
		status, code := "FAILED", "ANALYSIS_ERROR"
		if errors.Is(err, context.Canceled) || err.Error() == "job cancelled" {
			status = "CANCELLED"
			code = ""
		}
		_ = s.Repo.FinishJob(context.Background(), run.JobID, status, code, err.Error())
		summary, _ := json.Marshal(map[string]any{"error": err.Error()})
		_ = s.Repo.SetRunStatus(context.Background(), run.RunID, "failed", string(summary))
		return
	}
	requested, err := s.Repo.JobCancelRequested(context.Background(), run.JobID)
	if err != nil || requested {
		_ = s.Repo.FinishJob(context.Background(), run.JobID, "CANCELLED", "", "")
		_ = s.Repo.SetRunStatus(context.Background(), run.RunID, "failed", `{"reason":"cancelled"}`)
		return
	}
	_ = s.Repo.FinishJob(context.Background(), run.JobID, "SUCCEEDED", "", "")
}
func (s *RunsService) process(ctx context.Context, run repository.Run) error {
	schema, err := s.Repo.SchemaByRevision(ctx, run.ProjectID, run.RevisionID)
	if err != nil {
		return err
	}
	streams, err := s.Capture.Streams(ctx, run.ProjectID, run.AssemblyID)
	if err != nil {
		return err
	}
	ranges := capture.Split(run.AssemblyID, streams)
	if len(ranges) == 0 {
		return fmt.Errorf("no stream bytes in selected assembly")
	}
	_ = s.Repo.ProgressJob(ctx, run.JobID, 0, len(ranges))
	var fields, diagnostics, blocksCount int
	for i := 0; i < len(ranges); i += 256 {
		cancelled, e := s.Repo.JobCancelRequested(ctx, run.JobID)
		if e != nil {
			return e
		}
		if cancelled {
			return fmt.Errorf("job cancelled")
		}
		end := i + 256
		if end > len(ranges) {
			end = len(ranges)
		}
		blocks, e := s.Capture.Read(ctx, run.ProjectID, ranges[i:end])
		if e != nil {
			return e
		}
		parsed, e := engine.Parse(schema, blocks)
		if e != nil {
			return e
		}
		payload, e := json.Marshal(parsed)
		if e != nil {
			return e
		}
		if e = s.Repo.SaveResult(ctx, run.RunID, string(payload)); e != nil {
			return e
		}
		fields += len(parsed.Fields)
		diagnostics += len(parsed.Errors)
		blocksCount += len(blocks)
		_ = s.Repo.ProgressJob(ctx, run.JobID, end, len(ranges))
	}
	summary, _ := json.Marshal(map[string]any{"fields": fields, "diagnostics": diagnostics, "blocks": blocksCount, "streams": len(streams)})
	return s.Repo.SetRunStatus(ctx, run.RunID, "completed", string(summary))
}
func (s *RunsService) Wait() { s.wg.Wait() }
