package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/internal/httpapi"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/captures"
)

func rangeArgs(r *http.Request) (int64, int64, error) {
	offset, err := positiveInt(r.URL.Query().Get("offset"), 0, 1<<40)
	if err != nil {
		return 0, 0, err
	}
	length, err := positiveInt(r.URL.Query().Get("length"), 65536, 1<<20)
	if err != nil || length < 1 || offset > 1<<40-length {
		return 0, 0, errors.New("invalid range")
	}
	return offset, length, nil
}

func streamInfo(r *http.Request, store captures.Store, assemblyID, streamID string) (int64, error) {
	var length int64
	err := store.DB.QueryRowContext(r.Context(), `SELECT s.logical_length FROM streams s JOIN assemblies a ON a.id=s.assembly_id WHERE a.project_id=?1 AND a.id=?2 AND a.status='READY' AND s.id=?3`, r.PathValue("projectId"), assemblyID, streamID).Scan(&length)
	return length, err
}

func streamIntervals(r *http.Request, store captures.Store, assemblyID, streamID string, offset, length int64) ([]map[string]any, error) {
	if _, err := streamInfo(r, store, assemblyID, streamID); err != nil {
		return nil, err
	}
	return streamIntervalsUnchecked(r, store, assemblyID, streamID, offset, length)
}

func streamIntervalsUnchecked(r *http.Request, store captures.Store, assemblyID, streamID string, offset, length int64) ([]map[string]any, error) {
	rows, err := store.DB.QueryContext(r.Context(), `SELECT start_offset,end_offset,kind,data FROM stream_intervals WHERE assembly_id=?1 AND stream_id=?2 AND end_offset>?3 AND start_offset<?4 ORDER BY start_offset`, assemblyID, streamID, offset, offset+length)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0)
	type conflict struct {
		index         int
		start, lo, hi int64
	}
	conflicts := make([]conflict, 0)
	for rows.Next() {
		var start, end int64
		var kind string
		var data []byte
		if err := rows.Scan(&start, &end, &kind, &data); err != nil {
			rows.Close()
			return nil, err
		}
		lo, hi := max(start, offset), min(end, offset+length)
		item := map[string]any{"startOffset": lo, "endOffset": hi, "kind": kind}
		if kind == "DATA" {
			item["data"] = data[lo-start : hi-start]
		} else if kind == "CONFLICT" {
			conflicts = append(conflicts, conflict{len(items), start, lo, hi})
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for _, c := range conflicts {
		alts, err := store.DB.QueryContext(r.Context(), `SELECT data FROM interval_alternatives WHERE interval_id=(SELECT id FROM stream_intervals WHERE assembly_id=?1 AND stream_id=?2 AND start_offset=?3) ORDER BY id`, assemblyID, streamID, c.start)
		if err != nil {
			return nil, err
		}
		alternatives := make([][]byte, 0)
		for alts.Next() {
			var b []byte
			if err := alts.Scan(&b); err != nil {
				alts.Close()
				return nil, err
			}
			alternatives = append(alternatives, b[c.lo-c.start:c.hi-c.start])
		}
		err = alts.Err()
		alts.Close()
		if err != nil {
			return nil, err
		}
		items[c.index]["alternatives"] = alternatives
	}
	return items, nil
}

func sourceSpans(r *http.Request, store captures.Store, assemblyID, streamID string, offset, length int64) ([]map[string]any, error) {
	if _, err := streamInfo(r, store, assemblyID, streamID); err != nil {
		return nil, err
	}
	return sourceSpansUnchecked(r, store, assemblyID, streamID, offset, length)
}

func sourceSpansUnchecked(r *http.Request, store captures.Store, assemblyID, streamID string, offset, length int64) ([]map[string]any, error) {
	rows, err := store.DB.QueryContext(r.Context(), `SELECT ss.packet_no,ss.frame_offset,ss.stream_offset,ss.byte_length,ss.alternative_id FROM source_spans ss JOIN stream_intervals i ON i.id=ss.interval_id WHERE i.assembly_id=?1 AND i.stream_id=?2 AND ss.stream_offset+ss.byte_length>?3 AND ss.stream_offset<?4 ORDER BY ss.stream_offset,ss.packet_no,ss.frame_offset`, assemblyID, streamID, offset, offset+length)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var packet, frame, start, n int64
		var alternative sql.NullString
		if err := rows.Scan(&packet, &frame, &start, &n, &alternative); err != nil {
			return nil, err
		}
		lo, hi := max(start, offset), min(start+n, offset+length)
		items = append(items, map[string]any{"packetNo": packet, "frameStart": frame + lo - start, "frameEnd": frame + hi - start, "streamStart": lo, "streamEnd": hi, "alternativeId": alternative.String})
	}
	return items, rows.Err()
}

