package projects

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
)

func (s Store) BuildExport(ctx context.Context, j jobs.Job, progress func(string, int64, *int64) error) error {
	if j.ResourceID == nil {
		return ErrInvalid
	}
	var payload struct {
		SnapshotID string `json:"snapshotId"`
	}
	if err := json.Unmarshal(j.Payload, &payload); err != nil {
		return err
	}
	metadata, workspaceManifest, err := s.SnapshotData(ctx, payload.SnapshotID, j.ProjectID)
	if err != nil {
		return err
	}
	components := map[string]string{}
	for _, name := range []string{"capture", "analysis"} {
		if err := progress("SNAPSHOT_"+strings.ToUpper(name), 0, nil); err != nil {
			return err
		}
		id, err := s.Peers.Snapshot(ctx, name, j.ProjectID)
		if err != nil {
			return fmt.Errorf("%s snapshot: %w", name, err)
		}
		components[name] = id
	}
	dbPath, err := s.DataDirectory(ctx)
	if err != nil {
		return err
	}
	dir := filepath.Join(dbPath, "artifacts")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(dir, "export-*.zip")
	if err != nil {
		return err
	}
	defer func() { temp.Close(); os.Remove(temp.Name()) }()
	writer := zip.NewWriter(temp)
	files := map[string]string{}
	addBytes := func(name string, body []byte) error {
		entry, e := writer.Create(name)
		if e != nil {
			return e
		}
		if _, e = entry.Write(body); e != nil {
			return e
		}
		h := sha256.Sum256(body)
		files[name] = hex.EncodeToString(h[:])
		return nil
	}
	if err = addBytes("workspace.json", metadata); err != nil {
		writer.Close()
		return err
	}
	if err = addBytes("workspace-manifest.json", workspaceManifest); err != nil {
		writer.Close()
		return err
	}
	err = s.ForEachJournal(ctx, j.ProjectID, func(source, want string) error {
		body, e := os.ReadFile(source)
		if e != nil {
			return e
		}
		h := sha256.Sum256(body)
		if hex.EncodeToString(h[:]) != want {
			return errors.New("journal original hash mismatch")
		}
		return addBytes("journals/"+want+".csv", body)
	})
	if err != nil {
		writer.Close()
		return err
	}
	for _, name := range []string{"capture", "analysis"} {
		if err = progress("ARCHIVING_"+strings.ToUpper(name), 1, nil); err != nil {
			writer.Close()
			return err
		}
		hash, e := s.Peers.WriteArchive(ctx, writer, name, components[name], name+".zip")
		if e != nil {
			writer.Close()
			return fmt.Errorf("%s archive: %w", name, e)
		}
		files[name+".zip"] = hash
	}
	manifest := map[string]any{"version": 1, "projectId": j.ProjectID, "workspaceSnapshotId": payload.SnapshotID, "captureSnapshotId": components["capture"], "analysisSnapshotId": components["analysis"], "files": files}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		writer.Close()
		return err
	}
	if err = addBytes("manifest.json", encoded); err != nil {
		writer.Close()
		return err
	}
	if err = writer.Close(); err != nil {
		return err
	}
	if err = temp.Sync(); err != nil {
		return err
	}
	if err = temp.Close(); err != nil {
		return err
	}
	final := *j.ResourceID + ".zip"
	if err = os.Rename(temp.Name(), filepath.Join(dir, final)); err != nil {
		return err
	}
	file, err := os.Open(filepath.Join(dir, final))
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return err
	}
	return s.SetArtifact(ctx, *j.ResourceID, final, hex.EncodeToString(hash.Sum(nil)), size)
}
