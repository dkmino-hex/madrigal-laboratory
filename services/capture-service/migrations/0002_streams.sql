CREATE TABLE assemblies (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    capture_id TEXT NOT NULL,
    settings_version TEXT NOT NULL,
    settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
    engine_version TEXT NOT NULL,
    job_id TEXT,
    status TEXT NOT NULL DEFAULT 'BUILDING' CHECK (status IN ('BUILDING','READY','FAILED','CANCELLED')),
    diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at TEXT,
    UNIQUE (id, capture_id),
    UNIQUE (project_id, id),
    FOREIGN KEY (project_id, capture_id) REFERENCES captures(project_id, id),
    FOREIGN KEY (project_id, job_id) REFERENCES jobs(project_id, id),
    CHECK (status = 'BUILDING' OR finished_at IS NOT NULL)
) STRICT;
CREATE INDEX idx_assemblies_capture ON assemblies(capture_id, created_at);
CREATE TRIGGER assemblies_inputs_no_update
BEFORE UPDATE OF id, project_id, capture_id, settings_version, settings_json, engine_version ON assemblies
BEGIN SELECT RAISE(ABORT, 'assembly inputs are immutable'); END;
CREATE TRIGGER assemblies_terminal_no_update BEFORE UPDATE ON assemblies WHEN OLD.status != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'finished assemblies are immutable'); END;
CREATE TRIGGER assemblies_terminal_no_delete BEFORE DELETE ON assemblies WHEN OLD.status != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'finished assemblies are immutable'); END;

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    assembly_id TEXT NOT NULL,
    capture_id TEXT NOT NULL,
    connection_key TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    endpoint_a_ip TEXT NOT NULL,
    endpoint_a_port INTEGER NOT NULL CHECK (endpoint_a_port BETWEEN 0 AND 65535),
    endpoint_b_ip TEXT NOT NULL,
    endpoint_b_port INTEGER NOT NULL CHECK (endpoint_b_port BETWEEN 0 AND 65535),
    role_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (role_status IN ('KNOWN','UNKNOWN','AMBIGUOUS')),
    first_packet_no INTEGER NOT NULL,
    last_packet_no INTEGER NOT NULL CHECK (last_packet_no >= first_packet_no),
    diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics_json)),
    UNIQUE (assembly_id, id),
    UNIQUE (assembly_id, connection_key, generation),
    FOREIGN KEY (assembly_id, capture_id) REFERENCES assemblies(id, capture_id),
    FOREIGN KEY (capture_id, first_packet_no) REFERENCES packets(capture_id, packet_no),
    FOREIGN KEY (capture_id, last_packet_no) REFERENCES packets(capture_id, packet_no)
) STRICT;

CREATE TABLE streams (
    id TEXT PRIMARY KEY,
    assembly_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('A_TO_B','B_TO_A')),
    initial_seq INTEGER CHECK (initial_seq IS NULL OR initial_seq BETWEEN 0 AND 4294967295),
    known_start INTEGER NOT NULL DEFAULT 0 CHECK (known_start IN (0,1)),
    logical_length INTEGER NOT NULL CHECK (logical_length >= 0),
    known_bytes INTEGER NOT NULL CHECK (known_bytes BETWEEN 0 AND logical_length),
    diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics_json)),
    UNIQUE (assembly_id, id),
    UNIQUE (session_id, direction),
    FOREIGN KEY (assembly_id, session_id) REFERENCES sessions(assembly_id, id)
) STRICT;

CREATE TABLE stream_intervals (
    id TEXT PRIMARY KEY,
    assembly_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
    end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
    kind TEXT NOT NULL CHECK (kind IN ('DATA','GAP','CONFLICT')),
    data BLOB,
    UNIQUE (stream_id, start_offset),
    FOREIGN KEY (assembly_id, stream_id) REFERENCES streams(assembly_id, id),
    CHECK ((kind = 'DATA' AND data IS NOT NULL AND length(data) = end_offset - start_offset)
        OR (kind IN ('GAP','CONFLICT') AND data IS NULL))
) STRICT;
CREATE INDEX idx_intervals_range ON stream_intervals(stream_id, start_offset, end_offset);
CREATE TRIGGER intervals_check_insert BEFORE INSERT ON stream_intervals
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM streams s WHERE s.id = NEW.stream_id AND s.assembly_id = NEW.assembly_id
        AND NEW.end_offset <= s.logical_length
    ) THEN RAISE(ABORT, 'interval is outside the stream') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM stream_intervals i WHERE i.stream_id = NEW.stream_id
        AND i.start_offset < NEW.end_offset AND NEW.start_offset < i.end_offset
    ) THEN RAISE(ABORT, 'stream intervals overlap') END;
END;

CREATE TABLE interval_alternatives (
    id TEXT PRIMARY KEY,
    interval_id TEXT NOT NULL REFERENCES stream_intervals(id),
    data BLOB NOT NULL,
    UNIQUE (interval_id, id)
) STRICT;
CREATE TRIGGER alternatives_check_insert BEFORE INSERT ON interval_alternatives
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM stream_intervals i WHERE i.id = NEW.interval_id
        AND i.kind = 'CONFLICT' AND length(NEW.data) = i.end_offset - i.start_offset
    ) THEN RAISE(ABORT, 'alternative requires a conflict interval of the same length') END;
END;

