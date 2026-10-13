package captures

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/internal/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/internal/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/originals"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/reassembly"
)

const engineVersion = "capture-0.1"

type ProjectContext struct {
	ProjectID       string          `json:"projectId"`
	Status          string          `json:"status"`
	SettingsVersion string          `json:"settingsVersion"`
	Settings        json.RawMessage `json:"settings"`
}

func (s Store) Context(ctx context.Context, projectID, version string) (ProjectContext, error) {
	if s.WorkspaceURL == "" {
		return ProjectContext{}, errors.New("workspace URL is required")
	}
	u := strings.TrimRight(s.WorkspaceURL, "/") + "/internal/v1/projects/" + url.PathEscape(projectID) + "/context?settingsVersion=" + url.QueryEscape(version)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return ProjectContext{}, err
	}
	client := http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return ProjectContext{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		if resp.StatusCode == http.StatusNotFound {
			return ProjectContext{}, sql.ErrNoRows
		}
		return ProjectContext{}, fmt.Errorf("workspace context returned HTTP %d", resp.StatusCode)
	}
	var result ProjectContext
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return ProjectContext{}, err
	}
	if result.ProjectID != projectID || result.Status != "READY" || result.SettingsVersion == "" || len(result.Settings) == 0 {
		return ProjectContext{}, errors.New("project context is not ready")
	}
	return result, nil
}

func (s Store) ImportJob(ctx context.Context, j jobs.Job, progress func(string, int64, *int64) error) error {
	if j.ResourceID == nil {
		return errors.New("import job has no capture ID")
	}
	var payload struct {
		SettingsVersion string          `json:"settingsVersion"`
		Settings        json.RawMessage `json:"settings"`
	}
	if err := json.Unmarshal(j.Payload, &payload); err != nil {
		return err
	}
	if payload.SettingsVersion == "" || len(payload.Settings) == 0 {
		project, err := s.Context(ctx, j.ProjectID, "current")
		if err != nil {
			return err
		}
		payload.SettingsVersion, payload.Settings = project.SettingsVersion, project.Settings
	}
	c, err := s.Get(ctx, j.ProjectID, *j.ResourceID)
	if err != nil {
		return err
	}
	file, err := s.Files.Open(originals.Object{SHA256: c.SHA256, RelativePath: c.RelativePath, Size: c.Size, Format: c.Format})
	if err != nil {
		return err
	}
	path := file.Name()
	file.Close()
	if err := progress("READING", 0, nil); err != nil {
		return err
	}
	_, packets, err := reassembly.ReadCapture(path, 250000)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	total := int64(len(packets))
	if err := progress("INDEXING", 0, &total); err != nil {
		return err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := insertPackets(ctx, tx, c.ID, packets); err != nil {
		return err
	}
	assemblyID := identifier.New("assembly")
	if _, err := tx.ExecContext(ctx, "INSERT INTO assemblies(id,project_id,capture_id,settings_version,settings_json,engine_version,job_id) VALUES(?1,?2,?3,?4,?5,?6,?7)", assemblyID, j.ProjectID, c.ID, payload.SettingsVersion, string(payload.Settings), engineVersion, j.ID); err != nil {
		return err
	}
	sessions := reassembly.BuildSessions(c.ID, assemblyID, packets)
	if err := insertSessions(ctx, tx, assemblyID, c.ID, sessions, packets); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE captures SET packet_count=?2,status='READY' WHERE id=?1 AND status='IMPORTING'", c.ID, len(packets)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE assemblies SET status='READY',finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1", assemblyID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, "UPDATE jobs SET status='SUCCEEDED',stage='SUCCEEDED',progress_completed=?2,progress_total=?2,finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1 AND status='RUNNING' AND cancel_requested=FALSE", j.ID, total)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return jobs.ErrCancelled
	}
	return tx.Commit()
}

