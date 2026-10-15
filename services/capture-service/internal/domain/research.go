package domain

import "encoding/json"

// ResearchData is a bounded projection of an immutable assembly, without any interpretation.
type ResearchData struct {
	CaptureID       string           `json:"captureId"`
	CaptureName     string           `json:"captureName"`
	SHA256          string           `json:"sha256"`
	AssemblyID      string           `json:"assemblyId"`
	SettingsVersion string           `json:"settingsVersion"`
	EngineVersion   string           `json:"engineVersion"`
	Complete        bool             `json:"complete"`
	Streams         []ResearchStream `json:"streams"`
}
type ResearchStream struct {
	StreamID      string           `json:"streamId"`
	SessionID     string           `json:"sessionId"`
	Direction     string           `json:"direction"`
	EndpointA     string           `json:"endpointA"`
	EndpointB     string           `json:"endpointB"`
	LogicalLength int64            `json:"logicalLength"`
	SampleLength  int64            `json:"sampleLength"`
	Intervals     []map[string]any `json:"intervals"`
	Sources       []ResearchSource `json:"sources"`
	Diagnostics   json.RawMessage  `json:"diagnostics"`
}
type ResearchSource struct {
	PacketNo    int64  `json:"packetNo"`
	FrameStart  int64  `json:"frameStart"`
	FrameEnd    int64  `json:"frameEnd"`
	StreamStart int64  `json:"streamStart"`
	StreamEnd   int64  `json:"streamEnd"`
	Timestamp   string `json:"timestamp"`
}
