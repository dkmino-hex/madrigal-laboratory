package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
)

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Gateway is running"))
	})

	analysisURL := getEnv("ANALYSIS_URL", "http://analysis:8083")
	workspaceURL := getEnv("WORKSPACE_URL", "http://workspace-service:8081")
	captureURL := getEnv("CAPTURE_URL", "http://capture-service:8082")

	// Reverse proxy для каждого микросервиса.
	workspaceProxy := newReverseProxy(workspaceURL)
	captureProxy := newReverseProxy(captureURL)
	analysisProxy := newReverseProxy(analysisURL)

	mux.Handle("GET /api/v1/projects", workspaceProxy)
	mux.Handle("POST /api/v1/projects", workspaceProxy)
	mux.Handle("GET /api/v1/projects/{projectId}", workspaceProxy)
	mux.Handle("PATCH /api/v1/projects/{projectId}/settings", workspaceProxy)
	mux.Handle("POST /api/v1/projects/import", workspaceProxy)
	mux.Handle("POST /api/v1/projects/{projectId}/action-log", workspaceProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/actions", workspaceProxy)
	mux.Handle("POST /api/v1/projects/{projectId}/observations", workspaceProxy)
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
	mux.Handle("/api/v1/projects/{projectId}/interpretations/{rest...}", analysisProxy)
	mux.Handle("/api/v1/projects/{projectId}/previews", analysisProxy)
	mux.Handle("/api/v1/projects/{projectId}/runs", analysisProxy)
	mux.Handle("/api/v1/projects/{projectId}/runs/{rest...}", analysisProxy)

	log.Println("Gateway started on :8080")

	if err := http.ListenAndServe(":8080", corsMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}

func newReverseProxy(target string) *httputil.ReverseProxy {
	targetURL, err := url.Parse(target)
	if err != nil {
		log.Fatalf("Invalid proxy URL %q: %v", target, err)
	}

	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("Proxy error: %v", err)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)

		_ = json.NewEncoder(w).Encode(map[string]string{
			"code":    "BAD_GATEWAY",
			"message": "Service temporarily unavailable",
		})
	}

	return proxy
}

func getEnv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		allowedOrigin := getEnv("FRONTEND_ORIGIN", "http://localhost:5173")

		if r.Header.Get("Origin") == allowedOrigin {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, X-Request-ID")
		}

		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			if r.Header.Get("Origin") != allowedOrigin {
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
