package captures

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"path"
	"strings"
)

const MaxArchiveBytes = 250 << 20
const maxArchiveBytes = MaxArchiveBytes
const maxExpandedBytes = 750 << 20

func ParseCaptureArchive(data []byte) (restoreManifest, map[string][]byte, string, error) {
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return restoreManifest{}, nil, "", err
	}
	if len(z.File) > 64 {
		return restoreManifest{}, nil, "", errSelection
	}
	parts := make(map[string][]byte, len(z.File))
	var expanded uint64
	for _, file := range z.File {
		if file.Name == "" || strings.ContainsAny(file.Name, "\\:") || path.IsAbs(file.Name) || path.Clean(file.Name) != file.Name || strings.HasPrefix(file.Name, "../") || strings.Contains(file.Name, "/../") || file.Mode().IsRegular() == false {
			return restoreManifest{}, nil, "", errSelection
		}
		if _, exists := parts[file.Name]; exists {
			return restoreManifest{}, nil, "", errSelection
		}
		expanded += file.UncompressedSize64
		if expanded > maxExpandedBytes || file.UncompressedSize64 > 100<<20 {
			return restoreManifest{}, nil, "", errSelection
		}
		reader, e := file.Open()
		if e != nil {
			return restoreManifest{}, nil, "", e
		}
		body, e := io.ReadAll(io.LimitReader(reader, int64(file.UncompressedSize64)+1))
		reader.Close()
		if e != nil || uint64(len(body)) != file.UncompressedSize64 {
			return restoreManifest{}, nil, "", errSelection
		}
		parts[file.Name] = body
	}
	manifestBytes, ok := parts["manifest.json"]
	if !ok {
		return restoreManifest{}, nil, "", errSelection
	}
	var manifest restoreManifest
	if err = json.Unmarshal(manifestBytes, &manifest); err != nil {
		return restoreManifest{}, nil, "", err
	}
	if manifest.Version != 1 || manifest.Service != "capture" || manifest.ProjectID == "" || manifest.Selection.ProjectID != manifest.ProjectID || len(manifest.Files) != len(parts)-1 {
		return restoreManifest{}, nil, "", errSelection
	}
	for name, want := range manifest.Files {
		body, ok := parts[name]
		if !ok || len(want) != 64 {
			return restoreManifest{}, nil, "", errSelection
		}
		sum := sha256.Sum256(body)
		if hex.EncodeToString(sum[:]) != want {
			return restoreManifest{}, nil, "", errSelection
		}
	}
	for _, table := range restoreTables {
		if _, ok := parts["data/"+table+".json"]; !ok {
			return restoreManifest{}, nil, "", errSelection
		}
	}
	for _, capture := range manifest.Selection.Captures {
		if manifest.Files["originals/"+capture.SHA256] != capture.SHA256 {
			return restoreManifest{}, nil, "", errSelection
		}
	}
	sum := sha256.Sum256(manifestBytes)
	return manifest, parts, hex.EncodeToString(sum[:]), nil
}

func (store Store) RestoreCaptureArchive(ctx context.Context, projectID, importID string, manifest restoreManifest, parts map[string][]byte, manifestHash string, settingsMap map[string]string) (map[string]any, error) {
	if projectID == "" || importID == "" || len(importID) > 128 {
		return nil, errSelection
	}
	prior, exists, err := store.ExistingImport(ctx, projectID, importID, manifestHash)
	if err != nil || exists {
		return prior, err
	}
	for _, c := range manifest.Selection.Captures {
		body := parts["originals/"+c.SHA256]
		obj, e := store.Files.Put(ctx, bytes.NewReader(body))
		if e != nil || obj.SHA256 != c.SHA256 || obj.Size != c.Size || obj.Format != c.Format {
			return nil, errSelection
		}
	}
	tables := make(map[string][]map[string]any, len(restoreTables))
	for _, table := range restoreTables {
		dec := json.NewDecoder(bytes.NewReader(parts["data/"+table+".json"]))
		dec.UseNumber()
		var rows []map[string]any
		if err = dec.Decode(&rows); err != nil {
			return nil, errSelection
		}
		tables[table] = rows
	}
	return store.RestoreTables(ctx, projectID, importID, manifestHash, tables, settingsMap)
}
