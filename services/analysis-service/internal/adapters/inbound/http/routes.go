package handler

import (
	"net/http"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/application/analysis"
)

func New(repo service.Repository, client service.Capture, runs *service.RunsService) http.Handler {
	var workspace service.Workspace
	if runs != nil {
		workspace = runs.Workspace
	}
	interpretationHandler := NewInterpretationHandler(service.NewInterpretationService(repo, workspace))
	snapshotHandler := NewSnapshotHandler(repo, client)
	analysisHandler := &AnalysisHandler{Preview: &service.PreviewService{Repo: repo, Capture: client, Workspace: workspace}, Runs: runs, Repo: repo}
	mux := http.NewServeMux()
	researchCapture, _ := client.(service.ResearchCapture)
	researchWorkspace, _ := workspace.(service.ResearchWorkspace)
	registerResearch(mux, service.ResearchService{Capture: researchCapture, Workspace: researchWorkspace, Repo: repo})

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

	mux.HandleFunc("GET /api/v1/projects/{projectId}/interpretations/{interpretationId}", interpretationHandler.Get)
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

	return mux
}
