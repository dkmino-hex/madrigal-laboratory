package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/engine"
)

type RunsService struct {
	Repo      Repository
	Capture   Capture
	Workspace Workspace
	wg        sync.WaitGroup
	semaphore chan struct{}
	ctx       context.Context
	cancel    context.CancelFunc
	mu        sync.Mutex
	closed    bool
}

func NewRunsService(repo Repository, client Capture) *RunsService {
	ctx, cancel := context.WithCancel(context.Background())
	return &RunsService{Repo: repo, Capture: client, semaphore: make(chan struct{}, 2), ctx: ctx, cancel: cancel}
}
func (s *RunsService) Start(ctx context.Context, project string, in domain.RunInput, key string) (domain.Run, error) {
	if project == "" || in.RevisionID == "" || in.AssemblyID == "" {
		return domain.Run{}, fmt.Errorf("%w: projectId, revisionId and assemblyId required", ErrInvalidInput)
	}
	if _, err := s.Repo.SchemaByRevision(ctx, project, in.RevisionID); err != nil {
		return domain.Run{}, err
	}
	// Resolve and pin real Capture metadata; never trust a client-supplied version.
	capMeta, assemblyMeta, err := s.Capture.Assembly(ctx, project, in.AssemblyID)
	if err != nil {
		return domain.Run{}, err
	}
	if assemblyMeta.Status != "READY" || capMeta.Status != "READY" {
		return domain.Run{}, fmt.Errorf("%w: Capture assembly not READY", ErrInvalidInput)
	}
	if in.CaptureID != "" && in.CaptureID != capMeta.CaptureID {
		return domain.Run{}, fmt.Errorf("%w: captureId does not match assembly", ErrInvalidInput)
	}
	if in.SettingsVersion != "" && in.SettingsVersion != assemblyMeta.SettingsVersion {
		return domain.Run{}, fmt.Errorf("%w: settingsVersion does not match assembly", ErrInvalidInput)
	}
	in.CaptureID = capMeta.CaptureID
	in.SettingsVersion = assemblyMeta.SettingsVersion
	in.CaptureSHA256 = capMeta.SHA256
	in.CaptureEngineVersion = assemblyMeta.EngineVersion
	in.SettingsJSON = "{}"
	if s.Workspace != nil {
		settings, e := s.Workspace.Get(ctx, project, assemblyMeta.SettingsVersion)
		if e != nil {
			return domain.Run{}, e
		}
		if settings.Status != "READY" || settings.SettingsVersion != assemblyMeta.SettingsVersion {
			return domain.Run{}, fmt.Errorf("%w: Workspace settings not READY", ErrInvalidInput)
		}
		in.SettingsJSON = string(settings.Settings)
	}
	streams, err := s.Capture.Streams(ctx, project, in.AssemblyID)
	if err != nil {
		return domain.Run{}, err
	}
	ranges := domain.Split(in.AssemblyID, streams)
	manifest, err := json.Marshal(map[string]any{"captureId": in.CaptureID, "captureSha256": in.CaptureSHA256, "assemblyId": in.AssemblyID, "captureEngineVersion": in.CaptureEngineVersion, "settingsVersion": in.SettingsVersion, "settings": json.RawMessage(in.SettingsJSON), "ranges": ranges, "filters": in.Filters})
	if err != nil {
		return domain.Run{}, err
	}
	in.InputManifestJSON = string(manifest)
	run, existing, err := s.Repo.CreateRun(ctx, project, in, key)
	if err != nil {
		return domain.Run{}, err
	}
	if existing {
		if run.RevisionID != in.RevisionID || run.AssemblyID != in.AssemblyID || run.CaptureID != in.CaptureID || run.SettingsVersion != in.SettingsVersion || run.InputManifestJSON != in.InputManifestJSON {
			return domain.Run{}, fmt.Errorf("%w: idempotency key used with different request", ErrInvalidInput)
		}
		return run, nil
	}
	if err := s.launch(run); err != nil {
		return run, err
	}
	return run, nil
}
func (s *RunsService) ResumeQueued(ctx context.Context) error {
	runs, e := s.Repo.QueuedRuns(ctx)
	if e != nil {
		return e
	}
	for _, run := range runs {
		if err := s.launch(run); err != nil {
			return err
		}
	}
	return nil
}
func (s *RunsService) execute(run domain.Run) {
	ctx, cancel := context.WithTimeout(s.ctx, 10*time.Minute)
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
func (s *RunsService) process(ctx context.Context, run domain.Run) error {
	schema, err := s.Repo.SchemaByRevision(ctx, run.ProjectID, run.RevisionID)
	if err != nil {
		return err
	}
	streams, err := s.Capture.Streams(ctx, run.ProjectID, run.AssemblyID)
	if err != nil {
		return err
	}
	ranges := domain.Split(run.AssemblyID, streams)
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

func (s *RunsService) launch(run domain.Run) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return context.Canceled
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		select {
		case <-s.ctx.Done():
			return
		case s.semaphore <- struct{}{}:
		}
		defer func() { <-s.semaphore }()
		s.execute(run)
	}()
	return nil
}

// Worker cancels and joins every run before the composition root closes SQLite.
func (s *RunsService) Worker(ctx context.Context) error {
	<-ctx.Done()
	s.Stop()
	return ctx.Err()
}

func (s *RunsService) Stop() {
	s.mu.Lock()
	s.closed = true
	s.cancel()
	s.mu.Unlock()
	s.wg.Wait()
}
