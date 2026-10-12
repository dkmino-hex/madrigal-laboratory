package storage_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/storage"
)

func newDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := storage.Open(context.Background(), filepath.Join(t.TempDir(), "capture.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func exec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

func reject(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err == nil {
		t.Fatalf("expected rejection: %s", query)
	}
}

func seed(t *testing.T, db *sql.DB) {
	t.Helper()
	for index, id := range []string{"c1", "c2"} {
		exec(t, db, "INSERT INTO captures(id,project_id,sha256,original_name,relative_path,size_bytes,format) VALUES(?,'p1',?,'fixture.pcap',?,100,'PCAP')", id, strings.Repeat(string(rune('a'+index)), 64), "captures/"+id+".pcap")
		exec(t, db, "INSERT INTO capture_interfaces(capture_id,interface_no,link_type,snaplen) VALUES(?,0,1,65535)", id)
	}
	for index, frame := range [][]byte{{0xaa, 0xbb, 1, 2}, {0xaa, 0xbb, 1, 2}, {0xaa, 0xbb, 3, 4}} {
		exec(t, db, "INSERT INTO packets(capture_id,packet_no,timestamp_seconds,timestamp_nanoseconds,raw_timestamp_ticks,captured_length,original_length,frame,payload_offset,payload_length) VALUES('c1',?,0,0,'18446744073709551615',4,4,?,2,2)", index+1, frame)
	}
	exec(t, db, "INSERT INTO packets(capture_id,packet_no,timestamp_seconds,timestamp_nanoseconds,captured_length,original_length,frame,payload_offset,payload_length) VALUES('c2',1,0,0,4,4,?,2,2)", []byte{0xaa, 0xbb, 1, 2})
	exec(t, db, "INSERT INTO assemblies(id,project_id,capture_id,settings_version,settings_json,engine_version) VALUES('a1','p1','c1','settings-v1','{}','test-v1')")
	exec(t, db, "INSERT INTO sessions(id,assembly_id,capture_id,connection_key,generation,endpoint_a_ip,endpoint_a_port,endpoint_b_ip,endpoint_b_port,first_packet_no,last_packet_no) VALUES('s1','a1','c1','A:B',1,'10.0.0.1',12345,'10.0.0.2',46123,1,3)")
}

func stream(t *testing.T, db *sql.DB, length, known int) {
	t.Helper()
	exec(t, db, "INSERT INTO streams(id,assembly_id,session_id,direction,logical_length,known_bytes) VALUES('t1','a1','s1','A_TO_B',?,?)", length, known)
}

func span(t *testing.T, db *sql.DB, id, interval string, alternative any, offset, packet int) {
	t.Helper()
	exec(t, db, "INSERT INTO source_spans(id,interval_id,alternative_id,stream_offset,byte_length,capture_id,packet_no,frame_offset) VALUES(?,?,?,?,2,'c1',?,2)", id, interval, alternative, offset, packet)
}

func TestCaptureOriginalsAndPacketIndexAreImmutable(t *testing.T) {
	db := newDB(t)
	seed(t, db)
	reject(t, db, "UPDATE packets SET frame=x'00000102' WHERE capture_id='c1' AND packet_no=1")
	reject(t, db, "DELETE FROM packets WHERE capture_id='c1' AND packet_no=1")
	reject(t, db, "UPDATE captures SET sha256=? WHERE id='c1'", strings.Repeat("d", 64))
	reject(t, db, "UPDATE capture_interfaces SET timestamp_exponent=9 WHERE capture_id='c1'")
	reject(t, db, "UPDATE captures SET status='READY',packet_count=2 WHERE id='c1'")
	exec(t, db, "UPDATE captures SET status='READY',packet_count=3 WHERE id='c1'")
	reject(t, db, "UPDATE captures SET status='IMPORTING' WHERE id='c1'")
	reject(t, db, "INSERT INTO packets(capture_id,packet_no,timestamp_seconds,timestamp_nanoseconds,captured_length,original_length,frame) VALUES('c1',4,0,0,0,0,x'')")
	reject(t, db, "INSERT INTO capture_interfaces(capture_id,interface_no,link_type,snaplen) VALUES('c1',1,1,65535)")
	for _, values := range []string{
		"4,0,0,5,5,x'aabb0102',NULL",
		"4,0,1000000000,4,4,x'aabb0102',NULL",
		"4,0,0,4,4,x'aabb0102','18446744073709551616'",
		"4,0,0,4,4,x'aabb0102','-1'",
		"4,0,0,4,4,'text',NULL",
	} {
		reject(t, db, "INSERT INTO packets(capture_id,packet_no,timestamp_seconds,timestamp_nanoseconds,captured_length,original_length,frame,raw_timestamp_ticks) SELECT 'c2',"+values)
	}
}

func TestSourceMapPreservesRetransmissionsAndValidatesBytes(t *testing.T) {
	db := newDB(t)
	seed(t, db)
	stream(t, db, 4, 4)
	exec(t, db, "INSERT INTO stream_intervals VALUES('i1','a1','t1',0,2,'DATA',x'0102')")
	exec(t, db, "INSERT INTO stream_intervals VALUES('i2','a1','t1',2,4,'DATA',x'0304')")
	span(t, db, "m1", "i1", nil, 0, 1)
	span(t, db, "m2", "i1", nil, 0, 2)
	span(t, db, "m3", "i2", nil, 2, 3)
	var sources int
	if err := db.QueryRow("SELECT count(*) FROM source_spans WHERE interval_id='i1'").Scan(&sources); err != nil {
		t.Fatal(err)
	}
	if sources != 2 {
		t.Fatalf("retransmission sources lost: %d", sources)
	}
	for name, query := range map[string]string{
		"wrong bytes":            "INSERT INTO source_spans VALUES('bad','i1',NULL,0,2,'c1',3,2)",
		"header bytes":           "INSERT INTO source_spans VALUES('bad','i1',NULL,0,2,'c1',1,1)",
		"outside stream":         "INSERT INTO source_spans VALUES('bad','i1',NULL,1,2,'c1',1,2)",
		"other capture":          "INSERT INTO source_spans VALUES('bad','i1',NULL,0,2,'c2',1,2)",
		"duplicate source":       "INSERT INTO source_spans VALUES('bad','i1',NULL,0,2,'c1',1,2)",
		"overlapping interval":   "INSERT INTO stream_intervals VALUES('bad','a1','t1',1,3,'DATA',x'0203')",
		"out of bounds interval": "INSERT INTO stream_intervals VALUES('bad','a1','t1',4,6,'DATA',x'0102')",
	} {
		t.Run(name, func(t *testing.T) { reject(t, db, query) })
	}
	reject(t, db, "UPDATE source_spans SET packet_no=2 WHERE id='m1'")
	exec(t, db, "UPDATE assemblies SET status='READY',finished_at='2026-10-11T12:00:00Z' WHERE id='a1'")
	reject(t, db, "INSERT INTO source_spans VALUES('late','i1',NULL,0,1,'c1',1,2)")
	reject(t, db, "DELETE FROM source_spans WHERE id='m1'")
	reject(t, db, "UPDATE assemblies SET settings_version='settings-v2' WHERE id='a1'")
	reject(t, db, "UPDATE streams SET logical_length=10 WHERE id='t1'")
}

func TestGapsAndConflictsKeepUncertainty(t *testing.T) {
	db := newDB(t)
	seed(t, db)
	stream(t, db, 6, 2)
	exec(t, db, "INSERT INTO stream_intervals VALUES('data','a1','t1',0,2,'DATA',x'0102')")
	exec(t, db, "INSERT INTO stream_intervals VALUES('gap','a1','t1',2,4,'GAP',NULL)")
	exec(t, db, "INSERT INTO stream_intervals VALUES('conflict','a1','t1',4,6,'CONFLICT',NULL)")
	reject(t, db, "INSERT INTO source_spans VALUES('bad','gap',NULL,2,2,'c1',1,2)")
	reject(t, db, "INSERT INTO source_spans VALUES('bad','conflict',NULL,4,2,'c1',1,2)")
	reject(t, db, "INSERT INTO interval_alternatives VALUES('bad','data',x'0102')")
	reject(t, db, "INSERT INTO interval_alternatives VALUES('bad','conflict',x'01')")
	exec(t, db, "INSERT INTO interval_alternatives VALUES('alt1','conflict',x'0102')")
	exec(t, db, "INSERT INTO interval_alternatives VALUES('alt2','conflict',x'0304')")
	span(t, db, "m1", "conflict", "alt1", 4, 1)
	span(t, db, "m2", "conflict", "alt2", 4, 3)
	var gapHasNoData bool
	if err := db.QueryRow("SELECT data IS NULL FROM stream_intervals WHERE id='gap'").Scan(&gapHasNoData); err != nil {
		t.Fatal(err)
	}
	if !gapHasNoData {
		t.Fatal("gap was filled with bytes")
	}
	exec(t, db, "INSERT INTO sessions(id,assembly_id,capture_id,connection_key,generation,endpoint_a_ip,endpoint_a_port,endpoint_b_ip,endpoint_b_port,first_packet_no,last_packet_no) VALUES('s2','a1','c1','A:B',2,'10.0.0.1',12345,'10.0.0.2',46123,1,3)")
	reject(t, db, "INSERT INTO sessions(id,assembly_id,capture_id,connection_key,generation,endpoint_a_ip,endpoint_a_port,endpoint_b_ip,endpoint_b_port,first_packet_no,last_packet_no) VALUES('s3','a1','c1','A:B',2,'10.0.0.1',12345,'10.0.0.2',46123,1,3)")
	exec(t, db, "UPDATE assemblies SET status='READY',finished_at='2026-10-11T12:00:00Z' WHERE id='a1'")
	reject(t, db, "INSERT INTO interval_alternatives VALUES('late','conflict',x'0506')")
	reject(t, db, "DELETE FROM interval_alternatives WHERE id='alt1'")
}

func TestAssemblyViewPinsReadyOwnedRanges(t *testing.T) {
	db := newDB(t)
	seed(t, db)
	stream(t, db, 2, 2)
	exec(t, db, "INSERT INTO stream_intervals VALUES('data','a1','t1',0,2,'DATA',x'0102')")
	span(t, db, "m1", "data", nil, 0, 1)
	exec(t, db, "INSERT INTO assembly_views(id,project_id,manifest_json) VALUES('view1','p1','{}')")
	reject(t, db, "INSERT INTO assembly_view_items VALUES('view1','a1','t1',0,2)")
	exec(t, db, "UPDATE assemblies SET status='READY',finished_at='2026-10-11T12:00:00Z' WHERE id='a1'")
	reject(t, db, "INSERT INTO assembly_view_items VALUES('view1','a1','t1',0,3)")
	exec(t, db, "INSERT INTO assembly_views(id,project_id,manifest_json) VALUES('other','p2','{}')")
	reject(t, db, "INSERT INTO assembly_view_items VALUES('other','a1','t1',0,2)")
	exec(t, db, "INSERT INTO assembly_view_items VALUES('view1','a1','t1',0,2)")
	exec(t, db, "UPDATE assembly_views SET status='READY' WHERE id='view1'")
	reject(t, db, "INSERT INTO assembly_view_items VALUES('view1','a1','t1',0,1)")
	reject(t, db, "DELETE FROM assembly_view_items WHERE view_id='view1'")
	reject(t, db, "UPDATE assembly_views SET manifest_json='[]' WHERE id='view1'")
}
