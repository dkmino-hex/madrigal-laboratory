package storage

import (
	"context"
	"database/sql"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

type EvidenceInput = domain.EvidenceInput

type ObservationInput = domain.ObservationInput

type ObservationPatch = domain.ObservationPatch

func (s Store) PersistObservation(ctx context.Context, projectID string, in ObservationInput) (map[string]any, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var projectStatus string
	if err = tx.QueryRowContext(ctx, "SELECT status FROM projects WHERE id=?1", projectID).Scan(&projectStatus); err != nil {
		return nil, err
	}
	if projectStatus != "READY" {
		return nil, ErrProjectNotReady
	}
	var exists int
	var action any
	if in.ActionID != "" {
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM actions WHERE project_id=?1 AND id=?2", projectID, in.ActionID).Scan(&exists); err != nil {
			return nil, err
		}
		if exists == 0 {
			return nil, ErrInvalid
		}
		action = in.ActionID
	}
	id := identifier.New("obs")
	_, err = tx.ExecContext(ctx, "INSERT INTO observations(id,project_id,kind,text,status,action_id) VALUES(?1,?2,?3,?4,?5,?6)", id, projectID, in.Kind, strings.TrimSpace(in.Text), in.Status, action)
	if err != nil {
		return nil, err
	}
	for _, e := range in.Evidence {
		var aid, sid, off any
		if e.AssemblyID != "" {
			aid, sid, off = e.AssemblyID, e.StreamID, *e.StreamOffset
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO evidence(id,project_id,observation_id,kind,capture_sha256,packet_no,frame_offset,byte_length,assembly_id,stream_id,stream_offset) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)", identifier.New("ev"), projectID, id, e.Kind, e.CaptureSHA256, e.PacketNo, e.FrameOffset, e.ByteLength, aid, sid, off)
		if err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return s.Observation(ctx, projectID, id)
}

func (s Store) Observation(ctx context.Context, projectID, id string) (map[string]any, error) {
	var kind, text, status, created, updated string
	var action sql.NullString
	err := s.DB.QueryRowContext(ctx, "SELECT kind,text,status,action_id,created_at,updated_at FROM observations WHERE project_id=?1 AND id=?2", projectID, id).Scan(&kind, &text, &status, &action, &created, &updated)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT id,kind,capture_sha256,packet_no,frame_offset,byte_length,assembly_id,stream_id,stream_offset,selected FROM evidence WHERE observation_id=?1 ORDER BY id", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	evidence := make([]map[string]any, 0)
	for rows.Next() {
		var eid, kind, hash string
		var aid, sid sql.NullString
		var off sql.NullInt64
		var packet, frame, n int64
		var selected bool
		if err := rows.Scan(&eid, &kind, &hash, &packet, &frame, &n, &aid, &sid, &off, &selected); err != nil {
			return nil, err
		}
		item := map[string]any{"evidenceId": eid, "kind": kind, "captureSha256": hash, "packetNo": packet, "frameOffset": frame, "byteLength": n, "selected": selected}
		if aid.Valid {
			item["assemblyId"] = aid.String
			item["streamId"] = sid.String
			item["streamOffset"] = off.Int64
		}
		evidence = append(evidence, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"observationId": id, "kind": kind, "text": text, "status": status, "actionId": action.String, "evidence": evidence, "createdAt": created, "updatedAt": updated}, nil
}

func (s Store) Observations(ctx context.Context, projectID, cursor, kind, status, source string, limit int) (map[string]any, error) {
	if limit < 1 || limit > 100 || kind != "" && !domain.ValidObservationKind(kind) || status != "" && !domain.ValidObservationStatus(status) {
		return nil, ErrInvalid
	}
	project, err := s.Get(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if project.Status != "READY" {
		return nil, ErrProjectNotReady
	}
	query := `SELECT id FROM observations o WHERE o.project_id=?1 AND o.id>?2 AND (?3='' OR o.kind=?3) AND (?4='' OR o.status=?4) AND (?5='' OR EXISTS(SELECT 1 FROM evidence e WHERE e.observation_id=o.id AND e.capture_sha256=?5)) ORDER BY o.id LIMIT ?6`
	rows, err := s.DB.QueryContext(ctx, query, projectID, cursor, kind, status, source, limit+1)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	next := ""
	if len(ids) > limit {
		ids = ids[:limit]
		next = ids[len(ids)-1]
	}
	items := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		item, e := s.Observation(ctx, projectID, id)
		if e != nil {
			return nil, e
		}
		items = append(items, item)
	}
	return map[string]any{"items": items, "nextCursor": next}, nil
}

func (s Store) PatchObservation(ctx context.Context, projectID, id string, in ObservationPatch) (map[string]any, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var projectStatus string
	if err = tx.QueryRowContext(ctx, "SELECT status FROM projects WHERE id=?1", projectID).Scan(&projectStatus); err != nil {
		return nil, err
	}
	if projectStatus != "READY" {
		return nil, ErrProjectNotReady
	}
	var exists int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM observations WHERE project_id=?1 AND id=?2", projectID, id).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return nil, sql.ErrNoRows
	}
	if in.SelectedEvidenceIDs != nil {
		seen := map[string]bool{}
		for _, eid := range *in.SelectedEvidenceIDs {
			if seen[eid] {
				return nil, ErrInvalid
			}
			seen[eid] = true
			if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM evidence WHERE project_id=?1 AND observation_id=?2 AND id=?3", projectID, id, eid).Scan(&exists); err != nil {
				return nil, err
			}
			if exists == 0 {
				return nil, ErrInvalid
			}
		}
		if _, err = tx.ExecContext(ctx, "UPDATE evidence SET selected=0 WHERE observation_id=?1", id); err != nil {
			return nil, err
		}
		for eid := range seen {
			if _, err = tx.ExecContext(ctx, "UPDATE evidence SET selected=1 WHERE observation_id=?1 AND id=?2", id, eid); err != nil {
				return nil, err
			}
		}
	}
	var textValue, statusValue any
	if in.Text != nil {
		textValue = strings.TrimSpace(*in.Text)
	}
	if in.Status != nil {
		statusValue = *in.Status
	}
	_, err = tx.ExecContext(ctx, "UPDATE observations SET text=coalesce(?3,text),status=coalesce(?4,status),updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE project_id=?1 AND id=?2", projectID, id, textValue, statusValue)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return s.Observation(ctx, projectID, id)
}

var ErrSourceUnavailable = domain.ErrSourceUnavailable
