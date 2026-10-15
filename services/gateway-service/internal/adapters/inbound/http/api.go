package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

func New(workspaceProxy, captureProxy, analysisProxy http.Handler, allowedOrigin string, staticDirectory ...string) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Gateway is running"))
	})

	mux.Handle("GET /api/v1/projects", workspaceProxy)
	mux.Handle("POST /api/v1/projects", workspaceProxy)
	mux.Handle("GET /api/v1/projects/{projectId}", workspaceProxy)
	mux.Handle("PATCH /api/v1/projects/{projectId}/settings", workspaceProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/settings", workspaceProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/artifacts", workspaceProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/evidence", workspaceProxy)
	mux.Handle("POST /api/v1/projects/{projectId}/evidence", workspaceProxy)
	mux.Handle("PATCH /api/v1/projects/{projectId}/evidence/{evidenceId}", workspaceProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/action-log/{importId}", workspaceProxy)
	mux.Handle("DELETE /api/v1/projects/{projectId}/observations/{observationId}", workspaceProxy)
	mux.Handle("POST /api/v1/projects/import", workspaceProxy)
	mux.Handle("POST /api/v1/projects/{projectId}/action-log", workspaceProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/actions", workspaceProxy)
	mux.Handle("POST /api/v1/projects/{projectId}/observations", workspaceProxy)
	mux.Handle("POST /api/v1/projects/{projectId}/observations/automatic", workspaceProxy)
	mux.Handle("POST /api/v1/projects/{projectId}/discoveries", analysisProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/observations", workspaceProxy)
	mux.Handle("PATCH /api/v1/projects/{projectId}/observations/{observationId}", workspaceProxy)
	mux.Handle("POST /api/v1/projects/{projectId}/exports", workspaceProxy)
	mux.Handle("POST /api/v1/projects/{projectId}/reports", workspaceProxy)
	mux.Handle("GET /api/v1/artifacts/{artifactId}", workspaceProxy)

	mux.Handle("POST /api/v1/projects/{projectId}/captures", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/captures", captureProxy)
	mux.HandleFunc("GET /api/v1/jobs/{jobId}", func(w http.ResponseWriter, r *http.Request) {
		jobProxy(w, r, workspaceProxy, captureProxy, analysisProxy)
	})
	mux.HandleFunc("POST /api/v1/jobs/{jobId}/cancel", func(w http.ResponseWriter, r *http.Request) {
		jobProxy(w, r, workspaceProxy, captureProxy, analysisProxy)
	})
	mux.Handle("GET /api/v1/projects/{projectId}/captures/{captureId}/packets/{packetId}", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/sessions", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/sessions/{sessionId}", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/streams/{streamId}/bytes", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/streams/{streamId}/sources", captureProxy)
	mux.Handle("POST /api/v1/projects/{projectId}/captures/{captureId}/assemblies", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/captures/{captureId}/assemblies", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/streams/{streamId}/search", captureProxy)

	mux.Handle("/api/v1/projects/{projectId}/interpretations", analysisProxy)
	mux.Handle("GET /api/v1/analysis/health", analysisProxy)
	mux.Handle("/api/v1/projects/{projectId}/interpretations/{rest...}", analysisProxy)
	mux.Handle("/api/v1/projects/{projectId}/previews", analysisProxy)
	mux.Handle("/api/v1/projects/{projectId}/runs", analysisProxy)
	mux.Handle("/api/v1/projects/{projectId}/runs/{rest...}", analysisProxy)
	directory := ""
	if len(staticDirectory) > 0 {
		directory = staticDirectory[0]
	}
	mux.Handle("/", frontend(directory))

	return corsMiddleware(mux, allowedOrigin)
}

func corsMiddleware(next http.Handler, allowedOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowed := false
		for _, candidate := range strings.Split(allowedOrigin, ",") {
			if origin != "" && origin == strings.TrimSpace(candidate) {
				allowed = true
				break
			}
		}
		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, X-Request-ID")
			w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID, Idempotency-Replayed, Location, ETag")
		}

		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			if !allowed {
				http.Error(w, "Origin not allowed", http.StatusForbidden)
				return
			}

			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func jobProxy(w http.ResponseWriter, r *http.Request, ws, cap, ana http.Handler) {
	id := r.PathValue("jobId")
	switch {
	case strings.HasPrefix(id, "ws_"):
		ws.ServeHTTP(w, r)
	case strings.HasPrefix(id, "cap_"):
		cap.ServeHTTP(w, r)
	case strings.HasPrefix(id, "ana_"):
		ana.ServeHTTP(w, r)
	default:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(404)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "NOT_FOUND", "message": "unknown job ID prefix"})
	}
}
