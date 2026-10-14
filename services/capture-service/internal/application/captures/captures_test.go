package captures_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/platform/testdatabase"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/filestore"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
)

func TestCaptureAtomicQueueCancellationAndRecovery(t *testing.T) {
	ctx := context.Background()
	dsn := testdatabase.New(t)
	db, err := storage.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	files, err := originals.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := captures.Store{Repository: storage.Store{DB: db}, Files: files}
	input, err := os.ReadFile("../../../../../testdata/sample_protocol/research/01_configuration.pcap")
	if err != nil {
		t.Fatal(err)
	}
	c, j, duplicate, err := store.AcceptOriginal(ctx, "p1", "../../original.pcap", strings.NewReader(string(input)))
	if err != nil || duplicate {
		t.Fatalf("accept: %v", err)
	}
	if c.Status != "IMPORTING" || j.Status != "QUEUED" || !strings.HasPrefix(j.ID, "cap_") || c.OriginalName != "original.pcap" {
		t.Fatalf("capture %+v job %+v", c, j)
	}
	c2, j2, duplicate, err := store.AcceptOriginal(ctx, "p1", "other.pcap", strings.NewReader(string(input)))
	if err != nil || !duplicate || c.ID != c2.ID || j.ID != j2.ID {
		t.Fatalf("duplicate: %+v %v", j2, err)
	}
	if _, err = store.Jobs().Cancel(ctx, j.ID); err != nil {
		t.Fatal(err)
	}
	c, err = store.Get(ctx, "p1", c.ID)
	if err != nil || c.Status != "CANCELLED" {
		t.Fatalf("queued cancel: %+v %v", c, err)
	}
	if _, err = store.Jobs().Claim(ctx, []string{captures.ImportKind}); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("claimed cancelled job: %v", err)
	}
	c, j, _, err = store.AcceptOriginal(ctx, "p2", "original.pcap", strings.NewReader(string(input)))
	if err != nil {
		t.Fatal(err)
	}
	j, err = store.Jobs().Claim(ctx, []string{captures.ImportKind})
	if err != nil {
		t.Fatal(err)
	}
	total := int64(10)
	if err = store.Jobs().Progress(ctx, j.ID, "INDEXING", 3, &total); err != nil {
		t.Fatal(err)
	}
	if err = store.Jobs().Finish(ctx, j.ID, "SUCCEEDED", nil); err == nil {
		t.Fatal("unindexed capture was published as ready")
	}
	db.Close()
	db, err = storage.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	store.Repository = storage.Store{DB: db}
	if err = store.Jobs().Recover(ctx); err != nil {
		t.Fatal(err)
	}
	j, err = store.Jobs().Get(ctx, j.ID)
	if err != nil || j.Status != "FAILED" || j.Error.Code != "PROCESS_INTERRUPTED" || j.Completed != 3 {
		t.Fatalf("recovery: %+v %v", j, err)
	}
	c, err = store.Get(ctx, "p2", c.ID)
	if err != nil || c.Status != "ERROR" {
		t.Fatalf("capture recovery: %+v %v", c, err)
	}
	if _, err = db.Exec("UPDATE captures SET status='READY',packet_count=0 WHERE id=?1", c.ID); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	a, j, err := (storage.Store{DB: db}).EnqueueAssemblyTx(ctx, tx, "p2", c.ID, "settings-v1", json.RawMessage(`{}`), "test")
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Jobs().Claim(ctx, []string{captures.AssembleKind}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Jobs().Cancel(ctx, j.ID); err != nil {
		t.Fatal(err)
	}
	if err = store.Jobs().Progress(ctx, j.ID, "ASSEMBLING", 1, nil); !errors.Is(err, jobs.ErrCancelled) {
		t.Fatalf("progress after cancel: %v", err)
	}
	if err = store.Jobs().Finish(ctx, j.ID, "SUCCEEDED", nil); err != nil {
		t.Fatal(err)
	}
	var status string
	if err = db.QueryRow("SELECT status FROM assemblies WHERE id=?1", a).Scan(&status); err != nil || status != "CANCELLED" {
		t.Fatalf("assembly: %s %v", status, err)
	}
	if err = store.Jobs().Recover(ctx); err != nil {
		t.Fatal(err)
	}
	if err = files.Verify(ctx, originals.Object{SHA256: c.SHA256, RelativePath: c.RelativePath, Size: c.Size, Format: c.Format}); err != nil {
		t.Fatal(err)
	}
}

