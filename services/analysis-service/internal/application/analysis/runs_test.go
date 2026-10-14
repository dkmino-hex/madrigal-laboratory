package service

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
)

type stoppingRepository struct {
	Repository
	started chan struct{}
	count   atomic.Int32
}

func (r *stoppingRepository) QueuedRuns(context.Context) ([]domain.Run, error) {
	return []domain.Run{{RunID: "one"}, {RunID: "two"}, {RunID: "three"}}, nil
}
func (r *stoppingRepository) StartJob(ctx context.Context, _ string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	r.count.Add(1)
	return true, nil
}
func (r *stoppingRepository) SetRunStatus(context.Context, string, string, string) error { return nil }
func (r *stoppingRepository) FinishJob(context.Context, string, string, string, string) error {
	return nil
}
func (r *stoppingRepository) SchemaByRevision(ctx context.Context, _, _ string) (string, error) {
	r.started <- struct{}{}
	<-ctx.Done()
	return "", ctx.Err()
}

func TestShutdownCancelsAndJoinsRuns(t *testing.T) {
	repo := &stoppingRepository{started: make(chan struct{}, 3)}
	runs := NewRunsService(repo, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan error, 1)
	go func() { finished <- runs.Worker(ctx) }()
	if err := runs.ResumeQueued(ctx); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		select {
		case <-repo.started:
		case <-time.After(2 * time.Second):
			t.Fatal("runs did not start")
		}
	}
	cancel()
	select {
	case err := <-finished:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown did not join active runs")
	}
	if repo.count.Load() != 2 {
		t.Fatalf("queued run started during shutdown: %d", repo.count.Load())
	}
	if err := runs.ResumeQueued(context.Background()); !errors.Is(err, context.Canceled) {
		t.Fatalf("run admitted after shutdown: %v", err)
	}
}
