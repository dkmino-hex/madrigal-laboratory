package projects

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func (s Store) RestoreProject(ctx context.Context, j jobs.Job, progress func(string, int64, *int64) error) error {
	if j.ResourceID == nil {
		return ErrInvalid
	}
	state, err := s.ImportState(ctx, *j.ResourceID, j.ProjectID)
	if err != nil {
		return err
	}
	archivePath, wantHash, contextJSON, workspaceRestored := state.ArchivePath, state.Hash, state.ContextJSON, state.WorkspaceRestored
	var info importContext
	if err := json.Unmarshal([]byte(contextJSON), &info); err != nil {
		return err
	}
	if err := progress("VALIDATING", 0, nil); err != nil {
		return err
	}
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	h := sha256.New()
	_, err = io.Copy(h, io.LimitReader(f, maxProjectArchiveSize+1))
	f.Close()
	if err != nil || hex.EncodeToString(h.Sum(nil)) != wantHash {
		return ErrInvalidArchive
	}
	manifest, _, err := openProjectArchive(archivePath)
	if err != nil {
		return err
	}
	if manifest.ProjectID != info.Archive.ProjectID {
		return ErrInvalidArchive
	}
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		return ErrInvalidArchive
	}
	defer archive.Close()
	parts := map[string]*zip.File{}
	for _, part := range archive.File {
		parts[part.Name] = part
	}
	settingsHeader, _ := json.Marshal(info.SettingsMap)
	childJobs := map[string]string{}
	recordChild := func(name string) func(string) error {
		return func(id string) error {
			childJobs[name] = id
			return s.SetImportState(ctx, *j.ResourceID, "", childJobs)
		}
	}
	if err = s.SetImportState(ctx, *j.ResourceID, "RESTORING", nil); err != nil {
		return err
	}
	if err = progress("RESTORING_CAPTURE", 1, nil); err != nil {
		return err
	}
	capture, err := s.Peers.Restore(ctx, "capture", j.ProjectID, *j.ResourceID, parts["capture.zip"], map[string]string{"X-Settings-Version-Map": string(settingsHeader)}, recordChild("capture"))
	if err != nil {
		return fmt.Errorf("capture restore: %w", err)
	}
	if err = progress("RESTORING_ANALYSIS", 2, nil); err != nil {
		return err
	}
	captureIDs, _ := json.Marshal(capture.CaptureIDs)
	assemblyIDs, _ := json.Marshal(capture.AssemblyIDs)
	streamIDs, _ := json.Marshal(capture.StreamIDs)
	_, err = s.Peers.Restore(ctx, "analysis", j.ProjectID, *j.ResourceID, parts["analysis.zip"], map[string]string{"X-Capture-Id-Map": string(captureIDs), "X-Assembly-Id-Map": string(assemblyIDs), "X-Stream-Id-Map": string(streamIDs)}, recordChild("analysis"))
	if err != nil {
		return fmt.Errorf("analysis restore: %w", err)
	}
	if err = s.SetImportState(ctx, *j.ResourceID, "VERIFYING", childJobs); err != nil {
		return err
	}
	if err = s.validateRestoredEvidence(ctx, j.ProjectID, parts["workspace.json"], capture); err != nil {
		return err
	}
	if !workspaceRestored {
		if err = progress("RESTORING_WORKSPACE", 3, nil); err != nil {
			return err
		}
		if err = s.restoreWorkspaceRows(ctx, j.ProjectID, parts, capture); err != nil {
			return err
		}
	}
	return progress("VERIFIED", 4, nil)
}

func (s Store) validateRestoredEvidence(ctx context.Context, projectID string, part *zip.File, capture captureImportResult) error {
	body, err := readZipPart(part, 64<<20)
	if err != nil {
		return err
	}
	var metadata map[string][]map[string]any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if err = decoder.Decode(&metadata); err != nil {
		return ErrInvalidArchive
	}
	items := make([]map[string]any, 0, len(metadata["evidence"]))
	for _, row := range metadata["evidence"] {
		item := map[string]any{"captureSha256": row["capture_sha256"], "packetNo": row["packet_no"], "frameOffset": row["frame_offset"], "byteLength": row["byte_length"]}
		if old, ok := row["assembly_id"].(string); ok && old != "" {
			mappedAssembly := capture.AssemblyIDs[old]
			oldStream, _ := row["stream_id"].(string)
			mappedStream := capture.StreamIDs[oldStream]
			if mappedAssembly == "" || mappedStream == "" {
				return ErrInvalidArchive
			}
			item["assemblyId"] = mappedAssembly
			item["streamId"] = mappedStream
			item["streamOffset"] = row["stream_offset"]
		}
		items = append(items, item)
	}
	return s.Peers.ValidateEvidence(ctx, projectID, items)
}

func (s Store) restoreWorkspaceRows(ctx context.Context, projectID string, parts map[string]*zip.File, capture captureImportResult) error {
	body, err := readZipPart(parts["workspace.json"], 64<<20)
	if err != nil {
		return err
	}
	var data map[string][]map[string]any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if decoder.Decode(&data) != nil {
		return ErrInvalidArchive
	}
	dbPath, err := s.DataDirectory(ctx)
	if err != nil {
		return err
	}
	journalDir := filepath.Join(dbPath, "journals")
	if err = os.MkdirAll(journalDir, 0700); err != nil {
		return err
	}
	journalPaths := map[string]string{}
	for _, row := range data["journalImports"] {
		sha, e := domain.TextValue(row, "sha256")
		if e != nil || len(sha) != 64 {
			return ErrInvalidArchive
		}
		original, e := readZipPart(parts["journals/"+sha+".csv"], 16<<20)
		if e != nil {
			return e
		}
		h := sha256.Sum256(original)
		if hex.EncodeToString(h[:]) != sha {
			return ErrInvalidArchive
		}
		final := filepath.Join(journalDir, sha+".csv")
		file, e := os.OpenFile(final, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e == nil {
			_, e = file.Write(original)
			if closeErr := file.Close(); e == nil {
				e = closeErr
			}
			if e != nil {
				os.Remove(final)
				return e
			}
		} else if errors.Is(e, os.ErrExist) {
			info, statErr := os.Lstat(final)
			if statErr != nil || !info.Mode().IsRegular() {
				return ErrInvalidArchive
			}
			stored, readErr := os.ReadFile(final)
			if readErr != nil || !bytes.Equal(stored, original) {
				return ErrInvalidArchive
			}
		} else {
			return e
		}
		journalPaths[sha] = final
	}
	return s.RestoreWorkspaceRows(ctx, projectID, data, capture, journalPaths)
}
