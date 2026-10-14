package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/capture"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/database"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/handler"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/repository"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/service"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/workspace"
)

func main() {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "analysis.db"
	}

	// Migrations own their connection: migrate.Close() closes its database driver.
	migrationDB, err := database.Open(dbPath)
	if err != nil {
		log.Fatalf("Failed to connect to SQLite for migrations: %v", err)
	}
	if err := database.RunMigrations(migrationDB, database.MigrationFiles); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}
	// The migration driver closes migrationDB; application gets a separate pool.
	db, err := database.Open(dbPath)
	if err != nil {
		log.Fatalf("Failed to connect to SQLite: %v", err)
	}
	defer db.Close()

	log.Println("Database migrations applied successfully")
	log.Printf("SQLite connected: %s", dbPath)

	interpretationRepo := repository.NewInterpretationRepository(db)
	interpretationService := service.NewInterpretationService(interpretationRepo)
	interpretationHandler := handler.NewInterpretationHandler(interpretationService)
	captureBase := os.Getenv("CAPTURE_URL")
	if captureBase == "" {
		captureBase = "http://capture-service:8082"
	}
	captureClient := capture.New(captureBase)
	runsService := service.NewRunsService(interpretationRepo, captureClient)
	workspaceURL := os.Getenv("WORKSPACE_URL")
	if workspaceURL == "" {
		workspaceURL = "http://workspace-service:8081"
	}
	runsService.Workspace = workspace.New(workspaceURL)
	if err := interpretationRepo.RecoverRuns(context.Background()); err != nil {
		log.Fatalf("Recover unfinished runs: %v", err)
	}
	if err := runsService.ResumeQueued(context.Background()); err != nil {
		log.Fatalf("Resume jobs: %v", err)
	}
	snapshotHandler := handler.NewSnapshotHandler(interpretationRepo, captureClient)
	analysisHandler := &handler.AnalysisHandler{Preview: &service.PreviewService{Repo: interpretationRepo, Capture: captureClient}, Runs: runsService, Repo: interpretationRepo}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("Analysis is running"))
	})

	mux.HandleFunc("GET /api/v1/analysis/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("Analysis is running through Gateway"))
	})

	mux.HandleFunc(
		"POST /api/v1/projects/{projectId}/interpretations",
		interpretationHandler.Create,
	)
	mux.HandleFunc(

		"GET /api/v1/projects/{projectId}/interpretations",
		interpretationHandler.List,
	)

	mux.HandleFunc("POST /api/v1/projects/{projectId}/interpretations/{interpretationId}/revisions", interpretationHandler.CreateRevision)
	mux.HandleFunc("GET /api/v1/projects/{projectId}/interpretations/{interpretationId}/revisions", interpretationHandler.ListRevisions)
	mux.HandleFunc("GET /api/v1/projects/{projectId}/interpretations/{interpretationId}/revisions/{revisionId}", interpretationHandler.GetRevision)

	mux.HandleFunc("GET /api/v1/jobs/{jobId}", analysisHandler.JobGet)
	mux.HandleFunc("POST /api/v1/jobs/{jobId}/cancel", analysisHandler.JobCancel)
	mux.HandleFunc("POST /api/v1/projects/{projectId}/previews", analysisHandler.PreviewPost)
	mux.HandleFunc("POST /api/v1/projects/{projectId}/runs", analysisHandler.RunPost)
	mux.HandleFunc("GET /api/v1/projects/{projectId}/runs", analysisHandler.RunsList)
	mux.HandleFunc("GET /api/v1/projects/{projectId}/runs/{runId}", analysisHandler.RunGet)
	mux.HandleFunc("GET /api/v1/projects/{projectId}/runs/{runId}/results", analysisHandler.ResultsGet)
	mux.HandleFunc("POST /internal/v1/projects/{projectId}/snapshots", snapshotHandler.Create)
	mux.HandleFunc("GET /internal/v1/snapshots/{snapshotId}/archive", snapshotHandler.Download)
	mux.HandleFunc("PUT /internal/v1/projects/{projectId}/imports/{importId}", snapshotHandler.Import)
	log.Println("Analysis started on :8083")

	if err := http.ListenAndServe(":8083", mux); err != nil {
		log.Fatal(err)
	}
}
