package domain

type SnapshotInput struct {
	CaptureIDs  []string `json:"captureIds"`
	AssemblyIDs []string `json:"assemblyIds"`
}

type SnapshotMeta struct {
	Version   int    `json:"version"`
	ProjectID string `json:"projectId"`
	Captures  []struct {
		ID           string `json:"captureId"`
		SHA256       string `json:"sha256"`
		RelativePath string `json:"relativePath"`
		Size         int64  `json:"sizeBytes"`
		Format       string `json:"format"`
	} `json:"captures"`
	AssemblyIDs []string `json:"assemblyIds"`
}

type RestoreManifest struct {
	Version   int               `json:"version"`
	Service   string            `json:"service"`
	ProjectID string            `json:"projectId"`
	Selection SnapshotMeta      `json:"selection"`
	Files     map[string]string `json:"files"`
}

var ArchiveTables = []string{"captures", "capture_interfaces", "packets", "assemblies", "sessions", "streams", "stream_intervals", "interval_alternatives", "source_spans"}
