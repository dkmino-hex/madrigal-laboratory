package bootstrap

import (
	"context"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/platform/service"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/inbound/http"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/filestore"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/pcap"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/workspacehttp"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
)

func Run() error {
	db, err := storage.Open(context.Background(), service.Env("CAPTURE_DB_PATH", "data/capture/capture.sqlite"))
	if err != nil {
		return err
	}
	defer db.Close()
	files, err := originals.New(service.Env("CAPTURE_DATA_DIR", "data/capture"))
	if err != nil {
		return err
	}
	store := captures.Store{Repository: storage.Store{DB: db}, Files: files, Projects: workspacehttp.Client{URL: service.Env("WORKSPACE_INTERNAL_URL", "http://127.0.0.1:8081")}, ReadCapture: pcap.ReadCaptureContext}
	if err = store.AuditOriginals(context.Background()); err != nil {
		return err
	}
	worker := jobs.Worker{Store: store.Jobs(), Handlers: map[string]jobs.Handler{captures.ImportKind: store.ImportJob, captures.AssembleKind: store.AssembleJob}}
	return service.Run(service.Env("CAPTURE_HTTP_ADDR", "127.0.0.1:8082"), api.New(store), worker.Run)
}
