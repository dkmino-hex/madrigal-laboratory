package storage_test

import (
	"context"
	"database/sql"
	"github.com/dkmino-hex/madrigal-laboratory/internal/database"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/storage"
	"strings"
	"testing"
	"time"
)

func secondDB(t *testing.T, db *sql.DB) *sql.DB {
	t.Helper()
	path, err := database.Path(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	second, err := storage.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { second.Close() })
	return second
}

func assertBlockedInsert(t *testing.T, other *sql.DB, held *sql.Tx, query, expected string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		close(started)
		tx, err := other.BeginTx(ctx, nil)
		if err != nil {
			result <- err
			return
		}
		defer tx.Rollback()
		_, err = tx.ExecContext(ctx, query)
		if err == nil {
			err = tx.Commit()
		}
		result <- err
	}()
	<-started
	select {
	case err := <-result:
		t.Fatalf("concurrent writer did not wait: %v", err)
	case <-time.After(150 * time.Millisecond):
	}
	if err := held.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-result:
		if err == nil || !strings.Contains(err.Error(), expected) {
			t.Fatalf("expected %q rejection, got %v", expected, err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}

func TestConcurrentOverlappingIntervals(t *testing.T) {
	db := newDB(t)
	seed(t, db)
	stream(t, db, 4, 4)
	other := secondDB(t, db)
	first, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer first.Rollback()
	if _, err = first.Exec("INSERT INTO stream_intervals VALUES('first','a1','t1',0,2,'DATA',x'0102')"); err != nil {
		t.Fatal(err)
	}
	assertBlockedInsert(t, other, first, "INSERT INTO stream_intervals VALUES('second','a1','t1',1,3,'DATA',x'0203')", "overlap")
}

func TestConcurrentCapturePublicationRejectsLatePacket(t *testing.T) {
	db := newDB(t)
	seed(t, db)
	other := secondDB(t, db)
	publish, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer publish.Rollback()
	if _, err = publish.Exec("UPDATE captures SET status='READY',packet_count=3 WHERE id='c1'"); err != nil {
		t.Fatal(err)
	}
	assertBlockedInsert(t, other, publish, "INSERT INTO packets(capture_id,packet_no,timestamp_seconds,timestamp_nanoseconds,captured_length,original_length,frame) VALUES('c1',4,0,0,0,0,x'')", "while importing")
}
