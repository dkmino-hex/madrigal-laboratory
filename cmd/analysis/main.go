package main

import (
	"log"
	"net/http"
	"os"

	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/database"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/handler"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/repository"
	"github.com/dkmino-hex/madrigal-laboratory/internal/analysis/service"
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

	log.Println("Analysis started on :8083")

	if err := http.ListenAndServe(":8083", mux); err != nil {
		log.Fatal(err)
	}
}
