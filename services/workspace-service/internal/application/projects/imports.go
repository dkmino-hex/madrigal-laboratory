package projects

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
)

const maxProjectArchiveSize int64 = 1500 << 20

func openProjectArchive(name string) (projectArchiveManifest, map[string]*zip.File, error) {
	z, err := zip.OpenReader(name)
	if err != nil {
		return projectArchiveManifest{}, nil, ErrInvalidArchive
	}
	defer z.Close()
	if len(z.File) > 1024 {
		return projectArchiveManifest{}, nil, ErrInvalidArchive
	}
	files := make(map[string]*zip.File, len(z.File))
	var expanded uint64
	for _, f := range z.File {
		if f.Name == "" || strings.ContainsAny(f.Name, "\\:") || path.IsAbs(f.Name) || path.Clean(f.Name) != f.Name || strings.HasPrefix(f.Name, "../") || strings.Contains(f.Name, "/../") || !f.Mode().IsRegular() || files[f.Name] != nil {
			return projectArchiveManifest{}, nil, ErrInvalidArchive
		}
		expanded += f.UncompressedSize64
		if expanded > 3<<30 || f.UncompressedSize64 > 1500<<20 {
			return projectArchiveManifest{}, nil, ErrInvalidArchive
		}
		files[f.Name] = f
	}
	manifestFile := files["manifest.json"]
	if manifestFile == nil {
		return projectArchiveManifest{}, nil, ErrInvalidArchive
	}
	manifestBytes, err := readZipPart(manifestFile, 1<<20)
	if err != nil {
		return projectArchiveManifest{}, nil, err
	}
	var manifest projectArchiveManifest
	if json.Unmarshal(manifestBytes, &manifest) != nil || manifest.Version != 1 || manifest.ProjectID == "" || manifest.WorkspaceSnapshotID == "" || manifest.CaptureSnapshotID == "" || manifest.AnalysisSnapshotID == "" || len(manifest.Files) != len(files)-1 {
		return projectArchiveManifest{}, nil, ErrInvalidArchive
	}
	for _, required := range []string{"workspace.json", "workspace-manifest.json", "capture.zip", "analysis.zip"} {
		if files[required] == nil {
			return projectArchiveManifest{}, nil, ErrInvalidArchive
		}
	}
	for key, want := range manifest.Files {
		f := files[key]
		if f == nil || len(want) != 64 {
			return projectArchiveManifest{}, nil, ErrInvalidArchive
		}
		r, e := f.Open()
		if e != nil {
			return projectArchiveManifest{}, nil, ErrInvalidArchive
		}
		h := sha256.New()
		n, e := io.Copy(h, io.LimitReader(r, int64(f.UncompressedSize64)+1))
		r.Close()
		if e != nil || uint64(n) != f.UncompressedSize64 || hex.EncodeToString(h.Sum(nil)) != want {
			return projectArchiveManifest{}, nil, ErrInvalidArchive
		}
	}
	return manifest, files, nil
}

func readZipPart(f *zip.File, maximum int64) ([]byte, error) {
	if f == nil || f.UncompressedSize64 > uint64(maximum) {
		return nil, ErrInvalidArchive
	}
	r, err := f.Open()
	if err != nil {
		return nil, ErrInvalidArchive
	}
	defer r.Close()
	body, err := io.ReadAll(io.LimitReader(r, maximum+1))
	if err != nil || uint64(len(body)) != f.UncompressedSize64 {
		return nil, ErrInvalidArchive
	}
	return body, nil
}

func (s Store) AcceptProjectArchive(ctx context.Context, importID string, source io.Reader) (map[string]any, error) {
	if importID == "" {
		importID = identifier.New("import")
	}
	if len(importID) > 128 || strings.ContainsAny(importID, "/\\\r\n") {
		return nil, ErrInvalid
	}
	dbPath, err := s.DataDirectory(ctx)
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(dbPath, "imports")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	temp, err := os.CreateTemp(dir, "upload-*.zip")
	if err != nil {
		return nil, err
	}
	defer os.Remove(temp.Name())
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(temp, h), io.LimitReader(source, maxProjectArchiveSize+1))
	if closeErr := temp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return nil, err
	}
	if n == 0 || n > maxProjectArchiveSize {
		return nil, ErrInvalidArchive
	}
	hash := hex.EncodeToString(h.Sum(nil))
	manifest, _, err := openProjectArchive(temp.Name())
	if err != nil {
		return nil, err
	}
	archive, err := zip.OpenReader(temp.Name())
	if err != nil {
		return nil, ErrInvalidArchive
	}
	defer archive.Close()
	parts := make(map[string]*zip.File, len(archive.File))
	for _, f := range archive.File {
		parts[f.Name] = f
	}
	workspaceBytes, err := readZipPart(parts["workspace.json"], 64<<20)
	if err != nil {
		return nil, err
	}
	workspaceManifestBytes, err := readZipPart(parts["workspace-manifest.json"], 1<<20)
	if err != nil {
		return nil, err
	}
	var workspaceManifest struct {
		ProjectID      string `json:"projectId"`
		MetadataSHA256 string `json:"metadataSha256"`
	}
	if json.Unmarshal(workspaceManifestBytes, &workspaceManifest) != nil {
		return nil, ErrInvalidArchive
	}
	workspaceHash := sha256.Sum256(workspaceBytes)
	if workspaceManifest.ProjectID != manifest.ProjectID || workspaceManifest.MetadataSHA256 != hex.EncodeToString(workspaceHash[:]) {
		return nil, ErrInvalidArchive
	}
	var workspace map[string][]map[string]any
	decoder := json.NewDecoder(bytes.NewReader(workspaceBytes))
	decoder.UseNumber()
	if decoder.Decode(&workspace) != nil || len(workspace["project"]) != 1 || workspace["project"][0]["id"] != manifest.ProjectID || len(workspace["settings"]) == 0 {
		return nil, ErrInvalidArchive
	}
	prior, exists, err := s.ExistingProjectImport(ctx, importID, hash)
	if err != nil || exists {
		return prior, err
	}
	if err = archive.Close(); err != nil {
		return nil, err
	}
	final := filepath.Join(dir, hash+".zip")
	if err = os.Rename(temp.Name(), final); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	return s.RegisterProjectImport(ctx, importID, final, hash, manifest, workspace)
}
