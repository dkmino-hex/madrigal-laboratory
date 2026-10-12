package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/dkmino-hex/madrigal-laboratory/internal/service"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/api"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("workspace stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	db, err := storage.Open(context.Background(), service.Env("WORKSPACE_DB_PATH", "data/workspace/workspace.sqlite"))
	if err != nil {
		return err
	}
	defer db.Close()
	return service.Run(service.Env("WORKSPACE_HTTP_ADDR", "127.0.0.1:8081"), api.New(db))
}