CREATE TABLE source_spans (
    id TEXT PRIMARY KEY,
    interval_id TEXT NOT NULL REFERENCES stream_intervals(id),
    alternative_id TEXT,
    stream_offset INTEGER NOT NULL CHECK (stream_offset >= 0),
    byte_length INTEGER NOT NULL CHECK (byte_length > 0),
    capture_id TEXT NOT NULL,
    packet_no INTEGER NOT NULL CHECK (packet_no >= 1),
    frame_offset INTEGER NOT NULL CHECK (frame_offset >= 0),
    FOREIGN KEY (capture_id, packet_no) REFERENCES packets(capture_id, packet_no),
    FOREIGN KEY (interval_id, alternative_id) REFERENCES interval_alternatives(interval_id, id)
) STRICT;
CREATE INDEX idx_sources_interval ON source_spans(interval_id, stream_offset);
CREATE UNIQUE INDEX idx_sources_identity ON source_spans(
    interval_id, ifnull(alternative_id,''), stream_offset, byte_length, capture_id, packet_no, frame_offset
);
CREATE TRIGGER source_spans_check_insert BEFORE INSERT ON source_spans
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM stream_intervals i
        JOIN assemblies a ON a.id = i.assembly_id
        JOIN packets p ON p.capture_id = a.capture_id AND p.packet_no = NEW.packet_no
        LEFT JOIN interval_alternatives alt ON alt.interval_id = i.id AND alt.id = NEW.alternative_id
        WHERE i.id = NEW.interval_id AND NEW.capture_id = a.capture_id
        AND NEW.stream_offset >= i.start_offset
        AND NEW.stream_offset + NEW.byte_length <= i.end_offset
        AND p.payload_offset IS NOT NULL
        AND NEW.frame_offset >= p.payload_offset
        AND NEW.frame_offset + NEW.byte_length <= p.payload_offset + p.payload_length
        AND (
            (i.kind = 'DATA' AND NEW.alternative_id IS NULL
                AND substr(i.data, NEW.stream_offset - i.start_offset + 1, NEW.byte_length)
                    = substr(p.frame, NEW.frame_offset + 1, NEW.byte_length))
            OR
            (i.kind = 'CONFLICT' AND alt.id IS NOT NULL
                AND substr(alt.data, NEW.stream_offset - i.start_offset + 1, NEW.byte_length)
                    = substr(p.frame, NEW.frame_offset + 1, NEW.byte_length))
        )
    ) THEN RAISE(ABORT, 'source must match bytes in the assembly and captured TCP payload') END;
END;

CREATE TRIGGER sessions_building_insert BEFORE INSERT ON sessions
WHEN (SELECT status FROM assemblies WHERE id=NEW.assembly_id) != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'cannot add data to a finished assembly'); END;
CREATE TRIGGER sessions_no_update BEFORE UPDATE ON sessions
BEGIN SELECT RAISE(ABORT, 'assembly data is append-only'); END;
CREATE TRIGGER sessions_building_delete BEFORE DELETE ON sessions
WHEN (SELECT status FROM assemblies WHERE id=OLD.assembly_id) != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'cannot remove data from a finished assembly'); END;

CREATE TRIGGER streams_building_insert BEFORE INSERT ON streams
WHEN (SELECT status FROM assemblies WHERE id=NEW.assembly_id) != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'cannot add data to a finished assembly'); END;
CREATE TRIGGER streams_no_update BEFORE UPDATE ON streams
BEGIN SELECT RAISE(ABORT, 'assembly data is append-only'); END;
CREATE TRIGGER streams_building_delete BEFORE DELETE ON streams
WHEN (SELECT status FROM assemblies WHERE id=OLD.assembly_id) != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'cannot remove data from a finished assembly'); END;

CREATE TRIGGER stream_intervals_building_insert BEFORE INSERT ON stream_intervals
WHEN (SELECT status FROM assemblies WHERE id=NEW.assembly_id) != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'cannot add data to a finished assembly'); END;
CREATE TRIGGER stream_intervals_no_update BEFORE UPDATE ON stream_intervals
BEGIN SELECT RAISE(ABORT, 'assembly data is append-only'); END;
CREATE TRIGGER stream_intervals_building_delete BEFORE DELETE ON stream_intervals
WHEN (SELECT status FROM assemblies WHERE id=OLD.assembly_id) != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'cannot remove data from a finished assembly'); END;

CREATE TRIGGER interval_alternatives_building_insert BEFORE INSERT ON interval_alternatives
WHEN (SELECT status FROM assemblies WHERE id=(SELECT assembly_id FROM stream_intervals WHERE id=NEW.interval_id)) != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'cannot add data to a finished assembly'); END;
CREATE TRIGGER interval_alternatives_no_update BEFORE UPDATE ON interval_alternatives
BEGIN SELECT RAISE(ABORT, 'assembly data is append-only'); END;
CREATE TRIGGER interval_alternatives_building_delete BEFORE DELETE ON interval_alternatives
WHEN (SELECT status FROM assemblies WHERE id=(SELECT assembly_id FROM stream_intervals WHERE id=OLD.interval_id)) != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'cannot remove data from a finished assembly'); END;

CREATE TRIGGER source_spans_building_insert BEFORE INSERT ON source_spans
WHEN (SELECT status FROM assemblies WHERE id=(SELECT assembly_id FROM stream_intervals WHERE id=NEW.interval_id)) != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'cannot add data to a finished assembly'); END;
CREATE TRIGGER source_spans_no_update BEFORE UPDATE ON source_spans
BEGIN SELECT RAISE(ABORT, 'assembly data is append-only'); END;
CREATE TRIGGER source_spans_building_delete BEFORE DELETE ON source_spans
WHEN (SELECT status FROM assemblies WHERE id=(SELECT assembly_id FROM stream_intervals WHERE id=OLD.interval_id)) != 'BUILDING'
BEGIN SELECT RAISE(ABORT, 'cannot remove data from a finished assembly'); END;
