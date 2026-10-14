package bootstrap

import (
	"context"

	"github.com/dkmino-hex/madrigal-laboratory/platform/service"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/adapters/inbound/http"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/adapters/outbound/capturehttp"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/adapters/outbound/workspacehttp"
	analysis "github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/application/analysis"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/migrations"
)

func Run() error {
	path := service.Env("DB_PATH", "data/analysis/analysis.sqlite")
	db, err := storage.Open(path)
	if err != nil {
		return err
	}
	if err = storage.RunMigrations(db, migrations.Files); err != nil {
		return err
	}
	db, err = storage.Open(path)
	if err != nil {
		return err
	}
	defer db.Close()
	repo := storage.NewInterpretationRepository(db)
	capture := capture.New(service.Env("CAPTURE_URL", "http://capture-service:8082"))
	workspace := workspace.New(service.Env("WORKSPACE_URL", "http://workspace-service:8081"))
	runs := analysis.NewRunsService(repo, capture)
	defer runs.Stop()
	runs.Workspace = workspace
	if err = repo.RecoverRuns(context.Background()); err != nil {
		return err
	}
	if err = runs.ResumeQueued(context.Background()); err != nil {
		return err
	}
	return service.Run(service.Env("ANALYSIS_HTTP_ADDR", "127.0.0.1:8083"), handler.New(repo, capture, runs), runs.Worker)
}
