package storage_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/storage"
)

func newDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := storage.Open(context.Background(), filepath.Join(t.TempDir(), "workspace.sqlite"))
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

func project(t *testing.T, db *sql.DB, id string) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec("INSERT INTO projects(id,name,current_settings_version) VALUES(?,?,?)", id, id, id+"-settings"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec("INSERT INTO project_settings(id,project_id,version,settings_json) VALUES(?,?,1,'{}')", id+"-settings", id); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestProjectHasOwnedImmutableSettings(t *testing.T) {
	db := newDB(t)
	project(t, db, "p1")
	project(t, db, "p2")
	reject(t, db, "INSERT INTO projects(id,name) VALUES('unconfigured','invalid')")
	reject(t, db, "UPDATE projects SET current_settings_version='p2-settings' WHERE id='p1'")
	reject(t, db, "UPDATE project_settings SET settings_json='{\"changed\":true}' WHERE id='p1-settings'")
	reject(t, db, "DELETE FROM project_settings WHERE id='p1-settings'")
	exec(t, db, "INSERT INTO project_settings(id,project_id,version,settings_json) VALUES('p1-v2','p1',2,'{\"framing\":\"new\"}')")
	exec(t, db, "UPDATE projects SET current_settings_version='p1-v2' WHERE id='p1'")
	var count int
	if err := db.QueryRow("SELECT count(*) FROM project_settings WHERE project_id='p1'").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("old settings lost: %d", count)
	}
}

func TestResearchReferencesStayInProject(t *testing.T) {
	db := newDB(t)
	project(t, db, "p1")
	project(t, db, "p2")
	hash := strings.Repeat("a", 64)
	exec(t, db, "INSERT INTO journal_imports(id,project_id,original_name,source_path,sha256) VALUES('j1','p1','journal.csv','journals/j1.csv',?)", hash)
	reject(t, db, "INSERT INTO actions(id,project_id,journal_import_id,source_action_id,source_line,capture_path,start_unix_ns,end_unix_ns,name) VALUES('wrong','p2','j1','s',2,'capture.pcap',10,20,'set')")
	exec(t, db, "INSERT INTO actions(id,project_id,journal_import_id,source_action_id,source_line,capture_path,start_unix_ns,end_unix_ns,name) VALUES('a1','p1','j1','s',2,'capture.pcap',10,20,'set')")
	reject(t, db, "INSERT INTO observations(id,project_id,kind,text,action_id) VALUES('wrong','p2','HYPOTHESIS','Wrong project','a1')")
	exec(t, db, "INSERT INTO observations(id,project_id,kind,text,action_id) VALUES('o1','p1','HYPOTHESIS','Bytes contain the setpoint','a1')")
	reject(t, db, "INSERT INTO evidence(id,project_id,observation_id,kind,capture_sha256,packet_no,frame_offset,byte_length) VALUES('wrong','p2','o1','SUPPORT',?,1,2,2)", hash)
	exec(t, db, "INSERT INTO evidence(id,project_id,observation_id,kind,capture_sha256,packet_no,frame_offset,byte_length,assembly_id,stream_id,stream_offset) VALUES('e1','p1','o1','SUPPORT',?,1,2,2,'assembly1','stream1',0)", hash)
	reject(t, db, "UPDATE evidence SET stream_id=NULL WHERE id='e1'")
}

func TestReadyArtifactsNeedOwnedSnapshotAndChecksum(t *testing.T) {
	db := newDB(t)
	project(t, db, "p1")
	project(t, db, "p2")
	exec(t, db, "INSERT INTO snapshots(id,project_id,manifest_json,metadata_json) VALUES('snap1','p1','{}','{}')")
	reject(t, db, "UPDATE snapshots SET metadata_json='[]' WHERE id='snap1'")
	reject(t, db, "INSERT INTO artifacts(id,project_id,snapshot_id,kind,filename,content_type) VALUES('wrong','p2','snap1','PROJECT_ZIP','project.zip','application/zip')")
	exec(t, db, "INSERT INTO artifacts(id,project_id,snapshot_id,kind,filename,content_type) VALUES('export1','p1','snap1','PROJECT_ZIP','project.zip','application/zip')")
	reject(t, db, "UPDATE artifacts SET status='READY' WHERE id='export1'")
	exec(t, db, "UPDATE artifacts SET status='READY',relative_path='exports/project.zip',sha256=?,size_bytes=100 WHERE id='export1'", strings.Repeat("b", 64))
	reject(t, db, "UPDATE artifacts SET relative_path='another.zip' WHERE id='export1'")
	reject(t, db, "DELETE FROM artifacts WHERE id='export1'")
	reject(t, db, "INSERT INTO artifacts(id,project_id,snapshot_id,kind,status,filename,content_type,relative_path,sha256,size_bytes) VALUES('report1','p1','snap1','REPORT_MARKDOWN','READY','report.md','text/markdown','reports/1.md',?,100)", strings.Repeat("b", 64))
}

func TestJobsAndIdempotencyConstraints(t *testing.T) {
	db := newDB(t)
	project(t, db, "p1")
	reject(t, db, "INSERT INTO jobs(id,project_id,kind) VALUES('cap_wrong','p1','EXPORT')")
	exec(t, db, "INSERT INTO jobs(id,project_id,kind,progress_total) VALUES('ws_export','p1','EXPORT',10)")
	reject(t, db, "UPDATE jobs SET progress_completed=11 WHERE id='ws_export'")
	reject(t, db, "UPDATE jobs SET status='FAILED' WHERE id='ws_export'")
	exec(t, db, "UPDATE jobs SET status='FAILED',error_json='{\"code\":\"IO_ERROR\"}',finished_at='2026-10-11T12:00:00Z' WHERE id='ws_export'")
	query := "INSERT INTO idempotency_keys(scope,key,request_sha256,response_status,response_json,expires_at) VALUES(?,?,?,202,'{}','2026-10-12T00:00:00Z')"
	exec(t, db, query, "p1:export", "retry-1", strings.Repeat("c", 64))
	reject(t, db, query, "p1:export", "retry-1", strings.Repeat("c", 64))
	exec(t, db, query, "p1:journal", "retry-1", strings.Repeat("c", 64))
}
