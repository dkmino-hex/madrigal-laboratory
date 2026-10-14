package bootstrap

import (
	"database/sql"
	"net/http"

	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/adapters/inbound/http"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/adapters/outbound/capturehttp"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/adapters/outbound/peerhttp"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/application/projects"
)

func New(db *sql.DB) http.Handler {
	return api.New(projects.Store{Repository: storage.Store{DB: db}, Peers: peerhttp.Client{}, Evidence: capturehttp.ValidateEvidence})
}
