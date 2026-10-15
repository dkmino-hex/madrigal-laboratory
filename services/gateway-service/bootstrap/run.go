package bootstrap

import (
	"github.com/dkmino-hex/madrigal-laboratory/platform/service"
	"github.com/dkmino-hex/madrigal-laboratory/services/gateway-service/internal/adapters/inbound/http"
	"github.com/dkmino-hex/madrigal-laboratory/services/gateway-service/internal/adapters/outbound/proxy"
)

func Run() error {
	workspace, err := proxy.New(service.Env("WORKSPACE_URL", "http://workspace-service:8081"))
	if err != nil {
		return err
	}
	capture, err := proxy.New(service.Env("CAPTURE_URL", "http://capture-service:8082"))
	if err != nil {
		return err
	}
	analysis, err := proxy.New(service.Env("ANALYSIS_URL", "http://analysis-service:8083"))
	if err != nil {
		return err
	}
	return service.Run(service.Env("GATEWAY_HTTP_ADDR", "127.0.0.1:8080"), api.New(workspace, capture, analysis, service.Env("FRONTEND_ORIGIN", "http://localhost:5173,http://127.0.0.1:5173"), service.Env("FRONTEND_DIR", "")))
}
