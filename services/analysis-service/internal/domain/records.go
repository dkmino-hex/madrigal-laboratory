package domain

type Run struct {
	RunID                string         `json:"runId"`
	ProjectID            string         `json:"projectId"`
	RevisionID           string         `json:"revisionId"`
	AssemblyID           string         `json:"assemblyId"`
	CaptureID            string         `json:"captureId,omitempty"`
	SettingsVersion      string         `json:"settingsVersion,omitempty"`
	CaptureSHA256        string         `json:"captureSha256,omitempty"`
	CaptureEngineVersion string         `json:"captureEngineVersion,omitempty"`
	SettingsJSON         string         `json:"settingsJson,omitempty"`
	InputManifestJSON    string         `json:"inputManifestJson,omitempty"`
	JobID                string         `json:"jobId,omitempty"`
	Status               string         `json:"status"`
	Summary              map[string]any `json:"summary"`
	CreatedAt            string         `json:"createdAt"`
}

type RunInput struct {
	RevisionID           string         `json:"revisionId"`
	AssemblyID           string         `json:"assemblyId"`
	CaptureID            string         `json:"captureId"`
	SettingsVersion      string         `json:"settingsVersion"`
	Filters              map[string]any `json:"filters"`
	CaptureSHA256        string         `json:"-"`
	CaptureEngineVersion string         `json:"-"`
	SettingsJSON         string         `json:"-"`
	InputManifestJSON    string         `json:"-"`
}

type Job struct {
	JobID           string    `json:"jobId"`
	ProjectID       string    `json:"projectId"`
	Kind            string    `json:"kind"`
	ResourceID      string    `json:"resourceId"`
	Status          string    `json:"status"`
	Stage           string    `json:"stage"`
	Completed       string    `json:"completed"`
	Total           *string   `json:"total,omitempty"`
	CancelRequested bool      `json:"cancelRequested"`
	Attempts        string    `json:"attempts"`
	CreatedAt       string    `json:"createdAt"`
	UpdatedAt       string    `json:"updatedAt"`
	StartedAt       *string   `json:"startedAt,omitempty"`
	FinishedAt      *string   `json:"finishedAt,omitempty"`
	Error           *JobError `json:"error,omitempty"`
}

type JobError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Snapshot struct {
	Version         int                 `json:"version"`
	ProjectID       string              `json:"projectId"`
	Interpretations []InterpretationRow `json:"interpretations"`
	Revisions       []RevisionRow       `json:"revisions"`
	Runs            []RunRow            `json:"runs"`
	Results         []ResultRow         `json:"results"`
}

type InterpretationRow struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
}

type RevisionRow struct {
	ID               string `json:"id"`
	InterpretationID string `json:"interpretationId"`
	Version          int    `json:"version"`
	SchemaJSON       string `json:"schemaJson"`
	CreatedAt        string `json:"createdAt"`
}

type RunRow struct {
	ID                   string  `json:"id"`
	RevisionID           string  `json:"revisionId"`
	AssemblyID           string  `json:"assemblyId"`
	CaptureID            string  `json:"captureId"`
	SettingsVersion      string  `json:"settingsVersion"`
	CaptureSHA256        string  `json:"captureSha256"`
	CaptureEngineVersion string  `json:"captureEngineVersion"`
	SettingsJSON         string  `json:"settingsJson"`
	InputManifestJSON    string  `json:"inputManifestJson"`
	Status               string  `json:"status"`
	SummaryJSON          string  `json:"summaryJson"`
	RequestJSON          string  `json:"requestJson"`
	CreatedAt            string  `json:"createdAt"`
	CompletedAt          *string `json:"completedAt"`
}

type ResultRow struct {
	ID         string `json:"id"`
	RunID      string `json:"runId"`
	ResultJSON string `json:"resultJson"`
	CreatedAt  string `json:"createdAt"`
}
