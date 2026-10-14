package bootstrap

import (
	"context"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/platform/service"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/adapters/inbound/http"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/adapters/outbound/capturehttp"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/adapters/outbound/peerhttp"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/application/projects"
)

func Run() error {
	db, err := storage.Open(context.Background(), service.Env("WORKSPACE_DB_PATH", "data/workspace/workspace.sqlite"))
	if err != nil {
		return err
	}
	defer db.Close()
	store := projects.Store{Repository: storage.Store{DB: db}, Peers: peerhttp.Client{}, Evidence: capturehttp.ValidateEvidence}
	worker := jobs.Worker{Store: store.Jobs(), Handlers: map[string]jobs.Handler{projects.JournalKind: store.ImportJournal, projects.ReportKind: store.BuildReport, projects.ExportKind: store.BuildExport, projects.ProjectImportKind: store.RestoreProject}}
	return service.Run(service.Env("WORKSPACE_HTTP_ADDR", "127.0.0.1:8081"), api.New(store), worker.Run)
}
