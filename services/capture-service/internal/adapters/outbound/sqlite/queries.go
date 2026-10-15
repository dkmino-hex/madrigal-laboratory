package storage

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

func (store Store) ListCaptures(ctx context.Context, projectID, cursorToken string, limit int) (map[string]any, error) {
	rows, err := store.DB.QueryContext(ctx, `SELECT id,sha256,original_name,size_bytes,format,status,packet_count,diagnostics_json,created_at FROM captures WHERE project_id=?1 AND id>?2 ORDER BY id LIMIT ?3`, projectID, cursorToken, limit+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, hash, name, format, status, diagnostics, created string
		var size, count int64
		if err := rows.Scan(&id, &hash, &name, &size, &format, &status, &count, &diagnostics, &created); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"captureId": id, "sha256": hash, "originalName": name, "sizeBytes": size, "format": format, "status": status, "packetCount": count, "diagnostics": json.RawMessage(diagnostics), "createdAt": created})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	cursor := ""
	if len(items) > limit {
		items = items[:limit]
		cursor = items[len(items)-1]["captureId"].(string)
	}
	rows.Close()
	var total int64
	if err = store.DB.QueryRowContext(ctx, "SELECT count(*) FROM captures WHERE project_id=?", projectID).Scan(&total); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "nextCursor": cursor, "total": strconv.FormatInt(total, 10)}, nil
}

func (store Store) Packet(ctx context.Context, projectID, captureID string, n int64) (map[string]any, error) {
	var timestampSec, timestampNano, capLen, origLen, iface, linkType int64
	var frame []byte
	var diagnostics, checksum string
	var src, dst sql.NullString
	var sport, dport, seq, ack, flags, po, pl sql.NullInt64
	err := store.DB.QueryRowContext(ctx, `SELECT p.timestamp_seconds,p.timestamp_nanoseconds,p.captured_length,p.original_length,p.interface_no,i.link_type,p.frame,p.diagnostics_json,p.checksum_status,p.src_ip,p.dst_ip,p.src_port,p.dst_port,p.tcp_seq,p.tcp_ack,p.tcp_flags,p.payload_offset,p.payload_length FROM packets p JOIN captures c ON c.id=p.capture_id JOIN capture_interfaces i ON i.capture_id=p.capture_id AND i.interface_no=p.interface_no WHERE c.project_id=?1 AND p.capture_id=?2 AND p.packet_no=?3`, projectID, captureID, n).Scan(&timestampSec, &timestampNano, &capLen, &origLen, &iface, &linkType, &frame, &diagnostics, &checksum, &src, &dst, &sport, &dport, &seq, &ack, &flags, &po, &pl)
	if err != nil {
		return nil, err
	}
	return map[string]any{"captureId": captureID, "packetNo": n, "interfaceNo": iface, "linkType": linkType, "timestamp": time.Unix(timestampSec, timestampNano).UTC().Format(time.RFC3339Nano), "timestampSeconds": timestampSec, "timestampNanoseconds": timestampNano, "capturedLength": capLen, "originalLength": origLen, "frame": frame, "sourceIp": src.String, "destinationIp": dst.String, "sourcePort": sport.Int64, "destinationPort": dport.Int64, "tcpSeq": seq.Int64, "tcpAck": ack.Int64, "tcpFlags": flags.Int64, "payloadOffset": po.Int64, "payloadLength": pl.Int64, "checksumStatus": checksum, "diagnostics": json.RawMessage(diagnostics)}, nil
}

