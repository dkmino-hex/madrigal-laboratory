package domain

import (
	"fmt"
	"strconv"
)

type Range struct {
	AssemblyID string `json:"assemblyId"`
	StreamID   string `json:"streamId"`
	Offset     uint64 `json:"offset"`
	Length     uint64 `json:"length"`
}

type Interval struct {
	StartOffset  uint64   `json:"startOffset"`
	EndOffset    uint64   `json:"endOffset"`
	Kind         string   `json:"kind"`
	Data         string   `json:"data,omitempty"`
	Alternatives []string `json:"alternatives,omitempty"`
}

type Source struct {
	AlternativeID string `json:"alternativeId"`
	FrameStart    uint64 `json:"frameStart"`
	FrameEnd      uint64 `json:"frameEnd"`
	PacketNo      uint64 `json:"packetNo"`
	StreamStart   uint64 `json:"streamStart"`
	StreamEnd     uint64 `json:"streamEnd"`
}

type Block struct {
	AssemblyID string     `json:"assemblyId"`
	StreamID   string     `json:"streamId"`
	Offset     uint64     `json:"offset"`
	Length     uint64     `json:"length"`
	Intervals  []Interval `json:"intervals"`
	Sources    []Source   `json:"sources"`
}

type Stream struct {
	StreamID      string `json:"streamId"`
	LogicalLength uint64 `json:"logicalLength"`
}

type AssemblyMetadata struct {
	AssemblyID      string `json:"assemblyId"`
	SettingsVersion string `json:"settingsVersion"`
	EngineVersion   string `json:"engineVersion"`
	Status          string `json:"status"`
}

type CaptureMetadata struct {
	CaptureID string `json:"captureId"`
	SHA256    string `json:"sha256"`
	Status    string `json:"status"`
}

func Split(assembly string, streams []Stream) []Range {
	result := []Range{}
	for _, s := range streams {
		for off := uint64(0); off < s.LogicalLength; {
			length := s.LogicalLength - off
			if length > 1<<20 {
				length = 1 << 20
			}
			result = append(result, Range{assembly, s.StreamID, off, length})
			off += length
		}
	}
	return result
}

func ParseUnsigned(s string) (uint64, error) {
	v, e := strconv.ParseUint(s, 10, 64)
	if e != nil {
		return 0, fmt.Errorf("invalid unsigned offset: %w", e)
	}
	return v, nil
}
