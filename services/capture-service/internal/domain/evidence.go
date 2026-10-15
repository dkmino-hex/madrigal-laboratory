package domain

type EvidenceCheck struct {
	SessionID     string `json:"sessionId,omitempty"`
	Direction     string `json:"direction,omitempty"`
	AlternativeID string `json:"alternativeId,omitempty"`
	Kind          string `json:"kind,omitempty"`
	CaptureID     string `json:"captureId,omitempty"`
	CaptureSHA256 string `json:"captureSha256"`
	PacketNo      int64  `json:"packetNo"`
	FrameOffset   int64  `json:"frameOffset"`
	ByteLength    int64  `json:"byteLength"`
	AssemblyID    string `json:"assemblyId,omitempty"`
	StreamID      string `json:"streamId,omitempty"`
	StreamOffset  *int64 `json:"streamOffset,omitempty"`
}

type RequestError string

func (e RequestError) Error() string { return string(e) }

type EvidenceError string

func (e EvidenceError) Error() string { return string(e) }