func (store Store) Assemblies(ctx context.Context, projectID, captureID string) (map[string]any, error) {
	rows, err := store.DB.QueryContext(ctx, `SELECT a.id,a.settings_version,a.settings_json,a.engine_version,a.status,a.diagnostics_json,a.created_at,a.finished_at FROM assemblies a JOIN captures c ON c.id=a.capture_id WHERE c.project_id=?1 AND c.id=?2 ORDER BY a.created_at,a.id`, projectID, captureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, v, settings, engine, status, diagnostics, created string
		var finished sql.NullString
		if err := rows.Scan(&id, &v, &settings, &engine, &status, &diagnostics, &created, &finished); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"assemblyId": id, "settingsVersion": v, "settings": json.RawMessage(settings), "engineVersion": engine, "status": status, "diagnostics": json.RawMessage(diagnostics), "createdAt": created, "finishedAt": finished.String})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (store Store) Search(ctx context.Context, assemblyID, streamID string, pattern []byte, cursor int64, limit int) (map[string]any, error) {
	rows, err := store.DB.QueryContext(ctx, `SELECT start_offset,end_offset,kind,data FROM stream_intervals WHERE assembly_id=?1 AND stream_id=?2 ORDER BY start_offset`, assemblyID, streamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	matches := make([]int64, 0)
	var tail []byte
	var previousEnd int64 = -1
	more := false
	for rows.Next() {
		var start, end int64
		var kind string
		var data []byte
		if err = rows.Scan(&start, &end, &kind, &data); err != nil {
			return nil, err
		}
		if kind != "DATA" {
			tail = nil
			previousEnd = -1
			continue
		}
		if start != previousEnd {
			tail = nil
		}
		combined := make([]byte, 0, len(tail)+len(data))
		combined = append(combined, tail...)
		combined = append(combined, data...)
		base := start - int64(len(tail))
		for at := 0; at+len(pattern) <= len(combined); {
			index := bytes.Index(combined[at:], pattern)
			if index < 0 {
				break
			}
			match := base + int64(at+index)
			if match >= cursor && match+int64(len(pattern)) > start {
				if len(matches) == limit {
					more = true
					break
				}
				matches = append(matches, match)
			}
			at += index + 1
		}
		if more {
			break
		}
		keep := min(len(combined), len(pattern)-1)
		tail = append([]byte(nil), combined[len(combined)-keep:]...)
		previousEnd = end
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	next := ""
	if more {
		next = strconv.FormatInt(matches[len(matches)-1]+1, 10)
	}
	items := make([]map[string]any, 0, len(matches))
	for _, offset := range matches {
		items = append(items, map[string]any{"startOffset": offset, "endOffset": offset + int64(len(pattern))})
	}
	return map[string]any{"assemblyId": assemblyID, "streamId": streamID, "items": items, "nextCursor": next}, nil
}

func (store Store) StreamInfo(ctx context.Context, projectID string, assemblyID, streamID string) (int64, error) {
	var length int64
	err := store.DB.QueryRowContext(ctx, `SELECT s.logical_length FROM streams s JOIN assemblies a ON a.id=s.assembly_id WHERE a.project_id=?1 AND a.id=?2 AND a.status='READY' AND s.id=?3`, projectID, assemblyID, streamID).Scan(&length)
	return length, err
}

func (store Store) StreamIntervals(ctx context.Context, projectID string, assemblyID, streamID string, offset, length int64) ([]map[string]any, error) {
	if _, err := store.StreamInfo(ctx, projectID, assemblyID, streamID); err != nil {
		return nil, err
	}
	return store.StreamIntervalsUnchecked(ctx, assemblyID, streamID, offset, length)
}

func (store Store) StreamIntervalsUnchecked(ctx context.Context, assemblyID, streamID string, offset, length int64) ([]map[string]any, error) {
	rows, err := store.DB.QueryContext(ctx, `SELECT start_offset,end_offset,kind,data FROM stream_intervals WHERE assembly_id=?1 AND stream_id=?2 AND end_offset>?3 AND start_offset<?4 ORDER BY start_offset`, assemblyID, streamID, offset, offset+length)
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
		alts, err := store.DB.QueryContext(ctx, `SELECT data FROM interval_alternatives WHERE interval_id=(SELECT id FROM stream_intervals WHERE assembly_id=?1 AND stream_id=?2 AND start_offset=?3) ORDER BY id`, assemblyID, streamID, c.start)
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

func (store Store) SourceSpans(ctx context.Context, projectID string, assemblyID, streamID string, offset, length int64) ([]map[string]any, error) {
	if _, err := store.StreamInfo(ctx, projectID, assemblyID, streamID); err != nil {
		return nil, err
	}
	return store.SourceSpansUnchecked(ctx, assemblyID, streamID, offset, length)
}

func (store Store) SourceSpansUnchecked(ctx context.Context, assemblyID, streamID string, offset, length int64) ([]map[string]any, error) {
	rows, err := store.DB.QueryContext(ctx, `SELECT ss.packet_no,ss.frame_offset,ss.stream_offset,ss.byte_length,ss.alternative_id,p.timestamp_seconds,p.timestamp_nanoseconds FROM source_spans ss JOIN stream_intervals i ON i.id=ss.interval_id JOIN packets p ON p.capture_id=ss.capture_id AND p.packet_no=ss.packet_no WHERE i.assembly_id=?1 AND i.stream_id=?2 AND ss.stream_offset+ss.byte_length>?3 AND ss.stream_offset<?4 ORDER BY ss.stream_offset,ss.packet_no,ss.frame_offset`, assemblyID, streamID, offset, offset+length)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var packet, frame, start, n, seconds, nanos int64
		var alternative sql.NullString
		if err := rows.Scan(&packet, &frame, &start, &n, &alternative, &seconds, &nanos); err != nil {
			return nil, err
		}
		lo, hi := max(start, offset), min(start+n, offset+length)
		items = append(items, map[string]any{"packetNo": packet, "frameStart": frame + lo - start, "frameEnd": frame + hi - start, "streamStart": lo, "streamEnd": hi, "alternativeId": alternative.String, "timestamp": time.Unix(seconds, nanos).UTC().Format(time.RFC3339Nano)})
	}
	return items, rows.Err()
}

func (store Store) Sessions(ctx context.Context, projectID string, q map[string]string, limit int) (map[string]any, error) {
	args := []any{projectID, q["cursor"]}
	query := `SELECT s.id,s.assembly_id,s.capture_id,s.generation,s.endpoint_a_ip,s.endpoint_a_port,s.endpoint_b_ip,s.endpoint_b_port,s.first_packet_no,s.last_packet_no,s.diagnostics_json FROM sessions s JOIN assemblies a ON a.id=s.assembly_id WHERE a.project_id=?1 AND a.status='READY' AND s.id>?2`
	filters := []struct{ key, column string }{{"captureId", "s.capture_id"}, {"assemblyId", "s.assembly_id"}, {"streamId", ""}, {"ip", ""}, {"port", ""}, {"from", ""}, {"to", ""}}
	for _, f := range filters {
		v := q[f.key]
		if v == "" {
			continue
		}
		switch f.key {
		case "streamId":
			query += " AND EXISTS(SELECT 1 FROM streams st WHERE st.session_id=s.id AND st.assembly_id=s.assembly_id AND st.id=?" + strconv.Itoa(len(args)+1) + ")"
			args = append(args, v)
		case "ip":
			query += " AND (s.endpoint_a_ip=?" + strconv.Itoa(len(args)+1) + " OR s.endpoint_b_ip=?" + strconv.Itoa(len(args)+1) + ")"
			args = append(args, v)
		case "port":
			n, e := strconv.Atoi(v)
			if e != nil || n < 0 || n > 65535 {
				return nil, domain.RequestError("invalid port")
			}
			query += " AND (s.endpoint_a_port=?" + strconv.Itoa(len(args)+1) + " OR s.endpoint_b_port=?" + strconv.Itoa(len(args)+1) + ")"
			args = append(args, n)
		case "from", "to":
			_, e := strconv.ParseInt(v, 10, 64)
			if e != nil {
				return nil, domain.RequestError("invalid time filter")
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
	if q["defects"] == "true" {
		query += " AND (coalesce(json_array_length(s.diagnostics_json),0)>0 OR EXISTS(SELECT 1 FROM streams st WHERE st.session_id=s.id AND coalesce(json_array_length(st.diagnostics_json),0)>0))"
	}
	query += " ORDER BY s.id"
	if q["q"] == "" {
		query += " LIMIT ?" + strconv.Itoa(len(args)+1)
		args = append(args, limit+1)
	}
	rows, err := store.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, aid, cid, aip, bip, diagnostics string
		var gen, aport, bport, first, last int64
		if err := rows.Scan(&id, &aid, &cid, &gen, &aip, &aport, &bip, &bport, &first, &last, &diagnostics); err != nil {
			return nil, err
		}
		if q["q"] != "" && !strings.Contains(strings.ToLower(aip+" "+bip+" "+strconv.FormatInt(aport, 10)+" "+strconv.FormatInt(bport, 10)+" "+id), strings.ToLower(q["q"])) {
			continue
		}
		items = append(items, map[string]any{"sessionId": id, "assemblyId": aid, "captureId": cid, "generation": gen, "endpointA": map[string]any{"ip": aip, "port": aport}, "endpointB": map[string]any{"ip": bip, "port": bport}, "firstPacketNo": first, "lastPacketNo": last, "diagnostics": json.RawMessage(diagnostics)})
		if len(items) > limit {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	cursor := ""
	if len(items) > limit {
		items = items[:limit]
		cursor = items[len(items)-1]["sessionId"].(string)
	}
	return map[string]any{"items": items, "nextCursor": cursor}, nil
}

func (store Store) Session(ctx context.Context, projectID, aid, sessionID string) (map[string]any, error) {
	var cid, aip, bip, role, diagnostics string
	var gen, aport, bport, first, last int64
	err := store.DB.QueryRowContext(ctx, `SELECT s.capture_id,s.generation,s.endpoint_a_ip,s.endpoint_a_port,s.endpoint_b_ip,s.endpoint_b_port,s.role_status,s.first_packet_no,s.last_packet_no,s.diagnostics_json FROM sessions s JOIN assemblies a ON a.id=s.assembly_id WHERE a.project_id=?1 AND a.id=?2 AND a.status='READY' AND s.id=?3`, projectID, aid, sessionID).Scan(&cid, &gen, &aip, &aport, &bip, &bport, &role, &first, &last, &diagnostics)
	if err != nil {
		return nil, err
	}
	rows, err := store.DB.QueryContext(ctx, `SELECT id,direction,logical_length,known_bytes,known_start,diagnostics_json FROM streams WHERE assembly_id=?1 AND session_id=?2 ORDER BY direction`, aid, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	streams := make([]map[string]any, 0)
	for rows.Next() {
		var id, direction, diag string
		var length, known, start int64
		if err := rows.Scan(&id, &direction, &length, &known, &start, &diag); err != nil {
			return nil, err
		}
		streams = append(streams, map[string]any{"streamId": id, "direction": direction, "logicalLength": length, "knownBytes": known, "knownStart": start == 1, "diagnostics": json.RawMessage(diag)})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var fs, fn, ls, ln int64
	if err := store.DB.QueryRowContext(ctx, `SELECT timestamp_seconds,timestamp_nanoseconds FROM packets WHERE capture_id=?1 AND packet_no=?2`, cid, first).Scan(&fs, &fn); err != nil {
		return nil, err
	}
	if err := store.DB.QueryRowContext(ctx, `SELECT timestamp_seconds,timestamp_nanoseconds FROM packets WHERE capture_id=?1 AND packet_no=?2`, cid, last).Scan(&ls, &ln); err != nil {
		return nil, err
	}
	firstTime, lastTime := time.Unix(fs, fn).UTC().Format(time.RFC3339Nano), time.Unix(ls, ln).UTC().Format(time.RFC3339Nano)
	return map[string]any{"sessionId": sessionID, "assemblyId": aid, "captureId": cid, "generation": gen, "endpointA": map[string]any{"ip": aip, "port": aport}, "endpointB": map[string]any{"ip": bip, "port": bport}, "roleStatus": role, "firstPacketNo": first, "lastPacketNo": last, "firstSeen": firstTime, "lastSeen": lastTime, "streams": streams, "diagnostics": json.RawMessage(diagnostics)}, nil
}

func (store Store) CreateView(ctx context.Context, projectID string, ranges []domain.ViewRange) (map[string]any, error) {
	id := identifier.New("view")
	manifest, _ := json.Marshal(ranges)
	tx, err := store.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO assembly_views(id,project_id,manifest_json) VALUES(?1,?2,?3)`, id, projectID, string(manifest)); err != nil {
		return nil, err
	}
	for _, entry := range ranges {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO assembly_view_items(view_id,assembly_id,stream_id,start_offset,end_offset) VALUES(?1,?2,?3,?4,?5)`, id, entry.AssemblyID, entry.StreamID, entry.Offset, entry.Offset+entry.Length); err != nil {
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE assembly_views SET status='READY' WHERE id=?1`, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{"viewId": id, "projectId": projectID, "ranges": ranges, "dataUrl": "/internal/v1/assembly-views/" + id + "/data"}, nil
}

func (store Store) ViewManifest(ctx context.Context, id string) (string, error) {
	var manifest string
	err := store.DB.QueryRowContext(ctx, "SELECT manifest_json FROM assembly_views WHERE id=?1 AND status='READY'", id).Scan(&manifest)
	return manifest, err
}

func (store Store) ValidateEvidence(ctx context.Context, projectID string, entries []domain.EvidenceCheck) error {
	for _, e := range entries {
		if len(e.CaptureSHA256) != 64 || e.PacketNo < 1 || e.FrameOffset < 0 || e.ByteLength < 1 || e.FrameOffset > 1<<30 || e.ByteLength > 1<<20 || (e.AssemblyID == "") != (e.StreamID == "") || (e.AssemblyID == "") != (e.StreamOffset == nil) || e.StreamOffset != nil && (*e.StreamOffset < 0 || *e.StreamOffset > 1<<40-e.ByteLength) {
			return domain.EvidenceError("invalid source coordinates")
		}
		var captureID string
		var capturedLength int64
		err := store.DB.QueryRowContext(ctx, `SELECT c.id,p.captured_length FROM captures c JOIN packets p ON p.capture_id=c.id WHERE c.project_id=?1 AND c.sha256=?2 AND c.status='READY' AND p.packet_no=?3`, projectID, e.CaptureSHA256, e.PacketNo).Scan(&captureID, &capturedLength)
		if err == sql.ErrNoRows || err == nil && e.FrameOffset+e.ByteLength > capturedLength {
			return domain.EvidenceError("source packet or frame range was not found")
		}
		if err != nil {
			return err
		}
		if e.CaptureID != "" && e.CaptureID != captureID {
			return domain.EvidenceError("capture ID does not match source hash")
		}
		if e.AssemblyID != "" {
			var found int
			err = store.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM assemblies a JOIN streams s ON s.assembly_id=a.id JOIN stream_intervals i ON i.assembly_id=a.id AND i.stream_id=s.id JOIN source_spans ss ON ss.interval_id=i.id WHERE a.project_id=?1 AND a.status='READY' AND a.id=?2 AND s.id=?3 AND ss.capture_id=?4 AND ss.packet_no=?5 AND ss.frame_offset<=?6 AND ss.frame_offset+ss.byte_length>=?7 AND ss.stream_offset<=?8 AND ss.stream_offset+ss.byte_length>=?9 AND ss.frame_offset+(?8-ss.stream_offset)=?6 AND (?10='' OR s.session_id=?10) AND (?11='' OR s.direction=?11) AND (?12='' OR ss.alternative_id=?12)`, projectID, e.AssemblyID, e.StreamID, captureID, e.PacketNo, e.FrameOffset, e.FrameOffset+e.ByteLength, *e.StreamOffset, *e.StreamOffset+e.ByteLength, e.SessionID, e.Direction, e.AlternativeID).Scan(&found)
			if err != nil {
				return err
			}
			if found == 0 {
				return domain.EvidenceError("stream source range was not found")
			}
		}
	}

	return nil
}
