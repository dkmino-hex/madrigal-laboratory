package reassembly

import "time"

type Packet struct {
	Number          int       `json:"packetNo"`
	Time            time.Time `json:"time"`
	InterfaceNo     int       `json:"interfaceNo"`
	LinkType        int       `json:"linkType"`
	CapturedLength  int       `json:"capturedLength"`
	OriginalLength  int       `json:"originalLength"`
	Frame           []byte    `json:"frame"`
	SourceIP        string    `json:"sourceIp,omitempty"`
	DestinationIP   string    `json:"destinationIp,omitempty"`
	SourcePort      uint16    `json:"sourcePort,omitempty"`
	DestinationPort uint16    `json:"destinationPort,omitempty"`
	Sequence        uint32    `json:"sequence,omitempty"`
	Acknowledgment  uint32    `json:"acknowledgment,omitempty"`
	Flags           uint8     `json:"flags,omitempty"`
	PayloadStart    int       `json:"payloadStart,omitempty"`
	PayloadLength   int       `json:"payloadLength,omitempty"`
	Diagnostic      string    `json:"diagnostic,omitempty"`
}

type SourceSpan struct {
	PacketNo    int    `json:"packetNo"`
	FrameStart  int    `json:"frameStart"`
	FrameEnd    int    `json:"frameEnd"`
	StreamStart uint64 `json:"streamStart,string"`
	StreamEnd   uint64 `json:"streamEnd,string"`
}

type Interval struct {
	Start   uint64       `json:"start,string"`
	End     uint64       `json:"end,string"`
	Kind    string       `json:"kind"`
	Data    []byte       `json:"data,omitempty"`
	Sources []SourceSpan `json:"sources,omitempty"`
}

type Stream struct {
	ID         string     `json:"streamId"`
	Direction  string     `json:"direction"`
	InitialSeq *uint32    `json:"initialSeq,omitempty"`
	KnownStart bool       `json:"knownStart"`
	Intervals  []Interval `json:"intervals"`
	Length     uint64     `json:"length,string"`
	Diagnostic []string   `json:"diagnostics,omitempty"`
}

type Endpoint struct {
	IP   string `json:"ip"`
	Port uint16 `json:"port"`
}

type Session struct {
	ID            string    `json:"sessionId"`
	CaptureID     string    `json:"captureId"`
	AssemblyID    string    `json:"assemblyId"`
	Generation    int       `json:"generation"`
	FirstPacketNo int       `json:"firstPacketNo"`
	LastPacketNo  int       `json:"lastPacketNo"`
	A             Endpoint  `json:"a"`
	B             Endpoint  `json:"b"`
	Initiator     string    `json:"initiator,omitempty"`
	FirstSeen     time.Time `json:"firstSeen"`
	LastSeen      time.Time `json:"lastSeen"`
	Streams       [2]Stream `json:"streams"`
	Diagnostics   []string  `json:"diagnostics,omitempty"`
}

type Capture struct {
	ID         string    `json:"captureId"`
	ProjectID  string    `json:"projectId"`
	SHA256     string    `json:"sha256"`
	Format     string    `json:"format"`
	Size       int64     `json:"size"`
	AssemblyID string    `json:"assemblyId"`
	CreatedAt  time.Time `json:"createdAt"`
	Status     string    `json:"status"`
	Diagnostic string    `json:"diagnostic,omitempty"`
	JobID      string    `json:"jobId"`
	Packets    []Packet  `json:"-"`
	Sessions   []Session `json:"-"`
}