func registerSessions(mux *http.ServeMux, store captures.Store) {
	mux.HandleFunc("GET /api/v1/projects/{projectId}/sessions", func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpapi.Limit(r)
		if err != nil {
			httpapi.Error(w, 400, "INVALID_REQUEST", err.Error())
			return
		}
		q := r.URL.Query()
		args := []any{r.PathValue("projectId"), q.Get("cursor")}
		query := `SELECT s.id,s.assembly_id,s.capture_id,s.generation,s.endpoint_a_ip,s.endpoint_a_port,s.endpoint_b_ip,s.endpoint_b_port,s.first_packet_no,s.last_packet_no,s.diagnostics_json FROM sessions s JOIN assemblies a ON a.id=s.assembly_id WHERE a.project_id=?1 AND a.status='READY' AND s.id>?2`
		filters := []struct{ key, column string }{{"captureId", "s.capture_id"}, {"assemblyId", "s.assembly_id"}, {"ip", ""}, {"port", ""}, {"from", ""}, {"to", ""}}
		for _, f := range filters {
			v := q.Get(f.key)
			if v == "" {
				continue
			}
			switch f.key {
			case "ip":
				query += " AND (s.endpoint_a_ip=?" + strconv.Itoa(len(args)+1) + " OR s.endpoint_b_ip=?" + strconv.Itoa(len(args)+1) + ")"
				args = append(args, v)
			case "port":
				n, e := strconv.Atoi(v)
				if e != nil || n < 0 || n > 65535 {
					httpapi.Error(w, 400, "INVALID_REQUEST", "invalid port")
					return
				}
				query += " AND (s.endpoint_a_port=?" + strconv.Itoa(len(args)+1) + " OR s.endpoint_b_port=?" + strconv.Itoa(len(args)+1) + ")"
				args = append(args, n)
			case "from", "to":
				_, e := strconv.ParseInt(v, 10, 64)
				if e != nil {
					httpapi.Error(w, 400, "INVALID_REQUEST", "invalid time filter")
					return
				}
				op, packetNo := ">=", "s.last_packet_no"
				if f.key == "to" {
					op, packetNo = "<=", "s.first_packet_no"
				}
				query += " AND (SELECT timestamp_seconds FROM packets WHERE capture_id=s.capture_id AND packet_no=" + packetNo + ")" + op + "?" + strconv.Itoa(len(args)+1)
				args = append(args, v)
			default:
				query += " AND " + f.column + "=?" + strconv.Itoa(len(args)+1)
				args = append(args, v)
			}
		}
		query += " ORDER BY s.id LIMIT ?" + strconv.Itoa(len(args)+1)
		args = append(args, limit+1)
		rows, err := store.DB.QueryContext(r.Context(), query, args...)
		if err != nil {
			captureError(w, err)
			return
		}
		defer rows.Close()
		items := make([]map[string]any, 0)
		for rows.Next() {
			var id, aid, cid, aip, bip, diagnostics string
			var gen, aport, bport, first, last int64
			if err := rows.Scan(&id, &aid, &cid, &gen, &aip, &aport, &bip, &bport, &first, &last, &diagnostics); err != nil {
				captureError(w, err)
				return
			}
			items = append(items, map[string]any{"sessionId": id, "assemblyId": aid, "captureId": cid, "generation": gen, "endpointA": map[string]any{"ip": aip, "port": aport}, "endpointB": map[string]any{"ip": bip, "port": bport}, "firstPacketNo": first, "lastPacketNo": last, "diagnostics": json.RawMessage(diagnostics)})
		}
		if err := rows.Err(); err != nil {
			captureError(w, err)
			return
		}
		cursor := ""
		if len(items) > limit {
			items = items[:limit]
			cursor = items[len(items)-1]["sessionId"].(string)
		}
		httpapi.JSON(w, 200, map[string]any{"items": items, "nextCursor": cursor})
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/sessions/{sessionId}", func(w http.ResponseWriter, r *http.Request) {
		aid := r.URL.Query().Get("assemblyId")
		if aid == "" {
			httpapi.Error(w, 400, "INVALID_REQUEST", "assemblyId is required")
			return
		}
		var cid, aip, bip, role, diagnostics string
		var gen, aport, bport, first, last int64
		err := store.DB.QueryRowContext(r.Context(), `SELECT s.capture_id,s.generation,s.endpoint_a_ip,s.endpoint_a_port,s.endpoint_b_ip,s.endpoint_b_port,s.role_status,s.first_packet_no,s.last_packet_no,s.diagnostics_json FROM sessions s JOIN assemblies a ON a.id=s.assembly_id WHERE a.project_id=?1 AND a.id=?2 AND a.status='READY' AND s.id=?3`, r.PathValue("projectId"), aid, r.PathValue("sessionId")).Scan(&cid, &gen, &aip, &aport, &bip, &bport, &role, &first, &last, &diagnostics)
		if err != nil {
			captureError(w, err)
			return
		}
		rows, err := store.DB.QueryContext(r.Context(), `SELECT id,direction,logical_length,known_bytes,known_start,diagnostics_json FROM streams WHERE assembly_id=?1 AND session_id=?2 ORDER BY direction`, aid, r.PathValue("sessionId"))
		if err != nil {
			captureError(w, err)
			return
		}
		defer rows.Close()
		streams := make([]map[string]any, 0)
		for rows.Next() {
			var id, direction, diag string
			var length, known, start int64
			if err := rows.Scan(&id, &direction, &length, &known, &start, &diag); err != nil {
				captureError(w, err)
				return
			}
			streams = append(streams, map[string]any{"streamId": id, "direction": direction, "logicalLength": length, "knownBytes": known, "knownStart": start == 1, "diagnostics": json.RawMessage(diag)})
		}
		if err := rows.Err(); err != nil {
			captureError(w, err)
			return
		}
		var fs, fn, ls, ln int64
		if err := store.DB.QueryRowContext(r.Context(), `SELECT timestamp_seconds,timestamp_nanoseconds FROM packets WHERE capture_id=?1 AND packet_no=?2`, cid, first).Scan(&fs, &fn); err != nil {
			captureError(w, err)
			return
		}
		if err := store.DB.QueryRowContext(r.Context(), `SELECT timestamp_seconds,timestamp_nanoseconds FROM packets WHERE capture_id=?1 AND packet_no=?2`, cid, last).Scan(&ls, &ln); err != nil {
			captureError(w, err)
			return
		}
		firstTime, lastTime := time.Unix(fs, fn).UTC().Format(time.RFC3339Nano), time.Unix(ls, ln).UTC().Format(time.RFC3339Nano)
		httpapi.JSON(w, 200, map[string]any{"sessionId": r.PathValue("sessionId"), "assemblyId": aid, "captureId": cid, "generation": gen, "endpointA": map[string]any{"ip": aip, "port": aport}, "endpointB": map[string]any{"ip": bip, "port": bport}, "roleStatus": role, "firstPacketNo": first, "lastPacketNo": last, "firstSeen": firstTime, "lastSeen": lastTime, "streams": streams, "diagnostics": json.RawMessage(diagnostics)})
	})
	mux.HandleFunc("GET /api/v1/projects/{projectId}/streams/{streamId}/bytes", func(w http.ResponseWriter, r *http.Request) { streamRange(w, r, store, false) })
	mux.HandleFunc("GET /api/v1/projects/{projectId}/streams/{streamId}/sources", func(w http.ResponseWriter, r *http.Request) { streamRange(w, r, store, true) })
}

func streamRange(w http.ResponseWriter, r *http.Request, store captures.Store, sources bool) {
	aid := r.URL.Query().Get("assemblyId")
	if aid == "" {
		httpapi.Error(w, 400, "INVALID_REQUEST", "assemblyId is required")
		return
	}
	offset, length, err := rangeArgs(r)
	if err != nil {
		httpapi.Error(w, 400, "INVALID_REQUEST", err.Error())
		return
	}
	streamID := r.PathValue("streamId")
	if sources {
		items, err := sourceSpans(r, store, aid, streamID, offset, length)
		if err != nil {
			captureError(w, err)
			return
		}
		httpapi.JSON(w, 200, map[string]any{"assemblyId": aid, "streamId": streamID, "offset": offset, "length": length, "sources": items})
		return
	}
	items, err := streamIntervals(r, store, aid, streamID, offset, length)
	if err != nil {
		captureError(w, err)
		return
	}
	httpapi.JSON(w, 200, map[string]any{"assemblyId": aid, "streamId": streamID, "offset": offset, "length": length, "intervals": items})
}
