package domain

import (
	"encoding/hex"
	"sort"
	"strconv"
)

type Generation struct {
	EngineVersion string `json:"engineVersion"`
	Fingerprint   string `json:"fingerprint"`
	CandidateID   string `json:"candidateId"`
	Kind          string `json:"kind"`
	Parameter     string `json:"parameter,omitempty"`
	Matches       int    `json:"matches"`
	Total         int    `json:"total"`
}
type AutomaticObservation struct {
	Kind           string       `json:"kind,omitempty"`
	Text           string       `json:"text"`
	Basis          string       `json:"basis"`
	Generation     Generation   `json:"generation"`
	Examples       []SourceLink `json:"examples"`
	IdempotencyKey string       `json:"-"`
}

func (in *AutomaticObservation) Validate(project string) error {
	if in.Kind == "" {
		in.Kind = "OBSERVATION"
	}
	check := ObservationInput{Kind: in.Kind, Text: in.Text, Basis: in.Basis}
	if check.Normalize() != nil || len(in.Examples) == 0 || len(in.Examples) > 24 || !ValidIdempotencyKey(in.IdempotencyKey) {
		return ErrInvalid
	}
	g := in.Generation
	if g.EngineVersion == "" || len(g.EngineVersion) > 64 || len(g.Fingerprint) < 24 || len(g.Fingerprint) > 64 || g.CandidateID == "" || len(g.CandidateID) > 128 || len(g.Parameter) > 256 || g.Matches < 0 || g.Total < g.Matches || g.Total > 100000 {
		return ErrInvalid
	}
	if _, err := hex.DecodeString(g.Fingerprint); err != nil {
		return ErrInvalid
	}
	if g.Kind != "parameter" && g.Kind != "constant" && g.Kind != "variable" && g.Kind != "selection" {
		return ErrInvalid
	}
	for i := range in.Examples {
		link := &in.Examples[i]
		if link.ID != "" || link.Location.ProjectID != project || link.Status != "tentative" {
			return ErrInvalid
		}
		if _, err := link.Evidence(); err != nil {
			return err
		}
		// An automatically generated statement requires a continuous, unambiguous physical source.
		sources := append([]FrameSource(nil), link.Sources...)
		sort.Slice(sources, func(i, j int) bool {
			a, _ := strconv.ParseInt(sources[i].StreamStart, 10, 64)
			b, _ := strconv.ParseInt(sources[j].StreamStart, 10, 64)
			return a < b
		})
		start, _ := strconv.ParseInt(link.Location.Start, 10, 64)
		length, _ := strconv.ParseInt(link.Location.Length, 10, 64)
		covered := start
		for _, source := range sources {
			if source.Relation != "primary" && source.Relation != "retransmission" || source.AlternativeGroupID != "" {
				return ErrInvalid
			}
			at, _ := strconv.ParseInt(source.StreamStart, 10, 64)
			n, _ := strconv.ParseInt(source.Length, 10, 64)
			if at > covered {
				return ErrInvalid
			}
			covered = max(covered, at+n)
		}
		if covered != start+length {
			return ErrInvalid
		}
	}
	return nil
}
