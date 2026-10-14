package domain

type ViewRange struct {
	AssemblyID string `json:"assemblyId"`
	StreamID   string `json:"streamId"`
	Offset     int64  `json:"offset"`
	Length     int64  `json:"length"`
}
