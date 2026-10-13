package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/internal/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/captures"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/originals"
)

func captureError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, sql.ErrNoRows):
		httpapi.Error(w, 404, "NOT_FOUND", "resource was not found")
	case errors.Is(err, originals.ErrFormat), errors.Is(err, originals.ErrTooLarge):
		httpapi.Error(w, 400, "INVALID_CAPTURE", err.Error())
	default:
		slog.Error("capture request failed", "error", err)
		httpapi.Error(w, 500, "INTERNAL_ERROR", "request could not be completed")
	}
}

func positiveInt(raw string, fallback, maximum int64) (int64, error) {
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 || n > maximum {
		return 0, errors.New("invalid range")
	}
	return n, nil
}

func registerCapture(mux *http.ServeMux, store captures.Store) {
	mux.HandleFunc("POST /api/v1/projects/{projectId}/captures", func(w http.ResponseWriter, r *http.Request) {
		projectID := r.PathValue("projectId")
		project, err := store.Context(r.Context(), projectID, "current")
		if err != nil {
			captureError(w, err)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, originals.MaxSize+(1<<20))
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", "expected multipart capture upload")
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			file, header, err = r.FormFile("capture")
		}
		if err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", "file part is required")
			return
		}
		defer file.Close()
		c, j, duplicate, err := store.AcceptOriginalWithSettings(r.Context(), projectID, header.Filename, file, project.SettingsVersion, project.Settings)
		if err != nil {
			captureError(w, err)
			return
		}
		w.Header().Set("Location", "/api/v1/jobs/"+j.ID)
		httpapi.JSON(w, 202, map[string]any{"captureId": c.ID, "jobId": j.ID, "status": c.Status, "sha256": c.SHA256, "duplicate": duplicate})
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/captures", func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpapi.Limit(r)
		if err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", err.Error())
			return
		}
		rows, err := store.DB.QueryContext(r.Context(), `SELECT id,sha256,original_name,size_bytes,format,status,packet_count,diagnostics_json,created_at FROM captures WHERE project_id=?1 AND id>?2 ORDER BY id LIMIT ?3`, r.PathValue("projectId"), r.URL.Query().Get("cursor"), limit+1)
		if err != nil {
			captureError(w, err)
			return
		}
		defer rows.Close()
		items := make([]map[string]any, 0)
		for rows.Next() {
			var id, hash, name, format, status, diagnostics, created string
			var size, count int64
			if err := rows.Scan(&id, &hash, &name, &size, &format, &status, &count, &diagnostics, &created); err != nil {
				captureError(w, err)
				return
			}
			items = append(items, map[string]any{"captureId": id, "sha256": hash, "originalName": name, "sizeBytes": size, "format": format, "status": status, "packetCount": count, "diagnostics": json.RawMessage(diagnostics), "createdAt": created})
		}
		if err := rows.Err(); err != nil {
			captureError(w, err)
			return
		}
		cursor := ""
		if len(items) > limit {
			items = items[:limit]
			cursor = items[len(items)-1]["captureId"].(string)
		}
		httpapi.JSON(w, 200, map[string]any{"items": items, "nextCursor": cursor})
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/captures/{captureId}/packets/{packetNo}", func(w http.ResponseWriter, r *http.Request) {
		n, err := strconv.ParseInt(r.PathValue("packetNo"), 10, 64)
		if err != nil || n < 1 {
			httpapi.Error(w, 400, "INVALID_REQUEST", "invalid packet number")
			return
		}
		var timestampSec, timestampNano, capLen, origLen, iface, linkType int64
		var frame []byte
		var diagnostics string
		var src, dst sql.NullString
		var sport, dport, seq, ack, flags, po, pl sql.NullInt64
		err = store.DB.QueryRowContext(r.Context(), `SELECT p.timestamp_seconds,p.timestamp_nanoseconds,p.captured_length,p.original_length,p.interface_no,i.link_type,p.frame,p.diagnostics_json,p.src_ip,p.dst_ip,p.src_port,p.dst_port,p.tcp_seq,p.tcp_ack,p.tcp_flags,p.payload_offset,p.payload_length FROM packets p JOIN captures c ON c.id=p.capture_id JOIN capture_interfaces i ON i.capture_id=p.capture_id AND i.interface_no=p.interface_no WHERE c.project_id=?1 AND p.capture_id=?2 AND p.packet_no=?3`, r.PathValue("projectId"), r.PathValue("captureId"), n).Scan(&timestampSec, &timestampNano, &capLen, &origLen, &iface, &linkType, &frame, &diagnostics, &src, &dst, &sport, &dport, &seq, &ack, &flags, &po, &pl)
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, map[string]any{"captureId": r.PathValue("captureId"), "packetNo": n, "interfaceNo": iface, "linkType": linkType, "timestamp": time.Unix(timestampSec, timestampNano).UTC().Format(time.RFC3339Nano), "timestampSeconds": timestampSec, "timestampNanoseconds": timestampNano, "capturedLength": capLen, "originalLength": origLen, "frame": frame, "sourceIp": src.String, "destinationIp": dst.String, "sourcePort": sport.Int64, "destinationPort": dport.Int64, "tcpSeq": seq.Int64, "tcpAck": ack.Int64, "tcpFlags": flags.Int64, "payloadOffset": po.Int64, "payloadLength": pl.Int64, "diagnostics": json.RawMessage(diagnostics)})
	})
	mux.HandleFunc("POST /api/v1/projects/{projectId}/captures/{captureId}/assemblies", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			SettingsVersion string `json:"settingsVersion"`
		}
		if err := httpapi.Decode(w, r, &input); err != nil || input.SettingsVersion == "" {
			httpapi.Error(w, 400, "INVALID_REQUEST", "settingsVersion is required")
			return
		}
		project, err := store.Context(r.Context(), r.PathValue("projectId"), input.SettingsVersion)
		if err != nil {
			captureError(w, err)
			return
		}
		tx, err := store.DB.BeginTx(r.Context(), nil)
		if err != nil {
			captureError(w, err)
			return
		}
		defer tx.Rollback()
		id, job, err := store.EnqueueAssemblyTx(r.Context(), tx, project.ProjectID, r.PathValue("captureId"), project.SettingsVersion, project.Settings, "capture-0.1")
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				captureError(w, err)
			} else {
				httpapi.Error(w, 409, "NOT_READY", err.Error())
			}
			return
		}
		if err := tx.Commit(); err != nil {
			captureError(w, err)
			return
		}
		w.Header().Set("Location", "/api/v1/jobs/"+job.ID)
		httpapi.JSON(w, 202, map[string]any{"assemblyId": id, "jobId": job.ID, "status": "BUILDING", "settingsVersion": project.SettingsVersion})
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/captures/{captureId}/assemblies", func(w http.ResponseWriter, r *http.Request) {
		rows, err := store.DB.QueryContext(r.Context(), `SELECT a.id,a.settings_version,a.engine_version,a.status,a.diagnostics_json,a.created_at,a.finished_at FROM assemblies a JOIN captures c ON c.id=a.capture_id WHERE c.project_id=?1 AND c.id=?2 ORDER BY a.created_at,a.id`, r.PathValue("projectId"), r.PathValue("captureId"))
		if err != nil {
			captureError(w, err)
			return
		}
		defer rows.Close()
		items := make([]map[string]any, 0)
		for rows.Next() {
			var id, v, engine, status, diagnostics, created string
			var finished sql.NullString
			if err := rows.Scan(&id, &v, &engine, &status, &diagnostics, &created, &finished); err != nil {
				captureError(w, err)
				return
			}
			items = append(items, map[string]any{"assemblyId": id, "settingsVersion": v, "engineVersion": engine, "status": status, "diagnostics": json.RawMessage(diagnostics), "createdAt": created, "finishedAt": finished.String})
		}
		if err := rows.Err(); err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, map[string]any{"items": items})
	})
	registerSessions(mux, store)
	registerViews(mux, store)
}
