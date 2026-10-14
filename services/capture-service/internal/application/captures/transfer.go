package captures

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"

	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

type captureSnapshotInput = domain.SnapshotInput
type captureSnapshotMeta = domain.SnapshotMeta
type restoreManifest = domain.RestoreManifest

var errSelection = domain.ErrSelection
var restoreTables = domain.ArchiveTables

func (store Store) CreateCaptureSnapshot(ctx context.Context, projectID string, in domain.SnapshotInput) (map[string]any, error) {
	if _, err := store.Context(ctx, projectID, "current"); err != nil {
		return nil, err
	}
	return store.CreateSnapshot(ctx, projectID, in)
}

func (store Store) BuildCaptureArchive(ctx context.Context, meta captureSnapshotMeta) (string, error) {
	if store.Files == nil {
		return "", errors.New("original storage unavailable")
	}
	temp, err := os.CreateTemp("", "capture-snapshot-*.zip")
	if err != nil {
		return "", err
	}
	path := temp.Name()
	defer func() {
		temp.Close()
		if err != nil {
			os.Remove(path)
		}
	}()
	writer := zip.NewWriter(temp)
	files := make(map[string]string)
	captureIDs := make([]string, 0, len(meta.Captures))
	for _, c := range meta.Captures {
		captureIDs = append(captureIDs, c.ID)
		obj := domain.Original{SHA256: c.SHA256, RelativePath: c.RelativePath, Size: c.Size, Format: c.Format}
		if e := store.Files.Verify(ctx, obj); e != nil {
			writer.Close()
			err = e
			return "", err
		}
		f, e := store.Files.Open(obj)
		if e != nil {
			writer.Close()
			err = e
			return "", err
		}
		name := "originals/" + c.SHA256
		entry, e := writer.Create(name)
		if e == nil {
			_, e = io.Copy(entry, f)
		}
		f.Close()
		if e != nil {
			writer.Close()
			err = e
			return "", err
		}
		files[name] = c.SHA256
	}
	dataFiles, e := store.WriteSnapshotTables(ctx, writer, meta)
	if e != nil {
		writer.Close()
		err = e
		return "", err
	}
	for name, hash := range dataFiles {
		files[name] = hash
	}
	manifest := map[string]any{"version": 1, "service": "capture", "projectId": meta.ProjectID, "selection": meta, "files": files}
	entry, e := writer.Create("manifest.json")
	if e != nil {
		writer.Close()
		err = e
		return "", err
	}
	if e = json.NewEncoder(entry).Encode(manifest); e != nil {
		writer.Close()
		err = e
		return "", err
	}
	if e = writer.Close(); e != nil {
		err = e
		return "", err
	}
	if e = temp.Sync(); e != nil {
		err = e
		return "", err
	}
	if e = temp.Close(); e != nil {
		err = e
		return "", err
	}
	return path, nil
}