func insertPackets(ctx context.Context, tx *sql.Tx, captureID string, packets []reassembly.Packet) error {
	interfaces := map[int]int{}
	for _, p := range packets {
		if old, ok := interfaces[p.InterfaceNo]; ok && old != p.LinkType {
			return fmt.Errorf("interface %d changes link type", p.InterfaceNo)
		}
		interfaces[p.InterfaceNo] = p.LinkType
	}
	for interfaceNo, linkType := range interfaces {
		if _, err := tx.ExecContext(ctx, "INSERT INTO capture_interfaces(capture_id,interface_no,link_type,snaplen) VALUES(?1,?2,?3,65535)", captureID, interfaceNo, linkType); err != nil {
			return err
		}
	}
	for _, p := range packets {
		var srcIP, dstIP, srcPort, dstPort, seq, ack, flags, payloadOffset, payloadLength any
		if p.SourceIP != "" {
			srcIP, dstIP, srcPort, dstPort, seq, ack, flags, payloadOffset, payloadLength = p.SourceIP, p.DestinationIP, p.SourcePort, p.DestinationPort, p.Sequence, p.Acknowledgment, p.Flags, p.PayloadStart, p.PayloadLength
		}
		diagnostics := []string{}
		if p.Diagnostic != "" {
			diagnostics = append(diagnostics, p.Diagnostic)
		}
		diagnosticJSON, _ := json.Marshal(diagnostics)
		_, err := tx.ExecContext(ctx, `INSERT INTO packets(capture_id,packet_no,interface_no,timestamp_seconds,timestamp_nanoseconds,captured_length,original_length,frame,src_ip,dst_ip,src_port,dst_port,tcp_seq,tcp_ack,tcp_flags,payload_offset,payload_length,diagnostics_json)
		VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`, captureID, p.Number, p.InterfaceNo, p.Time.Unix(), p.Time.Nanosecond(), p.CapturedLength, p.OriginalLength, p.Frame, srcIP, dstIP, srcPort, dstPort, seq, ack, flags, payloadOffset, payloadLength, string(diagnosticJSON))
		if err != nil {
			return fmt.Errorf("packet %d: %w", p.Number, err)
		}
	}
	return nil
}

func insertSessions(ctx context.Context, tx *sql.Tx, assemblyID, captureID string, sessions []reassembly.Session, packets []reassembly.Packet) error {
	for _, session := range sessions {
		role := "UNKNOWN"
		if session.Initiator != "" {
			role = "KNOWN"
		}
		diagnostics, _ := json.Marshal(session.Diagnostics)
		a, b := fmt.Sprintf("%s:%d", session.A.IP, session.A.Port), fmt.Sprintf("%s:%d", session.B.IP, session.B.Port)
		if a > b {
			a, b = b, a
		}
		key := a + "|" + b
		_, err := tx.ExecContext(ctx, "INSERT INTO sessions(id,assembly_id,capture_id,connection_key,generation,endpoint_a_ip,endpoint_a_port,endpoint_b_ip,endpoint_b_port,role_status,first_packet_no,last_packet_no,diagnostics_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)", session.ID, assemblyID, captureID, key, session.Generation, session.A.IP, session.A.Port, session.B.IP, session.B.Port, role, session.FirstPacketNo, session.LastPacketNo, string(diagnostics))
		if err != nil {
			return fmt.Errorf("session %s: %w", session.ID, err)
		}
		for _, stream := range session.Streams {
			knownBytes := uint64(0)
			for _, iv := range stream.Intervals {
				if iv.Kind == "KNOWN" {
					knownBytes += iv.End - iv.Start
				}
			}
			var initialSeq any
			if stream.InitialSeq != nil {
				initialSeq = *stream.InitialSeq
			}
			streamDiagnostics, _ := json.Marshal(stream.Diagnostic)
			_, err := tx.ExecContext(ctx, "INSERT INTO streams(id,assembly_id,session_id,direction,initial_seq,known_start,logical_length,known_bytes,diagnostics_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)", stream.ID, assemblyID, session.ID, stream.Direction, initialSeq, stream.KnownStart, stream.Length, knownBytes, string(streamDiagnostics))
			if err != nil {
				return fmt.Errorf("stream %s: %w", stream.ID, err)
			}
			for _, iv := range stream.Intervals {
				id := identifier.New("interval")
				kind := iv.Kind
				if kind == "KNOWN" {
					kind = "DATA"
				}
				var data any
				if kind == "DATA" {
					data = iv.Data
				}
				_, err := tx.ExecContext(ctx, "INSERT INTO stream_intervals(id,assembly_id,stream_id,start_offset,end_offset,kind,data) VALUES(?1,?2,?3,?4,?5,?6,?7)", id, assemblyID, stream.ID, iv.Start, iv.End, kind, data)
				if err != nil {
					return fmt.Errorf("interval %s: %w", id, err)
				}
				alternatives := map[string]string{}
				for _, source := range iv.Sources {
					var altID any
					if kind == "CONFLICT" {
						if source.PacketNo < 1 || source.PacketNo > len(packets) {
							return errors.New("source packet out of range")
						}
						part := packets[source.PacketNo-1].Frame[source.FrameStart:source.FrameEnd]
						key := hex.EncodeToString(part)
						alt := alternatives[key]
						if alt == "" {
							alt = identifier.New("alternative")
							if _, err := tx.ExecContext(ctx, "INSERT INTO interval_alternatives(id,interval_id,data) VALUES(?1,?2,?3)", alt, id, part); err != nil {
								return err
							}
							alternatives[key] = alt
						}
						altID = alt
					}
					_, err := tx.ExecContext(ctx, "INSERT INTO source_spans(id,interval_id,alternative_id,stream_offset,byte_length,capture_id,packet_no,frame_offset) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)", identifier.New("source"), id, altID, source.StreamStart, source.StreamEnd-source.StreamStart, captureID, source.PacketNo, source.FrameStart)
					if err != nil {
						return fmt.Errorf("source packet %d: %w", source.PacketNo, err)
					}
				}
			}
		}
	}
	return nil
}

