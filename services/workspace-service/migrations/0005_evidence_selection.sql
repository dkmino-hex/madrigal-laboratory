ALTER TABLE evidence ADD COLUMN selected INTEGER NOT NULL DEFAULT 1 CHECK (selected IN (0,1));
CREATE TRIGGER evidence_source_no_update BEFORE UPDATE OF project_id,observation_id,kind,capture_sha256,packet_no,frame_offset,byte_length,assembly_id,stream_id,stream_offset ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence source is immutable'); END;
