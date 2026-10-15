// Package research computes explainable research proposals from bounded, pinned Capture data.
package research

import "encoding/json"

const Version = "research-0.1"
const MaxRows = 128
const MaxWidth = 128

type CaptureSelection struct {
	CaptureID  string `json:"captureId"`
	AssemblyID string `json:"assemblyId,omitempty"`
}
type Input struct {
	Captures   []CaptureSelection `json:"captures,omitempty"`
	Direction  string             `json:"direction,omitempty"`
	RevisionID string             `json:"revisionId,omitempty"`
}
type CaptureData struct {
	CaptureID       string   `json:"captureId"`
	CaptureName     string   `json:"captureName"`
	SHA256          string   `json:"sha256"`
	AssemblyID      string   `json:"assemblyId"`
	SettingsVersion string   `json:"settingsVersion"`
	EngineVersion   string   `json:"engineVersion"`
	Complete        bool     `json:"complete"`
	Streams         []Stream `json:"streams"`
}
type Stream struct {
	StreamID      string          `json:"streamId"`
	SessionID     string          `json:"sessionId"`
	Direction     string          `json:"direction"`
	EndpointA     string          `json:"endpointA"`
	EndpointB     string          `json:"endpointB"`
	LogicalLength int64           `json:"logicalLength"`
	SampleLength  int64           `json:"sampleLength"`
	Intervals     []Interval      `json:"intervals"`
	Sources       []Source        `json:"sources"`
	Diagnostics   json.RawMessage `json:"diagnostics"`
}
type Interval struct {
	Start int64  `json:"startOffset"`
	End   int64  `json:"endOffset"`
	Kind  string `json:"kind"`
	Data  []byte `json:"data"`
}
type Source struct {
	PacketNo    int64  `json:"packetNo"`
	FrameStart  int64  `json:"frameStart"`
	FrameEnd    int64  `json:"frameEnd"`
	StreamStart int64  `json:"streamStart"`
	StreamEnd   int64  `json:"streamEnd"`
	Timestamp   string `json:"timestamp"`
}
type Action struct {
	ID          string          `json:"actionId"`
	Name        string          `json:"name"`
	CapturePath string          `json:"capturePath"`
	Session     string          `json:"session"`
	Start       string          `json:"start"`
	End         string          `json:"end"`
	Parameters  json.RawMessage `json:"parameters"`
	Observed    json.RawMessage `json:"observedResult"`
}
type Location struct {
	ProjectID  string `json:"projectId"`
	CaptureID  string `json:"captureId"`
	SessionID  string `json:"sessionId"`
	AssemblyID string `json:"assemblyId"`
	StreamID   string `json:"streamId"`
	Direction  string `json:"direction"`
	Start      string `json:"start"`
	Length     string `json:"length"`
}
type FrameSource struct {
	CaptureID   string `json:"captureId"`
	PacketNo    int64  `json:"packetNo"`
	FrameOffset string `json:"frameOffset"`
	Length      string `json:"length"`
	StreamStart string `json:"streamStart"`
	Relation    string `json:"relation"`
}
type Row struct {
	ID            string            `json:"id"`
	GroupID       string            `json:"groupId"`
	Label         string            `json:"label"`
	CaptureName   string            `json:"captureName"`
	CaptureSHA256 string            `json:"captureSha256"`
	Location      Location          `json:"location"`
	Bytes         string            `json:"bytes"`
	Timestamp     string            `json:"timestamp"`
	Boundary      string            `json:"boundary"`
	ActionIDs     []string          `json:"actionIds"`
	Association   string            `json:"association"`
	Values        map[string]string `json:"values"`
	Sources       []FrameSource     `json:"sources"`
	Raw           []byte            `json:"-"`
	Start         int64             `json:"-"`
	Framing       Framing           `json:"-"`
}
type Framing struct {
	Magic        string `json:"magic,omitempty"`
	HeaderLength uint64 `json:"headerLength,omitempty"`
	LengthOffset uint64 `json:"lengthOffset,omitempty"`
	LengthType   string `json:"lengthType,omitempty"`
	FixedLength  uint64 `json:"fixedLength,omitempty"`
}
type Column struct {
	Offset   int    `json:"offset"`
	Present  int    `json:"present"`
	Distinct int    `json:"distinct"`
	Kind     string `json:"kind"`
	Heat     int    `json:"heat"`
}
type Group struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Rows       int      `json:"rows"`
	Parameters []string `json:"parameters"`
	Columns    []Column `json:"columns"`
}
type Candidate struct {
	ID              string     `json:"id"`
	GroupID         string     `json:"groupId"`
	Kind            string     `json:"kind"`
	Parameter       string     `json:"parameter"`
	Name            string     `json:"name"`
	Offset          int        `json:"offset"`
	Length          int        `json:"length"`
	Encoding        string     `json:"encoding"`
	Divisor         int64      `json:"divisor"`
	Matches         int        `json:"matches"`
	Total           int        `json:"total"`
	Support         []string   `json:"support"`
	Counterexamples []string   `json:"counterexamples"`
	Inconclusive    []string   `json:"inconclusive"`
	Statement       string     `json:"statement"`
	Basis           string     `json:"basis"`
	SchemaJSON      string     `json:"schemaJson,omitempty"`
	Examples        []Evidence `json:"examples"`
}
type Evidence struct {
	Location      Location      `json:"location"`
	Sources       []FrameSource `json:"sources"`
	CaptureSHA256 string        `json:"captureSha256"`
	Status        string        `json:"status"`
	Basis         string        `json:"basis"`
	ActionID      string        `json:"actionId,omitempty"`
	Kind          string        `json:"kind"`
	RevisionID    string        `json:"revisionId,omitempty"`
}
type Result struct {
	ProjectID     string             `json:"projectId"`
	EngineVersion string             `json:"engineVersion"`
	Fingerprint   string             `json:"fingerprint"`
	Complete      bool               `json:"complete"`
	Captures      []CaptureSelection `json:"captures"`
	Rows          []Row              `json:"rows"`
	Groups        []Group            `json:"groups"`
	Candidates    []Candidate        `json:"candidates"`
	Warnings      []string           `json:"warnings"`
}
