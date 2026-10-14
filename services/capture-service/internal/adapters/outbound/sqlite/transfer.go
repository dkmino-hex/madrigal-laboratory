package storage

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

type captureSnapshotInput = domain.SnapshotInput
type captureSnapshotMeta = domain.SnapshotMeta

var errSelection = domain.ErrSelection
var restoreTables = domain.ArchiveTables

var restoreColumnPattern = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

func (store Store) CreateSnapshot(ctx context.Context, projectID string, in captureSnapshotInput) (map[string]any, error) {
	tx, err := store.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	meta := captureSnapshotMeta{Version: 1, ProjectID: projectID}
	selection, _ := json.Marshal(in.CaptureIDs)
	rows, err := tx.QueryContext(ctx, `SELECT id,sha256,relative_path,size_bytes,format FROM captures WHERE project_id=?1 AND status='READY' AND (json_array_length(?2)=0 OR id IN (SELECT value FROM json_each(?2))) ORDER BY id`, projectID, string(selection))
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c struct {
			ID           string `json:"captureId"`
			SHA256       string `json:"sha256"`
			RelativePath string `json:"relativePath"`
			Size         int64  `json:"sizeBytes"`
			Format       string `json:"format"`
		}
		if err = rows.Scan(&c.ID, &c.SHA256, &c.RelativePath, &c.Size, &c.Format); err != nil {
			rows.Close()
			return nil, err
		}
		meta.Captures = append(meta.Captures, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(in.CaptureIDs) > 0 && len(meta.Captures) != len(in.CaptureIDs) {
		return nil, errSelection
	}
	ids := make([]string, 0, len(meta.Captures))
	for _, c := range meta.Captures {
		ids = append(ids, c.ID)
	}
	captureJSON, _ := json.Marshal(ids)
	assemblyJSON, _ := json.Marshal(in.AssemblyIDs)
	rows, err = tx.QueryContext(ctx, `SELECT id FROM assemblies WHERE project_id=?1 AND status='READY' AND capture_id IN (SELECT value FROM json_each(?2)) AND (json_array_length(?3)=0 OR id IN (SELECT value FROM json_each(?3))) ORDER BY id`, projectID, string(captureJSON), string(assemblyJSON))
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		meta.AssemblyIDs = append(meta.AssemblyIDs, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(in.AssemblyIDs) > 0 && len(meta.AssemblyIDs) != len(in.AssemblyIDs) {
		return nil, errSelection
	}
	body, err := json.Marshal(meta)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(body)
	manifest, _ := json.Marshal(map[string]any{"version": 1, "service": "capture", "projectId": projectID, "metadataSha256": hex.EncodeToString(hash[:]), "captureIds": ids, "assemblyIds": meta.AssemblyIDs})
	id := identifier.New("snapshot")
	if _, err = tx.ExecContext(ctx, "INSERT INTO snapshots(id,project_id,manifest_json,metadata_json) VALUES(?1,?2,?3,?4)", id, projectID, string(manifest), string(body)); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"snapshotId": id, "manifest": json.RawMessage(manifest)}, nil
}

func (store Store) WriteSnapshotTables(ctx context.Context, writer *zip.Writer, meta domain.SnapshotMeta) (map[string]string, error) {
	var err error
	files := map[string]string{}
	captureIDs := make([]string, 0, len(meta.Captures))
	for _, c := range meta.Captures {
		captureIDs = append(captureIDs, c.ID)
	}
	selectedCaptures, _ := json.Marshal(captureIDs)
	selectedAssemblies, _ := json.Marshal(meta.AssemblyIDs)
	tables := []struct {
		name, query string
		arg         string
	}{
		{"captures", `SELECT * FROM captures WHERE project_id=?1 AND id IN (SELECT value FROM json_each(?2)) ORDER BY id`, string(selectedCaptures)},
		{"capture_interfaces", `SELECT * FROM capture_interfaces WHERE capture_id IN (SELECT value FROM json_each(?2)) ORDER BY capture_id,interface_no`, string(selectedCaptures)},
		{"packets", `SELECT * FROM packets WHERE capture_id IN (SELECT value FROM json_each(?2)) ORDER BY capture_id,packet_no`, string(selectedCaptures)},
		{"assemblies", `SELECT * FROM assemblies WHERE project_id=?1 AND id IN (SELECT value FROM json_each(?2)) ORDER BY id`, string(selectedAssemblies)},
		{"sessions", `SELECT * FROM sessions WHERE assembly_id IN (SELECT value FROM json_each(?2)) ORDER BY id`, string(selectedAssemblies)},
		{"streams", `SELECT * FROM streams WHERE assembly_id IN (SELECT value FROM json_each(?2)) ORDER BY id`, string(selectedAssemblies)},
		{"stream_intervals", `SELECT * FROM stream_intervals WHERE assembly_id IN (SELECT value FROM json_each(?2)) ORDER BY id`, string(selectedAssemblies)},
		{"interval_alternatives", `SELECT alt.* FROM interval_alternatives alt JOIN stream_intervals i ON i.id=alt.interval_id WHERE i.assembly_id IN (SELECT value FROM json_each(?2)) ORDER BY alt.id`, string(selectedAssemblies)},
		{"source_spans", `SELECT ss.* FROM source_spans ss JOIN stream_intervals i ON i.id=ss.interval_id WHERE i.assembly_id IN (SELECT value FROM json_each(?2)) ORDER BY ss.id`, string(selectedAssemblies)},
	}
	for _, table := range tables {
		if e := ctx.Err(); e != nil {
			writer.Close()
			err = e
			return nil, err
		}
		rows, e := store.DB.QueryContext(ctx, table.query, meta.ProjectID, table.arg)
		if e != nil {
			writer.Close()
			err = e
			return nil, err
		}
		entry, e := writer.Create("data/" + table.name + ".json")
		if e != nil {
			rows.Close()
			writer.Close()
			err = e
			return nil, err
		}
		hash := sha256.New()
		dest := io.MultiWriter(entry, hash)
		_, e = io.WriteString(dest, "[")
		columns, _ := rows.Columns()
		first := true
		for e == nil && rows.Next() {
			values := make([]any, len(columns))
			targets := make([]any, len(columns))
			for i := range values {
				targets[i] = &values[i]
			}
			if e = rows.Scan(targets...); e != nil {
				break
			}
			item := make(map[string]any, len(columns))
			for i, key := range columns {
				item[key] = values[i]
			}
			var encoded []byte
			encoded, e = json.Marshal(item)
			if e != nil {
				break
			}
			if !first {
				_, e = io.WriteString(dest, ",")
				if e != nil {
					break
				}
			}
			_, e = dest.Write(encoded)
			first = false
		}
		if e == nil {
			e = rows.Err()
		}
		rows.Close()
		if e == nil {
			_, e = io.WriteString(dest, "]")
		}
		if e != nil {
			writer.Close()
			err = e
			return nil, err
		}
		files["data/"+table.name+".json"] = hex.EncodeToString(hash.Sum(nil))
	}

	return files, nil
}

func (store Store) SnapshotMetadata(ctx context.Context, id string) (domain.SnapshotMeta, error) {
	var raw []byte
	err := store.DB.QueryRowContext(ctx, "SELECT metadata_json FROM snapshots WHERE id=?1", id).Scan(&raw)
	if err != nil {
		return domain.SnapshotMeta{}, err
	}
	var result domain.SnapshotMeta
	err = json.Unmarshal(raw, &result)
	return result, err
}

func (store Store) ExistingImport(ctx context.Context, projectID, importID, manifestHash string) (map[string]any, bool, error) {
	var oldHash, resultJSON string
	err := store.DB.QueryRowContext(ctx, "SELECT manifest_sha256,result_json FROM imports WHERE project_id=?1 AND import_id=?2", projectID, importID).Scan(&oldHash, &resultJSON)
	if err == nil {
		if oldHash != manifestHash {
			return nil, false, errSelection
		}
		var result map[string]any
		if err = json.Unmarshal([]byte(resultJSON), &result); err != nil {
			return nil, false, err
		}
		return result, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, false, err
	}

	return nil, false, nil
}

func (store Store) RestoreTables(ctx context.Context, projectID, importID, manifestHash string, tables map[string][]map[string]any, settingsMap map[string]string) (map[string]any, error) {
	maps := map[string]map[string]string{}
	for _, name := range []string{"captures", "assemblies", "sessions", "streams", "stream_intervals", "interval_alternatives", "source_spans"} {
		mapping := map[string]string{}
		for _, row := range tables[name] {
			id, ok := row["id"].(string)
			if !ok || id == "" || mapping[id] != "" {
				return nil, errSelection
			}
			mapping[id] = identifier.New(strings.TrimSuffix(name, "s"))
		}
		maps[name] = mapping
	}
	tx, err := store.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "INSERT INTO imports(project_id,import_id,manifest_sha256,status) VALUES(?1,?2,?3,'RESTORING')", projectID, importID, manifestHash); err != nil {
		return nil, err
	}
	for _, name := range restoreTables {
		for _, record := range tables[name] {
			if err = ctx.Err(); err != nil {
				return nil, err
			}
			row := make(map[string]any, len(record))
			for key, value := range record {
				row[key] = value
			}
			if mapping := maps[name]; mapping != nil {
				row["id"] = mapping[row["id"].(string)]
			}
			for column, target := range map[string]string{"capture_id": "captures", "assembly_id": "assemblies", "session_id": "sessions", "stream_id": "streams", "interval_id": "stream_intervals", "alternative_id": "interval_alternatives"} {
				if old, ok := row[column].(string); ok && old != "" {
					newID := maps[target][old]
					if newID == "" {
						return nil, errSelection
					}
					row[column] = newID
				}
			}
			if name == "captures" || name == "assemblies" {
				row["project_id"] = projectID
			}
			if name == "captures" {
				sha, _ := row["sha256"].(string)
				if len(sha) != 64 {
					return nil, errSelection
				}
				row["relative_path"] = "objects/" + sha[:2] + "/" + sha
				row["status"] = "IMPORTING"
				row["packet_count"] = int64(0)
			}
			if name == "assemblies" {
				row["job_id"] = nil
				row["status"] = "BUILDING"
				row["finished_at"] = nil
				if len(settingsMap) > 0 {
					old, _ := row["settings_version"].(string)
					mapped := settingsMap[old]
					if mapped == "" {
						return nil, errSelection
					}
					row["settings_version"] = mapped
				}
			}
			if name == "packets" || name == "stream_intervals" || name == "interval_alternatives" {
				for _, key := range []string{"frame", "data"} {
					if encoded, ok := row[key].(string); ok {
						blob, e := base64.StdEncoding.DecodeString(encoded)
						if e != nil {
							return nil, errSelection
						}
						row[key] = blob
					}
				}
			}
			if err = insertRestoreRow(ctx, tx, name, row); err != nil {
				return nil, fmt.Errorf("restore %s: %w", name, err)
			}
		}
		if name == "packets" {
			for _, newID := range maps["captures"] {
				if _, err = tx.ExecContext(ctx, "UPDATE captures SET status='READY',packet_count=(SELECT COUNT(*) FROM packets WHERE capture_id=?1) WHERE id=?1", newID); err != nil {
					return nil, err
				}
			}
		}
	}
	for _, newID := range maps["assemblies"] {
		if _, err = tx.ExecContext(ctx, "UPDATE assemblies SET status='READY',finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1", newID); err != nil {
			return nil, err
		}
	}
	result := map[string]any{"importId": importID, "status": "READY", "captureIds": maps["captures"], "assemblyIds": maps["assemblies"], "streamIds": maps["streams"], "sessionIds": maps["sessions"]}
	encoded, _ := json.Marshal(result)
	if _, err = tx.ExecContext(ctx, "UPDATE imports SET status='READY',result_json=?3,updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE project_id=?1 AND import_id=?2", projectID, importID, string(encoded)); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil

}

func insertRestoreRow(ctx context.Context, tx *sql.Tx, table string, row map[string]any) error {
	keys := make([]string, 0, len(row))
	for key := range row {
		if !restoreColumnPattern.MatchString(key) {
			return errSelection
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	values := make([]any, 0, len(keys))
	placeholders := make([]string, 0, len(keys))
	for i, key := range keys {
		value := row[key]
		if n, ok := value.(json.Number); ok {
			parsed, e := n.Int64()
			if e != nil {
				return errSelection
			}
			value = parsed
		}
		values = append(values, value)
		placeholders = append(placeholders, fmt.Sprintf("?%d", i+1))
	}
	query := "INSERT INTO " + table + "(" + strings.Join(keys, ",") + ") VALUES(" + strings.Join(placeholders, ",") + ")"
	_, err := tx.ExecContext(ctx, query, values...)
	return err
}
