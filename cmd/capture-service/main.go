package main

import (
	"context"
	"errors"
	"log/slog"
	"os"

	"github.com/dkmino-hex/madrigal-laboratory/internal/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/internal/service"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/api"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/captures"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/originals"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("capture stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	db, err := storage.Open(context.Background(), service.Env("CAPTURE_DB_PATH", "data/capture/capture.sqlite"))
	if err != nil {
		return err
	}
	defer db.Close()
	files, err := originals.New(service.Env("CAPTURE_DATA_DIR", "data/capture"))
	if err != nil {
		return err
	}
	store := captures.Store{DB: db, Files: files, WorkspaceURL: service.Env("WORKSPACE_INTERNAL_URL", "http://127.0.0.1:8081")}
	if err = store.AuditOriginals(context.Background()); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	workerDone := make(chan error, 1)
	go func() {
		workerDone <- (jobs.Worker{Store: store.Jobs(), Handlers: map[string]jobs.Handler{captures.ImportKind: store.ImportJob, captures.AssembleKind: store.AssembleJob}}).Run(ctx)
	}()
	serverDone := make(chan error, 1)
	go func() { serverDone <- service.Run(service.Env("CAPTURE_HTTP_ADDR", "127.0.0.1:8082"), api.New(store)) }()
	select {
	case err = <-serverDone:
		cancel()
		workerErr := <-workerDone
		if err != nil {
			return err
		}
		if !errors.Is(workerErr, context.Canceled) {
			return workerErr
		}
		return nil
	case err = <-workerDone:
		return err
	}
}
