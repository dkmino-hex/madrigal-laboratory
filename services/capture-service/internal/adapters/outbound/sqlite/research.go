package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

func (s Store) ResearchData(ctx context.Context, project, captureID, assemblyID string, budget int64) (domain.ResearchData, error) {
	result := domain.ResearchData{Complete: true, Streams: []domain.ResearchStream{}}
	if budget < 1 || budget > 1<<20 {
		return result, fmt.Errorf("invalid research byte budget")
	}
	query := `SELECT c.id,c.original_name,c.sha256,a.id,a.settings_version,a.engine_version FROM captures c JOIN assemblies a ON a.capture_id=c.id WHERE c.project_id=? AND c.id=? AND c.status='READY' AND a.status='READY'`
	args := []any{project, captureID}
	if assemblyID != "" {
		query += " AND a.id=?"
		args = append(args, assemblyID)
	}
	query += " ORDER BY a.created_at DESC,a.id DESC LIMIT 1"
	err := s.DB.QueryRowContext(ctx, query, args...).Scan(&result.CaptureID, &result.CaptureName, &result.SHA256, &result.AssemblyID, &result.SettingsVersion, &result.EngineVersion)
	if err != nil {
		return result, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT s.id,s.session_id,s.direction,s.logical_length,s.diagnostics_json,se.endpoint_a_ip,se.endpoint_a_port,se.endpoint_b_ip,se.endpoint_b_port FROM streams s JOIN sessions se ON se.id=s.session_id WHERE s.assembly_id=? AND s.logical_length>0 ORDER BY se.first_packet_no,s.direction LIMIT 65`, result.AssemblyID)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var stream domain.ResearchStream
		var diagnostics, a, b string
		var ap, bp int
		if err = rows.Scan(&stream.StreamID, &stream.SessionID, &stream.Direction, &stream.LogicalLength, &diagnostics, &a, &ap, &b, &bp); err != nil {
			rows.Close()
			return result, err
		}
		stream.Diagnostics = []byte(diagnostics)
		stream.EndpointA, stream.EndpointB = fmt.Sprintf("%s:%d", a, ap), fmt.Sprintf("%s:%d", b, bp)
		result.Streams = append(result.Streams, stream)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	if len(result.Streams) > 64 {
		result.Streams = result.Streams[:64]
		result.Complete = false
	}
	kept := result.Streams[:0]
	sourceBudget := 4096
	for _, stream := range result.Streams {
		if budget == 0 || sourceBudget == 0 {
			result.Complete = false
			break
		}
		stream.SampleLength = min(stream.LogicalLength, min(budget, 128<<10))
		if stream.SampleLength < stream.LogicalLength {
			result.Complete = false
		}
		budget -= stream.SampleLength
		stream.Intervals, err = s.StreamIntervalsUnchecked(ctx, result.AssemblyID, stream.StreamID, 0, stream.SampleLength)
		if err != nil {
			return result, err
		}
		stream.Sources = []domain.ResearchSource{}
		sources, e := s.DB.QueryContext(ctx, `SELECT ss.packet_no,ss.frame_offset,ss.stream_offset,ss.byte_length,p.timestamp_seconds,p.timestamp_nanoseconds FROM source_spans ss JOIN stream_intervals i ON i.id=ss.interval_id JOIN packets p ON p.capture_id=ss.capture_id AND p.packet_no=ss.packet_no WHERE i.assembly_id=? AND i.stream_id=? AND i.kind='DATA' AND ss.alternative_id IS NULL AND ss.stream_offset<? ORDER BY ss.stream_offset,ss.packet_no LIMIT ?`, result.AssemblyID, stream.StreamID, stream.SampleLength, sourceBudget+1)
		if e != nil {
			return result, e
		}
		for sources.Next() {
			var source domain.ResearchSource
			var length, seconds, nanos int64
			if e = sources.Scan(&source.PacketNo, &source.FrameStart, &source.StreamStart, &length, &seconds, &nanos); e != nil {
				break
			}
			length = min(length, stream.SampleLength-source.StreamStart)
			source.FrameEnd, source.StreamEnd = source.FrameStart+length, source.StreamStart+length
			source.Timestamp = time.Unix(seconds, nanos).UTC().Format(time.RFC3339Nano)
			stream.Sources = append(stream.Sources, source)
		}
		if e == nil {
			e = sources.Err()
		}
		sources.Close()
		if e != nil {
			return result, e
		}
		if len(stream.Sources) > sourceBudget {
			stream.Sources = stream.Sources[:sourceBudget]
			result.Complete = false
		}
		sourceBudget -= len(stream.Sources)
		kept = append(kept, stream)
	}
	result.Streams = kept
	return result, nil
}

func (s Store) StreamReadContext(ctx context.Context, assembly, stream string) (map[string]any, error) {
	var id, name, direction string
	err := s.DB.QueryRowContext(ctx, `SELECT c.id,c.original_name,s.direction FROM streams s JOIN assemblies a ON a.id=s.assembly_id JOIN captures c ON c.id=a.capture_id WHERE s.id=? AND a.id=? AND a.status='READY'`, stream, assembly).Scan(&id, &name, &direction)
	if err != nil {
		return nil, err
	}
	return map[string]any{"captureId": id, "captureName": name, "direction": direction}, nil
}