func (s Store) AssembleJob(ctx context.Context, j jobs.Job, progress func(string, int64, *int64) error) error {
	if j.ResourceID == nil {
		return errors.New("assembly job has no resource ID")
	}
	var captureID string
	if err := s.DB.QueryRowContext(ctx, "SELECT capture_id FROM assemblies WHERE id=?1 AND project_id=?2 AND status='BUILDING'", *j.ResourceID, j.ProjectID).Scan(&captureID); err != nil {
		return err
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT packet_no,interface_no,timestamp_seconds,timestamp_nanoseconds,captured_length,original_length,frame,src_ip,dst_ip,src_port,dst_port,tcp_seq,tcp_ack,tcp_flags,payload_offset,payload_length FROM packets WHERE capture_id=?1 ORDER BY packet_no", captureID)
	if err != nil {
		return err
	}
	packets := []reassembly.Packet{}
	for rows.Next() {
		var p reassembly.Packet
		var seconds int64
		var nanos int
		var srcIP, dstIP sql.NullString
		var srcPort, dstPort, seq, ack, flags, payloadOffset, payloadLength sql.NullInt64
		if err := rows.Scan(&p.Number, &p.InterfaceNo, &seconds, &nanos, &p.CapturedLength, &p.OriginalLength, &p.Frame, &srcIP, &dstIP, &srcPort, &dstPort, &seq, &ack, &flags, &payloadOffset, &payloadLength); err != nil {
			rows.Close()
			return err
		}
		p.Time = time.Unix(seconds, int64(nanos)).UTC()
		if srcIP.Valid {
			p.SourceIP = srcIP.String
			p.DestinationIP = dstIP.String
			p.SourcePort = uint16(srcPort.Int64)
			p.DestinationPort = uint16(dstPort.Int64)
			p.Sequence = uint32(seq.Int64)
			p.Acknowledgment = uint32(ack.Int64)
			p.Flags = uint8(flags.Int64)
			p.PayloadStart = int(payloadOffset.Int64)
			p.PayloadLength = int(payloadLength.Int64)
		}
		packets = append(packets, p)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if err := progress("ASSEMBLING", 0, nil); err != nil {
		return err
	}
	sessions := reassembly.BuildSessions(captureID, *j.ResourceID, packets)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := insertSessions(ctx, tx, *j.ResourceID, captureID, sessions, packets); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE assemblies SET status='READY',finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1", *j.ResourceID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, "UPDATE jobs SET status='SUCCEEDED',stage='SUCCEEDED',finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?1 AND status='RUNNING' AND cancel_requested=FALSE", j.ID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return jobs.ErrCancelled
	}
	return tx.Commit()
}
