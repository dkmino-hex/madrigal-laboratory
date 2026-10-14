CREATE TABLE jobs (
    id TEXT PRIMARY KEY CHECK (id GLOB 'cap_*'),
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (length(kind) > 0),
    resource_id TEXT,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
    payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
    error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
    progress_completed INTEGER NOT NULL DEFAULT 0 CHECK (progress_completed >= 0),
    progress_total INTEGER CHECK (progress_total IS NULL OR progress_total >= progress_completed),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at TEXT,
    finished_at TEXT,
    UNIQUE (project_id, id),
    CHECK (status NOT IN ('SUCCEEDED','FAILED','CANCELLED') OR finished_at IS NOT NULL),
    CHECK (status != 'FAILED' OR error_json IS NOT NULL)
) STRICT;
CREATE INDEX idx_jobs_queue ON jobs(status, created_at);
CREATE INDEX idx_jobs_project ON jobs(project_id, created_at);

CREATE TABLE idempotency_keys (
    scope TEXT NOT NULL,
    key TEXT NOT NULL CHECK (length(key) > 0),
    request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
    response_status INTEGER NOT NULL CHECK (response_status BETWEEN 100 AND 599),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    resource_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT NOT NULL,
    PRIMARY KEY (scope, key)
) STRICT;
CREATE INDEX idx_idempotency_expiry ON idempotency_keys(expires_at);

CREATE TABLE captures (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    original_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    format TEXT NOT NULL CHECK (format IN ('PCAP','PCAPNG')),
    status TEXT NOT NULL DEFAULT 'IMPORTING' CHECK (status IN ('IMPORTING','READY','ERROR','CANCELLED')),
    packet_count INTEGER NOT NULL DEFAULT 0 CHECK (packet_count >= 0),
    diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (project_id, sha256),
    UNIQUE (project_id, id)
) STRICT;
CREATE INDEX idx_captures_project ON captures(project_id, created_at, id);
CREATE TRIGGER captures_original_no_update
BEFORE UPDATE OF id, project_id, sha256, relative_path, size_bytes, format ON captures
BEGIN SELECT RAISE(ABORT, 'capture originals are immutable'); END;

CREATE TABLE capture_interfaces (
    capture_id TEXT NOT NULL REFERENCES captures(id),
    interface_no INTEGER NOT NULL CHECK (interface_no >= 0),
    link_type INTEGER NOT NULL CHECK (link_type >= 0),
    snaplen INTEGER NOT NULL CHECK (snaplen >= 0),
    timestamp_base INTEGER NOT NULL DEFAULT 10 CHECK (timestamp_base IN (2,10)),
    timestamp_exponent INTEGER NOT NULL DEFAULT 6 CHECK (timestamp_exponent BETWEEN 0 AND 127),
    timestamp_offset_seconds INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    PRIMARY KEY (capture_id, interface_no)
) STRICT;

CREATE TABLE packets (
    capture_id TEXT NOT NULL,
    packet_no INTEGER NOT NULL CHECK (packet_no >= 1),
    interface_no INTEGER NOT NULL DEFAULT 0,
    timestamp_seconds INTEGER NOT NULL,
    timestamp_nanoseconds INTEGER NOT NULL CHECK (timestamp_nanoseconds BETWEEN 0 AND 999999999),
    raw_timestamp_ticks TEXT CHECK (raw_timestamp_ticks IS NULL OR
        (length(raw_timestamp_ticks) BETWEEN 1 AND 20 AND raw_timestamp_ticks NOT GLOB '*[^0-9]*' AND
         (length(raw_timestamp_ticks) < 20 OR raw_timestamp_ticks <= '18446744073709551615'))),
    captured_length INTEGER NOT NULL CHECK (captured_length >= 0),
    original_length INTEGER NOT NULL CHECK (original_length >= captured_length),
    frame BLOB NOT NULL CHECK (length(frame) = captured_length),
    src_ip TEXT,
    dst_ip TEXT,
    src_port INTEGER CHECK (src_port IS NULL OR src_port BETWEEN 0 AND 65535),
    dst_port INTEGER CHECK (dst_port IS NULL OR dst_port BETWEEN 0 AND 65535),
    tcp_seq INTEGER CHECK (tcp_seq IS NULL OR tcp_seq BETWEEN 0 AND 4294967295),
    tcp_ack INTEGER CHECK (tcp_ack IS NULL OR tcp_ack BETWEEN 0 AND 4294967295),
    tcp_flags INTEGER CHECK (tcp_flags IS NULL OR tcp_flags BETWEEN 0 AND 511),
    payload_offset INTEGER,
    payload_length INTEGER,
    checksum_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (checksum_status IN ('UNKNOWN','VALID','INVALID','OFFLOADED')),
    diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics_json)),
    PRIMARY KEY (capture_id, packet_no),
    FOREIGN KEY (capture_id, interface_no) REFERENCES capture_interfaces(capture_id, interface_no),
    CHECK ((payload_offset IS NULL AND payload_length IS NULL) OR
        (payload_offset IS NOT NULL AND payload_length IS NOT NULL AND
         payload_offset >= 0 AND payload_length >= 0 AND payload_offset <= captured_length AND
         payload_length <= captured_length - payload_offset))
) STRICT;
CREATE INDEX idx_packets_flow ON packets(capture_id, src_ip, src_port, dst_ip, dst_port, packet_no);
CREATE TRIGGER packets_no_update BEFORE UPDATE ON packets
BEGIN SELECT RAISE(ABORT, 'captured packets are immutable'); END;
CREATE TRIGGER packets_no_delete BEFORE DELETE ON packets
BEGIN SELECT RAISE(ABORT, 'captured packets are immutable'); END;
