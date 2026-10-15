package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/engine"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/research"
)

type inputManifest struct {
	ActionSnapshot       []research.Action    `json:"actionSnapshot,omitempty"`
	ActionsComplete      *bool                `json:"actionsComplete,omitempty"`
	EngineVersion        string               `json:"engineVersion"`
	CaptureID            string               `json:"captureId"`
	CaptureSHA256        string               `json:"captureSha256"`
	AssemblyID           string               `json:"assemblyId"`
	CaptureEngineVersion string               `json:"captureEngineVersion"`
	SettingsVersion      string               `json:"settingsVersion"`
	Settings             json.RawMessage      `json:"settings"`
	Corpus               []domain.CorpusEntry `json:"corpus"`
	Ranges               []domain.Range       `json:"ranges"`
	Sessions             []string             `json:"sessionIds,omitempty"`
	Filters              map[string]any       `json:"filters"`
}

func (s *RunsService) pin(ctx context.Context, project string, in *domain.RunInput) error {
	if len(in.Corpus) == 0 {
		in.Corpus = []domain.CorpusEntry{{CaptureID: in.CaptureID, AssemblyID: in.AssemblyID}}
	}
	if len(in.Corpus) > 100 {
		return fmt.Errorf("%w: corpus exceeds 100 assemblies", ErrInvalidInput)
	}
	for key, value := range in.Filters {
		if key != "scope" || value != "all" {
			return fmt.Errorf("%w: unsupported run filter", ErrInvalidInput)
		}
	}
	manifest := inputManifest{EngineVersion: engine.Version, Corpus: []domain.CorpusEntry{}, Ranges: []domain.Range{}, Settings: json.RawMessage(`{}`), Filters: in.Filters}
	seen, sessions := map[string]bool{}, map[string]bool{}
	for i, entry := range in.Corpus {
		if entry.AssemblyID == "" || seen[entry.AssemblyID] {
			return fmt.Errorf("%w: empty or duplicate assembly", ErrInvalidInput)
		}
		seen[entry.AssemblyID] = true
		capture, assembly, err := s.Capture.Assembly(ctx, project, entry.AssemblyID)
		if err != nil {
			return err
		}
		if capture.Status != "READY" || assembly.Status != "READY" || entry.CaptureID != "" && entry.CaptureID != capture.CaptureID || entry.SHA256 != "" && entry.SHA256 != capture.SHA256 {
			return fmt.Errorf("%w: corpus metadata mismatch or assembly not ready", ErrInvalidInput)
		}
		if i == 0 {
			if in.SettingsVersion != "" && in.SettingsVersion != assembly.SettingsVersion {
				return fmt.Errorf("%w: settingsVersion does not match assembly", ErrInvalidInput)
			}
			in.AssemblyID, in.CaptureID, in.CaptureSHA256, in.SettingsVersion, in.CaptureEngineVersion = entry.AssemblyID, capture.CaptureID, capture.SHA256, assembly.SettingsVersion, assembly.EngineVersion
			manifest.AssemblyID, manifest.CaptureID, manifest.CaptureSHA256, manifest.SettingsVersion, manifest.CaptureEngineVersion = in.AssemblyID, in.CaptureID, in.CaptureSHA256, in.SettingsVersion, in.CaptureEngineVersion
			if s.Workspace != nil {
				settings, err := s.Workspace.Get(ctx, project, in.SettingsVersion)
				if err != nil {
					return err
				}
				if settings.Status != "READY" || settings.SettingsVersion != in.SettingsVersion {
					return fmt.Errorf("%w: settings not ready", ErrInvalidInput)
				}
				manifest.Settings = settings.Settings
			}
		} else if assembly.SettingsVersion != in.SettingsVersion {
			return fmt.Errorf("%w: corpus assemblies use different settings", ErrInvalidInput)
		}
		manifest.Corpus = append(manifest.Corpus, domain.CorpusEntry{CaptureID: capture.CaptureID, AssemblyID: entry.AssemblyID, SHA256: capture.SHA256})
		streams, err := s.Capture.Streams(ctx, project, entry.AssemblyID)
		if err != nil {
			return err
		}
		for _, stream := range streams {
			if stream.SessionID != "" {
				sessions[stream.SessionID] = true
			}
		}
		manifest.Ranges = append(manifest.Ranges, domain.Split(entry.AssemblyID, streams)...)
	}
	for id := range sessions {
		manifest.Sessions = append(manifest.Sessions, id)
	}
	sort.Strings(manifest.Sessions)
	schema, err := s.Repo.SchemaByRevision(ctx, project, in.RevisionID)
	if err != nil {
		return err
	}
	if needsActionJournal(schema) {
		actions, complete, e := actionSnapshot(ctx, project, schema, s.Workspace)
		if e != nil {
			return e
		}
		manifest.ActionSnapshot = actions
		manifest.ActionsComplete = &complete
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	in.SettingsJSON, in.InputManifestJSON = string(manifest.Settings), string(data)
	return nil
}

// Unknown regions can overlap (a gap and a framing diagnostic). Count their
// union once, so summary coverage never claims more bytes than Capture supplied.
func coverage(blocks []domain.Block, unknown []engine.Span) (uint64, uint64) {
	var total, missing uint64
	for _, block := range blocks {
		total += block.Length
		ranges := [][2]uint64{}
		for _, span := range unknown {
			if span.AssemblyID != block.AssemblyID || span.StreamID != block.StreamID {
				continue
			}
			lo, _ := strconv.ParseUint(span.StartOffset, 10, 64)
			hi, _ := strconv.ParseUint(span.EndOffset, 10, 64)
			lo = max(lo, block.Offset)
			hi = min(hi, block.Offset+block.Length)
			if hi > lo {
				ranges = append(ranges, [2]uint64{lo, hi})
			}
		}
		sort.Slice(ranges, func(i, j int) bool { return ranges[i][0] < ranges[j][0] })
		end := block.Offset
		for _, r := range ranges {
			if r[1] > end {
				missing += r[1] - max(r[0], end)
				end = r[1]
			}
		}
	}
	return total - missing, missing
}
