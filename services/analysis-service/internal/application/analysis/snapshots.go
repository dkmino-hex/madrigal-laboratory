package service

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/google/uuid"
)

var (
	ErrInvalidArchive   = errors.New("invalid archive")
	ErrImportConflict   = errors.New("import conflict")
	ErrSnapshotTooLarge = errors.New("snapshot too large")
)

type Snapshots struct {
	Repo    Repository
	Capture Capture
}

type RestoreMaps struct {
	Captures, Assemblies, Streams, Settings, Sessions, Alternatives map[string]string
}

func (s Snapshots) Create(ctx context.Context, projectID string) (string, error) {
	snapshot, err := s.Repo.ExportSnapshot(ctx, projectID)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	archive := zip.NewWriter(&buf)
	entry, err := archive.Create("analysis.json")
	if err == nil {
		_, err = entry.Write(payload)
	}
	if err == nil {
		err = archive.Close()
	}
	if err != nil {
		return "", err
	}
	if buf.Len() > 750<<20 {
		return "", ErrSnapshotTooLarge
	}
	id := "snapshot_analysis_" + uuid.NewString()
	return id, s.Repo.SaveSnapshot(ctx, id, projectID, buf.Bytes())
}

func (s Snapshots) Archive(ctx context.Context, id string) ([]byte, error) {
	return s.Repo.LoadSnapshot(ctx, id)
}

func (s Snapshots) Mappings(ctx context.Context, project, importID string) (map[string]map[string]string, error) {
	return s.Repo.ImportMappings(ctx, project, importID)
}

func (s Snapshots) Restore(ctx context.Context, projectID, importID string, body []byte, maps RestoreMaps) error {
	digest := fmt.Sprintf("%x", sha256.Sum256(body))
	seen, err := s.Repo.ImportSeen(ctx, projectID, importID, digest)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrImportConflict, err)
	}
	if seen {
		return nil
	}
	archive, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		return fmt.Errorf("%w: invalid ZIP", ErrInvalidArchive)
	}
	if len(archive.File) != 1 || archive.File[0].Name != "analysis.json" || archive.File[0].UncompressedSize64 > 100<<20 {
		return fmt.Errorf("%w: expected single analysis.json", ErrInvalidArchive)
	}
	entry, err := archive.File[0].Open()
	if err != nil {
		return err
	}
	defer entry.Close()
	raw, err := io.ReadAll(io.LimitReader(entry, 100<<20+1))
	if err != nil || len(raw) > 100<<20 {
		return fmt.Errorf("%w: invalid analysis.json", ErrInvalidArchive)
	}
	var snapshot domain.Snapshot
	if json.Unmarshal(raw, &snapshot) != nil {
		return fmt.Errorf("%w: invalid snapshot JSON", ErrInvalidArchive)
	}
	if maps.Settings == nil {
		maps.Settings = map[string]string{}
	}
	for _, run := range snapshot.Runs {
		if run.SettingsVersion == "" || maps.Settings[run.SettingsVersion] != "" {
			continue
		}
		assemblyID := maps.Assemblies[run.AssemblyID]
		if assemblyID == "" {
			return fmt.Errorf("%w: assembly ID mapping missing", ErrImportConflict)
		}
		_, meta, err := s.Capture.Assembly(ctx, projectID, assemblyID)
		if err != nil || meta.SettingsVersion == "" {
			return fmt.Errorf("%w: cannot resolve restored settings version", ErrImportConflict)
		}
		maps.Settings[run.SettingsVersion] = meta.SettingsVersion
	}
	if err = s.Repo.ImportSnapshot(ctx, projectID, snapshot, maps.Captures, maps.Assemblies, maps.Streams, maps.Settings, importID, digest, maps.Sessions, maps.Alternatives); err != nil {
		return fmt.Errorf("%w: %s", ErrImportConflict, err)
	}
	return nil
}