func TestJobClaimAndWorker(t *testing.T) {
	ctx := context.Background()
	db, err := storage.Open(ctx, testdatabase.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := jobs.Store{DB: db, Prefix: "cap"}
	enqueue := func(kind string) jobs.Job {
		t.Helper()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		j, err := s.EnqueueTx(ctx, tx, "p1", kind, nil, map[string]string{})
		if err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		return j
	}
	j := enqueue("TEST")
	var wg sync.WaitGroup
	claimed := make(chan string, 8)
	for range 8 {
		wg.Go(func() {
			got, err := s.Claim(ctx, []string{"TEST"})
			if err == nil {
				claimed <- got.ID
			} else if !errors.Is(err, sql.ErrNoRows) {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	close(claimed)
	count := 0
	for id := range claimed {
		count++
		if id != j.ID {
			t.Fatal("wrong job")
		}
	}
	if count != 1 {
		t.Fatalf("claimed %d times", count)
	}
	if err = s.Finish(ctx, j.ID, "SUCCEEDED", nil); err != nil {
		t.Fatal(err)
	}
	rolled, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	rollbackJob, err := s.EnqueueTx(ctx, rolled, "p1", "TEST", nil, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	rolled.Rollback()
	if _, err = s.Get(ctx, rollbackJob.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("queue insert escaped transaction")
	}
	queued := enqueue("SLOW")
	unsupported := enqueue("NEXT_DAY")
	started := make(chan struct{})
	workerCtx, stop := context.WithCancel(ctx)
	defer stop()
	done := make(chan error, 1)
	go func() {
		done <- (jobs.Worker{Store: s, Handlers: map[string]jobs.Handler{"SLOW": func(work context.Context, j jobs.Job, progress func(string, int64, *int64) error) error {
			if err := progress("WORKING", 1, nil); err != nil {
				return err
			}
			close(started)
			<-work.Done()
			return work.Err()
		}}}).Run(workerCtx)
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not start")
	}
	secondCtx, secondStop := context.WithTimeout(ctx, time.Second)
	defer secondStop()
	if err = (jobs.Worker{Store: s}).Run(secondCtx); err == nil {
		t.Fatal("second worker acquired ownership")
	}
	if _, err = s.Cancel(ctx, queued.ID); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		got, err := s.Get(ctx, queued.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status == "CANCELLED" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("worker did not cancel")
		}
		time.Sleep(10 * time.Millisecond)
	}
	stillQueued, err := s.Get(ctx, unsupported.ID)
	if err != nil || stillQueued.Status != "QUEUED" {
		t.Fatalf("unsupported job: %+v %v", stillQueued, err)
	}
	stop()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not stop")
	}
}

func TestCapturePublicationRollbackAndOriginalAudit(t *testing.T) {
	ctx := context.Background()
	db, err := storage.Open(ctx, testdatabase.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	files, err := originals.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := captures.Store{Repository: storage.Store{DB: db}, Files: files}
	input, err := os.ReadFile("../../../../../testdata/sample_protocol/research/01_configuration.pcap")
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec("CREATE TRIGGER reject_job BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT,'simulated metadata failure'); END")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = s.AcceptOriginal(ctx, "p1", "original.pcap", strings.NewReader(string(input))); err == nil {
		t.Fatal("metadata failure was hidden")
	}
	var count int
	if err = db.QueryRow("SELECT (SELECT count(*) FROM captures)+(SELECT count(*) FROM jobs)").Scan(&count); err != nil || count != 0 {
		t.Fatalf("partial metadata count=%d err=%v", count, err)
	}
	if _, err = db.Exec("DROP TRIGGER reject_job"); err != nil {
		t.Fatal(err)
	}
	c, _, _, err := s.AcceptOriginal(ctx, "p1", "original.pcap", strings.NewReader(string(input)))
	if err != nil {
		t.Fatal(err)
	}
	if err = s.AuditOriginals(ctx); err != nil {
		t.Fatal(err)
	}
	f, err := files.Open(originals.Object{SHA256: c.SHA256, RelativePath: c.RelativePath, Size: c.Size, Format: c.Format})
	if err != nil {
		t.Fatal(err)
	}
	path := f.Name()
	f.Close()
	if err = os.WriteFile(path, []byte("changed outside service"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = s.AuditOriginals(ctx); err == nil {
		t.Fatal("audit accepted changed original")
	}
}
