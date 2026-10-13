package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
)

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Gateway is running"))
	})

	analysisURL := getEnv("ANALYSIS_URL", "http://analysis:8083")
	workspaceURL := getEnv("WORKSPACE_URL", "http://workspace:8081")
	captureURL := getEnv("CAPTURE_URL", "http://capture:8082")

	// Reverse proxy для каждого микросервиса.
	workspaceProxy := newReverseProxy(workspaceURL)
	captureProxy := newReverseProxy(captureURL)
	analysisProxy := newReverseProxy(analysisURL)

	mux.Handle("GET /api/v1/projects", workspaceProxy)
	mux.Handle("POST /api/v1/projects", workspaceProxy)
	mux.Handle("GET /api/v1/projects/{projectId}", workspaceProxy)
	mux.Handle("PATCH /api/v1/projects/{projectId}/settings", workspaceProxy)

	mux.Handle("POST /api/v1/projects/{projectId}/captures", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/captures", captureProxy)
	mux.Handle("GET /api/v1/jobs/{jobId}", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/captures/{captureId}/packets/{packetId}", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/sessions", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/sessions/{sessionId}", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/streams/{streamId}/bytes", captureProxy)
	mux.Handle("GET /api/v1/projects/{projectId}/streams/{streamId}/sources", captureProxy)
	mux.Handle("POST /api/v1/projects/{projectId}/captures/{captureId}/assemblies", captureProxy)

	mux.Handle("/api/v1/projects/{projectId}/interpretations", analysisProxy)
	mux.Handle("/api/v1/projects/{projectId}/interpretations/", analysisProxy)
	mux.Handle("/api/v1/projects/{projectId}/previews", analysisProxy)
	mux.Handle("/api/v1/projects/{projectId}/runs", analysisProxy)
	mux.Handle("/api/v1/projects/{projectId}/runs/", analysisProxy)

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
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
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
