package domain

import "strconv"

type ByteLocation struct {
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
	CaptureID          string `json:"captureId"`
	PacketNo           int64  `json:"packetNo"`
	FrameOffset        string `json:"frameOffset"`
	Length             string `json:"length"`
	StreamStart        string `json:"streamStart"`
	Relation           string `json:"relation"`
	AlternativeGroupID string `json:"alternativeGroupId,omitempty"`
}
type SourceLink struct {
	ID            string        `json:"evidenceId"`
	Location      ByteLocation  `json:"location"`
	Sources       []FrameSource `json:"sources"`
	CaptureSHA256 string        `json:"captureSha256"`
	Status        string        `json:"status"`
	Basis         string        `json:"basis"`
	ActionID      string        `json:"actionId,omitempty"`
	Kind          string        `json:"kind"`
	RevisionID    string        `json:"revisionId,omitempty"`
	RunID         string        `json:"runId,omitempty"`
}
type LinkReference struct {
	ID   string `json:"evidenceId"`
	Kind string `json:"kind"`
}

func (l SourceLink) Evidence() ([]EvidenceInput, error) {
	start, err := strconv.ParseInt(l.Location.Start, 10, 64)
	if err != nil || start < 0 {
		return nil, ErrInvalid
	}
	length, err := strconv.ParseInt(l.Location.Length, 10, 64)
	if err != nil || length < 1 || length > 1<<20 || start > 1<<40-length {
		return nil, ErrInvalid
	}
	if l.Location.CaptureID == "" || l.Location.SessionID == "" || l.Location.AssemblyID == "" || l.Location.StreamID == "" || (l.Location.Direction != "A_TO_B" && l.Location.Direction != "B_TO_A") || len(l.Basis) > 8000 || (l.Status != "tentative" && l.Status != "confirmed") || (l.Kind != "support" && l.Kind != "counterexample") || len(l.Sources) < 1 || len(l.Sources) > 4096 {
		return nil, ErrInvalid
	}
	items := make([]EvidenceInput, 0, len(l.Sources))
	for _, source := range l.Sources {
		frame, e1 := strconv.ParseInt(source.FrameOffset, 10, 64)
		n, e2 := strconv.ParseInt(source.Length, 10, 64)
		offset, e3 := strconv.ParseInt(source.StreamStart, 10, 64)
		if e1 != nil || e2 != nil || e3 != nil || source.CaptureID != l.Location.CaptureID || offset < start || n < 1 || offset > start+length-n {
			return nil, ErrInvalid
		}
		e := EvidenceInput{SessionID: l.Location.SessionID, Direction: l.Location.Direction, AlternativeID: source.AlternativeGroupID, Kind: "SUPPORT", CaptureID: source.CaptureID, CaptureSHA256: l.CaptureSHA256, PacketNo: source.PacketNo, FrameOffset: frame, ByteLength: n, AssemblyID: l.Location.AssemblyID, StreamID: l.Location.StreamID, StreamOffset: &offset}
		if err := e.Validate(); err != nil {
			return nil, err
		}
		items = append(items, e)
	}
	return items, nil
}

func (l SourceLink) Remap(projectID string, maps CaptureImportResult) (SourceLink, error) {
	l.Location.ProjectID = projectID
	type mappingPair struct {
		value   *string
		mapping map[string]string
	}
	pairs := []mappingPair{{&l.Location.CaptureID, maps.CaptureIDs}, {&l.Location.AssemblyID, maps.AssemblyIDs}, {&l.Location.StreamID, maps.StreamIDs}, {&l.Location.SessionID, maps.SessionIDs}}
	if l.RunID != "" {
		pairs = append(pairs, mappingPair{&l.RunID, maps.RunIDs})
	}
	if l.RevisionID != "" {
		pairs = append(pairs, mappingPair{&l.RevisionID, maps.RevisionIDs})
	}
	for i := range l.Sources {
		pairs = append(pairs, mappingPair{&l.Sources[i].CaptureID, maps.CaptureIDs})
		if l.Sources[i].AlternativeGroupID != "" {
			pairs = append(pairs, mappingPair{&l.Sources[i].AlternativeGroupID, maps.AlternativeIDs})
		}
	}
	for _, pair := range pairs {
		value := pair.mapping[*pair.value]
		if value == "" {
			return l, ErrInvalidArchive
		}
		*pair.value = value
	}
	return l, nil
}
